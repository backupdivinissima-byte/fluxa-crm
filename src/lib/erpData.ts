// Fluxa ERP — produtos e estoque. Mesmo padrão de crmData/marketingData:
// subcoleções por empresa, listeners em tempo real e `semUndefined` antes de gravar.
import { collection, doc, onSnapshot, orderBy, query, runTransaction, writeBatch, deleteDoc, limit, getDocs, where, type Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';
import type { MovimentoEstoque, Produto, Troca, Consignacao, ItemConsig, ContaFin } from '../types';

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
      marca: dados.marca?.trim() || undefined,
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

// ===== Pedidos =====
import type { ItemPedido, Pedido, StatusPedido } from '../types';

const pedidosCol = (empresaId: string) => collection(db, 'empresas', empresaId, 'pedidos');

export function ouvirPedidos(empresaId: string, cb: (p: Pedido[]) => void): Unsubscribe {
  return onSnapshot(query(pedidosCol(empresaId), orderBy('numero', 'desc'), limit(300)), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Pedido))
  );
}

/** Pedidos desde uma data (ISO) — usado no comparativo de vendas ano contra ano. */
export function ouvirPedidosDesde(empresaId: string, desdeIso: string, cb: (p: Pedido[]) => void): Unsubscribe {
  return onSnapshot(query(pedidosCol(empresaId), where('criadoEm', '>=', desdeIso), orderBy('criadoEm', 'asc')), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Pedido))
  );
}

export function totalDoPedido(itens: ItemPedido[], desconto: number, frete: number): number {
  const sub = itens.reduce((s, i) => s + i.quantidade * i.preco, 0);
  return Math.max(0, Math.round((sub - desconto + frete) * 100) / 100);
}

export interface DadosPedido {
  clienteNome: string; clienteTelefone?: string; itens: ItemPedido[]; desconto: number; frete: number;
  pagamento?: string; observacao?: string; origem?: Pedido['origem'];
  clienteId?: string; operacao?: string; vendedor?: string; condicaoPagamento?: string;
  comoOrcamento?: boolean; // orçamento não baixa o estoque
  diasParcelas?: number[]; // prazos da condição de pagamento (0 = à vista)
}

/** Cria o pedido e baixa o estoque de todos os itens numa transação só (ou tudo, ou nada). */
export async function criarPedido(empresaId: string, d: DadosPedido, usuario?: string): Promise<number> {
  if (!d.clienteNome.trim()) throw new Error('Informe o nome do cliente.');
  if (d.itens.length === 0) throw new Error('Adicione pelo menos um produto.');
  const contRef = doc(db, 'empresas', empresaId, 'contadores', 'pedidos');
  const pedRef = doc(pedidosCol(empresaId));
  return await runTransaction(db, async (tx) => {
    const prods = await Promise.all(d.itens.map((i) => tx.get(doc(produtosCol(empresaId), i.produtoId))));
    const cont = await tx.get(contRef);
    const numero = Number(cont.exists() ? cont.data().ultimo : 0) + 1;
    const agora = new Date().toISOString();
    if (!d.comoOrcamento) d.itens.forEach((i, k) => {
      const snap = prods[k];
      if (!snap.exists()) throw new Error(`Produto ${i.nome} não existe mais.`);
      const saldo = Number((snap.data() as Produto).estoque ?? 0);
      if (saldo < i.quantidade) throw new Error(`Estoque insuficiente de ${i.nome}: saldo ${saldo}, pedido ${i.quantidade}.`);
      tx.update(snap.ref, { estoque: saldo - i.quantidade, atualizadoEm: agora });
      tx.set(doc(movimentosCol(empresaId)), semUndefined({
        produtoId: i.produtoId, produtoNome: i.nome, sku: i.sku, tipo: 'saida', quantidade: -i.quantidade,
        saldoApos: saldo - i.quantidade, motivo: `Pedido #${numero}`, usuario, criadoEm: agora,
      }));
    });
    tx.set(contRef, { ultimo: numero });
    tx.set(pedRef, semUndefined({
      numero, clienteNome: d.clienteNome.trim(), clienteTelefone: d.clienteTelefone?.trim() || undefined, clienteId: d.clienteId || undefined,
      operacao: d.operacao || undefined, vendedor: d.vendedor || undefined, condicaoPagamento: d.condicaoPagamento || undefined, itens: d.itens,
      desconto: d.desconto, frete: d.frete, total: totalDoPedido(d.itens, d.desconto, d.frete),
      pagamento: d.pagamento || undefined, observacao: d.observacao?.trim() || undefined,
      status: (d.comoOrcamento ? 'orcamento' : 'aberto') as StatusPedido, origem: d.origem ?? 'manual', criadoEm: agora, atualizadoEm: agora,
    }));
    if (!d.comoOrcamento) {
      const total = totalDoPedido(d.itens, d.desconto, d.frete);
      const dias = d.diasParcelas?.length ? d.diasParcelas : [0];
      const base = Math.floor((total / dias.length) * 100) / 100;
      dias.forEach((dd, k) => {
        const valor = k === dias.length - 1 ? Math.round((total - base * (dias.length - 1)) * 100) / 100 : base;
        const venc = new Date(); venc.setDate(venc.getDate() + dd);
        tx.set(doc(contasCol(empresaId)), semUndefined({
          tipo: 'receber', descricao: `Pedido #${numero}${dias.length > 1 ? ` — parcela ${k + 1}/${dias.length}` : ''}`, parteNome: d.clienteNome.trim(),
          valor, vencimento: venc.toISOString().slice(0, 10), pago: false, origem: 'pedido', origemId: pedRef.id, criadoEm: agora,
        }));
      });
    }
    return numero;
  });
}

/** Muda o status. Cancelar devolve os itens ao estoque (e não dá para reativar um pedido cancelado). */
export async function mudarStatusPedido(empresaId: string, pedido: Pedido, status: StatusPedido, usuario?: string) {
  const ref = doc(pedidosCol(empresaId), pedido.id);
  await runTransaction(db, async (tx) => {
    const atual = await tx.get(ref);
    if (!atual.exists()) throw new Error('Pedido não encontrado.');
    const st = (atual.data() as Pedido).status;
    if (st === 'cancelado') throw new Error('Pedido já cancelado.');
    const agora = new Date().toISOString();
    if (status === 'cancelado' && st !== 'orcamento') {
      const prods = await Promise.all(pedido.itens.map((i) => tx.get(doc(produtosCol(empresaId), i.produtoId))));
      pedido.itens.forEach((i, k) => {
        const snap = prods[k];
        if (!snap.exists()) return;
        const saldo = Number((snap.data() as Produto).estoque ?? 0);
        tx.update(snap.ref, { estoque: saldo + i.quantidade, atualizadoEm: agora });
        tx.set(doc(movimentosCol(empresaId)), semUndefined({
          produtoId: i.produtoId, produtoNome: i.nome, sku: i.sku, tipo: 'entrada', quantidade: i.quantidade,
          saldoApos: saldo + i.quantidade, motivo: `Cancelamento do pedido #${pedido.numero}`, usuario, criadoEm: agora,
        }));
      });
    }
    tx.update(ref, { status, atualizadoEm: agora });
  });
  // Financeiro acompanha o pedido: pago baixa as contas; cancelado remove as que ainda não foram pagas.
  if (status === 'pago' || status === 'cancelado') {
    const snap = await getDocs(query(contasCol(empresaId), where('origemId', '==', pedido.id)));
    const b = writeBatch(db);
    snap.docs.forEach((c) => {
      if (status === 'pago') b.update(c.ref, { pago: true, pagoEm: new Date().toISOString() });
      else if (!(c.data() as ContaFin).pago) b.delete(c.ref);
    });
    await b.commit();
  }
}

/** Transforma o orçamento em pedido: confere e baixa o estoque agora. */
export async function converterOrcamento(empresaId: string, pedido: Pedido, usuario?: string) {
  const ref = doc(pedidosCol(empresaId), pedido.id);
  await runTransaction(db, async (tx) => {
    const atual = await tx.get(ref);
    if (!atual.exists() || (atual.data() as Pedido).status !== 'orcamento') throw new Error('Este orçamento já foi convertido ou cancelado.');
    const prods = await Promise.all(pedido.itens.map((i) => tx.get(doc(produtosCol(empresaId), i.produtoId))));
    const agora = new Date().toISOString();
    pedido.itens.forEach((i, k) => {
      const snap = prods[k];
      if (!snap.exists()) throw new Error(`Produto ${i.nome} não existe mais.`);
      const saldo = Number((snap.data() as Produto).estoque ?? 0);
      if (saldo < i.quantidade) throw new Error(`Estoque insuficiente de ${i.nome}: saldo ${saldo}, pedido ${i.quantidade}.`);
      tx.update(snap.ref, { estoque: saldo - i.quantidade, atualizadoEm: agora });
      tx.set(doc(movimentosCol(empresaId)), semUndefined({
        produtoId: i.produtoId, produtoNome: i.nome, sku: i.sku, tipo: 'saida', quantidade: -i.quantidade,
        saldoApos: saldo - i.quantidade, motivo: `Pedido #${pedido.numero} (do orçamento)`, usuario, criadoEm: agora,
      }));
    });
    tx.update(ref, { status: 'aberto', atualizadoEm: agora });
  });
}

// ===== Financeiro =====
const contasCol = (empresaId: string) => collection(db, 'empresas', empresaId, 'contas');

export function ouvirContas(empresaId: string, cb: (c: ContaFin[]) => void): Unsubscribe {
  return onSnapshot(query(contasCol(empresaId), orderBy('vencimento'), limit(500)), (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ContaFin)));
}
export async function criarConta(empresaId: string, c: Omit<ContaFin, 'id' | 'criadoEm' | 'pago'>) {
  const b = writeBatch(db);
  b.set(doc(contasCol(empresaId)), semUndefined({ ...c, pago: false, criadoEm: new Date().toISOString() }));
  await b.commit();
}
export async function baixarConta(empresaId: string, conta: ContaFin, pago: boolean) {
  const b = writeBatch(db);
  b.update(doc(contasCol(empresaId), conta.id), pago ? { pago: true, pagoEm: new Date().toISOString() } : { pago: false, pagoEm: null });
  await b.commit();
}
export async function excluirConta(empresaId: string, id: string) { await deleteDoc(doc(contasCol(empresaId), id)); }

// ===== Trocas e devoluções =====
const trocasCol = (empresaId: string) => collection(db, 'empresas', empresaId, 'trocas');
export function ouvirTrocas(empresaId: string, cb: (t: Troca[]) => void): Unsubscribe {
  return onSnapshot(query(trocasCol(empresaId), orderBy('numero', 'desc'), limit(200)), (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Troca)));
}

/** Devolução (itens voltam ao estoque) ou troca (voltam e saem outros). Limita ao que o cliente comprou e ainda não devolveu. */
export async function registrarTroca(
  empresaId: string, pedido: import('../types').Pedido, devolvidos: import('../types').ItemPedido[], novos: import('../types').ItemPedido[], motivo?: string, usuario?: string
): Promise<number> {
  devolvidos = devolvidos.filter((i) => i.quantidade > 0);
  novos = novos.filter((i) => i.quantidade > 0);
  if (devolvidos.length === 0) throw new Error('Informe pelo menos um item devolvido.');
  const pedRef = doc(db, 'empresas', empresaId, 'pedidos', pedido.id);
  const contRef = doc(db, 'empresas', empresaId, 'contadores', 'trocas');
  const trocaRef = doc(trocasCol(empresaId));
  return await runTransaction(db, async (tx) => {
    const ped = await tx.get(pedRef);
    if (!ped.exists()) throw new Error('Pedido não encontrado.');
    const atual = ped.data() as import('../types').Pedido;
    if (atual.status === 'orcamento' || atual.status === 'cancelado') throw new Error('Este pedido não aceita devolução.');
    const jaDev = { ...(atual.devolvidos ?? {}) };
    for (const i of devolvidos) {
      const comprou = atual.itens.find((x) => x.produtoId === i.produtoId)?.quantidade ?? 0;
      if (i.quantidade + (jaDev[i.produtoId] ?? 0) > comprou) throw new Error(`${i.nome}: só dá para devolver ${comprou - (jaDev[i.produtoId] ?? 0)}.`);
      jaDev[i.produtoId] = (jaDev[i.produtoId] ?? 0) + i.quantidade;
    }
    const ids = Array.from(new Set([...devolvidos, ...novos].map((i) => i.produtoId)));
    const snaps = new Map((await Promise.all(ids.map((id) => tx.get(doc(produtosCol(empresaId), id))))).map((s) => [s.id, s]));
    const cont = await tx.get(contRef);
    const numero = Number(cont.exists() ? cont.data().ultimo : 0) + 1;
    const saldos = new Map<string, number>();
    snaps.forEach((s, id) => saldos.set(id, Number(s.exists() ? (s.data() as Produto).estoque ?? 0 : 0)));
    const agora = new Date().toISOString();
    const mov = (i: import('../types').ItemPedido, delta: number, motivoMov: string) => {
      const novo = (saldos.get(i.produtoId) ?? 0) + delta;
      if (novo < 0) throw new Error(`Estoque insuficiente de ${i.nome}.`);
      saldos.set(i.produtoId, novo);
      tx.set(doc(movimentosCol(empresaId)), semUndefined({ produtoId: i.produtoId, produtoNome: i.nome, sku: i.sku, tipo: delta > 0 ? 'entrada' : 'saida', quantidade: delta, saldoApos: novo, motivo: motivoMov, usuario, criadoEm: agora }));
    };
    devolvidos.forEach((i) => mov(i, i.quantidade, `${novos.length ? 'Troca' : 'Devolução'} #${numero} (pedido #${atual.numero})`));
    novos.forEach((i) => mov(i, -i.quantidade, `Troca #${numero} (pedido #${atual.numero})`));
    saldos.forEach((v, id) => { const s = snaps.get(id); if (s?.exists()) tx.update(s.ref, { estoque: v, atualizadoEm: agora }); });
    const valorDevolvido = devolvidos.reduce((s, i) => s + i.quantidade * i.preco, 0);
    const valorNovo = novos.reduce((s, i) => s + i.quantidade * i.preco, 0);
    const diferenca = Math.round((valorNovo - valorDevolvido) * 100) / 100;
    tx.set(contRef, { ultimo: numero });
    tx.update(pedRef, { devolvidos: jaDev, atualizadoEm: agora });
    tx.set(trocaRef, semUndefined({ numero, pedidoId: pedido.id, pedidoNumero: atual.numero, clienteNome: atual.clienteNome, tipo: novos.length ? 'troca' : 'devolucao', devolvidos, novos, valorDevolvido, valorNovo, diferenca, motivo, criadoEm: agora }));
    if (diferenca !== 0) {
      tx.set(doc(contasCol(empresaId)), semUndefined({
        tipo: diferenca > 0 ? 'receber' : 'pagar', descricao: `${novos.length ? 'Troca' : 'Devolução'} #${numero} (pedido #${atual.numero})`, parteNome: atual.clienteNome,
        valor: Math.abs(diferenca), vencimento: agora.slice(0, 10), pago: false, origem: 'troca', origemId: trocaRef.id, criadoEm: agora,
      }));
    }
    return numero;
  });
}

// ===== Consignação =====
const consigCol = (empresaId: string) => collection(db, 'empresas', empresaId, 'consignacoes');
export function ouvirConsignacoes(empresaId: string, cb: (c: Consignacao[]) => void): Unsubscribe {
  return onSnapshot(query(consigCol(empresaId), orderBy('numero', 'desc'), limit(200)), (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Consignacao)));
}

/** Consignação a cliente: as peças SAEM do estoque. De fornecedor: as peças ENTRAM. */
export async function criarConsignacao(empresaId: string, tipo: Consignacao['tipo'], parteNome: string, parteId: string | undefined, itens: ItemConsig[], usuario?: string): Promise<number> {
  if (!parteNome.trim()) throw new Error('Informe o cliente ou fornecedor.');
  itens = itens.filter((i) => i.enviada > 0);
  if (itens.length === 0) throw new Error('Adicione pelo menos um produto.');
  const contRef = doc(db, 'empresas', empresaId, 'contadores', 'consignacoes');
  const ref = doc(consigCol(empresaId));
  return await runTransaction(db, async (tx) => {
    const snaps = await Promise.all(itens.map((i) => tx.get(doc(produtosCol(empresaId), i.produtoId))));
    const cont = await tx.get(contRef);
    const numero = Number(cont.exists() ? cont.data().ultimo : 0) + 1;
    const agora = new Date().toISOString();
    itens.forEach((i, k) => {
      const s = snaps[k];
      if (!s.exists()) throw new Error(`Produto ${i.nome} não existe mais.`);
      const saldo = Number((s.data() as Produto).estoque ?? 0);
      const novo = tipo === 'cliente' ? saldo - i.enviada : saldo + i.enviada;
      if (novo < 0) throw new Error(`Estoque insuficiente de ${i.nome}: saldo ${saldo}.`);
      tx.update(s.ref, { estoque: novo, atualizadoEm: agora });
      tx.set(doc(movimentosCol(empresaId)), semUndefined({ produtoId: i.produtoId, produtoNome: i.nome, sku: i.sku, tipo: tipo === 'cliente' ? 'saida' : 'entrada', quantidade: tipo === 'cliente' ? -i.enviada : i.enviada, saldoApos: novo, motivo: `Consignação #${numero} (${tipo === 'cliente' ? 'enviada ao cliente' : 'recebida do fornecedor'})`, usuario, criadoEm: agora }));
    });
    tx.set(contRef, { ultimo: numero });
    tx.set(ref, semUndefined({ numero, tipo, parteNome: parteNome.trim(), parteId, itens, status: 'aberta', valorAcertado: 0, criadoEm: agora, atualizadoEm: agora }));
    return numero;
  });
}

/** Acerto: informe quanto foi vendido e quanto voltou. Devolvidas movimentam o estoque; vendidas geram a conta a receber (cliente) ou a pagar (fornecedor). */
export async function acertarConsignacao(empresaId: string, c: Consignacao, acerto: Record<string, { vendida: number; devolvida: number }>, usuario?: string) {
  const ref = doc(consigCol(empresaId), c.id);
  await runTransaction(db, async (tx) => {
    const atual = await tx.get(ref);
    if (!atual.exists()) throw new Error('Consignação não encontrada.');
    const cons = atual.data() as Consignacao;
    const ids = cons.itens.map((i) => i.produtoId);
    const snaps = await Promise.all(ids.map((id) => tx.get(doc(produtosCol(empresaId), id))));
    const agora = new Date().toISOString();
    let valor = 0;
    const novos = cons.itens.map((i, k) => {
      const a = acerto[i.produtoId] ?? { vendida: 0, devolvida: 0 };
      if (a.vendida < 0 || a.devolvida < 0) throw new Error('Quantidades não podem ser negativas.');
      if (i.vendida + i.devolvida + a.vendida + a.devolvida > i.enviada) throw new Error(`${i.nome}: passa do que foi enviado (${i.enviada}).`);
      valor += a.vendida * (cons.tipo === 'cliente' ? i.preco : i.custo);
      if (a.devolvida > 0) {
        const s = snaps[k];
        if (s.exists()) {
          const saldo = Number((s.data() as Produto).estoque ?? 0);
          const novo = cons.tipo === 'cliente' ? saldo + a.devolvida : saldo - a.devolvida;
          if (novo < 0) throw new Error(`Estoque insuficiente de ${i.nome} para devolver ao fornecedor.`);
          tx.update(s.ref, { estoque: novo, atualizadoEm: agora });
          tx.set(doc(movimentosCol(empresaId)), semUndefined({ produtoId: i.produtoId, produtoNome: i.nome, sku: i.sku, tipo: cons.tipo === 'cliente' ? 'entrada' : 'saida', quantidade: cons.tipo === 'cliente' ? a.devolvida : -a.devolvida, saldoApos: novo, motivo: `Acerto da consignação #${cons.numero}`, usuario, criadoEm: agora }));
        }
      }
      return { ...i, vendida: i.vendida + a.vendida, devolvida: i.devolvida + a.devolvida };
    });
    valor = Math.round(valor * 100) / 100;
    const encerrada = novos.every((i) => i.vendida + i.devolvida >= i.enviada);
    tx.update(ref, { itens: novos, status: encerrada ? 'encerrada' : 'aberta', valorAcertado: Math.round((cons.valorAcertado + valor) * 100) / 100, atualizadoEm: agora });
    if (valor > 0) {
      tx.set(doc(contasCol(empresaId)), semUndefined({
        tipo: cons.tipo === 'cliente' ? 'receber' : 'pagar', descricao: `Acerto da consignação #${cons.numero}`, parteNome: cons.parteNome,
        valor, vencimento: agora.slice(0, 10), pago: false, origem: 'consignacao', origemId: c.id, criadoEm: agora,
      }));
    }
  });
}
