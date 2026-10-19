import { useEffect, useMemo, useState } from 'react';
import { ouvirConsignacoes, ouvirContas, ouvirPedidosDesde } from '../lib/erpData';
import { formatarMoeda } from '../lib/crmLogic';
import type { Consignacao, ContaFin, Pedido, Produto } from '../types';

export type DestinoErp = { aba: 'vendas' | 'estoque' | 'financeiro'; sub?: string };

/** Painel inicial: o que precisa de atenção hoje e os números do mês, sem precisar caçar em cada tela. */
export default function ErpInicio({ empresaId, produtos, ir }: { empresaId: string; produtos: Produto[]; ir: (d: DestinoErp) => void }) {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [contas, setContas] = useState<ContaFin[]>([]);
  const [cat, setCat] = useState('');
  const [consig, setConsig] = useState<Consignacao[]>([]);
  useEffect(() => { const a = ouvirPedidosDesde(empresaId, `${new Date().getFullYear() - 1}-01-01`, setPedidos); const b = ouvirContas(empresaId, setContas); const c = ouvirConsignacoes(empresaId, setConsig); return () => { a(); b(); c(); }; }, [empresaId]);

  const d = useMemo(() => {
    const agora = Date.now(); const h = new Date().toISOString().slice(0, 10); const mes = h.slice(0, 7);
    const vendas = pedidos.filter((p) => p.status !== 'cancelado' && p.status !== 'orcamento' && p.criadoEm.slice(0, 7) === mes);
    const total = vendas.reduce((s, p) => s + p.total, 0);
    const categoriaDe = new Map(produtos.map((p) => [p.id, p.categoria?.trim() || 'Sem categoria']));
    const porProduto = new Map<string, { nome: string; qtd: number }>();
    vendas.forEach((p) => p.itens.forEach((i) => porProduto.set(i.produtoId, { nome: i.nome, qtd: (porProduto.get(i.produtoId)?.qtd ?? 0) + i.quantidade })));
    const porCat = new Map<string, { qtd: number; valor: number }>();
    const topCat = new Map<string, Map<string, { nome: string; qtd: number }>>();
    vendas.forEach((p) => p.itens.forEach((i) => {
      const c = categoriaDe.get(i.produtoId) ?? 'Sem categoria';
      const a = porCat.get(c) ?? { qtd: 0, valor: 0 };
      porCat.set(c, { qtd: a.qtd + i.quantidade, valor: a.valor + i.quantidade * i.preco });
      const m = topCat.get(c) ?? new Map();
      m.set(i.produtoId, { nome: i.nome, qtd: (m.get(i.produtoId)?.qtd ?? 0) + i.quantidade });
      topCat.set(c, m);
    }));
    const ano = new Date().getFullYear();
    const meses = Array.from({ length: 12 }, (_, m) => {
      const soma = (a: number) => pedidos.filter((p) => p.status !== 'cancelado' && p.status !== 'orcamento' && p.criadoEm.slice(0, 7) === `${a}-${String(m + 1).padStart(2, '0')}`).reduce((s, p) => s + p.total, 0);
      return { atual: soma(ano), anterior: soma(ano - 1) };
    });
    const dias = (iso: string) => (agora - new Date(iso).getTime()) / 86400000;
    const vencidas = contas.filter((c) => !c.pago && c.vencimento < h);
    return {
      ano, meses, total, qtd: vendas.length,
      cats: Array.from(porCat.entries()).map(([nome, v]) => ({ nome, ...v, medio: v.qtd ? v.valor / v.qtd : 0 })).sort((a, b) => b.valor - a.valor),
      topCat: (c: string) => Array.from(topCat.get(c)?.values() ?? []).sort((a, b) => b.qtd - a.qtd).slice(0, 5), ticket: vendas.length ? total / vendas.length : 0,
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
      <GraficoAnual ano={d.ano} meses={d.meses} />
      <div className="grid md:grid-cols-2 gap-4 mb-5">
        <div>
          <h2 className="text-sm font-extrabold text-ink mb-2">5 mais vendidos no mês</h2>
          <div className="flex gap-1 mb-2 flex-wrap">
            {['', ...d.cats.map((c) => c.nome)].map((c) => (
              <button key={c} onClick={() => setCat(c)} className={`px-3 h-7 rounded-full text-xs font-bold ${cat === c ? 'bg-teal-500 text-white' : 'bg-slate-100 text-ink-soft'}`}>{c || 'Todos'}</button>
            ))}
          </div>
          <div className="rounded-xl border border-line bg-white divide-y divide-line">
            {(cat ? d.topCat(cat) : d.top).map((p, i) => <div key={i} className="flex justify-between px-4 py-2 text-sm"><span>{i + 1}. {p.nome}</span><b>{p.qtd} un.</b></div>)}
            {d.top.length === 0 && <p className="px-4 py-3 text-sm text-ink-soft">Ainda sem vendas neste mês.</p>}
          </div>
        </div>
        <div>
          <h2 className="text-sm font-extrabold text-ink mb-2">Ticket médio por categoria (preço médio por peça)</h2>
          <div className="rounded-xl border border-line bg-white divide-y divide-line">
            {d.cats.map((c) => <div key={c.nome} className="flex justify-between px-4 py-2 text-sm"><span>{c.nome} <span className="text-ink-soft text-xs">· {c.qtd} un. · {formatarMoeda(c.valor)}</span></span><b>{formatarMoeda(c.medio)}</b></div>)}
            {d.cats.length === 0 && <p className="px-4 py-3 text-sm text-ink-soft">Ainda sem vendas neste mês.</p>}
          </div>
        </div>
      </div>
      <h2 className="text-sm font-extrabold text-ink mb-2">Precisa de atenção</h2>
      <div className="space-y-2 mb-5">
        {alertas.map((a, i) => <button key={i} onClick={() => ir(a.destino)} className={`block w-full text-left rounded-xl border px-4 py-3 text-sm ${a.cor}`}>{a.texto}</button>)}
        {alertas.length === 0 && <p className="text-sm text-ink-soft rounded-xl border border-line bg-white px-4 py-3">Tudo em dia por aqui.</p>}
      </div>
    </>
  );
}

function Cartao({ t, v }: { t: string; v: string }) {
  return <div className="rounded-xl border border-line bg-white p-4"><div className="text-xs font-bold uppercase tracking-wide text-ink-soft">{t}</div><div className="text-xl font-extrabold text-ink">{v}</div></div>;
}

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

/** Barras lado a lado: cada mês do ano anterior colado no mesmo mês deste ano. */
function GraficoAnual({ ano, meses }: { ano: number; meses: { atual: number; anterior: number }[] }) {
  const max = Math.max(1, ...meses.flatMap((m) => [m.atual, m.anterior]));
  const H = 160; const mesAtual = new Date().getMonth();
  return (
    <div className="rounded-xl border border-line bg-white p-4 mb-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-sm font-extrabold text-ink">Vendas mês a mês: {ano} x {ano - 1}</h2>
        <div className="flex gap-4 text-xs text-ink-soft"><span><i className="inline-block w-3 h-3 rounded-sm bg-slate-300 mr-1 align-middle" />{ano - 1}</span><span><i className="inline-block w-3 h-3 rounded-sm bg-teal-500 mr-1 align-middle" />{ano}</span></div>
      </div>
      <div className="grid grid-cols-12 gap-1 items-end" style={{ height: H + 40 }}>
        {meses.map((m, i) => (
          <div key={i} className="flex flex-col items-center justify-end h-full" title={`${MESES[i]}: ${ano - 1} ${formatarMoeda(m.anterior)} · ${ano} ${formatarMoeda(m.atual)}`}>
            <div className="flex items-end gap-0.5 w-full justify-center" style={{ height: H }}>
              <div className="w-1/2 max-w-[22px] rounded-t bg-slate-300" style={{ height: Math.max(m.anterior ? 3 : 0, (m.anterior / max) * H) }} />
              <div className={`w-1/2 max-w-[22px] rounded-t ${i > mesAtual ? 'bg-teal-500/30' : 'bg-teal-500'}`} style={{ height: Math.max(m.atual ? 3 : 0, (m.atual / max) * H) }} />
            </div>
            <div className={`text-[11px] mt-1 ${i === mesAtual ? 'font-extrabold text-ink' : 'text-ink-soft'}`}>{MESES[i]}</div>
            <div className="text-[10px] text-ink-soft hidden lg:block">{m.atual ? formatarMoeda(m.atual).replace('R$ ', '') : ''}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
