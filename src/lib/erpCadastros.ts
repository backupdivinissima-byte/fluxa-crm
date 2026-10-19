// Cadastros do Fluxa ERP (clientes, fornecedores, condições de pagamento, tabelas de preço etc.).
// Uma definição por cadastro; a tela e a gravação são genéricas (src/pages/ErpCadastros.tsx).
import { collection, deleteDoc, doc, onSnapshot, orderBy, query, runTransaction, type Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';

export type TipoCampo = 'texto' | 'numero' | 'select' | 'ref' | 'data' | 'bool' | 'area';
export interface CampoCad {
  k: string; l: string; t: TipoCampo;
  opcoes?: string[]; ref?: string; obrigatorio?: boolean; coluna?: boolean; dica?: string;
}
export interface EntidadeCad { key: string; titulo: string; singular: string; descricao: string; grupo: string; campos: CampoCad[] }
export type RegistroCad = { id: string; codigo: number; ativo?: boolean; [k: string]: unknown };

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
const pessoa = (extra: CampoCad[] = []): CampoCad[] => [
  { k: 'nome', l: 'Nome / Razão social', t: 'texto', obrigatorio: true, coluna: true },
  { k: 'documento', l: 'CPF / CNPJ', t: 'texto', coluna: true },
  { k: 'telefone', l: 'Telefone / WhatsApp', t: 'texto', coluna: true },
  { k: 'email', l: 'E-mail', t: 'texto' },
  { k: 'cidade', l: 'Cidade', t: 'texto', coluna: true },
  { k: 'uf', l: 'UF', t: 'select', opcoes: UFS },
  { k: 'endereco', l: 'Endereço', t: 'texto' },
  ...extra,
  { k: 'observacao', l: 'Observação', t: 'area' },
];

export const ENTIDADES: EntidadeCad[] = [
  { key: 'clientes', grupo: 'Pessoas', titulo: 'Clientes', singular: 'cliente', descricao: 'Quem compra de você.', campos: pessoa([
    { k: 'grupoId', l: 'Grupo de cliente', t: 'ref', ref: 'gruposCliente' },
    { k: 'instagram', l: 'Instagram (@)', t: 'texto', dica: 'Útil para vendas de live' },
  ]) },
  { key: 'gruposCliente', grupo: 'Pessoas', titulo: 'Grupos de cliente', singular: 'grupo de cliente', descricao: 'Agrupa clientes com uma tabela de preço e desconto próprios (ex.: revendedora, atacado).', campos: [
    { k: 'nome', l: 'Nome do grupo', t: 'texto', obrigatorio: true, coluna: true },
    { k: 'tabelaPrecoId', l: 'Tabela de preço', t: 'ref', ref: 'tabelasPreco', coluna: true },
    { k: 'desconto', l: 'Desconto (%)', t: 'numero', coluna: true },
  ] },
  { key: 'fornecedores', grupo: 'Pessoas', titulo: 'Fornecedores', singular: 'fornecedor', descricao: 'De quem você compra.', campos: pessoa([{ k: 'contato', l: 'Pessoa de contato', t: 'texto', coluna: true }]) },
  { key: 'transportadores', grupo: 'Pessoas', titulo: 'Transportadores', singular: 'transportador', descricao: 'Quem entrega seus pedidos.', campos: pessoa() },
  { key: 'representantes', grupo: 'Pessoas', titulo: 'Representantes', singular: 'representante', descricao: 'Representantes comerciais.', campos: pessoa([{ k: 'comissao', l: 'Comissão (%)', t: 'numero', coluna: true }]) },
  { key: 'funcionarios', grupo: 'Pessoas', titulo: 'Funcionários', singular: 'funcionário', descricao: 'Equipe da empresa.', campos: [
    { k: 'nome', l: 'Nome', t: 'texto', obrigatorio: true, coluna: true },
    { k: 'documento', l: 'CPF', t: 'texto', coluna: true },
    { k: 'telefone', l: 'Telefone', t: 'texto', coluna: true },
    { k: 'setor', l: 'Setor', t: 'texto', coluna: true },
  ] },
  { key: 'vendedores', grupo: 'Pessoas', titulo: 'Vendedores', singular: 'vendedor', descricao: 'Quem vende (o pedido guarda o vendedor).', campos: pessoa([{ k: 'comissao', l: 'Comissão (%)', t: 'numero', coluna: true }]) },
  { key: 'corretores', grupo: 'Pessoas', titulo: 'Corretores', singular: 'corretor', descricao: 'Intermediários de venda.', campos: pessoa([{ k: 'comissao', l: 'Comissão (%)', t: 'numero' }]) },

  { key: 'categoriasProduto', grupo: 'Produtos', titulo: 'Categorias de produto', singular: 'categoria', descricao: 'Ex.: anéis, brincos, colares.', campos: [{ k: 'nome', l: 'Nome', t: 'texto', obrigatorio: true, coluna: true }] },
  { key: 'gruposProduto', grupo: 'Produtos', titulo: 'Grupos de produto', singular: 'grupo de produto', descricao: 'Agrupamento adicional (ex.: coleção, linha).', campos: [{ k: 'nome', l: 'Nome', t: 'texto', obrigatorio: true, coluna: true }] },
  { key: 'marcasProduto', grupo: 'Produtos', titulo: 'Marcas', singular: 'marca', descricao: 'Marcas dos seus produtos.', campos: [{ k: 'nome', l: 'Nome', t: 'texto', obrigatorio: true, coluna: true }] },
  { key: 'tabelasPreco', grupo: 'Produtos', titulo: 'Tabelas de preço', singular: 'tabela de preço', descricao: 'Ajuste sobre o preço base: negativo dá desconto, positivo acrescenta.', campos: [
    { k: 'nome', l: 'Nome', t: 'texto', obrigatorio: true, coluna: true },
    { k: 'ajuste', l: 'Ajuste sobre o preço (%)', t: 'numero', coluna: true, dica: 'Ex.: -20 = 20% mais barato' },
  ] },
  { key: 'variacoesProduto', grupo: 'Produtos', titulo: 'Variações de produto', singular: 'variação', descricao: 'Atributos que variam: tamanho, cor, banho.', campos: [
    { k: 'nome', l: 'Variação', t: 'texto', obrigatorio: true, coluna: true, dica: 'Ex.: Tamanho' },
    { k: 'valores', l: 'Valores (separe por vírgula)', t: 'texto', obrigatorio: true, coluna: true, dica: 'Ex.: 14, 16, 18' },
  ] },

  { key: 'condicoesPagamento', grupo: 'Vendas', titulo: 'Condições de pagamento', singular: 'condição de pagamento', descricao: 'Prazos de pagamento.', campos: [
    { k: 'nome', l: 'Descrição', t: 'texto', obrigatorio: true, coluna: true, dica: 'Ex.: 30/60/90' },
    { k: 'parcelas', l: 'Parcelas', t: 'numero', obrigatorio: true, coluna: true },
  ] },
  { key: 'operacoesVenda', grupo: 'Vendas', titulo: 'Operações de venda', singular: 'operação de venda', descricao: 'De onde veio a venda (presencial, live, WhatsApp, catálogo…).', campos: [
    { k: 'sigla', l: 'Sigla', t: 'texto', obrigatorio: true, coluna: true },
    { k: 'nome', l: 'Descrição', t: 'texto', obrigatorio: true, coluna: true },
  ] },
  { key: 'promocoes', grupo: 'Vendas', titulo: 'Promoções', singular: 'promoção', descricao: 'Regras automáticas de preço.', campos: [
    { k: 'nome', l: 'Nome', t: 'texto', obrigatorio: true, coluna: true },
    { k: 'tipo', l: 'Tipo', t: 'select', opcoes: ['Desconto em %', 'Desconto em R$', 'Leve X pague Y', 'Frete grátis acima de'], coluna: true },
    { k: 'regra', l: 'Regra / valor', t: 'texto', coluna: true, dica: 'Ex.: 10 (para 10%) ou 3x2' },
    { k: 'inicio', l: 'Início', t: 'data', coluna: true },
    { k: 'fim', l: 'Fim', t: 'data', coluna: true },
    { k: 'prioridade', l: 'Prioridade', t: 'numero', coluna: true },
  ] },
  { key: 'contratos', grupo: 'Vendas', titulo: 'Contratos', singular: 'contrato', descricao: 'Modelos de contrato.', campos: [
    { k: 'nome', l: 'Descrição', t: 'texto', obrigatorio: true, coluna: true },
    { k: 'texto', l: 'Texto do contrato', t: 'area' },
  ] },
];

export const entidadePorKey = (k: string) => ENTIDADES.find((e) => e.key === k);

const col = (empresaId: string, key: string) => collection(db, 'empresas', empresaId, `erp_${key}`);

export function ouvirCadastro(empresaId: string, key: string, cb: (r: RegistroCad[]) => void): Unsubscribe {
  return onSnapshot(query(col(empresaId, key), orderBy('codigo')), (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as RegistroCad)));
}

/** Cria (com código sequencial por cadastro) ou edita. */
export async function salvarCadastro(empresaId: string, key: string, dados: Record<string, unknown>, existente?: RegistroCad) {
  const limpo: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(dados)) if (v !== undefined && v !== '') limpo[k] = v;
  if (existente) {
    await runTransaction(db, async (tx) => { tx.set(doc(col(empresaId, key), existente.id), { ...limpo, atualizadoEm: new Date().toISOString() }, { merge: true }); });
    return;
  }
  const contRef = doc(db, 'empresas', empresaId, 'contadores', `erp_${key}`);
  const novo = doc(col(empresaId, key));
  await runTransaction(db, async (tx) => {
    const c = await tx.get(contRef);
    const codigo = Number(c.exists() ? c.data().ultimo : 0) + 1;
    tx.set(contRef, { ultimo: codigo });
    tx.set(novo, { ...limpo, codigo, ativo: true, criadoEm: new Date().toISOString(), atualizadoEm: new Date().toISOString() });
  });
}

export async function excluirCadastro(empresaId: string, key: string, id: string) {
  await deleteDoc(doc(col(empresaId, key), id));
}
