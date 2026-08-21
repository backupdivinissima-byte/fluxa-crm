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

app.use((req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada. Consulte a documentação em /importar dentro do Fluxa CRM.' });
});

// Região fixa (us-central1) pra URL previsível:
// https://us-central1-fluxa-crm.cloudfunctions.net/api
exports.api = functions.region('us-central1').https.onRequest(app);
