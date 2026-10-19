// API do Fluxa ERP (módulo individual): o ERP nunca acessa os outros módulos;
// quem quiser ligar Chat / Live / CRM (ou outro sistema) chama estas rotas
// com a chave de API da empresa (cabeçalho X-Api-Key).
//
//   GET  /v1/erp/produtos?busca=&limite=   lista produtos (preço, saldo)
//   GET  /v1/erp/produtos/:sku             um produto
//   POST /v1/erp/produtos                  cria/atualiza (upsert por sku)
//   POST /v1/erp/estoque                   { sku, quantidade, tipo: entrada|saida|ajuste, motivo }
//   POST /v1/erp/pedidos                   cria pedido ou orçamento (preço automático)
//   GET  /v1/erp/pedidos/:numero           consulta pedido
//   POST /v1/erp/pedidos/:numero/status    { status } (inclui cancelar e devolver ao estoque)
const admin = require('firebase-admin');

const idDoProduto = (sku) => String(sku).trim().toUpperCase().replace(/[\/\s.#?[\]]+/g, '-').slice(0, 120);
const num = (v, pad = 0) => (typeof v === 'number' && isFinite(v) ? v : pad);
const arred = (n) => Math.round(n * 100) / 100;
const STATUS = ['orcamento', 'aberto', 'pago', 'enviado', 'entregue', 'cancelado'];

module.exports = function registrarErp(app, db, empresaPelaChave) {
  const col = (e, nome) => db.collection('empresas').doc(e).collection(nome);

  const rota = (fn) => async (req, res) => {
    const empresa = await empresaPelaChave(req, res);
    if (!empresa) return;
    try {
      await fn(req, res, empresa.id);
    } catch (e) {
      const msg = e && e.message ? e.message : 'Erro inesperado.';
      res.status(e && e.http ? e.http : 500).json({ erro: msg });
    }
  };
  const erro = (http, msg) => Object.assign(new Error(msg), { http });
  const publico = (id, p) => ({
    sku: p.sku, nome: p.nome, categoria: p.categoria ?? null, marca: p.marca ?? null, unidade: p.unidade ?? 'un',
    preco: p.preco ?? 0, estoque: p.estoque ?? 0, estoqueMinimo: p.estoqueMinimo ?? 0, ativo: p.ativo !== false,
  });

  app.get('/v1/erp/produtos', rota(async (req, res, e) => {
    const limite = Math.min(Number(req.query.limite) || 200, 1000);
    const busca = String(req.query.busca ?? '').toLowerCase().trim();
    const snap = await col(e, 'produtos').limit(2000).get();
    let lista = snap.docs.map((d) => d.data());
    if (busca) lista = lista.filter((p) => `${p.sku} ${p.nome}`.toLowerCase().includes(busca));
    res.json({ produtos: lista.slice(0, limite).map((p) => publico(null, p)), total: lista.length });
  }));

  app.get('/v1/erp/produtos/:sku', rota(async (req, res, e) => {
    const s = await col(e, 'produtos').doc(idDoProduto(req.params.sku)).get();
    if (!s.exists) throw erro(404, 'Produto não encontrado.');
    res.json(publico(s.id, s.data()));
  }));

  app.post('/v1/erp/produtos', rota(async (req, res, e) => {
    const b = req.body ?? {};
    const sku = String(b.sku ?? '').trim();
    const nome = String(b.nome ?? '').trim();
    if (!sku || !nome) throw erro(400, 'Campos "sku" e "nome" são obrigatórios.');
    const ref = col(e, 'produtos').doc(idDoProduto(sku));
    const agora = new Date().toISOString();
    await db.runTransaction(async (tx) => {
      const atual = await tx.get(ref);
      const dados = {
        sku, nome, categoria: b.categoria, marca: b.marca, unidade: b.unidade, preco: b.preco != null ? num(b.preco) : undefined,
        custo: b.custo != null ? num(b.custo) : undefined, estoqueMinimo: b.estoqueMinimo != null ? num(b.estoqueMinimo) : undefined,
        ativo: b.ativo !== false, atualizadoEm: agora,
      };
      Object.keys(dados).forEach((k) => dados[k] === undefined && delete dados[k]);
      if (!atual.exists) {
        const inicial = num(b.estoque);
        tx.set(ref, { preco: 0, custo: 0, estoqueMinimo: 0, ...dados, estoque: inicial, origem: 'importado', criadoEm: agora });
        if (inicial > 0) tx.set(col(e, 'movimentosEstoque').doc(), { produtoId: ref.id, produtoNome: nome, sku, tipo: 'entrada', quantidade: inicial, saldoApos: inicial, motivo: 'Saldo inicial (API)', usuario: 'API', criadoEm: agora });
      } else {
        tx.set(ref, dados, { merge: true }); // saldo só muda por /estoque ou pedidos
      }
    });
    const s = await ref.get();
    res.json(publico(s.id, s.data()));
  }));

  app.post('/v1/erp/estoque', rota(async (req, res, e) => {
    const b = req.body ?? {};
    const tipo = b.tipo;
    const q = num(b.quantidade, NaN);
    if (!['entrada', 'saida', 'ajuste'].includes(tipo) || !isFinite(q) || q < 0) throw erro(400, 'Envie "tipo" (entrada|saida|ajuste) e "quantidade" >= 0.');
    const ref = col(e, 'produtos').doc(idDoProduto(b.sku ?? ''));
    const saldo = await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) throw erro(404, 'Produto não encontrado.');
      const p = s.data();
      const antes = num(p.estoque);
      const novo = tipo === 'entrada' ? antes + q : tipo === 'saida' ? antes - q : q;
      if (novo < 0) throw erro(409, `Estoque insuficiente: saldo ${antes}.`);
      const agora = new Date().toISOString();
      tx.update(ref, { estoque: novo, atualizadoEm: agora });
      tx.set(col(e, 'movimentosEstoque').doc(), { produtoId: ref.id, produtoNome: p.nome, sku: p.sku, tipo, quantidade: novo - antes, saldoApos: novo, motivo: b.motivo || 'Movimentação via API', usuario: 'API', criadoEm: agora });
      return novo;
    });
    res.json({ sku: b.sku, estoque: saldo });
  }));

  app.post('/v1/erp/pedidos', rota(async (req, res, e) => {
    const b = req.body ?? {};
    const clienteNome = String(b.clienteNome ?? '').trim();
    const entrada = Array.isArray(b.itens) ? b.itens : [];
    if (!clienteNome) throw erro(400, 'Campo "clienteNome" é obrigatório.');
    if (entrada.length === 0 || entrada.length > 200) throw erro(400, 'Envie de 1 a 200 itens em "itens" ({ sku, quantidade, preco? }).');
    const comoOrcamento = b.orcamento === true;
    const desconto = Math.max(0, num(b.desconto));
    const frete = Math.max(0, num(b.frete));
    const dias = Array.isArray(b.diasParcelas) && b.diasParcelas.length ? b.diasParcelas.map((d) => Math.max(0, Number(d) || 0)) : [0];
    const contRef = col(e, 'contadores').doc('pedidos');
    const pedRef = col(e, 'pedidos').doc();
    const out = await db.runTransaction(async (tx) => {
      const refs = entrada.map((i) => col(e, 'produtos').doc(idDoProduto(i.sku ?? '')));
      const snaps = await Promise.all(refs.map((r) => tx.get(r)));
      const cont = await tx.get(contRef);
      const numero = num(cont.exists ? cont.data().ultimo : 0) + 1;
      const agora = new Date().toISOString();
      const itens = entrada.map((i, k) => {
        const s = snaps[k];
        if (!s.exists) throw erro(404, `Produto ${i.sku} não encontrado.`);
        const q = num(i.quantidade);
        if (q <= 0) throw erro(400, `Quantidade inválida para ${i.sku}.`);
        const p = s.data();
        return { produtoId: s.id, sku: p.sku, nome: p.nome, quantidade: q, preco: i.preco != null ? num(i.preco) : num(p.preco) };
      });
      if (!comoOrcamento) itens.forEach((i, k) => {
        const saldo = num(snaps[k].data().estoque);
        if (saldo < i.quantidade) throw erro(409, `Estoque insuficiente de ${i.nome}: saldo ${saldo}, pedido ${i.quantidade}.`);
      });
      // mesmo produto repetido: soma as baixas
      const saldos = new Map();
      if (!comoOrcamento) itens.forEach((i, k) => {
        const antes = saldos.has(i.produtoId) ? saldos.get(i.produtoId) : num(snaps[k].data().estoque);
        if (antes < i.quantidade) throw erro(409, `Estoque insuficiente de ${i.nome}.`);
        const depois = antes - i.quantidade;
        saldos.set(i.produtoId, depois);
        tx.update(refs[k], { estoque: depois, atualizadoEm: agora });
        tx.set(col(e, 'movimentosEstoque').doc(), { produtoId: i.produtoId, produtoNome: i.nome, sku: i.sku, tipo: 'saida', quantidade: -i.quantidade, saldoApos: depois, motivo: `Pedido #${numero} (API)`, usuario: 'API', criadoEm: agora });
      });
      const total = Math.max(0, arred(itens.reduce((s, i) => s + i.quantidade * i.preco, 0) - desconto + frete));
      const pedido = {
        numero, clienteNome, itens, desconto, frete, total, status: comoOrcamento ? 'orcamento' : 'aberto', origem: 'api', criadoEm: agora, atualizadoEm: agora,
        ...(b.clienteTelefone ? { clienteTelefone: String(b.clienteTelefone) } : {}),
        ...(b.clienteId ? { clienteId: String(b.clienteId) } : {}),
        ...(b.vendedor ? { vendedor: String(b.vendedor) } : {}),
        ...(b.pagamento ? { pagamento: String(b.pagamento) } : {}),
        ...(b.observacao ? { observacao: String(b.observacao) } : {}),
      };
      tx.set(contRef, { ultimo: numero });
      tx.set(pedRef, pedido);
      if (!comoOrcamento) {
        const base = Math.floor((total / dias.length) * 100) / 100;
        dias.forEach((dd, k) => {
          const valor = k === dias.length - 1 ? arred(total - base * (dias.length - 1)) : base;
          const venc = new Date(); venc.setDate(venc.getDate() + dd);
          tx.set(col(e, 'contas').doc(), { tipo: 'receber', descricao: `Pedido #${numero}${dias.length > 1 ? ` — parcela ${k + 1}/${dias.length}` : ''}`, parteNome: clienteNome, valor, vencimento: venc.toISOString().slice(0, 10), pago: false, origem: 'pedido', origemId: pedRef.id, criadoEm: agora });
        });
      }
      return { numero, total, status: pedido.status, itens };
    });
    res.status(201).json(out);
  }));

  const pedidoPorNumero = async (e, n) => {
    const s = await col(e, 'pedidos').where('numero', '==', Number(n)).limit(1).get();
    if (s.empty) throw erro(404, 'Pedido não encontrado.');
    return s.docs[0];
  };

  app.get('/v1/erp/pedidos/:numero', rota(async (req, res, e) => {
    const d = await pedidoPorNumero(e, req.params.numero);
    const p = d.data();
    res.json({ numero: p.numero, status: p.status, clienteNome: p.clienteNome, itens: p.itens, desconto: p.desconto, frete: p.frete, total: p.total, criadoEm: p.criadoEm });
  }));

  app.post('/v1/erp/pedidos/:numero/status', rota(async (req, res, e) => {
    const status = (req.body ?? {}).status;
    if (!STATUS.includes(status) || status === 'orcamento') throw erro(400, `"status" deve ser um de: ${STATUS.filter((s) => s !== 'orcamento').join(', ')}.`);
    const d = await pedidoPorNumero(e, req.params.numero);
    await db.runTransaction(async (tx) => {
      const atual = await tx.get(d.ref);
      const p = atual.data();
      if (p.status === 'cancelado') throw erro(409, 'Pedido já cancelado.');
      const agora = new Date().toISOString();
      if (p.status === 'orcamento' && status !== 'cancelado') throw erro(409, 'Orçamento: converta no Fluxa ERP antes de mudar o status.');
      if (status === 'cancelado' && p.status !== 'orcamento') {
        const refs = p.itens.map((i) => col(e, 'produtos').doc(i.produtoId));
        const snaps = await Promise.all(refs.map((r) => tx.get(r)));
        const saldos = new Map();
        p.itens.forEach((i, k) => {
          if (!snaps[k].exists) return;
          const antes = saldos.has(i.produtoId) ? saldos.get(i.produtoId) : num(snaps[k].data().estoque);
          saldos.set(i.produtoId, antes + i.quantidade);
          tx.update(refs[k], { estoque: antes + i.quantidade, atualizadoEm: agora });
          tx.set(col(e, 'movimentosEstoque').doc(), { produtoId: i.produtoId, produtoNome: i.nome, sku: i.sku, tipo: 'entrada', quantidade: i.quantidade, saldoApos: antes + i.quantidade, motivo: `Cancelamento do pedido #${p.numero} (API)`, usuario: 'API', criadoEm: agora });
        });
      }
      tx.update(d.ref, { status, atualizadoEm: agora });
    });
    if (status === 'pago' || status === 'cancelado') {
      const cs = await col(e, 'contas').where('origemId', '==', d.id).get();
      const b = db.batch();
      cs.docs.forEach((c) => {
        if (status === 'pago') b.update(c.ref, { pago: true, pagoEm: new Date().toISOString() });
        else if (!c.data().pago) b.delete(c.ref);
      });
      await b.commit();
    }
    res.json({ numero: Number(req.params.numero), status });
  }));
};
