// Funções puras de regra de negócio do CRM — portadas da Divinissima
// (index.html, seção "CRM Kanban"), mantendo os mesmos nomes e comportamento
// pra facilitar comparação/manutenção futura.
import type { Cliente, CrmOrigem, KbColunaId, Vendedor } from '../types';

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

/** Valor a exibir no card do Kanban: valor do orçamento se houver, senão o total geral. */
export function kbValorCliente(c: Cliente): number {
  if ((c.crmStage === 'orcamento' || c.crmStage === 'concluido') && c.crmOrcamentoValor) {
    return c.crmOrcamentoValor;
  }
  return c.totalGeral ?? c.c1 ?? 0;
}

/** Em qual das 8 colunas do Kanban um cliente cai, dado o vendedor logado (ou null se admin). */
export function colunaDoCliente(
  c: Cliente,
  papel: 'admin' | 'vendedor',
  loginAtual?: string,
  nomeAtual?: string
): KbColunaId | null {
  // Pipeline manual tem prioridade.
  if (c.crmStage === 'atendimento') {
    if (papel === 'vendedor' && c.crmVendedorLogin !== loginAtual) return null;
    return 'atendimento';
  }
  if (c.crmStage === 'orcamento') {
    if (papel === 'vendedor' && c.crmVendedorLogin !== loginAtual) return null;
    return c.crmOrigem === 'catalogo' ? 'orcamento_catalogo' : 'orcamento_live';
  }
  if (c.crmStage === 'concluido') {
    if (papel === 'vendedor' && c.crmVendedorLogin !== loginAtual) return null;
    return c.crmOrigem === 'catalogo' ? 'concluido_catalogo' : 'concluido_live';
  }

  // Sem estágio manual: cai automaticamente pelos dias sem compra.
  const dias = diasSemAtend(c);
  if (dias > 40) return 'inativos'; // inativos é global, todo mundo vê
  if (papel === 'vendedor' && !matchVendedor(c, loginAtual ?? '', nomeAtual)) return null;
  if (dias > 30) return 'd31_40';
  return 'ativos';
}

export function formatarMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Regras de transição ao soltar um card numa coluna — replica kbMoverCliente. */
export interface ResultadoMover {
  ok: boolean;
  erro?: string;
  precisaVendedor?: boolean;
  precisaValorOrcamento?: boolean;
  patch?: Partial<Cliente>;
}

export function calcularMovimentoCliente(
  cliente: Cliente,
  destino: KbColunaId,
  vendedorAtual: Vendedor | 'admin'
): ResultadoMover {
  const loginAtual = vendedorAtual === 'admin' ? null : vendedorAtual.login;

  // Guarda: se já tem vendedor vinculado e é outro vendedor tentando mexer, bloqueia.
  if (
    loginAtual &&
    cliente.crmVendedorLogin &&
    cliente.crmVendedorLogin !== loginAtual &&
    destino !== 'inativos' &&
    destino !== 'd31_40' &&
    destino !== 'ativos'
  ) {
    return { ok: false, erro: 'Esse cliente já está sendo atendido por outro vendedor.' };
  }

  if (destino === 'inativos' || destino === 'd31_40' || destino === 'ativos') {
    return {
      ok: true,
      patch: {
        crmStage: null,
        crmVendedorLogin: undefined,
        crmOrcamentoValor: undefined,
        crmOrigem: undefined,
        crmStageChangedAt: new Date().toISOString(),
      },
    };
  }

  if (destino === 'atendimento') {
    if (!cliente.crmVendedorLogin && !loginAtual) {
      return { ok: true, precisaVendedor: true };
    }
    return {
      ok: true,
      patch: {
        crmStage: 'atendimento',
        crmOrigem: undefined,
        crmVendedorLogin: cliente.crmVendedorLogin ?? loginAtual ?? undefined,
        crmStageChangedAt: new Date().toISOString(),
      },
    };
  }

  if (destino === 'orcamento_live' || destino === 'orcamento_catalogo') {
    if (!cliente.crmVendedorLogin && !loginAtual) {
      return { ok: true, precisaVendedor: true, precisaValorOrcamento: true };
    }
    return { ok: true, precisaValorOrcamento: true };
  }

  if (destino === 'concluido_live' || destino === 'concluido_catalogo') {
    if (!cliente.crmVendedorLogin && !loginAtual) {
      return { ok: true, precisaVendedor: true };
    }
    const origem: CrmOrigem = destino === 'concluido_catalogo' ? 'catalogo' : 'live';
    return {
      ok: true,
      patch: {
        crmStage: 'concluido',
        crmOrigem: origem,
        crmVendedorLogin: cliente.crmVendedorLogin ?? loginAtual ?? undefined,
        crmStageChangedAt: new Date().toISOString(),
      },
    };
  }

  return { ok: false, erro: 'Destino inválido.' };
}

/** Vendas do mês corrente de um vendedor: soma dos orçamentos concluídos no mês. */
export function vendasMesVendedor(clientes: Cliente[], login: string): number {
  const agora = new Date();
  const mesRef = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
  return clientes
    .filter((c) => c.crmStage === 'concluido' && c.crmVendedorLogin === login)
    .filter((c) => (c.crmStageChangedAt ?? '').slice(0, 7) === mesRef)
    .reduce((soma, c) => soma + (c.crmOrcamentoValor ?? c.totalGeral ?? 0), 0);
}
