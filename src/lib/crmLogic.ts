// Funções puras de regra de negócio do CRM.
import type { Cliente, FiltroCrm, Vendedor } from '../types';

/** Transforma um código/login em um ID de documento Firestore seguro e
 * determinístico (mesmo valor de entrada sempre vira o mesmo ID) — usado
 * pelas importações (planilha, migração legada) pra atualizar em vez de
 * duplicar quando o mesmo código/login aparece de novo. */
export function idSeguro(valor: string): string {
  return (
    valor
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || `id-${Math.random().toString(36).slice(2, 10)}`
  );
}

/** Dias corridos desde a última compra/atendimento do cliente. */
export function diasSemAtend(c: Cliente): number {
  if (!c.dtUltCompra) return 9999;
  const dt = new Date(c.dtUltCompra);
  if (Number.isNaN(dt.getTime())) return 9999;
  const diffMs = Date.now() - dt.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export function statusInfo(dias: number): { label: string; cor: string } {
  if (dias > 40) return { label: 'Inativo', cor: '#C0392B' };
  if (dias > 30) return { label: 'Risco', cor: '#E67E22' };
  return { label: 'Ativo', cor: '#27AE60' };
}

/** Um cliente "pertence" a um vendedor por login exato ou por nome (fuzzy). */
export function matchVendedor(c: Cliente, login: string, nome?: string): boolean {
  if (c.cod_vendedor && c.cod_vendedor === login) return true;
  if (nome && c.vend_nome) {
    const a = c.vend_nome.trim().toLowerCase();
    const b = nome.trim().toLowerCase();
    if (a === b) return true;
  }
  return false;
}

/** Valor a exibir no card do quadro CRM: valor combinado (quando o card já
 * passou por uma coluna de fechamento) se houver, senão o total geral. */
export function valorCliente(c: Cliente): number {
  return c.crmOrcamentoValor ?? c.totalGeral ?? c.c1 ?? 0;
}

/** Testa se um cliente atende a todos os critérios preenchidos de um filtro
 * personalizado do CRM (critérios vazios são ignorados; os preenchidos se
 * combinam com "E" entre si). */
export function clientePassaFiltro(c: Cliente, f: FiltroCrm): boolean {
  if (f.texto && f.texto.trim()) {
    const termo = f.texto.trim().toLowerCase();
    const bate =
      (c.razao ?? c.nome ?? '').toLowerCase().includes(termo) ||
      c.cod.toLowerCase().includes(termo) ||
      (c.telefone ?? '').includes(termo);
    if (!bate) return false;
  }
  if (f.cidade && f.cidade.trim()) {
    if (!(c.cidade ?? '').toLowerCase().includes(f.cidade.trim().toLowerCase())) return false;
  }
  if (f.uf && f.uf.trim()) {
    if ((c.uf ?? '').trim().toUpperCase() !== f.uf.trim().toUpperCase()) return false;
  }
  if (f.vendedorLogin) {
    if (c.crmVendedorLogin !== f.vendedorLogin && c.cod_vendedor !== f.vendedorLogin) return false;
  }
  if (f.valorMin != null && valorCliente(c) < f.valorMin) return false;
  if (f.valorMax != null && valorCliente(c) > f.valorMax) return false;
  return true;
}

/** Um card só aparece pro login de vendedor se já for "dele" (vendedor
 * vinculado bate) ou, se ainda sem vendedor vinculado, se o cliente já era
 * originalmente dele (cod_vendedor/nome). Admin vê tudo. */
export function cartaoVisivelPara(
  c: Cliente,
  papel: 'admin' | 'vendedor',
  loginAtual?: string,
  nomeAtual?: string
): boolean {
  if (papel === 'admin') return true;
  if (c.crmVendedorLogin) return c.crmVendedorLogin === loginAtual;
  return matchVendedor(c, loginAtual ?? '', nomeAtual);
}

export function formatarMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Vendas do mês corrente de um vendedor: soma dos cards que estão HOJE
 * numa coluna de fechamento, atribuídos a esse vendedor, e que entraram
 * nela dentro do mês corrente. */
export function vendasMesVendedor(clientes: Cliente[], login: string, colunasFechamentoIds: string[]): number {
  if (colunasFechamentoIds.length === 0) return 0;
  const agora = new Date();
  const mesRef = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
  return clientes
    .filter((c) => c.crmColunaId && colunasFechamentoIds.includes(c.crmColunaId) && c.crmVendedorLogin === login)
    .filter((c) => (c.crmColunaChangedAt ?? '').slice(0, 7) === mesRef)
    .reduce((soma, c) => soma + (c.crmOrcamentoValor ?? c.totalGeral ?? 0), 0);
}

// ===== Agregações do Dashboard =====

/** "YYYY-MM" de um mês relativo a hoje (offsetMeses=0 é o mês corrente,
 * -1 é o mês anterior etc.). */
function mesRefRelativo(offsetMeses: number): string {
  const d = new Date();
  d.setDate(1); // evita virar mês errado em dias 29-31
  d.setMonth(d.getMonth() + offsetMeses);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Soma de vendas fechadas (qualquer vendedor) num mês de referência
 * ("YYYY-MM"). Generaliza `vendasMesVendedor` pra empresa inteira. */
export function vendasEmpresaNoMes(clientes: Cliente[], colunasFechamentoIds: string[], mesRef: string): number {
  if (colunasFechamentoIds.length === 0) return 0;
  return clientes
    .filter((c) => c.crmColunaId && colunasFechamentoIds.includes(c.crmColunaId))
    .filter((c) => (c.crmColunaChangedAt ?? '').slice(0, 7) === mesRef)
    .reduce((soma, c) => soma + (c.crmOrcamentoValor ?? c.totalGeral ?? 0), 0);
}

/** Vendas do mês corrente da empresa (todos os vendedores) + comparação
 * percentual com o mês anterior (undefined se não houver base de
 * comparação, pra evitar indicador enganoso). */
export function vendasMesAtualEmpresa(
  clientes: Cliente[],
  colunasFechamentoIds: string[]
): { total: number; mesRef: string; variacaoPct?: number } {
  const mesRef = mesRefRelativo(0);
  const total = vendasEmpresaNoMes(clientes, colunasFechamentoIds, mesRef);
  const anterior = vendasEmpresaNoMes(clientes, colunasFechamentoIds, mesRefRelativo(-1));
  const variacaoPct = anterior > 0 ? ((total - anterior) / anterior) * 100 : undefined;
  return { total, mesRef, variacaoPct };
}

/** Soma histórica (todo o período) do valor de todos os clientes da base. */
export function vendasTotalEmpresa(clientes: Cliente[]): number {
  return clientes.reduce((soma, c) => soma + valorCliente(c), 0);
}

/** Um cliente conta como "com vendedor" se já tiver um responsável
 * vinculado no funil ou de origem cadastral. */
export function temVendedor(c: Cliente): boolean {
  return Boolean(c.crmVendedorLogin || c.cod_vendedor);
}

/** Divisão com/sem atendimento pra base inteira, reaproveitando o mesmo
 * corte de 40 dias já usado em Clientes/ClienteDetalheModal: "sem
 * atendimento" = Inativo (+40 dias), "com atendimento" = Ativo ou Risco. */
export function resumoAtendimento(clientes: Cliente[]) {
  const total = clientes.length;
  const semAtendimento = clientes.filter((c) => diasSemAtend(c) > 40).length;
  const comAtendimento = total - semAtendimento;
  return {
    total,
    comAtendimento,
    semAtendimento,
    pctCom: total > 0 ? Math.round((comAtendimento / total) * 100) : 0,
    pctSem: total > 0 ? Math.round((semAtendimento / total) * 100) : 0,
  };
}

/** Funil de atendimento: total na base -> com vendedor -> ativos / 31-40
 * dias (risco) / inativos. Percentuais sempre em relação ao total da base. */
export function funilAtendimento(clientes: Cliente[]) {
  const total = clientes.length;
  const comVendedor = clientes.filter(temVendedor).length;
  const ativos = clientes.filter((c) => diasSemAtend(c) <= 30).length;
  const risco = clientes.filter((c) => {
    const d = diasSemAtend(c);
    return d > 30 && d <= 40;
  }).length;
  const inativos = clientes.filter((c) => diasSemAtend(c) > 40).length;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  return {
    total,
    comVendedor,
    ativos,
    risco,
    inativos,
    pctTotal: 100,
    pctComVendedor: pct(comVendedor),
    pctAtivos: pct(ativos),
    pctRisco: pct(risco),
    pctInativos: pct(inativos),
  };
}

export interface RankingVendedor {
  vendedor: Vendedor;
  clientesCount: number;
  totalHistorico: number;
  vendasMes: number;
  pctMeta: number | null; // null = sem faixa de meta cadastrada pra comparar
}

/** Ranking de vendedores por total histórico vendido (soma do valor de
 * todos os clientes vinculados a cada um), com vendas do mês corrente e %
 * da maior faixa de meta da empresa (referência de progresso). */
export function rankingVendedores(
  vendedores: Vendedor[],
  clientes: Cliente[],
  colunasFechamentoIds: string[],
  metaReferencia?: number
): RankingVendedor[] {
  return vendedores
    .map((v) => {
      const meus = clientes.filter((c) => c.crmVendedorLogin === v.login || c.cod_vendedor === v.login);
      const totalHistorico = meus.reduce((soma, c) => soma + valorCliente(c), 0);
      const vendasMes = vendasMesVendedor(clientes, v.login, colunasFechamentoIds);
      const pctMeta = metaReferencia && metaReferencia > 0 ? Math.min(100, Math.round((vendasMes / metaReferencia) * 100)) : null;
      return { vendedor: v, clientesCount: meus.length, totalHistorico, vendasMes, pctMeta };
    })
    .sort((a, b) => b.totalHistorico - a.totalHistorico);
}
