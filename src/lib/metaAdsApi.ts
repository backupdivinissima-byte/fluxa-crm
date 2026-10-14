import type { CampanhaMeta } from '../types';

// Sincronização direta com o Meta Ads (Marketing API), feita pelo próprio
// navegador do administrador — não depende de servidor/Cloud Functions.
// O token fica só neste navegador (localStorage), nunca no banco de dados.

const GRAPH = 'https://graph.facebook.com/v21.0';

const chaveToken = (empresaId: string) => `fluxacrm_meta_token_${empresaId}`;

export function lerTokenLocal(empresaId: string): string {
  try {
    return localStorage.getItem(chaveToken(empresaId)) ?? '';
  } catch {
    return '';
  }
}

export function guardarTokenLocal(empresaId: string, token: string) {
  try {
    localStorage.setItem(chaveToken(empresaId), token);
  } catch {
    /* navegador bloqueou o armazenamento: o token vale só pra esta sincronização */
  }
}

interface RespostaMeta<T> {
  data?: T[];
  paging?: { next?: string };
  error?: { message?: string; code?: number };
}

async function buscarTudo<T>(url: string): Promise<T[]> {
  const itens: T[] = [];
  let proxima: string | undefined = url;
  for (let pagina = 0; proxima && pagina < 10; pagina++) {
    const resp: Response = await fetch(proxima);
    const json = (await resp.json().catch(() => ({}))) as RespostaMeta<T>;
    if (!resp.ok || json.error) {
      const msg = json.error?.message ?? `erro ${resp.status}`;
      throw new Error(
        json.error?.code === 190
          ? 'O token do Meta é inválido ou expirou. Gere um novo token e cole na tela.'
          : `O Meta Ads respondeu com erro: ${msg}`
      );
    }
    itens.push(...(json.data ?? []));
    proxima = json.paging?.next;
  }
  return itens;
}

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

interface CampanhaApi {
  id: string;
  name: string;
  status: string;
  daily_budget?: string;
  lifetime_budget?: string;
}
interface InsightApi {
  campaign_id: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  actions?: { action_type: string; value: string }[];
  cost_per_action_type?: { action_type: string; value: string }[];
}

const STATUS: Record<string, CampanhaMeta['status']> = {
  ACTIVE: 'ativa',
  PAUSED: 'pausada',
  DELETED: 'removida',
  ARCHIVED: 'removida',
};

/** Busca as campanhas da conta e o desempenho do mês corrente. */
export async function buscarCampanhasMeta(
  contaAnuncioId: string,
  token: string,
  filtroNome = ''
): Promise<Omit<CampanhaMeta, 'id' | 'origem'>[]> {
  const conta = contaAnuncioId.trim().startsWith('act_') ? contaAnuncioId.trim() : `act_${contaAnuncioId.trim()}`;
  const t = encodeURIComponent(token.trim());

  const termos = filtroNome
    .split(',')
    .map((x) => normalizar(x))
    .filter(Boolean);
  const todas = await buscarTudo<CampanhaApi>(
    `${GRAPH}/${conta}/campaigns?fields=id,name,status,daily_budget,lifetime_budget&limit=200&access_token=${t}`
  );
  const campanhas =
    termos.length === 0 ? todas : todas.filter((c) => termos.some((t) => normalizar(c.name).includes(t)));
  const insights = await buscarTudo<InsightApi>(
    `${GRAPH}/${conta}/insights?level=campaign&date_preset=this_month&fields=campaign_id,spend,impressions,reach,actions,cost_per_action_type&limit=200&access_token=${t}`
  );
  const porCampanha = new Map(insights.map((i) => [i.campaign_id, i]));
  const hoje = new Date().toISOString().slice(0, 10);

  return campanhas.map((c) => {
    const ins = porCampanha.get(c.id);
    const acao = ins?.actions && ins.actions.length > 0 ? ins.actions[0] : undefined;
    const custo = acao ? ins?.cost_per_action_type?.find((a) => a.action_type === acao.action_type) : undefined;
    const orcamento = c.daily_budget ? Number(c.daily_budget) / 100 : c.lifetime_budget ? Number(c.lifetime_budget) / 100 : undefined;
    return {
      nome: c.name,
      status: STATUS[c.status] ?? 'em_revisao',
      resultado: acao ? Number(acao.value) : undefined,
      tipoResultado: acao?.action_type,
      alcance: ins?.reach ? Number(ins.reach) : undefined,
      impressoes: ins?.impressions ? Number(ins.impressions) : undefined,
      custoPorResultado: custo ? Number(custo.value) : undefined,
      orcamento,
      orcamentoTipo: c.daily_budget ? 'diario' : c.lifetime_budget ? 'total' : undefined,
      valorGasto: ins?.spend ? Number(ins.spend) : undefined,
      atualizadoEm: hoje,
    };
  });
}
