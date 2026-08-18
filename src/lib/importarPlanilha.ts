// Importação genérica via planilha Excel — ao contrário da antiga
// ferramenta de migração (específica dos dados legados da Divinissima),
// esse recurso vale pra qualquer empresa do Fluxa CRM: gera um modelo
// padronizado pra download, lê de volta a planilha preenchida pelo admin e
// grava clientes/vendedores da empresa atual no Firestore. É idempotente
// (usa merge:true com o código do cliente / login do vendedor como ID do
// documento), então pode ser rodada mais de uma vez pra ressincronizar sem
// duplicar nada.
// A biblioteca de planilhas (xlsx) é carregada sob demanda (só quando essa
// tela é aberta) em vez de no bundle principal — ela é pesada e a imensa
// maioria das visitas ao site nunca chega a usar importação.
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { idSeguro } from './crmLogic';
import type { Cliente, Vendedor } from '../types';

async function carregarXLSX() {
  return await import('xlsx');
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

/** Aceita número direto ou texto em formato BR ("1.234,56") ou US ("1234.56"). */
function paraNumero(v: unknown): number | undefined {
  if (v === '' || v == null) return undefined;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (!s) return undefined;
  const comBr = Number(s.replace(/\./g, '').replace(',', '.'));
  if (Number.isFinite(comBr)) return comBr;
  const direto = Number(s);
  return Number.isFinite(direto) ? direto : undefined;
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
  XLSX.utils.book_append_sheet(wb, abaClientes, 'Clientes');

  const abaVendedores = XLSX.utils.aoa_to_sheet([[...COL_VENDEDORES], ['Cecília Souza', 'cecilia', 'senha123', 3000]]);
  abaVendedores['!cols'] = COL_VENDEDORES.map(() => ({ wch: 22 }));
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

/** Lê o arquivo enviado e valida linha a linha — nunca lança erro por causa
 * de uma linha ruim isolada, só ignora essa linha e registra o motivo em
 * `erros`, pra uma planilha grande não travar inteira por um único typo. */
export async function lerPlanilha(arquivo: File): Promise<LeituraPlanilha> {
  const XLSX = await carregarXLSX();
  const buffer = await arquivo.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const erros: string[] = [];

  const abaClientes = wb.Sheets['Clientes'];
  const abaVendedores = wb.Sheets['Vendedores'];
  if (!abaClientes && !abaVendedores) {
    erros.push(
      'Não encontrei nenhuma aba "Clientes" ou "Vendedores" nesse arquivo — baixe o modelo pra conferir o formato certo.'
    );
  }

  const clientes: Array<Omit<Cliente, 'id'>> = [];
  let clientesIgnorados = 0;
  if (abaClientes) {
    const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(abaClientes, { defval: '' });
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
    const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(abaVendedores, { defval: '' });
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
