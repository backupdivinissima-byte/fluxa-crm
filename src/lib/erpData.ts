// Fluxa ERP — produtos e estoque. Mesmo padrão de crmData/marketingData:
// subcoleções por empresa, listeners em tempo real e `semUndefined` antes de gravar.
import { collection, doc, onSnapshot, orderBy, query, runTransaction, writeBatch, deleteDoc, limit, type Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';
import type { MovimentoEstoque, Produto } from '../types';

const produtosCol = (empresaId: string) => collection(db, 'empresas', empresaId, 'produtos');
const movimentosCol = (empresaId: string) => collection(db, 'empresas', empresaId, 'movimentosEstoque');

function semUndefined<T extends Record<string, unknown>>(obj: T): T {
  const limpo = { ...obj };
  for (const k of Object.keys(limpo)) if (limpo[k] === undefined) delete limpo[k];
  return limpo;
}

/** O código (SKU) vira o id do documento: salvar/importar o mesmo SKU de novo atualiza em vez de duplicar. */
export function idDoProduto(sku: string): string {
  return sku.trim().toUpperCase().replace(/[\/\s.#?[\]]+/g, '-').slice(0, 120);
}

export function ouvirProdutos(empresaId: string, cb: (p: Produto[]) => void): Unsubscribe {
  return onSnapshot(query(produtosCol(empresaId), orderBy('nome')), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Produto))
  );
}

export function ouvirMovimentos(empresaId: string, cb: (m: MovimentoEstoque[]) => void): Unsubscribe {
  return onSnapshot(query(movimentosCol(empresaId), orderBy('criadoEm', 'desc'), limit(200)), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as MovimentoEstoque))
  );
}

export type DadosProduto = Omit<Produto, 'id' | 'criadoEm' | 'atualizadoEm' | 'estoque'> & { estoque?: number };

/** Cria ou edita um produto. Edição NÃO mexe no estoque (isso é feito por movimentação, que deixa histórico). */
export async function salvarProduto(empresaId: string, dados: DadosProduto, existente?: Produto) {
  const id = existente?.id ?? idDoProduto(dados.sku);
  if (!id) throw new Error('Informe o código (SKU) do produto.');
  const ref = doc(produtosCol(empresaId), id);
  const agora = new Date().toISOString();
  await runTransaction(db, async (tx) => {
    const atual = await tx.get(ref);
    if (!existente && atual.exists()) throw new Error(`Já existe um produto com o código ${dados.sku}.`);
    const base = {
      sku: dados.sku.trim(),
      nome: dados.nome.trim(),
      categoria: dados.categoria?.trim() || undefined,
      unidade: dados.unidade?.trim() || 'un',
      preco: dados.preco,
      custo: dados.custo,
      estoqueMinimo: dados.estoqueMinimo,
      ativo: dados.ativo,
      origem: existente?.origem ?? 'manual',
      atualizadoEm: agora,
    };
    if (existente) tx.set(ref, semUndefined(base), { merge: true });
    else tx.set(ref, semUndefined({ ...base, estoque: dados.estoque ?? 0, criadoEm: agora }));
  });
  if (!existente && (dados.estoque ?? 0) !== 0) {
    await gravarMovimento(empresaId, id, dados.nome, dados.sku, 'entrada', dados.estoque ?? 0, dados.estoque ?? 0, 'Estoque inicial');
  }
}

export async function excluirProduto(empresaId: string, produtoId: string) {
  await deleteDoc(doc(produtosCol(empresaId), produtoId));
}

async function gravarMovimento(
  empresaId: string, produtoId: string, produtoNome: string, sku: string,
  tipo: MovimentoEstoque['tipo'], quantidade: number, saldoApos: number, motivo?: string, usuario?: string
) {
  const ref = doc(movimentosCol(empresaId));
  const b = writeBatch(db);
  b.set(ref, semUndefined({ produtoId, produtoNome, sku, tipo, quantidade, saldoApos, motivo, usuario, criadoEm: new Date().toISOString() }));
  await b.commit();
}

/** Entrada (+), saída (-) ou ajuste (define o saldo). Atômico: lê o saldo, grava o novo e o histórico juntos. */
export async function movimentarEstoque(
  empresaId: string, produto: Produto, tipo: MovimentoEstoque['tipo'], valor: number, motivo?: string, usuario?: string
) {
  const ref = doc(produtosCol(empresaId), produto.id);
  const movRef = doc(movimentosCol(empresaId));
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Produto não encontrado.');
    const saldo = Number((snap.data() as Produto).estoque ?? 0);
    const novo = tipo === 'entrada' ? saldo + valor : tipo === 'saida' ? saldo - valor : valor;
    if (novo < 0) throw new Error(`Estoque insuficiente: saldo atual ${saldo}.`);
    tx.update(ref, { estoque: novo, atualizadoEm: new Date().toISOString() });
    tx.set(movRef, semUndefined({
      produtoId: produto.id, produtoNome: produto.nome, sku: produto.sku, tipo,
      quantidade: novo - saldo, saldoApos: novo, motivo, usuario, criadoEm: new Date().toISOString(),
    }));
  });
}

/** Importação em lote (planilha do Bling/Olist/Tiny ou do Fluxa). Mesmo SKU atualiza o produto existente. */
export async function importarProdutos(empresaId: string, lista: Omit<Produto, 'id' | 'criadoEm' | 'atualizadoEm'>[]) {
  const agora = new Date().toISOString();
  for (let i = 0; i < lista.length; i += 400) {
    const b = writeBatch(db);
    for (const p of lista.slice(i, i + 400)) {
      const id = idDoProduto(p.sku);
      if (!id) continue;
      b.set(doc(produtosCol(empresaId), id), semUndefined({ ...p, origem: 'importado' as const, atualizadoEm: agora, criadoEm: agora }), { merge: true });
    }
    await b.commit();
  }
}
