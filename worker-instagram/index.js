// Fluxa CRM — recebe os comentários das lives do Instagram (webhook da Meta)
// e grava no Firestore da empresa. Roda de graça no Cloudflare Workers.
//
// Variáveis (Cloudflare → Settings → Variables and Secrets):
//   VERIFY_TOKEN          texto que você inventa; igual ao do painel da Meta
//   APP_SECRET            "Chave secreta do app do Instagram" (secret)
//   EMPRESAS_JSON         mapa {"<id da conta do Instagram>": "<id da empresa no Fluxa>"}
//                         (um servidor atende várias empresas: Divinissima, Carla Fidelis...)
//   EMPRESA_ID            (opcional) empresa padrão, se EMPRESAS_JSON não tiver a conta
//   FIREBASE_PROJECT_ID   fluxa-crm
//   SERVICE_ACCOUNT_JSON  JSON da conta de serviço do Firebase (secret)

const enc = new TextEncoder();

function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function assinaturaValida(corpo, cabecalho, segredo) {
  if (!cabecalho || !cabecalho.startsWith('sha256=')) return false;
  const chave = await crypto.subtle.importKey('raw', enc.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', chave, enc.encode(corpo));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const recebido = cabecalho.slice(7);
  if (hex.length !== recebido.length) return false;
  let dif = 0;
  for (let i = 0; i < hex.length; i++) dif |= hex.charCodeAt(i) ^ recebido.charCodeAt(i);
  return dif === 0;
}

let cacheToken = { valor: '', expira: 0 };

async function tokenGoogle(env) {
  if (cacheToken.valor && Date.now() < cacheToken.expira) return cacheToken.valor;
  const conta = JSON.parse(env.SERVICE_ACCOUNT_JSON);
  const agora = Math.floor(Date.now() / 1000);
  const cab = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const corpo = b64url(
    enc.encode(
      JSON.stringify({
        iss: conta.client_email,
        scope: 'https://www.googleapis.com/auth/datastore',
        aud: 'https://oauth2.googleapis.com/token',
        iat: agora,
        exp: agora + 3600,
      })
    )
  );
  const pem = conta.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const chave = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', chave, enc.encode(`${cab}.${corpo}`));
  const jwt = `${cab}.${corpo}.${b64url(sig)}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('Falha ao autenticar no Google: ' + JSON.stringify(j));
  cacheToken = { valor: j.access_token, expira: Date.now() + 50 * 60 * 1000 };
  return cacheToken.valor;
}

function empresaDaConta(env, contaIg) {
  try {
    const mapa = JSON.parse(env.EMPRESAS_JSON || '{}');
    if (mapa[contaIg]) return mapa[contaIg];
  } catch {
    /* JSON inválido: usa o padrão */
  }
  return env.EMPRESA_ID || '';
}

function base(env, empresaId) {
  return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/empresas/${empresaId}/instagramLives`;
}

// Cria o documento só se ele ainda não existir (um por @, sem repetir).
async function criarSeNovo(env, url, campos) {
  const token = await tokenGoogle(env);
  const r = await fetch(`${url}?currentDocument.exists=false`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: campos }),
  });
  if (r.status === 409 || r.status === 400) return false; // já existia
  if (!r.ok) throw new Error(`Firestore ${r.status}: ${await r.text()}`);
  return true;
}

async function atualizarLive(env, empresaId, liveId, quando) {
  const token = await tokenGoogle(env);
  const qs = ['iniciadaEm', 'atualizadoEm'].map((m) => `updateMask.fieldPaths=${m}`).join('&');
  const r = await fetch(`${base(env, empresaId)}/${liveId}?${qs}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { iniciadaEm: { stringValue: quando }, atualizadoEm: { stringValue: new Date().toISOString() } } }),
  });
  if (!r.ok) throw new Error(`Firestore ${r.status}: ${await r.text()}`);
}

// Guarda só o @ (primeira vez que aparece na live) — poupa a cota do banco.
async function guardarComentario(env, c) {
  if (!c.empresaId) return; // conta do Instagram sem empresa cadastrada: ignora
  const url = base(env, c.empresaId);
  const novo = await criarSeNovo(env, `${url}/${c.liveId}/arrobas/${encodeURIComponent(c.arroba)}`, {
    arroba: { stringValue: c.arroba },
    texto: { stringValue: c.texto },
    quando: { stringValue: c.quando },
  });
  if (novo) await atualizarLive(env, c.empresaId, c.liveId, c.quando);
}


// ===== Mensagens diretas: Instagram Direct e Messenger =====
// Variáveis extras:
//   CHAT_PROJECT_ID  projeto do Fluxa Chat (fluxa-chat-a052d): conversas e fila. FIREBASE_PROJECT_ID (fluxa-crm) fica só para as lives.
//   TOKENS_JSON  {"<idDaEmpresa>:instagram": "<token>", "<idDaEmpresa>:facebook": "<token da Página>"}
//                (usados para responder e para buscar o nome do contato)

const DOCS = (env) => `projects/${env.CHAT_PROJECT_ID || env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

async function commitFirestore(env, writes) {
  const token = await tokenGoogle(env);
  const r = await fetch(`https://firestore.googleapis.com/v1/${DOCS(env)}:commit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes }),
  });
  if (!r.ok) throw new Error(`Firestore commit ${r.status}: ${await r.text()}`);
}

function tokenDoCanal(env, empresaId, canal) {
  try {
    return JSON.parse(env.TOKENS_JSON || '{}')[`${empresaId}:${canal}`] || '';
  } catch {
    return '';
  }
}

async function nomeDoContato(env, empresaId, canal, idContato) {
  const t = tokenDoCanal(env, empresaId, canal);
  if (!t) return '';
  const host = canal === 'instagram' ? 'graph.instagram.com' : 'graph.facebook.com';
  const campos = canal === 'instagram' ? 'name,username' : 'name';
  try {
    const r = await fetch(`https://${host}/v21.0/${idContato}?fields=${campos}&access_token=${encodeURIComponent(t)}`);
    const j = await r.json();
    return j.name || (j.username ? `@${j.username}` : '');
  } catch {
    return '';
  }
}

async function guardarMensagemDireta(env, canal, empresaId, evento) {
  const msg = evento.message;
  if (!msg || msg.is_echo || !msg.mid) return; // ignora ecos das nossas próprias respostas
  const contato = String(evento.sender?.id ?? '');
  if (!contato) return;
  const texto = msg.text || (msg.attachments?.length ? '[anexo]' : '[mensagem]');
  const quando = new Date(Number(evento.timestamp ?? Date.now())).toISOString();
  const idConversa = `${canal}_${contato}`;
  const raiz = `${DOCS(env)}/empresas/${empresaId}/conversas/${idConversa}`;

  // Só busca o nome quando a conversa ainda não tem um.
  const token = await tokenGoogle(env);
  const atual = await fetch(`https://firestore.googleapis.com/v1/${raiz}?mask.fieldPaths=nome`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  let nome = '';
  const conversaNova = atual.status === 404;
  if (atual.status === 404 || !(await atual.json().catch(() => ({}))).fields?.nome) {
    nome = (await nomeDoContato(env, empresaId, canal, contato)) || contato;
  }

  await commitFirestore(env, [
    {
      update: {
        name: raiz,
        fields: {
          canal: { stringValue: canal },
          contato: { stringValue: contato },
          ...(nome ? { nome: { stringValue: nome } } : {}),
          ultimaMensagem: { stringValue: texto },
          ultimaEm: { stringValue: quando },
          ultimaDe: { stringValue: 'cliente' },
          ...(conversaNova ? { primeiroContato: { booleanValue: true } } : {}),
        },
      },
      updateMask: { fieldPaths: ['canal', 'contato', ...(nome ? ['nome'] : []), 'ultimaMensagem', 'ultimaEm', 'ultimaDe', ...(conversaNova ? ['primeiroContato'] : [])] },
      updateTransforms: [{ fieldPath: 'naoLidas', increment: { integerValue: '1' } }],
    },
    {
      update: {
        name: `${raiz}/mensagens/${encodeURIComponent(msg.mid)}`,
        fields: { de: { stringValue: 'cliente' }, texto: { stringValue: texto }, em: { stringValue: quando } },
      },
    },
  ]);
}

async function tratarMensagensDiretas(env, corpo) {
  const canal = corpo.object === 'instagram' ? 'instagram' : 'facebook';
  for (const entrada of corpo.entry ?? []) {
    const empresaId = empresaDaConta(env, String(entrada.id ?? ''));
    if (!empresaId) continue;
    for (const evento of entrada.messaging ?? []) await guardarMensagemDireta(env, canal, empresaId, evento);
  }
}

// Respostas escritas no Fluxa para Instagram/Messenger: a cada minuto o
// servidor lê a fila (chatSaida) e envia pela API da Meta.
async function enviarFila(env) {
  const empresas = [...new Set(Object.values(JSON.parse(env.EMPRESAS_JSON || '{}')))];
  if (env.EMPRESA_ID && !empresas.includes(env.EMPRESA_ID)) empresas.push(env.EMPRESA_ID);
  const token = await tokenGoogle(env);
  for (const empresaId of empresas) {
    const r = await fetch(`https://firestore.googleapis.com/v1/${DOCS(env)}/empresas/${empresaId}:runQuery`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'chatSaida' }],
          where: { fieldFilter: { field: { fieldPath: 'enviada' }, op: 'EQUAL', value: { booleanValue: false } } },
          limit: 20,
        },
      }),
    });
    if (!r.ok) continue;
    for (const linha of await r.json()) {
      const doc = linha.document;
      if (!doc) continue;
      const f = doc.fields ?? {};
      const canal = f.canal?.stringValue;
      if (canal !== 'instagram' && canal !== 'facebook') continue; // WhatsApp é do conector
      const agendada = f.agendadaPara?.stringValue;
      if (agendada && new Date(agendada).getTime() > Date.now()) continue; // stand-by
      let erro = '';
      const t = tokenDoCanal(env, empresaId, canal);
      if (!t) erro = `sem token de ${canal} no servidor`;
      else {
        const host = canal === 'instagram' ? 'graph.instagram.com' : 'graph.facebook.com';
        const envio = await fetch(`https://${host}/v21.0/me/messages?access_token=${encodeURIComponent(t)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: f.para?.stringValue },
            ...(canal === 'facebook' ? { messaging_type: 'RESPONSE' } : {}),
            message: { text: f.texto?.stringValue ?? '' },
          }),
        });
        if (!envio.ok) erro = `${envio.status}: ${(await envio.text()).slice(0, 300)}`;
      }
      await commitFirestore(env, [
        {
          update: {
            name: doc.name,
            fields: { enviada: { booleanValue: true }, ...(erro ? { erro: { stringValue: erro } } : { enviadaEm: { stringValue: new Date().toISOString() } }) },
          },
          updateMask: { fieldPaths: ['enviada', erro ? 'erro' : 'enviadaEm'] },
        },
      ]);
      if (!erro && f.jaRegistrada?.booleanValue === false && f.conversaId?.stringValue) {
        const em = new Date().toISOString();
        const base = `${DOCS(env)}/empresas/${empresaId}/conversas/${f.conversaId.stringValue}`;
        await commitFirestore(env, [
          {
            update: {
              name: `${base}/mensagens/ag_${doc.name.split('/').pop()}`,
              fields: { de: { stringValue: 'equipe' }, texto: { stringValue: f.texto?.stringValue ?? '' }, em: { stringValue: em }, autor: { stringValue: f.autor?.stringValue ?? '' } },
            },
          },
          {
            update: {
              name: base,
              fields: { ultimaMensagem: { stringValue: f.texto?.stringValue ?? '' }, ultimaEm: { stringValue: em }, ultimaDe: { stringValue: 'equipe' } },
            },
            updateMask: { fieldPaths: ['ultimaMensagem', 'ultimaEm', 'ultimaDe'] },
          },
        ]);
      }
    }
  }
}


// ===== Leitura direta (sem mexer no webhook da Meta que já existe) =====
// A cada minuto o Fluxa pergunta ao Instagram: "chegou mensagem direta nova?" e "tem live no ar? quais @ comentaram?".
// Usa o token do Instagram (TOKENS_JSON: "<idDaEmpresa>:instagram"). Não depende do webhook.
async function igGet(t, caminho) {
  const r = await fetch(`https://graph.instagram.com/v21.0/${caminho}${caminho.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(t)}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Instagram ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

async function atualizarConversaDm(env, empresaId, contato, texto, quando, nomeSugerido) {
  const raiz = `${DOCS(env)}/empresas/${empresaId}/conversas/instagram_${contato}`;
  const token = await tokenGoogle(env);
  const atual = await fetch(`https://firestore.googleapis.com/v1/${raiz}?mask.fieldPaths=nome`, { headers: { Authorization: `Bearer ${token}` } });
  const conversaNova = atual.status === 404;
  const semNome = conversaNova || !(await atual.json().catch(() => ({}))).fields?.nome;
  const nome = semNome ? nomeSugerido || contato : '';
  await commitFirestore(env, [
    {
      update: {
        name: raiz,
        fields: {
          canal: { stringValue: 'instagram' },
          contato: { stringValue: contato },
          ...(nome ? { nome: { stringValue: nome } } : {}),
          ultimaMensagem: { stringValue: texto },
          ultimaEm: { stringValue: quando },
          ultimaDe: { stringValue: 'cliente' },
          ...(conversaNova ? { primeiroContato: { booleanValue: true } } : {}),
        },
      },
      updateMask: { fieldPaths: ['canal', 'contato', ...(nome ? ['nome'] : []), 'ultimaMensagem', 'ultimaEm', 'ultimaDe', ...(conversaNova ? ['primeiroContato'] : [])] },
      updateTransforms: [{ fieldPath: 'naoLidas', increment: { integerValue: '1' } }],
    },
  ]);
}

async function sincronizarDiretas(env, empresaId, t, meuId) {
  const j = await igGet(t, 'me/conversations?platform=instagram&limit=8&fields=id,updated_time,messages.limit(4){id,message,from,created_time,attachments}');
  const limite = Date.now() - 20 * 60 * 1000; // só olha o que chegou nos últimos 20 minutos
  let novas = 0;
  for (const conv of j.data ?? []) {
    for (const m of conv.messages?.data ?? []) {
      if (novas >= 8) return;
      const de = String(m.from?.id ?? '');
      if (!de || de === meuId) continue; // as nossas próprias respostas já estão no Fluxa
      const quando = new Date(m.created_time).toISOString();
      if (new Date(quando).getTime() < limite) continue;
      const texto = m.message || (m.attachments?.data?.length ? '[anexo]' : '[mensagem]');
      const token = await tokenGoogle(env);
      const raiz = `${DOCS(env)}/empresas/${empresaId}/conversas/instagram_${de}`;
      const r = await fetch(`https://firestore.googleapis.com/v1/${raiz}/mensagens/${encodeURIComponent(m.id)}?currentDocument.exists=false`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { de: { stringValue: 'cliente' }, texto: { stringValue: texto }, em: { stringValue: quando } } }),
      });
      if (r.status === 409 || r.status === 400) continue; // já estava no Fluxa
      if (!r.ok) throw new Error(`Firestore ${r.status}: ${await r.text()}`);
      novas++;
      await atualizarConversaDm(env, empresaId, de, texto, quando, m.from?.username ? `@${m.from.username}` : '');
    }
  }
}

async function sincronizarLives(env, empresaId, t) {
  let lives;
  try {
    lives = await igGet(t, 'me/live_media?fields=id,timestamp');
  } catch {
    return; // sem live no ar (ou a Meta não liberou): tenta de novo no próximo minuto
  }
  let gravados = 0;
  for (const live of (lives.data ?? []).slice(0, 2)) {
    let com;
    try {
      com = await igGet(t, `${live.id}/comments?fields=id,text,username,timestamp&limit=50`);
    } catch {
      continue;
    }
    for (const c of com.data ?? []) {
      if (gravados >= 20) return;
      const arroba = String(c.username ?? '').trim().toLowerCase();
      if (!arroba) continue;
      gravados++;
      await guardarComentario(env, { empresaId, liveId: String(live.id), arroba, texto: String(c.text ?? ''), quando: c.timestamp ? new Date(c.timestamp).toISOString() : new Date().toISOString() });
    }
  }
}

async function sincronizarInstagram(env) {
  let tokens = {};
  try {
    tokens = JSON.parse(env.TOKENS_JSON || '{}');
  } catch {
    return;
  }
  for (const [chave, t] of Object.entries(tokens)) {
    if (!chave.endsWith(':instagram') || !t) continue;
    const empresaId = chave.slice(0, -':instagram'.length);
    try {
      const eu = await igGet(t, 'me?fields=user_id,username');
      const meuId = String(eu.user_id ?? eu.id ?? '');
      await sincronizarDiretas(env, empresaId, t, meuId);
      await sincronizarLives(env, empresaId, t);
    } catch (e) {
      console.error(`Leitura do Instagram (${empresaId}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

function extrair(corpo, env) {
  const lista = [];
  for (const entrada of corpo.entry ?? []) {
    for (const mudanca of entrada.changes ?? []) {
      if (mudanca.field !== 'live_comments') continue;
      const v = mudanca.value ?? {};
      const arroba = String(v.from?.username ?? v.username ?? '').trim().toLowerCase();
      if (!arroba) continue;
      lista.push({
        empresaId: empresaDaConta(env, String(entrada.id ?? '')),
        id: String(v.id ?? `${v.media?.id ?? 'live'}-${arroba}-${entrada.time ?? Date.now()}`),
        liveId: String(v.media?.id ?? entrada.id ?? 'live'),
        arroba,
        texto: String(v.text ?? ''),
        quando: new Date((entrada.time ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      });
    }
  }
  return lista;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // Verificação inicial pedida pela Meta ao cadastrar o webhook.
    if (req.method === 'GET') {
      if (url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === env.VERIFY_TOKEN) {
        return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 });
      }
      return new Response('Fluxa CRM — webhook do Instagram ativo.', { status: 200 });
    }

    if (req.method !== 'POST') return new Response('Método não permitido', { status: 405 });

    const texto = await req.text();
    if (!(await assinaturaValida(texto, req.headers.get('x-hub-signature-256'), env.APP_SECRET))) {
      return new Response('Assinatura inválida', { status: 401 });
    }

    try {
      const corpo = JSON.parse(texto);
      if (corpo.object === 'instagram' && (corpo.entry ?? []).some((e) => e.messaging?.length)) await tratarMensagensDiretas(env, corpo);
      else if (corpo.object === 'page') await tratarMensagensDiretas(env, corpo);
      for (const c of extrair(corpo, env)) await guardarComentario(env, c);
    } catch (e) {
      console.error(e);
      return new Response('Erro ao gravar', { status: 500 });
    }
    return new Response('ok', { status: 200 });
  },
  async scheduled(_evento, env) {
    try {
      await enviarFila(env);
    } catch (e) {
      console.error(`Erro na fila de envio: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      await sincronizarInstagram(env);
    } catch (e) {
      console.error('Erro ao ler o Instagram:', e);
    }
  },
};
