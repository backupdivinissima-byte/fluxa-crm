// Importação genérica via planilha Excel — ao contrário da antiga
// ferramenta de migração (específica de dados legados de uma empresa só),
// esse recurso vale pra qualquer empresa do Fluxa CRM: gera um modelo
// padronizado pra download, lê de volta a planilha preenchida pelo admin e
// grava clientes/vendedores da empresa atual no Firestore. É idempotente
// (usa merge:true com o código do cliente / login do vendedor como ID do
// documento), então pode ser rodada mais de uma vez pra ressincronizar sem
// duplicar nada.
// Além de .xlsx/.xls/.csv, também aceita .docx (Word) e .pdf: extraímos a
// tabela de dentro do arquivo (via mammoth/pdfjs) e alimentamos o mesmo
// pipeline de leitura de planilha, reconhecendo variações comuns de nome de
// coluna (ex.: "CNPJ" além de "CNPJ/CPF").
// Todas essas bibliotecas são carregadas sob demanda (só quando essa tela é
// aberta e só a biblioteca do formato realmente enviado) em vez de no bundle
// principal — são pesadas e a imensa maioria das visitas ao site nunca chega
// a usar importação.
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { idSeguro } from './crmLogic';
import type { Cliente, Vendedor } from '../types';

async function carregarXLSX() {
  return await import('xlsx');
}

async function carregarMammoth() {
  return await import('mammoth');
}

async function carregarPdfjs() {
  const pdfjsLib = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjsLib;
}

const COL_CLIENTES = [
  'Código*',
  'Nome',
  'Razão Social',
  'Telefone',
  'CNPJ/CPF',
  'Cidade',
  'UF',
  'Data última compra (AAAA-MM-DD)',
  'Total geral (R$)',
  'Login do vendedor',
  'Nome do vendedor',
] as const;

const COL_VENDEDORES = ['Nome*', 'Login*', 'Senha', 'Meta pessoal (R$)'] as const;

function clientesCol(empresaId: string) {
  return collection(db, 'empresas', empresaId, 'clientes');
}

function vendedoresCol(empresaId: string) {
  return collection(db, 'empresas', empresaId, 'vendedores');
}

function semUndef<T extends Record<string, unknown>>(obj: T): T {
  const limpo = { ...obj };
  for (const k of Object.keys(limpo)) {
    if (limpo[k] === undefined || limpo[k] === '') delete limpo[k];
  }
  return limpo;
}

function strOrUndef(v: unknown): string | undefined {
  const s = String(v ?? '').trim();
  return s || undefined;
}

function linhaVazia(linha: Record<string, unknown>): boolean {
  return Object.values(linha).every((v) => String(v ?? '').trim() === '');
}

/** Converte um número de data serial do Excel (dias desde 1899-12-30) pra
 * "AAAA-MM-DD" — sem depender do módulo SSF do xlsx, que não é exportado
 * nesta versão da biblioteca. */
function serialExcelParaISO(serial: number): string | undefined {
  if (!Number.isFinite(serial)) return undefined;
  const d = new Date(Math.round((serial - 25569) * 86400 * 1000));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

/** Aceita número (célula formatada como data no Excel), "AAAA-MM-DD" ou
 * "DD/MM/AAAA" (texto). */
function paraDataISO(v: unknown): string | undefined {
  if (v === '' || v == null) return undefined;
  if (typeof v === 'number') return serialExcelParaISO(v);
  const s = String(v).trim();
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return undefined;
}

/** Aceita número direto ou texto em formato BR ("1.234,56") ou internacional
 * ("1234.56"). Só interpreta ponto como separador de milhar quando também
 * há vírgula (aí sim é inequivocamente formato BR) — sem vírgula, o ponto é
 * tratado como separador decimal direto, que é o formato mais comum em
 * exportação de banco de dados/CSV (ex.: "999.9"). Sem essa distinção, um
 * valor como "999.9" virava 9999 (o ponto era removido por engano).
 * Também aceita um prefixo de moeda solto (ex.: "R$ 1.250,00"), comum em
 * tabela digitada à mão em Word/PDF. */
function paraNumero(v: unknown): number | undefined {
  if (v === '' || v == null) return undefined;
  if (typeof v === 'number') return v;
  const s = String(v).trim().replace(/^[^\d-]+/, '');
  if (!s) return undefined;
  if (s.includes(',')) {
    const comBr = Number(s.replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(comBr)) return comBr;
  }
  const direto = Number(s);
  return Number.isFinite(direto) ? direto : undefined;
}

/** Marca uma coluna inteira (pelas próximas `linhasComFormato` linhas) com
 * formato "Texto" (@) no Excel — evita que o Excel reinterprete códigos,
 * telefones, CNPJ/CPF e logins como número e corte zero à esquerda (ex.:
 * "011..." virando "11..."), o que corrompe a importação. Sem isso, toda
 * coluna da planilha gerada aparece como "Geral" no Excel. */
async function aplicarFormatoTexto(
  XLSX: Awaited<ReturnType<typeof carregarXLSX>>,
  ws: ReturnType<typeof XLSX.utils.aoa_to_sheet>,
  colunas: readonly string[],
  nomesColunaTexto: string[],
  linhasComFormato = 500
) {
  const nomesSet = new Set(nomesColunaTexto);
  colunas.forEach((nome, idx) => {
    if (!nomesSet.has(nome)) return;
    for (let linha = 2; linha <= linhasComFormato + 1; linha++) {
      const endereco = XLSX.utils.encode_cell({ r: linha - 1, c: idx });
      if (!ws[endereco]) ws[endereco] = { t: 's', v: '' };
      ws[endereco].z = '@';
    }
  });
  const range = XLSX.utils.decode_range(ws['!ref'] as string);
  range.e.r = Math.max(range.e.r, linhasComFormato);
  ws['!ref'] = XLSX.utils.encode_range(range);
}

/** Gera o arquivo .xlsx modelo (3 abas: Clientes, Vendedores, Instruções)
 * com as colunas exatas que a leitura espera, mais uma linha de exemplo em
 * cada aba de dados — pra qualquer empresa baixar, preencher e reenviar. */
export async function gerarPlanilhaModelo(): Promise<Blob> {
  const XLSX = await carregarXLSX();
  const wb = XLSX.utils.book_new();

  const abaClientes = XLSX.utils.aoa_to_sheet([
    [...COL_CLIENTES],
    [
      'C001',
      'Maria Silva',
      'Maria Silva Joias ME',
      '11999998888',
      '12.345.678/0001-90',
      'São Paulo',
      'SP',
      '2026-07-15',
      1250,
      'cecilia',
      'Cecília',
    ],
  ]);
  abaClientes['!cols'] = COL_CLIENTES.map(() => ({ wch: 24 }));
  await aplicarFormatoTexto(XLSX, abaClientes, COL_CLIENTES, ['Código*', 'Telefone', 'CNPJ/CPF', 'Login do vendedor']);
  XLSX.utils.book_append_sheet(wb, abaClientes, 'Clientes');

  const abaVendedores = XLSX.utils.aoa_to_sheet([[...COL_VENDEDORES], ['Cecília Souza', 'cecilia', 'senha123', 3000]]);
  abaVendedores['!cols'] = COL_VENDEDORES.map(() => ({ wch: 22 }));
  await aplicarFormatoTexto(XLSX, abaVendedores, COL_VENDEDORES, ['Login*', 'Senha']);
  XLSX.utils.book_append_sheet(wb, abaVendedores, 'Vendedores');

  const abaInstrucoes = XLSX.utils.aoa_to_sheet([
    ['Como preencher esta planilha'],
    [''],
    ['1. Preencha a aba "Clientes" e/ou a aba "Vendedores" — não precisa usar as duas.'],
    ['2. Não mude o nome das colunas nem o nome das abas.'],
    ['3. Campos com * são obrigatórios; os demais podem ficar em branco.'],
    ['4. "Código*" do cliente é o identificador único dele: se já existir na sua conta, os dados são atualizados; se não existir, é criado um cliente novo.'],
    ['5. "Login*" do vendedor é o identificador único dele — mesma regra do item 4.'],
    ['6. Se deixar "Senha" em branco para um vendedor que já existe, a senha atual dele é mantida (não é apagada).'],
    ['7. Datas no formato AAAA-MM-DD (ex.: 2026-07-15).'],
    ['8. Pode apagar a linha de exemplo antes de importar — ela é só ilustrativa.'],
    ['9. É seguro importar a mesma planilha mais de uma vez: os dados não duplicam, só atualizam.'],
  ]);
  abaInstrucoes['!cols'] = [{ wch: 100 }];
  XLSX.utils.book_append_sheet(wb, abaInstrucoes, 'Instruções');

  const arrayBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export interface LeituraPlanilha {
  clientes: Array<Omit<Cliente, 'id'>>;
  vendedores: Array<Omit<Vendedor, 'id' | 'ativo'>>;
  clientesIgnorados: number;
  vendedoresIgnorados: number;
  erros: string[];
}

/** Remove acento e caixa alta/baixa pra comparar cabeçalhos de forma
 * tolerante (ex.: "Código" e "codigo" devem casar). */
function normalizarTexto(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// Variações comuns de nome de coluna aceitas em .docx/.pdf digitados à mão
// (além do nome exato do modelo Excel) — mapeadas pro nome canônico que o
// restante da leitura já reconhece (COL_CLIENTES/COL_VENDEDORES acima).
const SINONIMOS_CLIENTES: Record<string, string> = {
  codigo: 'Código*',
  'codigo*': 'Código*',
  cod: 'Código*',
  'cod*': 'Código*',
  nome: 'Nome',
  'razao social': 'Razão Social',
  razao: 'Razão Social',
  telefone: 'Telefone',
  fone: 'Telefone',
  celular: 'Telefone',
  whatsapp: 'Telefone',
  'cnpj/cpf': 'CNPJ/CPF',
  cnpj: 'CNPJ/CPF',
  cpf: 'CNPJ/CPF',
  documento: 'CNPJ/CPF',
  cidade: 'Cidade',
  uf: 'UF',
  estado: 'UF',
  'data ultima compra (aaaa-mm-dd)': 'Data última compra (AAAA-MM-DD)',
  'data ultima compra': 'Data última compra (AAAA-MM-DD)',
  'ultima compra': 'Data última compra (AAAA-MM-DD)',
  data: 'Data última compra (AAAA-MM-DD)',
  'total geral (r$)': 'Total geral (R$)',
  'total geral': 'Total geral (R$)',
  'valor total': 'Total geral (R$)',
  total: 'Total geral (R$)',
  'login do vendedor': 'Login do vendedor',
  'nome do vendedor': 'Nome do vendedor',
  vendedor: 'Nome do vendedor',
};

const SINONIMOS_VENDEDORES: Record<string, string> = {
  'nome*': 'Nome*',
  nome: 'Nome*',
  'login*': 'Login*',
  login: 'Login*',
  usuario: 'Login*',
  senha: 'Senha',
  'senha*': 'Senha',
  'meta pessoal (r$)': 'Meta pessoal (R$)',
  'meta pessoal': 'Meta pessoal (R$)',
  meta: 'Meta pessoal (R$)',
};

const CHAVES_EXATAS_CLIENTES = new Set(['codigo', 'codigo*', 'cod', 'cod*']);
const CHAVES_EXATAS_VENDEDORES = new Set(['login', 'login*']);

/** Recebe a 1ª linha (cabeçalho) de uma tabela extraída de .docx/.pdf e
 * devolve os nomes de coluna já traduzidos pro nome canônico do modelo
 * (quando reconhecido), junto do tipo de tabela detectado. Detecta o tipo
 * por presença exata de uma coluna "Código"/"Cod" (clientes) ou
 * "Login" (vendedores) — não usa contains pra não confundir com a coluna
 * "Login do vendedor" da tabela de clientes. */
function normalizarCabecalho(bruto: string[]): { colunas: string[]; tipo: 'clientes' | 'vendedores' | null } {
  const normalizados = bruto.map(normalizarTexto);
  const tipo: 'clientes' | 'vendedores' | null = normalizados.some((h) => CHAVES_EXATAS_CLIENTES.has(h))
    ? 'clientes'
    : normalizados.some((h) => CHAVES_EXATAS_VENDEDORES.has(h))
      ? 'vendedores'
      : null;
  const mapa = tipo === 'vendedores' ? SINONIMOS_VENDEDORES : SINONIMOS_CLIENTES;
  const colunas = bruto.map((h, i) => mapa[normalizados[i]] ?? h);
  return { colunas, tipo };
}

/** Extrai a 1ª tabela de um .docx como matriz de células (linha 0 =
 * cabeçalho). Se o documento não tiver uma tabela de verdade (só texto
 * corrido), tenta interpretar cada parágrafo como uma linha com colunas
 * separadas por tabulação — comum em texto colado de uma planilha. */
async function extrairTabelaDocx(arquivo: File): Promise<string[][]> {
  const mammoth = await carregarMammoth();
  const arrayBuffer = await arquivo.arrayBuffer();
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const tabela = doc.querySelector('table');
  if (tabela) {
    return Array.from(tabela.querySelectorAll('tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td,th')).map((celula) => (celula.textContent ?? '').trim())
    );
  }
  const paragrafos = Array.from(doc.querySelectorAll('p'))
    .map((p) => (p.textContent ?? '').trim())
    .filter((t) => t !== '');
  return paragrafos.map((linha) => linha.split('\t').map((c) => c.trim()));
}

/** Extrai texto de um .pdf e tenta reconstruir a tabela por posição: agrupa
 * itens de texto que ficam na mesma altura (linha) e quebra em colunas onde
 * o espaço horizontal entre um item e o próximo é bem maior que o espaço
 * normal entre palavras. É uma heurística — funciona bem pra PDF exportado
 * de planilha/sistema com colunas alinhadas; não faz OCR, então PDF
 * escaneado (imagem) não é lido. */
async function extrairTabelaPdf(arquivo: File): Promise<string[][]> {
  const pdfjsLib = await carregarPdfjs();
  const buffer = await arquivo.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const linhas: string[][] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const conteudo = await page.getTextContent();
    const itens = (conteudo.items as Array<{ str: string; width: number; transform: number[] }>)
      .filter((it) => typeof it.str === 'string' && it.str.trim() !== '')
      .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], largura: it.width ?? 0 }));

    const porLinha = new Map<number, typeof itens>();
    for (const it of itens) {
      const chaveY = Math.round(it.y / 3) * 3; // tolerância de 3pt na mesma linha
      const grupo = porLinha.get(chaveY);
      if (grupo) grupo.push(it);
      else porLinha.set(chaveY, [it]);
    }

    const ysOrdenados = [...porLinha.keys()].sort((a, b) => b - a); // topo pra baixo
    for (const y of ysOrdenados) {
      const itensLinha = porLinha.get(y)!.sort((a, b) => a.x - b.x);
      const celulas: string[] = [];
      let atual = '';
      let xFimAnterior: number | null = null;
      for (const it of itensLinha) {
        const gap = xFimAnterior === null ? 0 : it.x - xFimAnterior;
        if (xFimAnterior !== null && gap > 10) {
          celulas.push(atual.trim());
          atual = '';
        }
        atual += it.str;
        xFimAnterior = it.x + it.largura;
      }
      if (atual.trim()) celulas.push(atual.trim());
      if (celulas.length > 0) linhas.push(celulas);
    }
  }
  return linhas;
}

/** Processa um workbook (xlsx/xls/csv nativo, ou sintético montado a partir
 * de uma tabela extraída de .docx/.pdf) e valida linha a linha — nunca
 * lança erro por causa de uma linha ruim isolada, só ignora essa linha e
 * registra o motivo em `erros`, pra uma planilha grande não travar inteira
 * por um único typo. */
function processarWorkbook(wb: ReturnType<Awaited<ReturnType<typeof carregarXLSX>>['read']>, XLSX: Awaited<ReturnType<typeof carregarXLSX>>): LeituraPlanilha {
  const erros: string[] = [];

  let abaClientes = wb.Sheets['Clientes'];
  let abaVendedores = wb.Sheets['Vendedores'];

  // Uma tabela única (sem abas nomeadas "Clientes"/"Vendedores") — caso do
  // .csv exportado de banco de dados, e sempre o caso de .docx/.pdf.
  // Identificamos pelo cabeçalho da própria tabela, desde que use os
  // mesmos nomes de coluna do modelo (ou uma variação reconhecida).
  if (!abaClientes && !abaVendedores && wb.SheetNames.length === 1) {
    const unicaAba = wb.Sheets[wb.SheetNames[0]];
    const linhas = XLSX.utils.sheet_to_json<unknown[]>(unicaAba, { header: 1 });
    const cabecalho = (linhas[0] ?? []).map((c) => String(c ?? '').trim());
    if (cabecalho.includes('Código*')) abaClientes = unicaAba;
    else if (cabecalho.includes('Login*')) abaVendedores = unicaAba;
  }

  if (!abaClientes && !abaVendedores) {
    erros.push(
      'Não encontrei nenhuma aba "Clientes" ou "Vendedores" nesse arquivo (nem uma tabela com o cabeçalho do modelo) — baixe o modelo pra conferir o formato certo.'
    );
  }

  const opcoesLeitura = { defval: '' } as const;

  const clientes: Array<Omit<Cliente, 'id'>> = [];
  let clientesIgnorados = 0;
  if (abaClientes) {
    const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(abaClientes, opcoesLeitura);
    linhas.forEach((linha, i) => {
      if (linhaVazia(linha)) return;
      const cod = strOrUndef(linha['Código*']);
      if (!cod) {
        clientesIgnorados++;
        erros.push(`Clientes, linha ${i + 2}: sem "Código*" preenchido — linha ignorada.`);
        return;
      }
      clientes.push({
        cod,
        nome: strOrUndef(linha['Nome']),
        razao: strOrUndef(linha['Razão Social']),
        telefone: strOrUndef(linha['Telefone']),
        cnpj: strOrUndef(linha['CNPJ/CPF']),
        cidade: strOrUndef(linha['Cidade']),
        uf: strOrUndef(linha['UF']),
        dtUltCompra: paraDataISO(linha['Data última compra (AAAA-MM-DD)']),
        totalGeral: paraNumero(linha['Total geral (R$)']),
        cod_vendedor: strOrUndef(linha['Login do vendedor']),
        vend_nome: strOrUndef(linha['Nome do vendedor']),
      });
    });
  }

  const vendedores: Array<Omit<Vendedor, 'id' | 'ativo'>> = [];
  let vendedoresIgnorados = 0;
  if (abaVendedores) {
    const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(abaVendedores, opcoesLeitura);
    linhas.forEach((linha, i) => {
      if (linhaVazia(linha)) return;
      const nome = strOrUndef(linha['Nome*']);
      const login = strOrUndef(linha['Login*']);
      if (!nome || !login) {
        vendedoresIgnorados++;
        erros.push(`Vendedores, linha ${i + 2}: preencha "Nome*" e "Login*" — linha ignorada.`);
        return;
      }
      vendedores.push({
        nome,
        login,
        senha: strOrUndef(linha['Senha']) ?? '',
        meta: paraNumero(linha['Meta pessoal (R$)']),
      });
    });
  }

  return { clientes, vendedores, clientesIgnorados, vendedoresIgnorados, erros };
}

/** Monta um workbook "sintético" (1 aba só) a partir de uma tabela já
 * extraída de .docx/.pdf, com o cabeçalho traduzido pro nome canônico —
 * assim o resto do pipeline (processarWorkbook) trata do mesmo jeito que
 * uma planilha de verdade. */
function workbookDeTabela(XLSX: Awaited<ReturnType<typeof carregarXLSX>>, tabela: string[][]) {
  const wb = XLSX.utils.book_new();
  if (tabela.length === 0) return wb;
  const { colunas } = normalizarCabecalho(tabela[0]);
  const linhas = [colunas, ...tabela.slice(1)];
  const ws = XLSX.utils.aoa_to_sheet(linhas);
  XLSX.utils.book_append_sheet(wb, ws, 'Dados');
  return wb;
}

/** Lê o arquivo enviado (.xlsx, .xls, .csv, .docx ou .pdf) e devolve os
 * clientes/vendedores encontrados, já validados linha a linha. */
export async function lerPlanilha(arquivo: File): Promise<LeituraPlanilha> {
  const XLSX = await carregarXLSX();
  const nome = arquivo.name.toLowerCase();

  if (nome.endsWith('.docx')) {
    const tabela = await extrairTabelaDocx(arquivo);
    if (tabela.length === 0) {
      return {
        clientes: [],
        vendedores: [],
        clientesIgnorados: 0,
        vendedoresIgnorados: 0,
        erros: ['Não encontrei nenhuma tabela nesse .docx — cole os dados numa tabela do Word, com o cabeçalho igual ao do modelo Excel.'],
      };
    }
    return processarWorkbook(workbookDeTabela(XLSX, tabela), XLSX);
  }

  if (nome.endsWith('.pdf')) {
    const tabela = await extrairTabelaPdf(arquivo);
    if (tabela.length === 0) {
      return {
        clientes: [],
        vendedores: [],
        clientesIgnorados: 0,
        vendedoresIgnorados: 0,
        erros: [
          'Não consegui extrair texto desse .pdf — se for um PDF escaneado (imagem), não é lido; use um PDF gerado direto do sistema/planilha, ou envie em .xlsx/.csv/.docx.',
        ],
      };
    }
    return processarWorkbook(workbookDeTabela(XLSX, tabela), XLSX);
  }

  // .xlsx / .xls / .csv
  const buffer = await arquivo.arrayBuffer();
  // .csv não é um formato binário (ao contrário do .xlsx/.xls, que é um
  // zip) — lendo como 'array' sem decodificar, o xlsx assume Latin-1 por
  // padrão quando o arquivo não tem BOM UTF-8, e acentos (São Paulo,
  // Código, Razão...) viram lixo. Decodificamos como texto UTF-8 primeiro
  // pra CSV. Também usamos `raw: true` na leitura pra desligar a
  // "adivinhação" de tipo do xlsx pra CSV (que auto-detecta números e
  // datas por conteúdo): sem isso, "0001" vira número 1 (perde zero à
  // esquerda) e "2026-01-10" vira data serial formatada "1/10/26" (não
  // bate mais com nenhum dos formatos que paraDataISO reconhece). Deixando
  // tudo como texto puro, quem decide o tipo são nossas próprias funções
  // (paraNumero/paraDataISO), que já sabem interpretar texto.
  const ehCsv = nome.endsWith('.csv');
  const wb = ehCsv
    ? XLSX.read(new TextDecoder('utf-8').decode(buffer).replace(/^﻿/, ''), { type: 'string', raw: true })
    : XLSX.read(buffer, { type: 'array' });
  return processarWorkbook(wb, XLSX);
}

export interface ResultadoImportacaoPlanilha {
  clientesImportados: number;
  clientesIgnorados: number;
  vendedoresImportados: number;
  vendedoresIgnorados: number;
  erros: string[];
}

/** Lê a planilha e grava clientes/vendedores da empresa atual em lote no
 * Firestore. Vendedor novo sem senha preenchida recebe uma senha aleatória
 * (visível no resultado só se precisar reenviar pro vendedor); vendedor já
 * existente com senha em branco mantém a senha atual. */
export async function importarPlanilha(empresaId: string, arquivo: File): Promise<ResultadoImportacaoPlanilha> {
  const { clientes, vendedores, clientesIgnorados, vendedoresIgnorados, erros } = await lerPlanilha(arquivo);

  const vendedoresExistentesSnap = await getDocs(vendedoresCol(empresaId));
  const loginsExistentes = new Set(
    vendedoresExistentesSnap.docs.map((d) => (d.data() as Vendedor).login).filter(Boolean)
  );

  let lote = writeBatch(db);
  let operacoesNoLote = 0;
  async function commitSeNecessario() {
    if (operacoesNoLote >= 400) {
      await lote.commit();
      lote = writeBatch(db);
      operacoesNoLote = 0;
    }
  }

  let clientesImportados = 0;
  for (const c of clientes) {
    const ref = doc(clientesCol(empresaId), idSeguro(c.cod));
    lote.set(ref, semUndef(c), { merge: true });
    operacoesNoLote++;
    clientesImportados++;
    await commitSeNecessario();
  }

  let vendedoresImportados = 0;
  for (const v of vendedores) {
    const jaExiste = loginsExistentes.has(v.login);
    const dados: Record<string, unknown> = { nome: v.nome, login: v.login, ativo: true };
    if (v.senha) dados.senha = v.senha;
    else if (!jaExiste) dados.senha = Math.random().toString(36).slice(2, 8);
    if (v.meta !== undefined) dados.meta = v.meta;
    if (!jaExiste) dados.criadoEm = new Date().toISOString();
    const ref = doc(vendedoresCol(empresaId), idSeguro(v.login));
    lote.set(ref, dados, { merge: true });
    operacoesNoLote++;
    vendedoresImportados++;
    await commitSeNecessario();
  }

  if (operacoesNoLote > 0) await lote.commit();

  return { clientesImportados, clientesIgnorados, vendedoresImportados, vendedoresIgnorados, erros };
}
