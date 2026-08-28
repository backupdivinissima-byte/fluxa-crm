// Funções puras de regra de negócio do módulo Marketing (Meta, Live, Análise
// Marketing) — mesmo estilo de src/lib/crmLogic.ts: nada de side-effect,
// fácil de testar, reaproveitando o que já existe lá em vez de duplicar.
import type { CampanhaMeta, Cliente, ReservaLive } from '../types';
import { valorCliente, vendasEmpresaNoMes } from './crmLogic';

// ===== Cruzamento Live x CRM =====

/** Índice cod -> reserva mais recente daquele cliente (uma planilha pode
 * trazer o mesmo cliente em mais de uma live; fica a reserva de data mais
 * recente). */
export function indiceReservasPorCliente(reservas: ReservaLive[]): Map<string, ReservaLive> {
  const mapa = new Map<string, ReservaLive>();
  for (const r of reservas) {
    const atual = mapa.get(r.cod);
    if (!atual || r.data > atual.data) mapa.set(r.cod, r);
  }
  return mapa;
}

/** Regra pedida: cliente com reserva de live = "live"; sem reserva = "fora
 * live" (cliente catálogo). */
export function origemCliente(cod: string, indiceReservas: Map<string, ReservaLive>): 'live' | 'catalogo' {
  return indiceReservas.has(cod) ? 'live' : 'catalogo';
}

/** Quanto o cliente comprou ALÉM do orçamento reservado na live (valor
 * final do cliente no CRM menos o valor da reserva) — nunca negativo, pra
 * não mostrar "acréscimo" quando o cliente comprou menos do que reservou. */
export function acrescimoCatalogo(cliente: Cliente, reserva: ReservaLive): number {
  return Math.max(0, valorCliente(cliente) - reserva.valorReservaLive);
}

export interface ResultadoClienteLive {
  cliente: Cliente;
  origem: 'live' | 'catalogo';
  reserva?: ReservaLive;
  valorReservado?: number;
  valorFinal: number;
  acrescimo?: number; // só quando origem === 'live'
}

/** Junta clientes do CRM com as reservas de live pra montar a tabela de
 * resultado da aba Live: pra cada cliente, mostra se veio da live (com
 * quanto reservou e quanto acrescentou de catálogo) ou é cliente catálogo. */
export function resultadoClientesLive(clientes: Cliente[], reservas: ReservaLive[]): ResultadoClienteLive[] {
  const indice = indiceReservasPorCliente(reservas);
  return clientes.map((cliente) => {
    const reserva = indice.get(cliente.cod);
    if (!reserva) {
      return { cliente, origem: 'catalogo' as const, valorFinal: valorCliente(cliente) };
    }
    return {
      cliente,
      origem: 'live' as const,
      reserva,
      valorReservado: reserva.valorReservaLive,
      valorFinal: valorCliente(cliente),
      acrescimo: acrescimoCatalogo(cliente, reserva),
    };
  });
}

// ===== Investimento em Meta Ads =====

/** Soma o valor gasto de todas as campanhas cujo mês de referência
 * (`atualizadoEm`) é o mês pedido ("AAAA-MM"). */
export function custoMetaNoMes(campanhas: CampanhaMeta[], mesRef: string): number {
  return campanhas
    .filter((c) => (c.atualizadoEm ?? '').slice(0, 7) === mesRef)
    .reduce((soma, c) => soma + (c.valorGasto ?? 0), 0);
}

// ===== Clientes novos (pra CAC) =====

/** Mês da primeira compra conhecida do cliente: usa a mais antiga entrada
 * de `origensImportacao` (chave "mes-AAAA-MM"), caindo pra `dtUltCompra`
 * quando não há histórico de importação (cliente cadastrado manualmente). */
function primeiroMesCliente(c: Cliente): string | undefined {
  if (c.origensImportacao) {
    const meses = Object.keys(c.origensImportacao)
      .map((k) => /^mes-(\d{4}-\d{2})$/.exec(k)?.[1])
      .filter((m): m is string => Boolean(m));
    if (meses.length > 0) return meses.sort()[0];
  }
  return c.dtUltCompra?.slice(0, 7);
}

/** Clientes cuja primeira compra conhecida caiu no mês pedido — usado como
 * aproximação de "clientes novos" pro cálculo de CAC (o Fluxa CRM não tem
 * uma data de cadastro do cliente separada da data de compra). */
export function clientesNovosNoMes(clientes: Cliente[], mesRef: string): Cliente[] {
  return clientes.filter((c) => primeiroMesCliente(c) === mesRef);
}

/** CAC (Custo de Aquisição de Cliente) do mês: investimento em Meta Ads
 * dividido pelo nº de clientes novos no mês. `undefined` quando não há
 * clientes novos no mês (divisão sem sentido, evita mostrar CAC "infinito"
 * ou zerado de forma enganosa). */
export function cacNoMes(campanhas: CampanhaMeta[], clientes: Cliente[], mesRef: string): number | undefined {
  const novos = clientesNovosNoMes(clientes, mesRef).length;
  if (novos === 0) return undefined;
  return custoMetaNoMes(campanhas, mesRef) / novos;
}

// ===== Receita atribuída à live e ROI =====

/** Receita (valor final no CRM) dos clientes cuja reserva de live caiu no
 * mês pedido — parte da receita do mês que dá pra atribuir diretamente às
 * lives. */
export function receitaAtribuidaLiveNoMes(clientes: Cliente[], reservas: ReservaLive[], mesRef: string): number {
  const reservasNoMes = reservas.filter((r) => (r.data ?? '').slice(0, 7) === mesRef);
  const indice = indiceReservasPorCliente(reservasNoMes);
  let soma = 0;
  for (const cliente of clientes) {
    if (indice.has(cliente.cod)) soma += valorCliente(cliente);
  }
  return soma;
}

export interface ResumoMarketingMes {
  mesRef: string;
  investimentoMeta: number;
  receitaTotal: number; // vendas fechadas no mês (reaproveita vendasEmpresaNoMes de crmLogic.ts)
  receitaLive: number;
  clientesNovos: number;
  cac?: number;
  roi?: number; // (receitaTotal - investimentoMeta) / investimentoMeta
}

/** Monta o resumo do mês pra aba Análise Marketing: investimento em Meta
 * Ads, receita total fechada no mês (reaproveitando `vendasEmpresaNoMes` de
 * crmLogic.ts em vez de duplicar essa regra), receita atribuída à live, CAC
 * e ROI. ROI e CAC ficam `undefined` quando não há investimento/clientes
 * novos no mês, pra não mostrar uma conta sem sentido (divisão por zero). */
export function resumoMarketingMes(
  campanhas: CampanhaMeta[],
  clientes: Cliente[],
  reservas: ReservaLive[],
  colunasFechamentoIds: string[],
  mesRef: string
): ResumoMarketingMes {
  const investimentoMeta = custoMetaNoMes(campanhas, mesRef);
  const receitaTotal = vendasEmpresaNoMes(clientes, colunasFechamentoIds, mesRef);
  const receitaLive = receitaAtribuidaLiveNoMes(clientes, reservas, mesRef);
  const clientesNovos = clientesNovosNoMes(clientes, mesRef).length;
  return {
    mesRef,
    investimentoMeta,
    receitaTotal,
    receitaLive,
    clientesNovos,
    cac: investimentoMeta > 0 && clientesNovos > 0 ? investimentoMeta / clientesNovos : undefined,
    roi: investimentoMeta > 0 ? (receitaTotal - investimentoMeta) / investimentoMeta : undefined,
  };
}

/** "AAAA-MM" dos últimos N meses (incluindo o mês corrente), do mais antigo
 * pro mais recente — usado pra montar a tabela de evolução mensal. */
export function ultimosMeses(n: number): string[] {
  const meses: string[] = [];
  const base = new Date();
  base.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setMonth(d.getMonth() - i);
    meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return meses;
}
