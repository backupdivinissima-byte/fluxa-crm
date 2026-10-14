import type { ArrobaLive } from '../types';

// Leitura das lives do Instagram pela API oficial (Instagram Graph API),
// feita pelo navegador do administrador. O Instagram NÃO informa quem está
// apenas assistindo; informa só quem COMENTA durante a transmissão.
// O token fica só neste navegador (localStorage), nunca no banco.

// Token gerado no app pelo "login do Instagram" (começa com IG...) usa o
// endereço do Instagram; token do Business Manager (começa com EA...) usa o do Facebook.
function enderecoApi(token: string): string {
  return /^IG/i.test(token.trim()) ? 'https://graph.instagram.com/v21.0' : 'https://graph.facebook.com/v21.0';
}
const chave = (empresaId: string) => `fluxacrm_instagram_token_${empresaId}`;

export function lerTokenInstagram(empresaId: string): string {
  try {
    return localStorage.getItem(chave(empresaId)) ?? '';
  } catch {
    return '';
  }
}

export function guardarTokenInstagram(empresaId: string, token: string) {
  try {
    localStorage.setItem(chave(empresaId), token);
  } catch {
    /* sem armazenamento local: vale só nesta sessão */
  }
}

interface ComentarioApi {
  id: string;
  text?: string;
  timestamp?: string;
  username?: string;
  from?: { username?: string };
}
interface LiveApi {
  id: string;
  timestamp?: string;
  comments?: { data?: ComentarioApi[]; paging?: { next?: string } };
}

export interface LiveAgora {
  id: string;
  iniciadaEm: string;
  arrobas: Record<string, ArrobaLive>;
}

/** Busca a(s) live(s) em andamento agora e os comentaristas até o momento. */
export async function buscarLivesAgora(contaInstagramId: string, token: string): Promise<LiveAgora[]> {
  const t = encodeURIComponent(token.trim());
  const campos = encodeURIComponent('id,timestamp,comments.limit(100){id,text,timestamp,username,from}');
  const resp = await fetch(`${enderecoApi(token)}/${contaInstagramId.trim()}/live_media?fields=${campos}&access_token=${t}`);
  const json = (await resp.json().catch(() => ({}))) as { data?: LiveApi[]; error?: { message?: string; code?: number } };
  if (!resp.ok || json.error) {
    throw new Error(
      json.error?.code === 190
        ? 'O token do Instagram é inválido ou expirou. Gere um novo token.'
        : `O Instagram respondeu com erro: ${json.error?.message ?? resp.status}`
    );
  }
  const resultado: LiveAgora[] = [];
  for (const live of json.data ?? []) {
    const comentarios = [...(live.comments?.data ?? [])];
    let proxima = live.comments?.paging?.next;
    for (let pagina = 0; proxima && pagina < 20; pagina++) {
      const r: Response = await fetch(proxima);
      const j = (await r.json().catch(() => ({}))) as { data?: ComentarioApi[]; paging?: { next?: string } };
      comentarios.push(...(j.data ?? []));
      proxima = j.paging?.next;
    }
    const arrobas: Record<string, ArrobaLive> = {};
    for (const c of comentarios) {
      const nome = (c.username ?? c.from?.username ?? '').trim().toLowerCase();
      if (!nome) continue;
      const quando = c.timestamp ?? new Date().toISOString();
      const atual = arrobas[nome];
      if (!atual) {
        arrobas[nome] = { comentarios: 1, primeiraVez: quando, ultimaVez: quando, ultimoTexto: c.text };
      } else {
        atual.comentarios += 1;
        if (quando < atual.primeiraVez) atual.primeiraVez = quando;
        if (quando >= atual.ultimaVez) {
          atual.ultimaVez = quando;
          atual.ultimoTexto = c.text;
        }
      }
    }
    resultado.push({ id: live.id, iniciadaEm: live.timestamp ?? new Date().toISOString(), arrobas });
  }
  return resultado;
}
