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
  'Produto/Categoria',
  'Quantidade',
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
      'Brincos',
      3,
    ],
    // Mesmo código ("C001") repetido numa 2ª linha, só pra ilustrar como
    // registrar mais de um produto pro mesmo cliente — ver instrução 10.
    ['C001', '', '', '', '', '', '', '', '', '', '', 'Colares', 1],
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
    [
      '10. "Produto/Categoria" e "Quantidade" são opcionais e alimentam o ranking "Produtos mais comprados" de cada cliente (na tela Clientes). Pra registrar mais de um produto pro mesmo cliente, repita o "Código*" em várias linhas, uma por produto — só precisa preencher os outros campos (nome, telefone...) numa delas, as demais podem deixar em branco. As quantidades de cada produto são somadas entre as linhas repetidas.',
    ],
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
  'produto/categoria': 'Produto/Categoria',
  produto: 'Produto/Categoria',
  categoria: 'Produto/Categoria',
  quantidade: 'Quantidade',
  qtd: 'Quantidade',
  qtde: 'Quantidade',
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

const CHAVES_EXATAS_CLIENTES = new Set([
  'codigo',
  'codigo*',
  'cod',
  'cod*',
  'codigo do cliente',
  'codigo cliente',
  'id',
  'id do cliente',
  'cod cliente',
]);
const CHAVES_EXATAS_VENDEDORES = new Set(['login', 'login*', 'usuario', 'login do vendedor']);

// Reconhecimento por "contém", usado só pra PREENCHER colunas depois que o
// tipo da tabela (clientes/vendedores) já foi decidido por uma chave exata
// acima — nunca pra decidir o tipo, pra não arriscar interpretar planilha
// errada. Testado em ordem: o 1º padrão que bater vence, então padrões
// mais específicos vêm antes dos mais genéricos (ex.: "nome do vendedor"
// antes de "nome").
const CONTEM_CLIENTES: Array<[RegExp, string]> = [
  [/codigo|\bcod\b|\bid\b/, 'Código*'],
  [/nome.*vendedor/, 'Nome do vendedor'],
  [/login.*vendedor/, 'Login do vendedor'],
  [/vendedor/, 'Nome do vendedor'],
  [/raz.*social/, 'Razão Social'],
  [/nome/, 'Nome'],
  [/fone|celular|whats/, 'Telefone'],
  [/cnpj|cpf/, 'CNPJ/CPF'],
  [/cidade|municipio/, 'Cidade'],
  [/^uf$|^estado$/, 'UF'],
  [/data.*compra|ultima.*compra|data/, 'Data última compra (AAAA-MM-DD)'],
  [/total|valor/, 'Total geral (R$)'],
  [/produto|categoria/, 'Produto/Categoria'],
  [/quantidade|^qtd/, 'Quantidade'],
];

const CONTEM_VENDEDORES: Array<[RegExp, string]> = [
  [/senha/, 'Senha'],
  [/meta/, 'Meta pessoal (R$)'],
  [/nome/, 'Nome*'],
  [/login|usuario/, 'Login*'],
];

/** Recebe a 1ª linha (cabeçalho) de uma tabela — de .xlsx/.xls/.csv,
 * .docx ou .pdf, tanto faz — e devolve os nomes de coluna já traduzidos
 * pro nome canônico do modelo (quando reconhecido), junto do tipo de
 * tabela detectado. Detecta o tipo por presença exata de uma coluna
 * "Código"/"Cod"/"ID" (clientes) ou "Login" (vendedores) — só essa
 * detecção de TIPO usa correspondência exata, pra não confundir tabelas
 * (ex.: uma planilha de produtos que por acaso tem coluna "Nome"). Depois
 * de decidido o tipo, as DEMAIS colunas aceitam também correspondência
 * "contém" (CONTEM_CLIENTES/CONTEM_VENDEDORES) — mais tolerante a nomes de
 * coluna fora do padrão exato do modelo (ex.: "Nome do Cliente", "Cidade/UF"). */
function normalizarCabecalho(
  bruto: string[],
  tipoForcado?: 'clientes' | 'vendedores'
): { colunas: string[]; tipo: 'clientes' | 'vendedores' | null } {
  const normalizados = bruto.map(normalizarTexto);
  const tipoDetectado: 'clientes' | 'vendedores' | null = normalizados.some((h) => CHAVES_EXATAS_CLIENTES.has(h))
    ? 'clientes'
    : normalizados.some((h) => CHAVES_EXATAS_VENDEDORES.has(h))
      ? 'vendedores'
      : null;
  const tipoParaTraducao = tipoDetectado ?? tipoForcado ?? null;
  const mapaExato = tipoParaTraducao === 'vendedores' ? SINONIMOS_VENDEDORES : SINONIMOS_CLIENTES;
  const padroesContem = tipoParaTraducao === 'vendedores' ? CONTEM_VENDEDORES : CONTEM_CLIENTES;
  const colunas = bruto.map((h, i) => {
    const norm = normalizados[i];
    if (mapaExato[norm]) return mapaExato[norm];
    const achado = padroesContem.find(([re]) => re.test(norm));
    return achado ? achado[1] : h;
  });
  return { colunas, tipo: tipoDetectado };
}

/** Uma aba literalmente chamada "Clientes" ou "Vendedores" é um sinal forte
 * o bastante do tipo de dado ali dentro (mesmo que o cabeçalho da tabela
 * use nomes de coluna fora do padrão) — usado como fallback quando nenhuma
 * coluna bate com as chaves exatas de tipo. */
function tipoForcadoPorNomeAba(nomeAba: string): 'clientes' | 'vendedores' | undefined {
  const n = normalizarTexto(nomeAba);
  if (n === 'clientes' || n === 'cliente') return 'clientes';
  if (n === 'vendedores' || n === 'vendedor') return 'vendedores';
  return undefined;
}

const MAX_LINHAS_BUSCA_CABECALHO = 15;

function linhaTemConteudoSuficiente(linha: unknown[]): boolean {
  return linha.filter((c) => String(c ?? '').trim() !== '').length >= 2;
}

/** Varre uma aba procurando a linha de cabeçalho de verdade dentro das
 * primeiras linhas — nem toda planilha/relatório exportado tem o
 * cabeçalho na linha 1 (é comum ter linha(s) de título do relatório
 * acima, como "RELATÓRIO DE MOVIMENTAÇÕES" ou o nome da empresa). Devolve
 * o cabeçalho já traduzido, o tipo detectado, e as linhas de dados (tudo
 * que vem depois do cabeçalho) — ou null se não achar nada reconhecível
 * nessa aba dentro do limite de linhas verificado. */
function extrairTabelaDaAba(
  aba: ReturnType<Awaited<ReturnType<typeof carregarXLSX>>['read']>['Sheets'][string],
  XLSX: Awaited<ReturnType<typeof carregarXLSX>>,
  tipoForcado?: 'clientes' | 'vendedores'
): { tipo: 'clientes' | 'vendedores'; colunas: string[]; linhasDados: unknown[][] } | null {
  const matriz = XLSX.utils.sheet_to_json<unknown[]>(aba, { header: 1, defval: '' }) as unknown[][];
  const limite = Math.min(matriz.length, MAX_LINHAS_BUSCA_CABECALHO);
  for (let i = 0; i < limite; i++) {
    const bruto = matriz[i] ?? [];
    if (!linhaTemConteudoSuficiente(bruto)) continue;
    const brutoStr = bruto.map((c) => String(c ?? '').trim());
    const { colunas, tipo } = normalizarCabecalho(brutoStr, tipoForcado);
    const tipoFinal = tipo ?? tipoForcado;
    if (tipoFinal) return { tipo: tipoFinal, colunas, linhasDados: matriz.slice(i + 1) };
  }
  return null;
}

function linhasParaRegistros(colunas: string[], linhasDados: unknown[][]): Record<string, unknown>[] {
  return linhasDados.map((linha) => {
    const registro: Record<string, unknown> = {};
    colunas.forEach((col, idx) => {
      registro[col] = linha[idx] ?? '';
    });
    return registro;
  });
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

/** Lê qualquer um dos 4 formatos suportados (.xlsx/.xls/.csv/.docx/.pdf) e
 * devolve a tabela "crua" (linha 0 = cabeçalho, como está no arquivo, sem
 * nenhuma interpretação de coluna) — usado por quem precisa ler uma tabela
 * genérica do documento em vez do formato específico de clientes/vendedores
 * (ex.: preencher automaticamente o formulário de conexão do ERP a partir de
 * um documento de configuração). */
export async function lerTabelaBruta(arquivo: File): Promise<string[][]> {
  const nome = arquivo.name.toLowerCase();
  if (nome.endsWith('.docx')) return extrairTabelaDocx(arquivo);
  if (nome.endsWith('.pdf')) return extrairTabelaPdf(arquivo);

  const XLSX = await carregarXLSX();
  const buffer = await arquivo.arrayBuffer();
  const ehCsv = nome.endsWith('.csv');
  const wb = ehCsv
    ? XLSX.read(new TextDecoder('utf-8').decode(buffer).replace(/^﻿/, ''), { type: 'string', raw: true })
    : XLSX.read(buffer, { type: 'array' });
  const primeiraAba = wb.Sheets[wb.SheetNames[0]];
  if (!primeiraAba) return [];
  return XLSX.utils
    .sheet_to_json<unknown[]>(primeiraAba, { header: 1 })
    .map((linha) => (linha as unknown[]).map((c) => String(c ?? '').trim()));
}

/** Processa um workbook (xlsx/xls/csv nativo, ou sintético montado a partir
 * de uma tabela extraída de .docx/.pdf) e valida linha a linha — nunca
 * lança erro por causa de uma linha ruim isolada, só ignora essa linha e
 * registra o motivo em `erros`, pra uma planilha grande não travar inteira
 * por um único typo. */
function processarWorkbook(wb: ReturnType<Awaited<ReturnType<typeof carregarXLSX>>['read']>, XLSX: Awaited<ReturnType<typeof carregarXLSX>>): LeituraPlanilha {
  const erros: string[] = [];

  // Varre TODAS as abas do arquivo (não só uma aba única, e não só abas
  // chamadas exatamente "Clientes"/"Vendedores") procurando tabelas de
  // cliente/vendedor — cada aba pode ter linhas de título acima do
  // cabeçalho de verdade (ver extrairTabelaDaAba). Uma aba chamada
  // "Clientes"/"Vendedores" força esse tipo mesmo se o cabeçalho usar
  // nomes de coluna fora do padrão exato do modelo.
  const registrosClientes: Record<string, unknown>[] = [];
  const registrosVendedores: Record<string, unknown>[] = [];
  const cabecalhosEncontrados: string[] = [];

  for (const nomeAba of wb.SheetNames) {
    const aba = wb.Sheets[nomeAba];
    if (!aba) continue;
    const achado = extrairTabelaDaAba(aba, XLSX, tipoForcadoPorNomeAba(nomeAba));
    if (!achado) continue;
    cabecalhosEncontrados.push(`"${nomeAba}" (${achado.tipo}): ${achado.colunas.join(', ')}`);
    const registros = linhasParaRegistros(achado.colunas, achado.linhasDados);
    if (achado.tipo === 'clientes') registrosClientes.push(...registros);
    else registrosVendedores.push(...registros);
  }

  if (registrosClientes.length === 0 && registrosVendedores.length === 0) {
    erros.push(
      cabecalhosEncontrados.length > 0
        ? `Não encontrei uma coluna de código de cliente ("Código"/"Cod"/"ID") nem de login de vendedor em nenhuma aba. Cabeçalhos encontrados — ${cabecalhosEncontrados.join(' | ')} — baixe o modelo pra conferir os nomes de coluna esperados.`
        : 'Não encontrei nenhuma linha com dado nesse arquivo — confira se a planilha não está vazia ou baixe o modelo pra conferir o formato.'
    );
  }

  // Acumula por "Código*" em vez de 1 linha = 1 cliente: assim dá pra
  // repetir o mesmo código em várias linhas (uma por produto comprado, ou
  // vindo de abas diferentes) sem criar clientes duplicados — os campos
  // escalares (nome, telefone...) usam o 1º valor não vazio encontrado, a
  // data usa a mais recente entre as linhas, e as quantidades de
  // "Produto/Categoria" são somadas.
  const acumulado = new Map<string, Omit<Cliente, 'id'>>();
  const ordemCod: string[] = [];
  let clientesIgnorados = 0;
  registrosClientes.forEach((linha, i) => {
    if (linhaVazia(linha)) return;
    const cod = strOrUndef(linha['Código*']);
    if (!cod) {
      clientesIgnorados++;
      erros.push(`Clientes, linha ${i + 2}: sem "Código*" preenchido — linha ignorada.`);
      return;
    }

    let c = acumulado.get(cod);
    if (!c) {
      c = { cod };
      acumulado.set(cod, c);
      ordemCod.push(cod);
    }

    c.nome ??= strOrUndef(linha['Nome']);
    c.razao ??= strOrUndef(linha['Razão Social']);
    c.telefone ??= strOrUndef(linha['Telefone']);
    c.cnpj ??= strOrUndef(linha['CNPJ/CPF']);
    c.cidade ??= strOrUndef(linha['Cidade']);
    c.uf ??= strOrUndef(linha['UF']);
    c.totalGeral ??= paraNumero(linha['Total geral (R$)']);
    c.cod_vendedor ??= strOrUndef(linha['Login do vendedor']);
    c.vend_nome ??= strOrUndef(linha['Nome do vendedor']);

    const data = paraDataISO(linha['Data última compra (AAAA-MM-DD)']);
    if (data && (!c.dtUltCompra || data > c.dtUltCompra)) c.dtUltCompra = data;

    const produto = strOrUndef(linha['Produto/Categoria']);
    if (produto) {
      const qtd = paraNumero(linha['Quantidade']) ?? 1;
      c.produtos ??= {};
      c.produtos[produto] = (c.produtos[produto] ?? 0) + qtd;
    }
  });
  const clientes: Array<Omit<Cliente, 'id'>> = ordemCod.map((cod) => acumulado.get(cod)!);

  const vendedores: Array<Omit<Vendedor, 'id' | 'ativo'>> = [];
  let vendedoresIgnorados = 0;
  registrosVendedores.forEach((linha, i) => {
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

// ---- Leitura especial: "Relatório de Movimentações" (extrato de vendas
// exportado por ERP/PDV, salvo com extensão .xls mas com conteúdo HTML por
// dentro) ----
// Esse tipo de relatório não é uma lista de clientes — é um extrato de
// vendas, com o cliente e os produtos comprados aninhados dentro de cada
// "documento" de venda (várias linhas por venda), em vez de 1 linha = 1
// cliente. Além disso, o HTML desses relatórios costuma vir com tags
// <table> sem fechamento — o que faz o parser binário do xlsx (SheetJS)
// fatiar o conteúdo em centenas de "abas" fragmentadas e incoerentes (cada
// pedaço com colunas desalinhadas). Por isso não reaproveitamos
// processarWorkbook aqui: usamos DOMParser (o mesmo algoritmo de parsing de
// HTML5 do navegador) pra reconstruir a tabela original de verdade a partir
// do HTML bruto — testado e confirmado que recupera 100% das linhas do
// relatório, na ordem certa, numa <table> só.

/** Detecta se o conteúdo do arquivo é, na verdade, HTML (comum em
 * exportações de ERP/PDV que salvam um relatório em .xls, mas o conteúdo
 * real é uma tabela HTML — não um arquivo binário Excel de verdade). */
function pareceConteudoHtml(textoInicial: string): boolean {
  const inicio = textoInicial.trimStart().toLowerCase();
  return inicio.startsWith('<html') || inicio.startsWith('<!doctype html') || inicio.includes('<table');
}

/** Extrai todas as <table> de um HTML e devolve cada uma como matriz de
 * célula (cada linha = array de textos de <td>/<th>). */
function extrairTabelasHtml(html: string): string[][][] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(doc.querySelectorAll('table')).map((tabela) =>
    Array.from(tabela.querySelectorAll('tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td,th')).map((celula) => (celula.textContent ?? '').trim())
    )
  );
}

/** "4565 - THAIANE RIBEIRO..." -> {cod:"4565", nome:"THAIANE RIBEIRO..."} */
function partirCodNome(s: string | undefined): { cod?: string; nome?: string } {
  if (!s) return {};
  const m = s.trim().match(/^(\d+)\s*-\s*(.+)$/);
  if (m) return { cod: m[1], nome: m[2].trim() || undefined };
  return { nome: s.trim() || undefined };
}

const STATUS_VENDA_CONHECIDOS = ['Cancelado', 'Fechada', 'Aberta'];

function situacaoDaLinha(cells: string[]): string | undefined {
  return cells.find((c) => STATUS_VENDA_CONHECIDOS.includes(c.trim()))?.trim();
}

/** Pega o último valor "R$ ..." da linha — nesse relatório a ordem das
 * colunas de valor é sempre Desc./Frete/Vlr. Liq./Vlr. Total, então o
 * último é o Vlr. Total (o que interessa pro totalGeral do cliente). */
function valorTotalDaLinhaCliente(cells: string[]): number | undefined {
  const valoresRs = cells.filter((c) => /^R\$/.test(c.trim()));
  if (valoresRs.length === 0) return undefined;
  return paraNumero(valoresRs[valoresRs.length - 1]);
}

function ehLinhaClienteRelatorio(cells: string[]): boolean {
  return (cells[1] ?? '').trim() === 'Cliente';
}
function ehLinhaVendedorRelatorio(cells: string[]): boolean {
  return (cells[1] ?? '').trim().toLowerCase().startsWith('vendedor');
}
/** Linha de produto: célula 1 é "código - nome" (ex.: "001110 - BRINCO") e
 * não é uma linha de cliente/vendedor. */
function ehLinhaProdutoRelatorio(cells: string[]): boolean {
  const c1 = (cells[1] ?? '').trim();
  return /^\d+\s*-\s*.+/.test(c1) && !ehLinhaClienteRelatorio(cells) && !ehLinhaVendedorRelatorio(cells);
}
/** A quantidade nessa linha é o 1º valor numérico "puro" (sem "R$") a
 * partir da 3ª célula — a posição exata varia (às vezes tem uma célula em
 * branco a mais antes dela), então procuramos pelo formato em vez de uma
 * posição fixa. */
function quantidadeDaLinhaProduto(cells: string[]): number {
  for (let i = 2; i < cells.length; i++) {
    if (/^\d+(\.\d+)?$/.test(cells[i].trim())) return paraNumero(cells[i]) ?? 1;
  }
  return 1;
}

/** Reconhece se uma tabela extraída de HTML é um "Relatório de
 * Movimentações" desse formato — presença de ao menos 1 linha "Cliente" e 1
 * "Vendedor(a)" é a assinatura. */
function ehRelatorioDeMovimentacoes(tabela: string[][]): boolean {
  return tabela.some(ehLinhaClienteRelatorio) && tabela.some(ehLinhaVendedorRelatorio);
}

/** Lê um "Relatório de Movimentações" e devolve os clientes agregados: cada
 * "documento" de venda (linha "Cliente" + linha "Vendedor(a)" logo depois +
 * linhas de produto até a próxima coisa que não for produto) é uma venda;
 * várias vendas do mesmo código de cliente são somadas num único registro
 * (valor total somado, produtos comprados somados, vendedor "dono" = o da
 * venda mais recente). Vendas com situação "Cancelado" são ignoradas — não
 * contam como compra de verdade nem entram no ranking de produtos. */
function extrairClientesRelatorioMovimentacoes(tabela: string[][]): {
  clientes: Array<Omit<Cliente, 'id'>>;
  vendasCanceladasIgnoradas: number;
} {
  const acumulado = new Map<string, Omit<Cliente, 'id'>>();
  const ordemCod: string[] = [];
  let vendasCanceladasIgnoradas = 0;

  for (let i = 0; i < tabela.length; i++) {
    const linha = tabela[i];
    if (!ehLinhaClienteRelatorio(linha)) continue;

    const { cod: codCliente, nome: nomeCliente } = partirCodNome(linha[2]);
    const cod = codCliente ?? idSeguro(nomeCliente ?? `cliente-linha-${i}`);
    const cancelada = situacaoDaLinha(linha)?.toLowerCase() === 'cancelado';
    const dataMatch = (linha[3] ?? '').match(/(\d{2}\/\d{2}\/\d{4})/);
    const dataISO = dataMatch ? paraDataISO(dataMatch[1]) : undefined;
    const valorTotal = valorTotalDaLinhaCliente(linha);

    const linhaVendedor = tabela[i + 1];
    const temVendedor = !!linhaVendedor && ehLinhaVendedorRelatorio(linhaVendedor);
    const vendedorInfo = temVendedor ? partirCodNome(linhaVendedor[2]) : {};

    const produtosDaVenda: Array<{ nome: string; qtd: number }> = [];
    let j = i + (temVendedor ? 2 : 1);
    while (j < tabela.length && ehLinhaProdutoRelatorio(tabela[j])) {
      const { nome: nomeProduto } = partirCodNome(tabela[j][1]);
      if (nomeProduto) produtosDaVenda.push({ nome: nomeProduto, qtd: quantidadeDaLinhaProduto(tabela[j]) });
      j++;
    }

    if (cancelada) {
      vendasCanceladasIgnoradas++;
      continue;
    }

    let c = acumulado.get(cod);
    if (!c) {
      c = { cod };
      acumulado.set(cod, c);
      ordemCod.push(cod);
    }
    c.nome ??= nomeCliente;
    c.totalGeral = (c.totalGeral ?? 0) + (valorTotal ?? 0);
    if (dataISO && (!c.dtUltCompra || dataISO > c.dtUltCompra)) {
      c.dtUltCompra = dataISO;
      if (vendedorInfo.cod) c.cod_vendedor = vendedorInfo.cod;
      if (vendedorInfo.nome) c.vend_nome = vendedorInfo.nome;
    }
    for (const p of produtosDaVenda) {
      c.produtos ??= {};
      c.produtos[p.nome] = (c.produtos[p.nome] ?? 0) + p.qtd;
    }
  }

  return { clientes: ordemCod.map((cod) => acumulado.get(cod)!), vendasCanceladasIgnoradas };
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

  // Alguns ERPs/PDVs exportam um "relatório" com extensão .xls/.xlsx cujo
  // conteúdo real é HTML (não um Excel binário de verdade) — detectamos
  // isso pelos primeiros bytes do arquivo antes de tentar ler como xlsx
  // normal, porque o parser binário do xlsx lê esse HTML de forma
  // inconsistente (ver extrairClientesRelatorioMovimentacoes acima).
  if (!ehCsv) {
    const textoInicial = new TextDecoder('utf-8').decode(buffer.slice(0, 1000));
    if (pareceConteudoHtml(textoInicial)) {
      const textoCompleto = new TextDecoder('utf-8').decode(buffer);
      const tabelas = extrairTabelasHtml(textoCompleto);
      const maiorTabela = tabelas.reduce<string[][] | null>(
        (maior, atual) => (atual.length > (maior?.length ?? 0) ? atual : maior),
        null
      );
      if (maiorTabela && ehRelatorioDeMovimentacoes(maiorTabela)) {
        const { clientes, vendasCanceladasIgnoradas } = extrairClientesRelatorioMovimentacoes(maiorTabela);
        const erros: string[] = [];
        if (vendasCanceladasIgnoradas > 0) {
          erros.push(
            `${vendasCanceladasIgnoradas} venda(s) com situação "Cancelado" foram ignoradas (não contam como compra).`
          );
        }
        if (clientes.length === 0) {
          erros.push('Não encontrei nenhum cliente com venda válida nesse relatório.');
        }
        return { clientes, vendedores: [], clientesIgnorados: 0, vendedoresIgnorados: 0, erros };
      }
      if (maiorTabela) {
        // HTML de outro formato de relatório (não bate com a assinatura do
        // Relatório de Movimentações) — tenta como tabela genérica, igual
        // fazemos com .docx/.pdf.
        return processarWorkbook(workbookDeTabela(XLSX, maiorTabela), XLSX);
      }
    }
  }

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

/** Grava clientes/vendedores já lidos (de onde vieram — planilha comum ou
 * leitura por IA — não importa mais a partir daqui) em lote no Firestore.
 * Vendedor novo sem senha preenchida recebe uma senha aleatória (visível no
 * resultado só se precisar reenviar pro vendedor); vendedor já existente
 * com senha em branco mantém a senha atual. Extraído de `importarPlanilha`
 * pra ser reaproveitado também pela leitura por IA (`importarIA.ts`), que
 * chega nos mesmos formatos de `clientes`/`vendedores` por outro caminho. */
export async function salvarClientesEVendedores(
  empresaId: string,
  clientes: Array<Omit<Cliente, 'id'>>,
  vendedores: Array<Omit<Vendedor, 'id' | 'ativo'>>
): Promise<{ clientesImportados: number; vendedoresImportados: number }> {
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

  return { clientesImportados, vendedoresImportados };
}

/** Lê a planilha e grava clientes/vendedores da empresa atual — caminho
 * "rápido" (sem IA), reconhece só os nomes de coluna do modelo e suas
 * variações mais comuns (ver SINONIMOS_CLIENTES). */
export async function importarPlanilha(empresaId: string, arquivo: File): Promise<ResultadoImportacaoPlanilha> {
  const { clientes, vendedores, clientesIgnorados, vendedoresIgnorados, erros } = await lerPlanilha(arquivo);
  const { clientesImportados, vendedoresImportados } = await salvarClientesEVendedores(empresaId, clientes, vendedores);
  return { clientesImportados, clientesIgnorados, vendedoresImportados, vendedoresIgnorados, erros };
}
