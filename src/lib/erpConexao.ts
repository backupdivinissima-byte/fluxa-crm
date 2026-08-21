// Conexão "puxando" dados do sistema atual da empresa (ERP, e-commerce
// etc.) — sentido oposto da chave de API em apiKey.ts: aqui é o Fluxa CRM
// que chama a API de fora, usando a URL/credencial configuradas aqui, e
// importa a lista de clientes automaticamente. Ver functions/index.js
// (rota /v1/sincronizar-de-erp) pro lado que efetivamente busca os dados.
import { doc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
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
