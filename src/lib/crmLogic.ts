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

// Prazo (em dias sem compra/atendimento) que separa Ativo de Inativo,
// configurável por empresa no Dashboard (botões 30/60/90/personalizado —
// ver Empresa.diasInatividade). Usado tanto pelo funil do Dashboard quanto
// por statusInfo/Clientes/detalhe do cliente — um único parâmetro pra tudo.
export const DIAS_INATIVIDADE_PADRAO = 30;

/** Status do cliente conforme o prazo de inatividade configurado pela
 * empresa: "Risco" são os últimos 10 dias antes de virar Inativo (ex.: se
 * o prazo é 60 dias, de 50 a 60 dias o cliente já aparece em Risco),
 * "Inativo" é passar do prazo, "Ativo" é o resto. */
export function statusInfo(
  dias: number,
  diasInatividade: number = DIAS_INATIVIDADE_PADRAO
): { label: string; cor: string } {
  const inicioRisco = Math.max(0, diasInatividade - 10);
  if (dias > diasInatividade) return { label: 'Inativo', cor: '#C0392B' };
  if (dias >= inicioRisco) return { label: 'Risco', cor: '#E67E22' };
  return { label: 'Ativo', cor: '#27AE60' };
}

/** Um cliente "pertence" a um vendedor por login exato ou por nome (fuzzy).
 * O nome usa "contém" (não só igualdade exata) porque o nome do vendedor
 * que vem da importação costuma ser um nome curto/apelido do ERP (ex.:
 * "MIRIAM", "CECILIA"), enquanto o nome cadastrado no Fluxa costuma ser o
 * nome completo (ex.: "Miriam Rodrigues dos Santos") — comparar só por
 * igualdade nunca bateria nesse caso comum. */
export function matchVendedor(c: Cliente, login: string, nome?: string): boolean {
  if (c.cod_vendedor && c.cod_vendedor === login) return true;
  if (nome && c.vend_nome) {
    const a = c.vend_nome.trim().toLowerCase();
    const b = nome.trim().toLowerCase();
    if (a && b && (a === b || a.includes(b) || b.includes(a))) return true;
  }
  return false;
}

/** Total geral "de verdade" de um cliente, recalculado a partir de
 * `origensImportacao` em vez de confiar direto no campo `totalGeral`
 * salvo no documento. Necessário porque, antes da correção de chave por
 * mês (ver `chaveOrigemPorMes` em importarPlanilha.ts), reimportar o mês
 * corrente várias vezes ao longo do mês — comum, cada reexportação do ERP
 * sai com um nome de arquivo diferente — criava uma origem NOVA por
 * arquivo em vez de substituir a existente, e todas ficavam somadas pra
 * sempre no total do cliente (inflando "Vendas total"/"total histórico"
 * várias vezes o valor real). Aqui, cada origem é agrupada pelo MÊS da
 * compra (`dtUltCompra`) e, dentro de cada mês, só a MAIOR contribuição
 * conta (reimportações do mesmo mês só crescem ao longo do tempo, então a
 * maior é sempre a mais completa) — meses diferentes continuam somando
 * normalmente entre si. Origens sem data conhecida (raro) entram todas
 * somadas, já que não dá pra saber se são duplicatas do mesmo período.
 * Cliente sem nenhuma origem importada cai pro `totalGeral` salvo direto
 * (ex.: cliente cadastrado manualmente, nunca importado). */
export function totalGeralReal(c: Cliente): number | undefined {
  const origens = c.origensImportacao;
  if (!origens || Object.keys(origens).length === 0) return c.totalGeral;
  const maiorPorMes = new Map<string, number>();
  let semData = 0;
  for (const origem of Object.values(origens)) {
    if (origem.totalGeral === undefined) continue;
    if (origem.dtUltCompra) {
      const mes = origem.dtUltCompra.slice(0, 7);
      const atual = maiorPorMes.get(mes);
      if (atual === undefined || origem.totalGeral > atual) maiorPorMes.set(mes, origem.totalGeral);
    } else {
      semData += origem.totalGeral;
    }
  }
  let soma = semData;
  for (const v of maiorPorMes.values()) soma += v;
  return soma;
}

/** Valor a exibir no card do quadro CRM: valor combinado (quando o card já
 * passou por uma coluna de fechamento) se houver, senão o total geral real
 * (ver `totalGeralReal`). */
export function valorCliente(c: Cliente): number {
  return c.crmOrcamentoValor ?? totalGeralReal(c) ?? c.c1 ?? 0;
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

/** Total de vendas IMPORTADAS por mês (chave "AAAA-MM"), somando a
 * contribuição de todos os clientes — usa `Cliente.origensImportacao`
 * (ver `salvarPorArquivo`/`chaveOrigemPorMes` em importarPlanilha.ts), que
 * já rastreia o mês de cada compra. Só entram meses com data conhecida
 * (contribuições sem data reconhecida, caso raro, ficam de fora daqui mas
 * continuam contando no total geral do cliente). Usado pro gráfico
 * "Evolução de vendas por mês" do Dashboard mostrar direto o que foi
 * importado, sem precisar de lançamento manual mês a mês. */
export function vendasImportadasPorMes(clientes: Cliente[]): Record<string, number> {
  const totais: Record<string, number> = {};
  for (const c of clientes) {
    const origens = c.origensImportacao;
    if (!origens) continue;
    for (const [chave, origem] of Object.entries(origens)) {
      const m = /^mes-(\d{4}-\d{2})$/.exec(chave);
      if (!m || origem.totalGeral === undefined) continue;
      const mesRef = m[1];
      totais[mesRef] = (totais[mesRef] ?? 0) + origem.totalGeral;
    }
  }
  return totais;
}

/** Vendas IMPORTADAS de um vendedor específico num mês de referência
 * ("AAAA-MM") — soma a contribuição daquele mês (`origensImportacao`,
 * chave "mes-AAAA-MM", ver `chaveOrigemPorMes`) de todos os clientes
 * vinculados a esse vendedor (mesmo critério de `rankingVendedores`:
 * `crmVendedorLogin` OU `matchVendedor`). Usado pro ranking de vendedores
 * mostrar o valor REAL do mês corrente (antes ficava sempre R$0,00 pra
 * quem só tem vendas importadas, porque dependia só do quadro Kanban). */
export function vendasImportadasMesVendedor(
  clientes: Cliente[],
  login: string,
  nome: string | undefined,
  mesRef: string
): number {
  const chave = `mes-${mesRef}`;
  let soma = 0;
  for (const c of clientes) {
    if (!(c.crmVendedorLogin === login || matchVendedor(c, login, nome))) continue;
    const origem = c.origensImportacao?.[chave];
    if (origem?.totalGeral !== undefined) soma += origem.totalGeral;
  }
  return soma;
}

/** Último dia de um mês "AAAA-MM", como "AAAA-MM-DD" (em UTC, pra não
 * depender do fuso do navegador). */
function ultimoDiaDoMes(mes: string): string {
  const [ano, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(ano, m, 0)).toISOString().slice(0, 10); // dia 0 do mês seguinte = último dia deste
}

/** Diferença em dias inteiros entre duas datas "AAAA-MM-DD" (em UTC). */
function diasEntreDatasISO(dataAnterior: string, dataPosterior: string): number {
  const a = Date.UTC(...(dataAnterior.split('-').map(Number) as [number, number, number]));
  const b = Date.UTC(...(dataPosterior.split('-').map(Number) as [number, number, number]));
  return Math.round((b - a) / 86400000);
}

/** Nº de clientes "ativos" (≤ diasInatividade sem comprar) em cada mês do
 * histórico, tomando o ÚLTIMO DIA de cada mês como data de referência —
 * não o momento atual. Responde perguntas do tipo "quantos clientes
 * estavam ativos até 31/07, considerando 40 dias sem comprar".
 *
 * Reconstrói a compra mais recente de cada cliente ATÉ aquela data usando
 * `Cliente.origensImportacao` (cada entrada é o mês de uma compra, com a
 * data mais recente dentro dele — ver `chaveOrigemPorMes` em
 * importarPlanilha.ts): pra cada mês de corte, pega a maior data conhecida
 * que não passe do último dia daquele mês. Cliente sem nenhuma origem com
 * data (raro) fica de fora do cálculo. `meses` é a lista de "AAAA-MM" a
 * calcular. */
export function clientesAtivosPorMesHistorico(
  clientes: Cliente[],
  diasInatividade: number,
  meses: string[]
): Record<string, number> {
  const datasPorCliente: string[][] = [];
  for (const c of clientes) {
    const datas: string[] = [];
    if (c.origensImportacao) {
      for (const origem of Object.values(c.origensImportacao)) {
        if (origem.dtUltCompra) datas.push(origem.dtUltCompra);
      }
    }
    if (datas.length > 0) {
      datas.sort();
      datasPorCliente.push(datas);
    }
  }

  const resultado: Record<string, number> = {};
  for (const mes of meses) {
    const cutoff = ultimoDiaDoMes(mes);
    let ativos = 0;
    for (const datas of datasPorCliente) {
      let ultima: string | undefined;
      for (const d of datas) {
        if (d <= cutoff) ultima = d;
        else break; // já ordenado — pode parar no primeiro que passar do corte
      }
      if (ultima && diasEntreDatasISO(ultima, cutoff) <= diasInatividade) ativos++;
    }
    resultado[mes] = ativos;
  }
  return resultado;
}

/** Um cliente conta como "com vendedor" se já tiver um responsável
 * vinculado no funil ou de origem cadastral. */
export function temVendedor(c: Cliente): boolean {
  return Boolean(c.crmVendedorLogin || c.cod_vendedor);
}

/** Divisão com/sem atendimento pra base inteira, usando o mesmo prazo
 * configurável de Empresa.diasInatividade: "sem atendimento" = Inativo
 * (passou do prazo), "com atendimento" = Ativo ou Risco. */
export function resumoAtendimento(clientes: Cliente[], diasInatividade: number = DIAS_INATIVIDADE_PADRAO) {
  const total = clientes.length;
  const semAtendimento = clientes.filter((c) => diasSemAtend(c) > diasInatividade).length;
  const comAtendimento = total - semAtendimento;
  return {
    total,
    comAtendimento,
    semAtendimento,
    pctCom: total > 0 ? Math.round((comAtendimento / total) * 100) : 0,
    pctSem: total > 0 ? Math.round((semAtendimento / total) * 100) : 0,
  };
}

/** Funil de atendimento: total na base -> com vendedor -> ativos / inativos.
 * Usa o mesmo prazo configurável de Empresa.diasInatividade (30/60/90/
 * personalizado, ver botões no Dashboard) que também governa statusInfo —
 * um único parâmetro pra tudo (Dashboard, Clientes, detalhe do cliente).
 * Percentuais sempre em relação ao total da base. */
export function funilAtendimento(clientes: Cliente[], diasInatividade: number = DIAS_INATIVIDADE_PADRAO) {
  const total = clientes.length;
  const comVendedor = clientes.filter(temVendedor).length;
  const ativos = clientes.filter((c) => diasSemAtend(c) <= diasInatividade).length;
  const inativos = total - ativos;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  return {
    total,
    comVendedor,
    ativos,
    inativos,
    pctTotal: 100,
    pctComVendedor: pct(comVendedor),
    pctAtivos: pct(ativos),
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

/** Ranking de vendedores pelas vendas do mês corrente (quem vendeu mais
 * agora fica em 1º — inclusive um vendedor com R$0 no mês pode cair pra
 * trás de quem vendeu algo, mesmo tendo total histórico maior). O total
 * histórico (soma de todos os clientes vinculados) e a % da maior faixa
 * de meta da empresa continuam disponíveis, só não decidem mais a ordem.
 *
 * "Vinculado" usa `matchVendedor` (login exato OU nome — ver lá): o
 * `cod_vendedor` que vem da importação é o código do ERP, que raramente é
 * igual ao login do Fluxa, então sem o match por nome o total histórico
 * ficava perto de zero pra quase todo mundo mesmo com vendas reais
 * importadas. Um vendedor sem NENHUM cliente importado correspondente
 * (nem por login, nem por nome parecido) aparece com total 0 — pra ver
 * TODOS os totais importados por código do ERP, mesmo sem cadastro
 * correspondente no Fluxa, veja "Total importado por vendedor" na tela de
 * Vendedores. */
export function rankingVendedores(
  vendedores: Vendedor[],
  clientes: Cliente[],
  colunasFechamentoIds: string[],
  metaReferencia?: number
): RankingVendedor[] {
  const mesRefAtual = mesRefRelativo(0);
  // Se já existe QUALQUER dado importado pro mês corrente (empresa toda),
  // o valor do mês de cada vendedor vem da importação — mais fiel à
  // realidade que o quadro Kanban, que só reflete cards arrastados
  // manualmente pra uma coluna de fechamento (a maioria dos clientes
  // importados via ERP nunca passa pelo Kanban). Sem nenhum dado
  // importado ainda pro mês corrente, cai pro cálculo antigo (Kanban).
  const temImportacaoNoMes = Object.keys(vendasImportadasPorMes(clientes)).includes(mesRefAtual);
  return vendedores
    .map((v) => {
      const meus = clientes.filter((c) => c.crmVendedorLogin === v.login || matchVendedor(c, v.login, v.nome));
      const totalHistorico = meus.reduce((soma, c) => soma + valorCliente(c), 0);
      const vendasMes = temImportacaoNoMes
        ? vendasImportadasMesVendedor(clientes, v.login, v.nome, mesRefAtual)
        : vendasMesVendedor(clientes, v.login, colunasFechamentoIds);
      const pctMeta = metaReferencia && metaReferencia > 0 ? Math.min(100, Math.round((vendasMes / metaReferencia) * 100)) : null;
      return { vendedor: v, clientesCount: meus.length, totalHistorico, vendasMes, pctMeta };
    })
    .sort((a, b) => b.vendasMes - a.vendasMes);
}

export interface RankingVendedorImportado {
  codVendedor: string;
  nome: string;
  clientesCount: number;
  totalHistorico: number;
}

/** Ranking de vendedores pelo total histórico REAL vindo da importação,
 * agrupado direto pelo código de vendedor do ERP (`cliente.cod_vendedor`) —
 * sem depender de bater com o login de nenhum vendedor cadastrado no
 * Fluxa. Cobre TODOS os vendedores que aparecem nos arquivos importados,
 * mesmo os que não têm uma conta correspondente no sistema. Usado na tela
 * de Vendedores ("Total importado por vendedor"). */
export function rankingVendedoresImportado(clientes: Cliente[]): RankingVendedorImportado[] {
  const mapa = new Map<string, RankingVendedorImportado>();
  for (const c of clientes) {
    if (!c.cod_vendedor) continue;
    const atual = mapa.get(c.cod_vendedor) ?? {
      codVendedor: c.cod_vendedor,
      nome: c.vend_nome ?? c.cod_vendedor,
      clientesCount: 0,
      totalHistorico: 0,
    };
    atual.totalHistorico += totalGeralReal(c) ?? 0;
    atual.clientesCount += 1;
    if (c.vend_nome) atual.nome = c.vend_nome;
    mapa.set(c.cod_vendedor, atual);
  }
  return [...mapa.values()].sort((a, b) => b.totalHistorico - a.totalHistorico);
}
