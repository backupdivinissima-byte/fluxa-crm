// Funções puras de regra de negócio do CRM.
import { CRM_FUNIL_RECOMENDADO, type Cliente, type ColunaCrm, type FiltroCrm, type MetaTier, type Vendedor } from '../types';

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

/** Quantos dias antes do prazo de inatividade o cliente já entra em Risco. */
export const DIAS_ANTECEDENCIA_RISCO = 9;

/** Primeiro dia da faixa de Risco para um prazo de inatividade. A faixa vai
 * de (prazo − 9) até o próprio prazo: prazo 30 → 21 a 30, prazo 60 → 51 a
 * 60, prazo 90 → 81 a 90 (vale também para o prazo personalizado). */
export function inicioRiscoDe(diasInatividade: number): number {
  return Math.max(0, diasInatividade - DIAS_ANTECEDENCIA_RISCO);
}

export type FaixaAtendimento = 'inativo' | 'risco' | 'ativo';

/** Em qual faixa um cliente cai pelos dias sem compra/atendimento:
 * "inativo" passou do prazo (acima de N dias), "risco" está nos 9 dias
 * antes do prazo, "ativo" é o resto. */
export function faixaPorDias(dias: number, diasInatividade: number): FaixaAtendimento {
  if (dias > diasInatividade) return 'inativo';
  if (dias >= inicioRiscoDe(diasInatividade)) return 'risco';
  return 'ativo';
}

/** Texto das faixas para mostrar nos títulos do funil, ex.: "Acima de 30
 * dias" (inativos) e "21 a 30 dias" (risco). */
export function rotuloFaixa(tipo: 'inativos' | 'risco', diasInatividade: number): string {
  if (tipo === 'inativos') return `Acima de ${diasInatividade} dias`;
  return `${inicioRiscoDe(diasInatividade)} a ${diasInatividade} dias`;
}

/** Status do cliente conforme o prazo de inatividade configurado pela
 * empresa: "Risco" são os 9 dias antes de virar Inativo (ex.: prazo de 60
 * dias → de 51 a 60 dias o cliente já aparece em Risco), "Inativo" é passar
 * do prazo, "Ativo" é o resto. */
export function statusInfo(
  dias: number,
  diasInatividade: number = DIAS_INATIVIDADE_PADRAO
): { label: string; cor: string } {
  const faixa = faixaPorDias(dias, diasInatividade);
  if (faixa === 'inativo') return { label: 'Inativo', cor: '#C0392B' };
  if (faixa === 'risco') return { label: 'Risco', cor: '#E67E22' };
  return { label: 'Ativo', cor: '#27AE60' };
}

/** Dias de "atendimento" de um cliente que foi movido pra uma coluna de
 * atendimento: conta a partir da compra mais recente OU do dia em que ele
 * foi movido pra lá, o que for mais recente. Assim um cliente inativo que
 * acabou de entrar em atendimento ganha o prazo inteiro pra comprar, e uma
 * compra nova também reinicia a contagem. */
export function diasEmAtendimento(c: Cliente): number {
  const compra = diasSemAtend(c);
  if (!c.crmColunaChangedAt) return compra;
  const t = new Date(c.crmColunaChangedAt).getTime();
  if (Number.isNaN(t)) return compra;
  const desdeMovimento = Math.max(0, Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24)));
  return Math.min(compra, desdeMovimento);
}

/** Ação de uma coluna manual ao soltar um cliente nela: "atendimento"
 * (confirmar vendedor) ou "orcamento" (pedir valor). Vale o que foi
 * escolhido no seletor da coluna; se nada foi escolhido, deduz pelo nome
 * ("Em Atendimento", "Orçamento Live"...). Coluna automática ou de
 * fechamento nunca tem ação. */
export function acaoDaColuna(col: ColunaCrm): 'atendimento' | 'orcamento' | undefined {
  if (col.auto || col.fechamento) return undefined;
  if (col.acao === 'nenhuma') return undefined;
  if (col.acao) return col.acao;
  const nome = col.nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  if (nome.includes('orcamento')) return 'orcamento';
  if (nome.includes('atendimento')) return 'atendimento';
  return undefined;
}

/** Em qual coluna do funil o cliente aparece e se o vínculo com o vendedor
 * ainda vale.
 * - Coluna manual comum (orçamento, concluído...): fica onde foi colocado.
 * - Coluna de atendimento: fica enquanto estiver "ativo" pelo prazo de
 *   inatividade; sem venda no prazo, volta pra risco e depois inativos
 *   (e o vínculo com o vendedor deixa de valer).
 * - Sem coluna manual: entra sozinho em inativos/risco pelos dias sem
 *   compra; o que está ativo cai na 1ª coluna manual. */
export function colunaEfetivaDoCliente(
  c: Cliente,
  colunas: ColunaCrm[],
  diasInatividade: number
): { id?: string; vinculoVigente: boolean } {
  const manual = c.crmColunaId ? colunas.find((x) => x.id === c.crmColunaId) : undefined;
  let dias = diasSemAtend(c);
  if (manual && !manual.auto) {
    if (acaoDaColuna(manual) !== 'atendimento') return { id: manual.id, vinculoVigente: true };
    dias = diasEmAtendimento(c);
    if (faixaPorDias(dias, diasInatividade) === 'ativo') return { id: manual.id, vinculoVigente: true };
  }
  const faixa = faixaPorDias(dias, diasInatividade);
  const colInativos = colunas.find((x) => x.auto === 'inativos')?.id;
  const colRisco = colunas.find((x) => x.auto === 'risco')?.id;
  const colPadrao = colunas.find((x) => !x.auto)?.id;
  let id: string | undefined;
  if (faixa === 'inativo' && colInativos) id = colInativos;
  else if (faixa === 'risco' && colRisco) id = colRisco;
  else id = colPadrao;
  return { id, vinculoVigente: false };
}

/** Converte o que a pessoa digitou ("1.234,56", "1234,5" ou "1234.56") em
 * número. Devolve NaN se não for um número. */
export function parseValorBR(texto: string): number {
  const t = texto.trim().replace(/\s/g, '');
  if (!t) return NaN;
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  return Number(normal);
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

/** Data ISO (ou "AAAA-MM-DD...") em dd/mm/aaaa, sem passar por fuso (uma
 * data sem hora viraria o dia anterior no horário do Brasil). */
export function formatarDataBR(iso?: string): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

/** As (até) 3 compras mais recentes do cliente, da mais nova pra mais
 * velha. A fonte é `origensImportacao` (uma entrada por mês importado; se o
 * mesmo mês aparece mais de uma vez, vale a maior, mesma regra de
 * `totalGeralReal`). Clientes antigos sem essa estrutura caem nos campos
 * c1/c2/c3, se existirem. */
export function ultimasCompras(c: Cliente): { valor: number; data?: string }[] {
  const origens = c.origensImportacao;
  if (origens && Object.keys(origens).length > 0) {
    const porMes = new Map<string, { valor: number; data?: string }>();
    const semData: { valor: number; data?: string }[] = [];
    for (const o of Object.values(origens)) {
      if (!o.totalGeral || o.totalGeral <= 0) continue;
      if (o.dtUltCompra) {
        const mes = o.dtUltCompra.slice(0, 7);
        const atual = porMes.get(mes);
        if (!atual || o.totalGeral > atual.valor) porMes.set(mes, { valor: o.totalGeral, data: o.dtUltCompra });
      } else {
        semData.push({ valor: o.totalGeral });
      }
    }
    const lista = [...porMes.values()].sort((a, b) => (b.data ?? '').localeCompare(a.data ?? '')).concat(semData);
    if (lista.length > 0) return lista.slice(0, 3);
  }
  return [c.c1, c.c2, c.c3]
    .filter((v): v is number => typeof v === 'number' && v > 0)
    .map((valor) => ({ valor }));
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
  nomeAtual?: string,
  vinculoVigente = true
): boolean {
  if (papel === 'admin') return true;
  // Vínculo vencido (ficou sem venda no prazo): o cliente deixa de ser
  // exclusivo do vendedor que o atendia.
  if (c.crmVendedorLogin && vinculoVigente) return c.crmVendedorLogin === loginAtual;
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

/** A venda (código e nome do vendedor como vieram do ERP) é deste vendedor do Fluxa? */
function vendedorDaVenda(x: { cod?: string; nome?: string }, login: string, nome?: string): boolean {
  if (x.cod && x.cod === login) return true;
  if (nome && x.nome) {
    const a = x.nome.trim().toLowerCase();
    const b = nome.trim().toLowerCase();
    if (a && b && (a === b || a.includes(b) || b.includes(a))) return true;
  }
  return false;
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
    const origem = c.origensImportacao?.[chave];
    if (origem?.porVendedor) {
      // Importação nova: cada venda conta para o vendedor DAQUELA venda (igual ao relatório do ERP),
      // seja qual for o dono do cliente no funil.
      for (const x of origem.porVendedor) if (vendedorDaVenda(x, login, nome)) soma += x.valor;
      continue;
    }
    // Importação antiga (sem detalhe por venda): o cliente inteiro vai para o vendedor ligado a ele.
    if (!(c.crmVendedorLogin === login || matchVendedor(c, login, nome))) continue;
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
      const meusIds = new Set(meus.map((c) => c.id));
      // Cada venda conta para quem vendeu (igual ao ERP); meses sem detalhe por vendedor vão para o dono atual do cliente.
      const totalHistorico = clientes.reduce((soma, c) => {
        const origens = Object.values(c.origensImportacao ?? {});
        if (!origens.some((o) => o.porVendedor)) return meusIds.has(c.id) ? soma + valorCliente(c) : soma;
        let t = soma;
        for (const o of origens) {
          if (o.porVendedor) for (const x of o.porVendedor) { if (vendedorDaVenda(x, v.login, v.nome)) t += x.valor; }
          else if (meusIds.has(c.id)) t += o.totalGeral ?? 0;
        }
        return t;
      }, 0);
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
  const pegar = (cod: string, nome?: string) => {
    const atual = mapa.get(cod) ?? { codVendedor: cod, nome: nome ?? cod, clientesCount: 0, totalHistorico: 0 };
    if (nome) atual.nome = nome;
    mapa.set(cod, atual);
    return atual;
  };
  for (const c of clientes) {
    if (c.cod_vendedor) pegar(c.cod_vendedor, c.vend_nome).clientesCount += 1;
    const origens = Object.values(c.origensImportacao ?? {});
    if (origens.some((o) => o.porVendedor)) {
      // Cada venda para quem vendeu (igual ao relatório do ERP); meses antigos sem detalhe vão para o dono do cliente.
      for (const o of origens) {
        if (o.porVendedor) for (const x of o.porVendedor) pegar(x.cod ?? x.nome ?? '—', x.nome).totalHistorico += x.valor;
        else if (c.cod_vendedor) pegar(c.cod_vendedor, c.vend_nome).totalHistorico += o.totalGeral ?? 0;
      }
    } else if (c.cod_vendedor) {
      pegar(c.cod_vendedor, c.vend_nome).totalHistorico += totalGeralReal(c) ?? 0;
    }
  }
  return [...mapa.values()].sort((a, b) => b.totalHistorico - a.totalHistorico);
}

// ===== Painel do vendedor ("Meu painel") =====

const doisDigitos = (n: number) => String(n).padStart(2, '0');

/** Feriados nacionais do ano ("AAAA-MM-DD"): os fixos mais a Sexta-feira
 * Santa (2 dias antes da Páscoa, calculada pelo algoritmo gregoriano). */
export function feriadosNacionais(ano: number): Set<string> {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mesPascoa = Math.floor((h + l - 7 * m + 114) / 31);
  const diaPascoa = ((h + l - 7 * m + 114) % 31) + 1;
  const sextaSanta = new Date(Date.UTC(ano, mesPascoa - 1, diaPascoa - 2)).toISOString().slice(0, 10);
  const fixos = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];
  return new Set([sextaSanta, ...fixos.map((f2) => `${ano}-${f2}`)]);
}

/** Dias úteis (segunda a sexta, sem feriado nacional) do mês de `hoje`:
 * total, quantos já passaram (contando o dia de hoje) e quantos faltam. */
export function diasUteisDoMes(hoje: Date = new Date()): { total: number; decorridos: number; restantes: number } {
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth();
  const feriados = feriadosNacionais(ano);
  const ultimoDia = new Date(ano, mes + 1, 0).getDate();
  let total = 0;
  let decorridos = 0;
  for (let dia = 1; dia <= ultimoDia; dia++) {
    const semana = new Date(ano, mes, dia).getDay();
    if (semana === 0 || semana === 6) continue;
    if (feriados.has(`${ano}-${doisDigitos(mes + 1)}-${doisDigitos(dia)}`)) continue;
    total++;
    if (dia <= hoje.getDate()) decorridos++;
  }
  return { total, decorridos, restantes: total - decorridos };
}

/** Vendas IMPORTADAS do vendedor mês a mês (chave "AAAA-MM"), somando a
 * contribuição de cada mês dos clientes dele (mesmo critério de
 * `vendasImportadasMesVendedor`). Alimenta o gráfico "Evolução de vendas
 * por mês" do painel do vendedor. */
export function vendasMensaisDoVendedor(
  clientes: Cliente[],
  login: string,
  nome: string | undefined
): Record<string, number> {
  const totais: Record<string, number> = {};
  for (const c of clientes) {
    if (!c.origensImportacao) continue;
    const meu = c.crmVendedorLogin === login || matchVendedor(c, login, nome);
    for (const [chave, origem] of Object.entries(c.origensImportacao)) {
      const m = /^mes-(\d{4}-\d{2})$/.exec(chave);
      if (!m) continue;
      if (origem.porVendedor) {
        for (const x of origem.porVendedor) if (vendedorDaVenda(x, login, nome)) totais[m[1]] = (totais[m[1]] ?? 0) + x.valor;
      } else if (meu && origem.totalGeral !== undefined) {
        totais[m[1]] = (totais[m[1]] ?? 0) + origem.totalGeral;
      }
    }
  }
  return totais;
}

/** Vendas de um vendedor num mês ("AAAA-MM"), pela mesma regra do ranking
 * do Dashboard: se já há dado importado pra esse mês na empresa, vale a
 * importação; senão, o que foi concluído no funil (colunas de fechamento). */
export function vendasDoMesVendedor(
  clientes: Cliente[],
  login: string,
  nome: string | undefined,
  colunasFechamentoIds: string[],
  mesRef: string
): number {
  const temImportacaoNoMes = Object.keys(vendasImportadasPorMes(clientes)).includes(mesRef);
  return temImportacaoNoMes
    ? vendasImportadasMesVendedor(clientes, login, nome, mesRef)
    : vendasMesVendedor(clientes, login, colunasFechamentoIds);
}

/** Maior faixa de meta atingida com as vendas do mês (não cumulativa), a
 * comissão estimada (% sobre as vendas + bônus) e a próxima faixa ainda não
 * atingida. `indice` -1 = nenhuma atingida. */
export function nivelDeMeta(
  metas: MetaTier[],
  vendas: number,
  comissaoBase = 0
): { indice: number; tier: MetaTier | null; comissao: number; proxima: MetaTier | null } {
  let indice = -1;
  for (let i = metas.length - 1; i >= 0; i--) {
    if (metas[i].valor > 0 && vendas >= metas[i].valor) {
      indice = i;
      break;
    }
  }
  const tier = indice >= 0 ? metas[indice] : null;
  // Abaixo da 1ª meta vale a comissão base (sem bônus).
  const comissao = tier ? vendas * (tier.comissao / 100) + tier.bonus : vendas * (comissaoBase / 100);
  const proxima = metas.find((m, i) => i > indice && m.valor > 0) ?? null;
  return { indice, tier, comissao, proxima };
}

export interface ClienteParaContatar {
  cliente: Cliente;
  dias: number;
  valor: number;
}

export interface ResumoCarteira {
  total: number;
  ativos: number;
  risco: number;
  inativos: number;
  emAtendimento: number;
  orcamentos: { coluna: ColunaCrm; qtd: number; valor: number }[];
  orcamentoTotal: number;
  emRisco: ClienteParaContatar[]; // mais perto de inativar primeiro
  inativosDeValor: ClienteParaContatar[]; // maior valor histórico primeiro
}

/** Resumo da carteira de UM vendedor — só entram os clientes que ele
 * enxerga no CRM (`cartaoVisivelPara`): os dele pelo vínculo vigente do
 * funil ou pela origem cadastral (login/nome). Separa ativos/risco/inativos
 * pelo prazo do Dashboard, conta quem está em atendimento, soma os
 * orçamentos em aberto por coluna de orçamento e já monta as listas de
 * "clientes para contatar". */
export function resumoCarteiraVendedor(
  clientes: Cliente[],
  login: string,
  nome: string | undefined,
  colunas: ColunaCrm[],
  diasInatividade: number,
  limiteLista = 6
): ResumoCarteira {
  const resumo: ResumoCarteira = {
    total: 0,
    ativos: 0,
    risco: 0,
    inativos: 0,
    emAtendimento: 0,
    orcamentos: [],
    orcamentoTotal: 0,
    emRisco: [],
    inativosDeValor: [],
  };
  const porColuna = new Map<string, { coluna: ColunaCrm; qtd: number; valor: number }>();
  for (const col of colunas) {
    if (acaoDaColuna(col) === 'orcamento') porColuna.set(col.id, { coluna: col, qtd: 0, valor: 0 });
  }

  for (const c of clientes) {
    const { id, vinculoVigente } = colunaEfetivaDoCliente(c, colunas, diasInatividade);
    if (!cartaoVisivelPara(c, 'vendedor', login, nome, vinculoVigente)) continue;
    resumo.total++;
    const dias = diasSemAtend(c);
    const faixa = faixaPorDias(dias, diasInatividade);
    if (faixa === 'ativo') resumo.ativos++;
    else if (faixa === 'risco') {
      resumo.risco++;
      resumo.emRisco.push({ cliente: c, dias, valor: valorCliente(c) });
    } else {
      resumo.inativos++;
      resumo.inativosDeValor.push({ cliente: c, dias, valor: valorCliente(c) });
    }

    const coluna = id ? colunas.find((x) => x.id === id) : undefined;
    const acao = coluna ? acaoDaColuna(coluna) : undefined;
    if (acao === 'atendimento') resumo.emAtendimento++;
    if (acao === 'orcamento' && coluna) {
      const item = porColuna.get(coluna.id);
      if (item) {
        item.qtd++;
        item.valor += c.crmOrcamentoValor ?? 0;
      }
    }
  }

  resumo.orcamentos = [...porColuna.values()];
  resumo.orcamentoTotal = resumo.orcamentos.reduce((s, o) => s + o.valor, 0);
  resumo.emRisco.sort((a, b) => b.dias - a.dias);
  resumo.emRisco = resumo.emRisco.slice(0, limiteLista);
  resumo.inativosDeValor.sort((a, b) => b.valor - a.valor);
  resumo.inativosDeValor = resumo.inativosDeValor.slice(0, limiteLista);
  return resumo;
}

/** Faixas de meta que valem pro vendedor: as próprias, se cadastradas; senão o padrão da empresa. */
export function metasDoVendedor(vendedor: { metas?: MetaTier[] } | undefined | null, metasEmpresa: MetaTier[]): MetaTier[] {
  return vendedor?.metas && vendedor.metas.length > 0 ? vendedor.metas : metasEmpresa;
}

function chaveNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Monta o funil padrão do Fluxa CRM aproveitando o que a empresa já tem:
 * colunas com o mesmo papel (mesmo nome) mantêm o id — e portanto os clientes
 * que já estão nelas — e o que for de outro jeito é substituído pelo padrão. */
export function padronizarColunas(existentes: ColunaCrm[]): ColunaCrm[] {
  const usados = new Set<string>();
  return CRM_FUNIL_RECOMENDADO.map((padrao) => {
    const alvo = chaveNome(padrao.nome);
    const igual = existentes.find((e) => {
      if (usados.has(e.id)) return false;
      const n = chaveNome(e.nome);
      if (padrao.auto === 'inativos') return e.auto === 'inativos' || n.includes('inativo');
      if (padrao.auto === 'risco') return e.auto === 'risco' || n.includes('risco');
      return n === alvo;
    });
    if (!igual) return { ...padrao };
    usados.add(igual.id);
    // Mantém o id (e os clientes) e aplica a função padrão da coluna.
    return { ...padrao, id: igual.id };
  });
}
