// Fluxa Prospect: acha o @ do Instagram de cada lead lendo o SITE da própria loja (link público "instagram.com/…").
// Não acessa o Instagram em si. Quando um lead é salvo com site (ou o usuário clica em "Buscar no site"),
// o Fluxa marca empresas/{id}/prospectLeads/{lead}.buscarInstagram = true e este módulo preenche `instagram`.
import dns from 'node:dns/promises';
import net from 'node:net';

const IGNORAR = new Set(['p', 'reel', 'reels', 'explore', 'accounts', 'sharer', 'share', 'tv', 'stories', 'direct', 'about', 'legal', 'developer', 'privacy', 'web', 'static', 'oauth', 'embed', 'challenge', 'directory', 'popular', 'instagram', 'login', 'ig']);
const MAX_BYTES = 1_500_000;

function ipPrivado(ip) {
  if (net.isIPv6(ip)) return ip === '::1' || /^f[cd]/i.test(ip) || /^fe80/i.test(ip) || ip.startsWith('::ffff:127.') || ip.startsWith('::ffff:10.') || ip.startsWith('::ffff:192.168.');
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a >= 224;
}

async function urlSegura(texto) {
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(texto) ? texto : `https://${texto}`);
  } catch {
    throw new Error('endereço do site inválido');
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error('só http/https');
  if (net.isIP(u.hostname) ? ipPrivado(u.hostname) : false) throw new Error('endereço não permitido');
  const r = await dns.lookup(u.hostname, { all: true });
  if (!r.length || r.some((x) => ipPrivado(x.address))) throw new Error('endereço não permitido');
  return u;
}

async function baixar(url) {
  let atual = await urlSegura(url);
  for (let i = 0; i < 4; i++) {
    const resp = await fetch(atual, {
      redirect: 'manual',
      signal: AbortSignal.timeout(12000),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; FluxaProspect/1.0)', accept: 'text/html,*/*' },
    });
    if (resp.status >= 300 && resp.status < 400 && resp.headers.get('location')) {
      atual = await urlSegura(new URL(resp.headers.get('location'), atual).toString());
      continue;
    }
    if (!resp.ok) throw new Error(`site respondeu ${resp.status}`);
    const reader = resp.body.getReader();
    const partes = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      partes.push(value);
      if (total > MAX_BYTES) {
        await reader.cancel();
        break;
      }
    }
    return Buffer.concat(partes).toString('utf8');
  }
  throw new Error('muitos redirecionamentos');
}

export function acharInstagram(html) {
  const cont = new Map();
  for (const m of html.matchAll(/instagram\.com\/(?:_u\/)?([A-Za-z0-9._]{2,30})(?=[\/?"'#\s<\\]|$)/gi)) {
    const h = m[1].replace(/\.+$/, '').toLowerCase();
    if (IGNORAR.has(h) || /^\d+$/.test(h)) continue;
    cont.set(h, (cont.get(h) ?? 0) + 1);
  }
  const ordenado = [...cont.entries()].sort((a, b) => b[1] - a[1]);
  return ordenado.length ? ordenado[0][0] : null;
}

export function iniciarBuscaInstagram({ base }) {
  const fila = [];
  const emFila = new Set();
  let rodando = false;

  async function processar() {
    if (rodando) return;
    rodando = true;
    try {
      while (fila.length) {
        const ref = fila.shift();
        emFila.delete(ref.id);
        try {
          const snap = await ref.get();
          const d = snap.data();
          if (!d || d.buscarInstagram !== true) continue;
          if (!d.site) {
            await ref.update({ buscarInstagram: false, instagramStatus: 'sem_site' });
            continue;
          }
          const html = await baixar(d.site);
          const h = acharInstagram(html);
          await ref.update(h ? { instagram: h, buscarInstagram: false, instagramStatus: 'achou' } : { buscarInstagram: false, instagramStatus: 'nao_achou' });
          console.log(`[prospect] ${d.nome}: ${h ? '@' + h : 'sem Instagram no site'}`);
        } catch (e) {
          console.warn(`[prospect] não consegui ler o site (${e.message})`);
          await ref.update({ buscarInstagram: false, instagramStatus: 'erro' }).catch(() => {});
        }
      }
    } finally {
      rodando = false;
    }
  }

  base
    .collection('prospectLeads')
    .where('buscarInstagram', '==', true)
    .onSnapshot(
      (snap) => {
        for (const ch of snap.docChanges()) {
          if (ch.type === 'removed' || emFila.has(ch.doc.id)) continue;
          emFila.add(ch.doc.id);
          fila.push(ch.doc.ref);
        }
        void processar();
      },
      (e) => console.error('[prospect] escuta falhou:', e.message)
    );
  console.log('[prospect] busca de Instagram pelos sites ligada.');
}
