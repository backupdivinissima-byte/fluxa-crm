import { useEffect, useMemo, useState } from 'react';
import { ouvirConsignacoes, ouvirContas, ouvirPedidos } from '../lib/erpData';
import { formatarMoeda } from '../lib/crmLogic';
import type { Consignacao, ContaFin, Pedido, Produto } from '../types';

export type DestinoErp = { aba: 'vendas' | 'estoque' | 'financeiro'; sub?: string };

/** Painel inicial: o que precisa de atenção hoje e os números do mês, sem precisar caçar em cada tela. */
export default function ErpInicio({ empresaId, produtos, ir }: { empresaId: string; produtos: Produto[]; ir: (d: DestinoErp) => void }) {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [contas, setContas] = useState<ContaFin[]>([]);
  const [consig, setConsig] = useState<Consignacao[]>([]);
  useEffect(() => { const a = ouvirPedidos(empresaId, setPedidos); const b = ouvirContas(empresaId, setContas); const c = ouvirConsignacoes(empresaId, setConsig); return () => { a(); b(); c(); }; }, [empresaId]);

  const d = useMemo(() => {
    const agora = Date.now(); const h = new Date().toISOString().slice(0, 10); const mes = h.slice(0, 7);
    const vendas = pedidos.filter((p) => p.status !== 'cancelado' && p.status !== 'orcamento' && p.criadoEm.slice(0, 7) === mes);
    const total = vendas.reduce((s, p) => s + p.total, 0);
    const porProduto = new Map<string, { nome: string; qtd: number }>();
    vendas.forEach((p) => p.itens.forEach((i) => porProduto.set(i.produtoId, { nome: i.nome, qtd: (porProduto.get(i.produtoId)?.qtd ?? 0) + i.quantidade })));
    const dias = (iso: string) => (agora - new Date(iso).getTime()) / 86400000;
    const vencidas = contas.filter((c) => !c.pago && c.vencimento < h);
    return {
      total, qtd: vendas.length, ticket: vendas.length ? total / vendas.length : 0,
      top: Array.from(porProduto.values()).sort((a, b) => b.qtd - a.qtd).slice(0, 5),
      baixos: produtos.filter((p) => p.ativo && p.estoque <= p.estoqueMinimo),
      orcParados: pedidos.filter((p) => p.status === 'orcamento' && dias(p.criadoEm) >= 3),
      vencidasRec: vencidas.filter((c) => c.tipo === 'receber'), vencidasPag: vencidas.filter((c) => c.tipo === 'pagar'),
      consigAntigas: consig.filter((c) => c.status === 'aberta' && dias(c.criadoEm) >= 30),
      semGiro: produtos.filter((p) => p.ativo && p.estoque > 0 && !porProduto.has(p.id)).length,
    };
  }, [pedidos, contas, consig, produtos]);

  const soma = (l: ContaFin[]) => l.reduce((s, c) => s + c.valor, 0);
  const alertas: { texto: string; destino: DestinoErp; cor: string }[] = [];
  if (d.vencidasRec.length) alertas.push({ texto: `${d.vencidasRec.length} conta(s) a receber atrasada(s): ${formatarMoeda(soma(d.vencidasRec))}`, destino: { aba: 'financeiro' }, cor: 'border-red-300 bg-red-50' });
  if (d.vencidasPag.length) alertas.push({ texto: `${d.vencidasPag.length} conta(s) a pagar atrasada(s): ${formatarMoeda(soma(d.vencidasPag))}`, destino: { aba: 'financeiro' }, cor: 'border-red-300 bg-red-50' });
  if (d.baixos.length) alertas.push({ texto: `${d.baixos.length} produto(s) com estoque baixo: ${d.baixos.slice(0, 3).map((p) => p.nome).join(', ')}${d.baixos.length > 3 ? '…' : ''}`, destino: { aba: 'estoque' }, cor: 'border-amber-300 bg-amber-50' });
  if (d.orcParados.length) alertas.push({ texto: `${d.orcParados.length} orçamento(s) parado(s) há 3 dias ou mais. Vale chamar o cliente.`, destino: { aba: 'vendas' }, cor: 'border-violet-300 bg-violet-50' });
  if (d.consigAntigas.length) alertas.push({ texto: `${d.consigAntigas.length} consignação(ões) aberta(s) há mais de 30 dias. Hora de acertar.`, destino: { aba: 'vendas', sub: 'consignacao' }, cor: 'border-amber-300 bg-amber-50' });
  if (d.semGiro > 0) alertas.push({ texto: `${d.semGiro} produto(s) com estoque e nenhuma venda neste mês.`, destino: { aba: 'estoque' }, cor: 'border-slate-300 bg-slate-50' });

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <Cartao t="Vendido no mês" v={formatarMoeda(d.total)} />
        <Cartao t="Pedidos no mês" v={String(d.qtd)} />
        <Cartao t="Ticket médio" v={formatarMoeda(d.ticket)} />
      </div>
      <h2 className="text-sm font-extrabold text-ink mb-2">Precisa de atenção</h2>
      <div className="space-y-2 mb-5">
        {alertas.map((a, i) => <button key={i} onClick={() => ir(a.destino)} className={`block w-full text-left rounded-xl border px-4 py-3 text-sm ${a.cor}`}>{a.texto}</button>)}
        {alertas.length === 0 && <p className="text-sm text-ink-soft rounded-xl border border-line bg-white px-4 py-3">Tudo em dia por aqui.</p>}
      </div>
      <h2 className="text-sm font-extrabold text-ink mb-2">Mais vendidos no mês</h2>
      <div className="rounded-xl border border-line bg-white divide-y divide-line">
        {d.top.map((p, i) => <div key={i} className="flex justify-between px-4 py-2 text-sm"><span>{i + 1}. {p.nome}</span><b>{p.qtd} un.</b></div>)}
        {d.top.length === 0 && <p className="px-4 py-3 text-sm text-ink-soft">Ainda sem vendas neste mês.</p>}
      </div>
    </>
  );
}

function Cartao({ t, v }: { t: string; v: string }) {
  return <div className="rounded-xl border border-line bg-white p-4"><div className="text-xs font-bold uppercase tracking-wide text-ink-soft">{t}</div><div className="text-xl font-extrabold text-ink">{v}</div></div>;
}
