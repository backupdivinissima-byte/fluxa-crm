// Leitura das planilhas do módulo Marketing: export do Gerenciador de
// Anúncios (aba Meta) e planilha de reserva da live (aba Live). Reaproveita
// `lerTabelaBruta` de importarPlanilha.ts (mesmo suporte a .xlsx/.xls/.csv)
// em vez de duplicar a leitura de arquivo — só a interpretação de coluna é
// diferente daqui pra lá.
import { carregarXLSX, lerTabelaBruta } from './importarPlanilha';
import type { CampanhaMeta, ReservaLive } from '../types';

function normalizar(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Acha o índice da coluna cujo cabeçalho bate com algum dos nomes
 * aceitos (comparação sem acento/maiúsculas, "contém"). */
function acharColuna(cabecalho: string[], nomes: string[]): number {
  const cab = Array.from(cabecalho, (c) => normalizar(c ?? ''));
  for (const nome of nomes) {
    const alvo = normalizar(nome);
    const i = cab.findIndex((c) => c === alvo || c.includes(alvo));
    if (i >= 0) return i;
  }
  return -1;
}

/** Converte um número de data serial do Excel (dias desde 1899-12-30) pra
 * "AAAA-MM-DD" — mesma lógica de importarPlanilha.ts. */
function serialExcelParaISO(serial: number): string | undefined {
  const d = new Date(Math.round((serial - 25569) * 86400 * 1000));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

/** Aceita "AAAA-MM-DD", "DD/MM/AAAA" ou serial numérico do Excel. */
function parseData(valor: string): string | undefined {
  const v = valor.trim();
  if (!v) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const brMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(v);
  if (brMatch) {
    const [, d, m, a] = brMatch;
    const ano = a.length === 2 ? `20${a}` : a;
    return `${ano}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  if (/^\d+(\.\d+)?$/.test(v)) return serialExcelParaISO(Number(v));
  return undefined;
}

/** Aceita "1234.56", "1.234,56" (formato BR) ou "R$ 1.234,56". */
function parseNumero(valor: string): number | undefined {
  let v = valor.trim().replace(/^R\$\s*/i, '');
  if (!v) return undefined;
  if (v.includes(',') && v.includes('.')) {
    v = v.replace(/\./g, '').replace(',', '.');
  } else if (v.includes(',')) {
    v = v.replace(',', '.');
  }
  v = v.replace(/[^\d.-]/g, '');
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseStatus(valor: string): CampanhaMeta['status'] {
  const v = normalizar(valor);
  if (v.includes('pausad')) return 'pausada';
  if (v.includes('remov') || v.includes('exclu')) return 'removida';
  if (v.includes('revis') || v.includes('aprend') || v.includes('rejeit')) return 'em_revisao';
  return 'ativa';
}

export interface LeituraCampanhasMeta {
  campanhas: Omit<CampanhaMeta, 'id' | 'origem'>[];
  mesReferencia: string; // "AAAA-MM" — mês predominante das linhas lidas
  ignoradas: number;
}

/** Lê o CSV/Excel exportado do Gerenciador de Anúncios (Meta Ads). Aceita
 * variações comuns de nome de coluna em português e inglês (export do Meta
 * costuma vir em inglês: "Campaign name", "Amount spent" etc.). */
export async function lerCampanhasMetaDoArquivo(arquivo: File): Promise<LeituraCampanhasMeta> {
  const tabela = await lerTabelaBruta(arquivo);
  if (tabela.length < 2) return { campanhas: [], mesReferencia: new Date().toISOString().slice(0, 7), ignoradas: 0 };

  const [cabecalho, ...linhas] = tabela;
  const idx = {
    nome: acharColuna(cabecalho, ['nome da campanha', 'campanha', 'campaign name', 'campaign']),
    status: acharColuna(cabecalho, ['veiculação', 'veiculacao', 'status', 'delivery']),
    resultado: acharColuna(cabecalho, ['resultados', 'results']),
    tipoResultado: acharColuna(cabecalho, ['tipo de resultado', 'result type', 'indicador de resultados']),
    alcance: acharColuna(cabecalho, ['alcance', 'reach']),
    impressoes: acharColuna(cabecalho, ['impressões', 'impressoes', 'impressions']),
    custoPorResultado: acharColuna(cabecalho, ['custo por resultado', 'cost per result']),
    orcamento: acharColuna(cabecalho, ['orçamento', 'orcamento', 'budget']),
    valorGasto: acharColuna(cabecalho, ['valor usado', 'valor gasto', 'amount spent', 'gasto']),
    dataInicio: acharColuna(cabecalho, ['início dos relatórios', 'inicio', 'data de início', 'start date']),
    dataFim: acharColuna(cabecalho, ['término dos relatórios', 'fim', 'data de término', 'end date']),
  };

  const hoje = new Date().toISOString().slice(0, 10);
  const campanhas: Omit<CampanhaMeta, 'id' | 'origem'>[] = [];
  let ignoradas = 0;
  const contagemMes = new Map<string, number>();

  for (const linha of linhas) {
    if (linha.every((c) => !c || !c.trim())) continue;
    const nome = idx.nome >= 0 ? linha[idx.nome]?.trim() : '';
    if (!nome) {
      ignoradas++;
      continue;
    }
    const dataFim = idx.dataFim >= 0 ? parseData(linha[idx.dataFim] ?? '') : undefined;
    const dataInicio = idx.dataInicio >= 0 ? parseData(linha[idx.dataInicio] ?? '') : undefined;
    const atualizadoEm = dataFim ?? dataInicio ?? hoje;
    const mes = atualizadoEm.slice(0, 7);
    contagemMes.set(mes, (contagemMes.get(mes) ?? 0) + 1);

    campanhas.push({
      nome,
      status: idx.status >= 0 ? parseStatus(linha[idx.status] ?? '') : 'ativa',
      resultado: idx.resultado >= 0 ? parseNumero(linha[idx.resultado] ?? '') : undefined,
      tipoResultado: idx.tipoResultado >= 0 ? linha[idx.tipoResultado]?.trim() || undefined : undefined,
      alcance: idx.alcance >= 0 ? parseNumero(linha[idx.alcance] ?? '') : undefined,
      impressoes: idx.impressoes >= 0 ? parseNumero(linha[idx.impressoes] ?? '') : undefined,
      custoPorResultado: idx.custoPorResultado >= 0 ? parseNumero(linha[idx.custoPorResultado] ?? '') : undefined,
      orcamento: idx.orcamento >= 0 ? parseNumero(linha[idx.orcamento] ?? '') : undefined,
      valorGasto: idx.valorGasto >= 0 ? parseNumero(linha[idx.valorGasto] ?? '') : undefined,
      dataInicio,
      dataFim,
      atualizadoEm,
    });
  }

  let mesReferencia = hoje.slice(0, 7);
  let max = 0;
  for (const [mes, n] of contagemMes) {
    if (n > max) {
      max = n;
      mesReferencia = mes;
    }
  }

  return { campanhas, mesReferencia, ignoradas };
}

export interface LeituraReservasLive {
  reservas: Omit<ReservaLive, 'id' | 'importadoEm'>[];
  ignoradas: number;
}

/** Lê a planilha de reserva da live: data, código do cliente, nome do
 * cliente, valor da reserva. Linha sem código de cliente ou sem valor é
 * ignorada (registrada em `ignoradas`) em vez de travar a importação
 * inteira. */
export async function lerReservasLiveDoArquivo(arquivo: File): Promise<LeituraReservasLive> {
  const tabela = await lerTabelaBruta(arquivo);
  if (tabela.length < 2) return { reservas: [], ignoradas: 0 };

  const [cabecalho, ...linhas] = tabela;
  const idx = {
    data: acharColuna(cabecalho, ['data']),
    cod: acharColuna(cabecalho, ['código do cliente', 'codigo do cliente', 'código', 'codigo', 'cod']),
    nome: acharColuna(cabecalho, ['nome do cliente', 'nome', 'cliente']),
    valor: acharColuna(cabecalho, ['valor da reserva', 'valor reserva', 'reserva', 'valor']),
  };

  const hoje = new Date().toISOString().slice(0, 10);
  const reservas: Omit<ReservaLive, 'id' | 'importadoEm'>[] = [];
  let ignoradas = 0;

  for (const linha of linhas) {
    if (linha.every((c) => !c || !c.trim())) continue;
    const cod = idx.cod >= 0 ? linha[idx.cod]?.trim() : '';
    const valor = idx.valor >= 0 ? parseNumero(linha[idx.valor] ?? '') : undefined;
    if (!cod || valor === undefined) {
      ignoradas++;
      continue;
    }
    reservas.push({
      data: (idx.data >= 0 ? parseData(linha[idx.data] ?? '') : undefined) ?? hoje,
      cod,
      nomeCliente: (idx.nome >= 0 ? linha[idx.nome]?.trim() : '') || cod,
      valorReservaLive: valor,
    });
  }

  return { reservas, ignoradas };
}

/** Planilha modelo da reserva da live (aba Live): uma linha por reserva. */
export async function gerarModeloReservasLive(): Promise<Blob> {
  const XLSX = await carregarXLSX();
  const wb = XLSX.utils.book_new();

  const aba = XLSX.utils.aoa_to_sheet([
    ['Data', 'Código do cliente', 'Nome do cliente', 'Valor da reserva'],
    ['15/10/2026', 'C001', 'Maria Silva', 1250.5],
    ['15/10/2026', 'C002', 'Ana Souza', 480],
  ]);
  aba['!cols'] = [{ wch: 14 }, { wch: 20 }, { wch: 30 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, aba, 'Reservas');

  const instrucoes = XLSX.utils.aoa_to_sheet([
    ['Como preencher a planilha de reservas da live'],
    [''],
    ['1. Preencha a aba "Reservas": uma linha para cada cliente que reservou peças na live.'],
    ['2. Não mude o nome das colunas.'],
    ['3. Data: DD/MM/AAAA (ex.: 15/10/2026) ou AAAA-MM-DD. Se ficar em branco, vale a data de hoje.'],
    ['4. Código do cliente*: o mesmo código usado no cadastro do cliente no Fluxa. Obrigatório.'],
    ['5. Nome do cliente: opcional (se vazio, aparece o código).'],
    ['6. Valor da reserva*: valor do orçamento das peças reservadas (ex.: 1250,50). Obrigatório.'],
    ['7. Pode reenviar a planilha: a mesma data + código atualiza a reserva em vez de duplicar.'],
    ['8. Cliente com reserva conta como vindo da live; sem reserva é cliente catálogo (fora da live).'],
    ['9. Apague as linhas de exemplo (C001 e C002) antes de enviar.'],
  ]);
  instrucoes['!cols'] = [{ wch: 100 }];
  XLSX.utils.book_append_sheet(wb, instrucoes, 'Instruções');

  const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
