// Conexão "puxando" dados do sistema atual da empresa (ERP, e-commerce
// etc.) — sentido oposto da chave de API em apiKey.ts: aqui é o Fluxa CRM
// que chama a API de fora, usando a URL/credencial configuradas aqui, e
// importa a lista de clientes automaticamente. Ver functions/index.js
// (rota /v1/sincronizar-de-erp) pro lado que efetivamente busca os dados.
import { doc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { lerTabelaBruta } from './importarPlanilha';
import type { Empresa } from '../types';

export type ErpConexao = NonNullable<Empresa['erpConexao']>;

export const CAMPOS_MAPEAVEIS: { campo: string; label: string; obrigatorio?: boolean }[] = [
  { campo: 'cod', label: 'Código do cliente', obrigatorio: true },
  { campo: 'nome', label: 'Nome' },
  { campo: 'razao', label: 'Razão social' },
  { campo: 'telefone', label: 'Telefone' },
  { campo: 'cnpj', label: 'CNPJ/CPF' },
  { campo: 'cidade', label: 'Cidade' },
  { campo: 'uf', label: 'UF' },
  { campo: 'dtUltCompra', label: 'Data da última compra' },
  { campo: 'totalGeral', label: 'Valor total' },
  { campo: 'cod_vendedor', label: 'Login do vendedor' },
  { campo: 'vend_nome', label: 'Nome do vendedor' },
];

export const MAPEAMENTO_PADRAO: Record<string, string> = {
  cod: 'codigo',
  nome: 'nome',
  telefone: 'telefone',
  cnpj: 'cnpj',
  cidade: 'cidade',
  uf: 'uf',
  dtUltCompra: 'dataUltimaCompra',
  totalGeral: 'valorTotal',
};

// Preenchimento automático do formulário de conexão a partir de um
// documento (em vez de digitar URL/token/mapeamento campo a campo à mão) —
// o admin baixa o modelo, preenche com os dados do ERP dela e anexa; o
// Fluxa lê e preenche os campos do formulário sozinho.
const COLUNA_URL = 'URL da API';
const COLUNA_AUTENTICACAO = 'Autenticação (nenhuma, bearer, header ou basic)';
const COLUNA_HEADER_NOME = 'Nome do cabeçalho (só se Autenticação = header)';
const COLUNA_USUARIO = 'Usuário (só se Autenticação = basic)';
const COLUNA_TOKEN = 'Token, chave ou senha';
const COLUNA_LISTA_PATH = 'Caminho da lista na resposta (opcional)';

function colunaMapeamento(label: string): string {
  return `Mapeamento - ${label}`;
}

function normalizarCabecalhoConfig(s: string): string {
  return s.trim().toLowerCase();
}

/** Gera o .xlsx modelo (1 linha de cabeçalho + 1 linha de exemplo) pro admin
 * preencher com a URL/autenticação/mapeamento do ERP dela — depois é só
 * anexar em "Documento de configuração" e clicar em "Preencher dados". */
export async function gerarModeloConfigErp(): Promise<Blob> {
  const XLSX = await import('xlsx');
  const colunas = [
    COLUNA_URL,
    COLUNA_AUTENTICACAO,
    COLUNA_HEADER_NOME,
    COLUNA_USUARIO,
    COLUNA_TOKEN,
    COLUNA_LISTA_PATH,
    ...CAMPOS_MAPEAVEIS.map(({ label }) => colunaMapeamento(label)),
  ];
  const exemplo = [
    'https://meuerp.com.br/api/clientes',
    'bearer',
    '',
    '',
    'SEU_TOKEN_AQUI',
    '',
    'codigo',
    'nome',
    'razaoSocial',
    'telefone',
    'cnpj',
    'cidade',
    'uf',
    'dataUltimaCompra',
    'valorTotal',
    'loginVendedor',
    'nomeVendedor',
  ];
  const ws = XLSX.utils.aoa_to_sheet([colunas, exemplo]);
  ws['!cols'] = colunas.map(() => ({ wch: 30 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Configuração ERP');
  const arrayBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export interface ConfigDocumentoErp {
  url?: string;
  autenticacao?: ErpConexao['autenticacao'];
  headerNome?: string;
  valorAuth?: string;
  usuarioBasic?: string;
  listaPath?: string;
  mapeamento: Record<string, string>;
}

/** Lê um documento (.xlsx/.xls/.csv/.docx/.pdf) preenchido a partir do
 * modelo de `gerarModeloConfigErp` e devolve os valores encontrados — só os
 * campos realmente preenchidos no documento vêm com valor, o resto vem
 * undefined/vazio (quem chama decide se mantém o que já estava no
 * formulário ou sobrescreve). Reconhece o cabeçalho de forma tolerante a
 * maiúscula/minúscula e espaço, mas espera os mesmos nomes de coluna do
 * modelo — por isso vale sempre baixar o modelo antes de preencher. */
export async function lerConfigDeDocumento(arquivo: File): Promise<ConfigDocumentoErp> {
  const tabela = await lerTabelaBruta(arquivo);
  const mapeamento: Record<string, string> = {};
  if (tabela.length < 2) return { mapeamento };

  const cabecalho = tabela[0].map((c) => c.trim());
  const linha = tabela[1] ?? [];
  const valorDaColuna = (nomeColuna: string): string => {
    const idx = cabecalho.findIndex((h) => normalizarCabecalhoConfig(h) === normalizarCabecalhoConfig(nomeColuna));
    if (idx === -1) return '';
    return String(linha[idx] ?? '').trim();
  };

  const autenticacaoBruta = normalizarCabecalhoConfig(valorDaColuna(COLUNA_AUTENTICACAO));
  const autenticacao: ErpConexao['autenticacao'] | undefined =
    autenticacaoBruta === 'bearer' || autenticacaoBruta === 'header' || autenticacaoBruta === 'basic'
      ? autenticacaoBruta
      : autenticacaoBruta === 'nenhuma'
        ? 'nenhuma'
        : undefined;

  for (const { campo, label } of CAMPOS_MAPEAVEIS) {
    const valor = valorDaColuna(colunaMapeamento(label));
    if (valor) mapeamento[campo] = valor;
  }

  return {
    url: valorDaColuna(COLUNA_URL) || undefined,
    autenticacao,
    headerNome: valorDaColuna(COLUNA_HEADER_NOME) || undefined,
    valorAuth: valorDaColuna(COLUNA_TOKEN) || undefined,
    usuarioBasic: valorDaColuna(COLUNA_USUARIO) || undefined,
    listaPath: valorDaColuna(COLUNA_LISTA_PATH) || undefined,
    mapeamento,
  };
}

/** Salva a configuração de conexão com o ERP. Se `valorAuth`/`usuarioBasic`
 * vierem vazios mas já existir uma credencial salva antes, mantém a antiga
 * (assim dá pra editar só a URL/mapeamento sem reenviar o token de novo). */
export async function salvarConexaoErp(
  empresaId: string,
  config: ErpConexao,
  credencialAnterior?: { valorAuth?: string; usuarioBasic?: string }
): Promise<void> {
  const paraSalvar: ErpConexao = {
    ...config,
    valorAuth: config.valorAuth || credencialAnterior?.valorAuth,
    usuarioBasic: config.usuarioBasic || credencialAnterior?.usuarioBasic,
    configuradoEm: config.configuradoEm ?? new Date().toISOString(),
  };
  await updateDoc(doc(db, 'empresas', empresaId), { erpConexao: paraSalvar });
}

export interface ResultadoSincronizacaoErp {
  totalRecebido: number;
  clientesImportados: number;
  clientesIgnorados: number;
  erros: string[];
  amostra?: Record<string, unknown>[]; // só presente em modo de teste (preview)
}

/** Chama a Cloud Function que efetivamente busca os dados no ERP (via
 * sincronizarComErp) usando o token de sessão do admin logado. Em modo
 * `preview`, nada é gravado — só devolve os primeiros itens já mapeados
 * pra conferência antes de sincronizar de verdade. */
export async function sincronizarComErp(idToken: string, preview: boolean): Promise<ResultadoSincronizacaoErp> {
  const API_BASE_URL = 'https://us-central1-fluxa-crm.cloudfunctions.net/api';
  const resp = await fetch(`${API_BASE_URL}/v1/sincronizar-de-erp${preview ? '?preview=1' : ''}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(dados?.erro ?? `Erro ao sincronizar (HTTP ${resp.status}).`);
  }
  return dados;
}
