// API do Fluxa CRM ("Importar / Sincronização" → "Importar via API").
//
// Permite que o sistema atual do cliente (ERP, e-commerce, planilha
// automatizada, etc.) envie clientes e vendedores diretamente pro Fluxa CRM
// por HTTP, sem precisar de uma pessoa baixando/subindo planilha manualmente.
//
// Autenticação: cabeçalho "X-Api-Key" com a chave gerada na tela
// "Importar / Sincronização" do Fluxa CRM (Configurações → Importar). A
// chave em si nunca fica salva no Firestore — só o hash SHA-256 dela — pra
// que nem um vazamento do banco de dados exponha as chaves de verdade.
//
// Mesma lógica de "upsert" (idempotente) já usada na importação por
// planilha: cliente é identificado pelo campo "cod", vendedor pelo campo
// "login" — reenviar o mesmo item várias vezes atualiza em vez de duplicar.
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

admin.initializeApp();
const db = admin.firestore();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '5mb' }));

const LIMITE_ITENS_POR_LISTA = 2000;
const TAMANHO_LOTE = 400; // limite do Firestore é 500 operações por batch

/** Mesmo algoritmo de src/lib/crmLogic.ts (idSeguro) — precisa gerar
 * exatamente o mesmo ID de documento que a importação por planilha, senão a
 * mesma empresa acaba com dois documentos diferentes pro mesmo código. */
function idSeguro(valor) {
  return (
    String(valor ?? '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || `id-${Math.random().toString(36).slice(2, 10)}`
  );
}

function semVazio(obj) {
  const limpo = { ...obj };
  for (const k of Object.keys(limpo)) {
    if (limpo[k] === undefined || limpo[k] === null || limpo[k] === '') delete limpo[k];
  }
  return limpo;
}

function sha256Hex(texto) {
  return crypto.createHash('sha256').update(texto, 'utf8').digest('hex');
}

/** Lê um valor de dentro de um objeto por um caminho "a.b.c" (aceita
 * também "a.0.b" pra índice de array). Caminho vazio devolve o próprio
 * objeto. Usado tanto pra achar a lista de clientes na resposta do ERP
 * quanto pra mapear cada campo dentro de cada item dessa lista. */
function valorPorCaminho(obj, caminho) {
  if (!caminho) return obj;
  return caminho
    .split('.')
    .map((p) => p.trim())
    .filter(Boolean)
    .reduce((atual, chave) => (atual == null ? undefined : atual[chave]), obj);
}

/** Resolve qual empresa é dona da chave enviada em X-Api-Key. Responde com
 * 401 (e retorna null) se a chave faltar, for inválida ou tiver sido
 * revogada — quem chamou já deve parar de processar nesse caso. */
async function empresaPelaChave(req, res) {
  const chave = req.header('X-Api-Key');
  if (!chave) {
    res.status(401).json({ erro: 'Cabeçalho "X-Api-Key" é obrigatório.' });
    return null;
  }
  const hash = sha256Hex(chave);
  const snap = await db.collection('empresas').where('apiKeyHash', '==', hash).limit(1).get();
  if (snap.empty) {
    res.status(401).json({ erro: 'Chave de API inválida ou revogada.' });
    return null;
  }
  const empresaDoc = snap.docs[0];
  return { id: empresaDoc.id, ...empresaDoc.data() };
}

// GET /v1/status — só confirma que a chave é válida, sem gravar nada.
// Útil pra testar a conexão antes de configurar o resto da integração.
app.get('/v1/status', async (req, res) => {
  const empresa = await empresaPelaChave(req, res);
  if (!empresa) return;
  res.json({ ok: true, empresa: empresa.nome ?? null });
});

// POST /v1/sincronizar — corpo: { "clientes": [...], "vendedores": [...] }
// (as duas listas são opcionais, mas pelo menos uma precisa vir preenchida).
app.post('/v1/sincronizar', async (req, res) => {
  const empresa = await empresaPelaChave(req, res);
  if (!empresa) return;

  const corpo = req.body && typeof req.body === 'object' ? req.body : {};
  const clientesEntrada = Array.isArray(corpo.clientes) ? corpo.clientes : [];
  const vendedoresEntrada = Array.isArray(corpo.vendedores) ? corpo.vendedores : [];

  if (clientesEntrada.length === 0 && vendedoresEntrada.length === 0) {
    res.status(400).json({ erro: 'Envie ao menos um item em "clientes" e/ou "vendedores".' });
    return;
  }
  if (clientesEntrada.length > LIMITE_ITENS_POR_LISTA || vendedoresEntrada.length > LIMITE_ITENS_POR_LISTA) {
    res.status(400).json({ erro: `Máximo de ${LIMITE_ITENS_POR_LISTA} itens por lista em cada requisição.` });
    return;
  }

  const empresaRef = db.collection('empresas').doc(empresa.id);
  const erros = [];

  const vendedoresExistentesSnap = await empresaRef.collection('vendedores').get();
  const loginsExistentes = new Set(vendedoresExistentesSnap.docs.map((d) => d.data().login).filter(Boolean));

  let lote = db.batch();
  let operacoesNoLote = 0;
  async function commitSeNecessario() {
    if (operacoesNoLote >= TAMANHO_LOTE) {
      await lote.commit();
      lote = db.batch();
      operacoesNoLote = 0;
    }
  }

  let clientesImportados = 0;
  let clientesIgnorados = 0;
  for (let i = 0; i < clientesEntrada.length; i++) {
    const c = clientesEntrada[i] && typeof clientesEntrada[i] === 'object' ? clientesEntrada[i] : {};
    const cod = String(c.cod ?? '').trim();
    if (!cod) {
      clientesIgnorados++;
      erros.push(`clientes[${i}]: campo "cod" é obrigatório — item ignorado.`);
      continue;
    }
    const dados = semVazio({
      cod,
      nome: c.nome,
      razao: c.razao,
      telefone: c.telefone,
      cnpj: c.cnpj,
      cidade: c.cidade,
      uf: c.uf,
      dtUltCompra: c.dtUltCompra,
      totalGeral: typeof c.totalGeral === 'number' ? c.totalGeral : undefined,
      cod_vendedor: c.cod_vendedor,
      vend_nome: c.vend_nome,
    });
    const ref = empresaRef.collection('clientes').doc(idSeguro(cod));
    lote.set(ref, dados, { merge: true });
    operacoesNoLote++;
    clientesImportados++;
    await commitSeNecessario();
  }

  let vendedoresImportados = 0;
  let vendedoresIgnorados = 0;
  for (let i = 0; i < vendedoresEntrada.length; i++) {
    const v = vendedoresEntrada[i] && typeof vendedoresEntrada[i] === 'object' ? vendedoresEntrada[i] : {};
    const nome = String(v.nome ?? '').trim();
    const login = String(v.login ?? '').trim();
    if (!nome || !login) {
      vendedoresIgnorados++;
      erros.push(`vendedores[${i}]: campos "nome" e "login" são obrigatórios — item ignorado.`);
      continue;
    }
    const jaExiste = loginsExistentes.has(login);
    const dados = { nome, login, ativo: true };
    if (v.senha) dados.senha = String(v.senha);
    else if (!jaExiste) dados.senha = Math.random().toString(36).slice(2, 8);
    if (typeof v.meta === 'number') dados.meta = v.meta;
    if (!jaExiste) dados.criadoEm = new Date().toISOString();
    const ref = empresaRef.collection('vendedores').doc(idSeguro(login));
    lote.set(ref, dados, { merge: true });
    operacoesNoLote++;
    vendedoresImportados++;
    loginsExistentes.add(login);
    await commitSeNecessario();
  }

  if (operacoesNoLote > 0) await lote.commit();

  res.json({ clientesImportados, clientesIgnorados, vendedoresImportados, vendedoresIgnorados, erros });
});

// ===== Sincronizar "puxando" do ERP da empresa (sentido oposto às rotas
// acima) — quem chama é o próprio Fluxa CRM (tela Importar/Sincronização,
// botão "Sincronizar agora"), autenticado com o token de login do admin,
// não com a X-Api-Key. A partir da URL/credencial salvas em
// empresas/{id}.erpConexao, este servidor busca a lista de clientes no
// sistema do cliente e importa pro Firestore (mesmo upsert por "cod" já
// usado em /v1/sincronizar). =====

/** Confere o token de login do Firebase Auth do admin que chamou, acha a
 * empresa dele e devolve os dois. Responde 401/403 (e retorna null) se o
 * token faltar, for inválido, ou se quem chamou não for admin dessa
 * empresa — quem chamou deve parar de processar nesse caso. */
async function empresaPeloAdminLogado(req, res) {
  const cabecalho = req.header('Authorization') ?? '';
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : null;
  if (!token) {
    res.status(401).json({ erro: 'Faça login como administrador pra usar esta função.' });
    return null;
  }
  let decodificado;
  try {
    decodificado = await admin.auth().verifyIdToken(token);
  } catch {
    res.status(401).json({ erro: 'Sessão inválida ou expirada. Faça login novamente.' });
    return null;
  }
  const perfilSnap = await db.collection('usuarios').doc(decodificado.uid).get();
  const perfil = perfilSnap.exists ? perfilSnap.data() : null;
  if (!perfil || perfil.papel !== 'admin' || !perfil.empresaId) {
    res.status(403).json({ erro: 'Só administradores podem sincronizar com o ERP.' });
    return null;
  }
  const empresaSnap = await db.collection('empresas').doc(perfil.empresaId).get();
  if (!empresaSnap.exists) {
    res.status(404).json({ erro: 'Empresa não encontrada.' });
    return null;
  }
  return { id: empresaSnap.id, ...empresaSnap.data() };
}

/** Monta os cabeçalhos HTTP pra chamar a API do ERP conforme o tipo de
 * autenticação configurado na tela "Conecte seu ERP". */
function cabecalhosAuthErp(conexao) {
  const headers = { Accept: 'application/json' };
  if (conexao.autenticacao === 'bearer' && conexao.valorAuth) {
    headers.Authorization = `Bearer ${conexao.valorAuth}`;
  } else if (conexao.autenticacao === 'header' && conexao.headerNome && conexao.valorAuth) {
    headers[conexao.headerNome] = conexao.valorAuth;
  } else if (conexao.autenticacao === 'basic' && conexao.usuarioBasic) {
    const par = `${conexao.usuarioBasic}:${conexao.valorAuth ?? ''}`;
    headers.Authorization = `Basic ${Buffer.from(par, 'utf8').toString('base64')}`;
  }
  return headers;
}

// POST /v1/sincronizar-de-erp[?preview=1] — busca a lista de clientes na
// API do ERP configurada pela empresa e importa pro Fluxa CRM. Com
// ?preview=1, só devolve os primeiros itens já mapeados, sem gravar nada
// (pra conferir o mapeamento de campos antes de sincronizar de verdade).
app.post('/v1/sincronizar-de-erp', async (req, res) => {
  const empresa = await empresaPeloAdminLogado(req, res);
  if (!empresa) return;

  const conexao = empresa.erpConexao;
  if (!conexao || !conexao.url) {
    res.status(400).json({ erro: 'Configure a URL da API do seu ERP na tela Importar/Sincronização antes de sincronizar.' });
    return;
  }
  if (!conexao.mapeamento || !conexao.mapeamento.cod) {
    res.status(400).json({ erro: 'Mapeie ao menos o campo "Código do cliente" antes de sincronizar.' });
    return;
  }

  const ehPreview = req.query.preview === '1';

  let respostaBruta;
  try {
    const resposta = await fetch(conexao.url, { headers: cabecalhosAuthErp(conexao) });
    if (!resposta.ok) {
      res.status(502).json({ erro: `O ERP respondeu com erro HTTP ${resposta.status}. Confira a URL e a autenticação.` });
      return;
    }
    respostaBruta = await resposta.json();
  } catch (e) {
    res.status(502).json({ erro: `Não foi possível conectar na API do ERP: ${e.message ?? 'erro desconhecido'}.` });
    return;
  }

  const lista = valorPorCaminho(respostaBruta, conexao.listaPath ?? '');
  if (!Array.isArray(lista)) {
    res.status(400).json({
      erro: conexao.listaPath
        ? `O caminho "${conexao.listaPath}" não aponta pra uma lista na resposta do ERP.`
        : 'A resposta do ERP não é uma lista. Preencha "Caminho da lista" com o campo onde ela está (ex.: "data.clientes").',
    });
    return;
  }
  if (lista.length > LIMITE_ITENS_POR_LISTA) {
    res.status(400).json({ erro: `A resposta do ERP trouxe mais de ${LIMITE_ITENS_POR_LISTA} itens — sincronize em lotes menores do lado do ERP, se possível.` });
    return;
  }

  const erros = [];
  const mapeados = [];
  for (let i = 0; i < lista.length; i++) {
    const item = lista[i] && typeof lista[i] === 'object' ? lista[i] : {};
    const cod = String(valorPorCaminho(item, conexao.mapeamento.cod) ?? '').trim();
    if (!cod) {
      erros.push(`item[${i}]: não achou valor em "${conexao.mapeamento.cod}" — item ignorado.`);
      continue;
    }
    const totalBruto = valorPorCaminho(item, conexao.mapeamento.totalGeral);
    mapeados.push(
      semVazio({
        cod,
        nome: valorPorCaminho(item, conexao.mapeamento.nome),
        razao: valorPorCaminho(item, conexao.mapeamento.razao),
        telefone: valorPorCaminho(item, conexao.mapeamento.telefone),
        cnpj: valorPorCaminho(item, conexao.mapeamento.cnpj),
        cidade: valorPorCaminho(item, conexao.mapeamento.cidade),
        uf: valorPorCaminho(item, conexao.mapeamento.uf),
        dtUltCompra: valorPorCaminho(item, conexao.mapeamento.dtUltCompra),
        totalGeral: typeof totalBruto === 'number' ? totalBruto : Number(totalBruto) || undefined,
        cod_vendedor: valorPorCaminho(item, conexao.mapeamento.cod_vendedor),
        vend_nome: valorPorCaminho(item, conexao.mapeamento.vend_nome),
      })
    );
  }

  if (ehPreview) {
    res.json({ totalRecebido: lista.length, clientesImportados: 0, clientesIgnorados: erros.length, erros, amostra: mapeados.slice(0, 5) });
    return;
  }

  const empresaRef = db.collection('empresas').doc(empresa.id);
  let lote = db.batch();
  let operacoesNoLote = 0;
  async function commitSeNecessario() {
    if (operacoesNoLote >= TAMANHO_LOTE) {
      await lote.commit();
      lote = db.batch();
      operacoesNoLote = 0;
    }
  }
  for (const dados of mapeados) {
    const ref = empresaRef.collection('clientes').doc(idSeguro(dados.cod));
    lote.set(ref, dados, { merge: true });
    operacoesNoLote++;
    await commitSeNecessario();
  }
  if (operacoesNoLote > 0) await lote.commit();
  await empresaRef.update({ 'erpConexao.ultimaSincronizacao': new Date().toISOString() });

  res.json({ totalRecebido: lista.length, clientesImportados: mapeados.length, clientesIgnorados: erros.length, erros });
});

// ===== Marketing — Meta Ads e Instagram (Fase 2 do módulo Marketing) =====
//
// Mesma autenticação de /v1/sincronizar-de-erp (token de login do admin via
// Authorization: Bearer, ver empresaPeloAdminLogado acima) — quem chama é o
// próprio Fluxa CRM (telas Meta/Live do módulo Marketing), não um sistema
// externo. As credenciais (Empresa.metaAdsConexao/instagramConexao) são
// configuradas nessas telas, mesmo padrão de Empresa.erpConexao: token
// gravado em texto, nunca reexibido depois de salvo.
//
// AVISO: estas duas rotas dependem de credenciais reais (token do Meta
// Business Manager / Instagram) que ainda não existem em produção — o
// código abaixo segue a documentação pública da Graph API do Meta, mas
// precisa ser testado e ajustado assim que houver um token de teste. Até
// lá, ambas respondem com um erro claro em vez de travar a tela: quem
// chamou (telas Meta/Live) sempre tem a entrada manual/importação de
// planilha como alternativa que já funciona hoje.

const META_GRAPH_VERSION = 'v21.0';

// POST /v1/meta/sincronizar — busca as campanhas da conta de anúncios
// configurada (Empresa.metaAdsConexao) na Marketing API do Meta e grava um
// snapshot em campanhasMeta (mês corrente), mesmo formato usado pela
// importação manual de planilha (ver importarCampanhasMeta no frontend).
app.post('/v1/meta/sincronizar', async (req, res) => {
  const empresa = await empresaPeloAdminLogado(req, res);
  if (!empresa) return;

  const conexao = empresa.metaAdsConexao;
  if (!conexao || !conexao.contaAnuncioId || !conexao.tokenAcesso) {
    res.status(400).json({ erro: 'Conecte sua conta do Meta Ads (ID da conta + token) na aba Meta antes de sincronizar.' });
    return;
  }

  const contaId = conexao.contaAnuncioId.startsWith('act_') ? conexao.contaAnuncioId : `act_${conexao.contaAnuncioId}`;
  const base = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

  try {
    // 1) Dados cadastrais da campanha (nome, status, orçamento) — a API de
    // insights (passo 2) não traz essas colunas.
    const urlCampanhas = `${base}/${contaId}/campaigns?fields=id,name,status,daily_budget,lifetime_budget&limit=200&access_token=${encodeURIComponent(conexao.tokenAcesso)}`;
    const respCampanhas = await fetch(urlCampanhas);
    const dadosCampanhas = await respCampanhas.json();
    if (!respCampanhas.ok) {
      res.status(502).json({ erro: `Meta Ads respondeu com erro ao listar campanhas: ${dadosCampanhas?.error?.message ?? respCampanhas.status}.` });
      return;
    }

    // 2) Métricas de desempenho do mês corrente por campanha.
    const urlInsights = `${base}/${contaId}/insights?level=campaign&date_preset=this_month&fields=campaign_id,campaign_name,spend,impressions,reach,actions,cost_per_action_type&limit=200&access_token=${encodeURIComponent(conexao.tokenAcesso)}`;
    const respInsights = await fetch(urlInsights);
    const dadosInsights = await respInsights.json();
    if (!respInsights.ok) {
      res.status(502).json({ erro: `Meta Ads respondeu com erro ao buscar resultados: ${dadosInsights?.error?.message ?? respInsights.status}.` });
      return;
    }

    const insightsPorCampanha = new Map((dadosInsights.data ?? []).map((i) => [i.campaign_id, i]));
    const hoje = new Date().toISOString().slice(0, 10);
    const mesReferencia = hoje.slice(0, 7);

    const statusMap = { ACTIVE: 'ativa', PAUSED: 'pausada', DELETED: 'removida', ARCHIVED: 'removida' };

    const campanhas = (dadosCampanhas.data ?? []).map((c) => {
      const insight = insightsPorCampanha.get(c.id);
      const primeiraAcao = Array.isArray(insight?.actions) && insight.actions.length > 0 ? insight.actions[0] : null;
      const custoPorAcao =
        primeiraAcao && Array.isArray(insight?.cost_per_action_type)
          ? insight.cost_per_action_type.find((a) => a.action_type === primeiraAcao.action_type)
          : null;
      return semVazio({
        nome: c.name,
        status: statusMap[c.status] ?? 'em_revisao',
        resultado: primeiraAcao ? Number(primeiraAcao.value) : undefined,
        tipoResultado: primeiraAcao?.action_type,
        alcance: insight?.reach ? Number(insight.reach) : undefined,
        impressoes: insight?.impressions ? Number(insight.impressions) : undefined,
        custoPorResultado: custoPorAcao ? Number(custoPorAcao.value) : undefined,
        orcamento: c.daily_budget ? Number(c.daily_budget) / 100 : c.lifetime_budget ? Number(c.lifetime_budget) / 100 : undefined,
        orcamentoTipo: c.daily_budget ? 'diario' : c.lifetime_budget ? 'total' : undefined,
        valorGasto: insight?.spend ? Number(insight.spend) : undefined,
        atualizadoEm: hoje,
        origem: 'api',
      });
    });

    // Substitui o snapshot do mês corrente (mesmo critério da importação
    // manual — ver importarCampanhasMeta no frontend) antes de gravar o novo.
    const campanhasCol = db.collection('empresas').doc(empresa.id).collection('campanhasMeta');
    const antigasSnap = await campanhasCol.get();
    const lote = db.batch();
    for (const d of antigasSnap.docs) {
      if ((d.data().atualizadoEm ?? '').slice(0, 7) === mesReferencia) lote.delete(d.ref);
    }
    for (const c of campanhas) {
      lote.set(campanhasCol.doc(), c);
    }
    lote.update(db.collection('empresas').doc(empresa.id), { 'metaAdsConexao.ultimaSincronizacao': new Date().toISOString() });
    await lote.commit();

    res.json({ campanhasImportadas: campanhas.length });
  } catch (e) {
    res.status(502).json({ erro: `Não foi possível falar com o Meta Ads agora: ${e.message ?? 'erro desconhecido'}.` });
  }
});

// POST /v1/instagram/live-insights — corpo: { "liveId": "..." }. Tenta achar
// a transmissão ao vivo correspondente na conta do Instagram (por horário) e
// devolver visualizações/pico de pessoas online, quando a API oferecer esse
// dado pra aquela live. A cobertura da Graph API pra métricas de live
// PASSADA é limitada — por isso qualquer falha aqui devolve um erro
// explicativo, nunca trava a tela: a aba Live sempre aceita preenchimento
// manual como alternativa.
app.post('/v1/instagram/live-insights', async (req, res) => {
  const empresa = await empresaPeloAdminLogado(req, res);
  if (!empresa) return;

  const conexao = empresa.instagramConexao;
  if (!conexao || !conexao.contaInstagramId || !conexao.tokenAcesso) {
    res.status(400).json({ erro: 'Conecte sua conta do Instagram (ID da conta comercial + token) na aba Live antes de buscar automaticamente.' });
    return;
  }

  const liveId = req.body?.liveId;
  if (!liveId) {
    res.status(400).json({ erro: 'Informe o ID da live.' });
    return;
  }

  const liveSnap = await db.collection('empresas').doc(empresa.id).collection('lives').doc(String(liveId)).get();
  if (!liveSnap.exists) {
    res.status(404).json({ erro: 'Live não encontrada.' });
    return;
  }
  const live = liveSnap.data();

  const base = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
  try {
    // Lista as transmissões ao vivo recentes da conta e tenta achar a que
    // bate com a data/horário cadastrados no Fluxa CRM.
    const url = `${base}/${conexao.contaInstagramId}/live_media?fields=id,timestamp&access_token=${encodeURIComponent(conexao.tokenAcesso)}`;
    const resp = await fetch(url);
    const dados = await resp.json();
    if (!resp.ok) {
      res.status(502).json({ erro: `Instagram respondeu com erro: ${dados?.error?.message ?? resp.status}.` });
      return;
    }
    const candidata = (dados.data ?? []).find((m) => String(m.timestamp ?? '').slice(0, 10) === live.data);
    if (!candidata) {
      res.status(404).json({ erro: 'Não encontrei essa live na conta do Instagram conectada — preencha os números manualmente.' });
      return;
    }
    const urlInsights = `${base}/${candidata.id}/insights?metric=live_views&access_token=${encodeURIComponent(conexao.tokenAcesso)}`;
    const respInsights = await fetch(urlInsights);
    const dadosInsights = await respInsights.json();
    if (!respInsights.ok) {
      res.status(502).json({ erro: `Instagram respondeu com erro ao buscar métricas: ${dadosInsights?.error?.message ?? respInsights.status}.` });
      return;
    }
    const visualizacoes = dadosInsights.data?.[0]?.values?.[0]?.value;
    res.json({ visualizacoes: typeof visualizacoes === 'number' ? visualizacoes : undefined });
  } catch (e) {
    res.status(502).json({ erro: `Não foi possível falar com o Instagram agora: ${e.message ?? 'erro desconhecido'}.` });
  }
});

app.use((req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada. Consulte a documentação em /importar dentro do Fluxa CRM.' });
});

// Região fixa (us-central1) pra URL previsível:
// https://us-central1-fluxa-crm.cloudfunctions.net/api
exports.api = functions.region('us-central1').https.onRequest(app);
