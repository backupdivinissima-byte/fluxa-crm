// Fluxa CRM — recebe os comentários das lives do Instagram (webhook da Meta)
// e grava no Firestore da empresa. Roda de graça no Cloudflare Workers.
//
// Variáveis (Cloudflare → Settings → Variables and Secrets):
//   VERIFY_TOKEN          texto que você inventa; igual ao do painel da Meta
//   APP_SECRET            "Chave secreta do app do Instagram" (secret)
//   EMPRESA_ID            id da empresa no Fluxa (ex.: o uid do administrador)
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

function base(env) {
  return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/empresas/${env.EMPRESA_ID}/instagramLives`;
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

async function atualizarLive(env, liveId, quando) {
  const token = await tokenGoogle(env);
  const qs = ['iniciadaEm', 'atualizadoEm'].map((m) => `updateMask.fieldPaths=${m}`).join('&');
  const r = await fetch(`${base(env)}/${liveId}?${qs}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { iniciadaEm: { stringValue: quando }, atualizadoEm: { stringValue: new Date().toISOString() } } }),
  });
  if (!r.ok) throw new Error(`Firestore ${r.status}: ${await r.text()}`);
}

// Guarda só o @ (primeira vez que aparece na live) — poupa a cota do banco.
async function guardarComentario(env, c) {
  const url = base(env);
  const novo = await criarSeNovo(env, `${url}/${c.liveId}/arrobas/${encodeURIComponent(c.arroba)}`, {
    arroba: { stringValue: c.arroba },
    texto: { stringValue: c.texto },
    quando: { stringValue: c.quando },
  });
  if (novo) await atualizarLive(env, c.liveId, c.quando);
}

function extrair(corpo) {
  const lista = [];
  for (const entrada of corpo.entry ?? []) {
    for (const mudanca of entrada.changes ?? []) {
      if (mudanca.field !== 'live_comments') continue;
      const v = mudanca.value ?? {};
      const arroba = String(v.from?.username ?? v.username ?? '').trim().toLowerCase();
      if (!arroba) continue;
      lista.push({
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
      for (const c of extrair(JSON.parse(texto))) await guardarComentario(env, c);
    } catch (e) {
      console.error(e);
      return new Response('Erro ao gravar', { status: 500 });
    }
    return new Response('ok', { status: 200 });
  },
};
