import { useEffect, useMemo, useState } from 'react';
import { ouvirPedidosDesde } from '../lib/erpData';
import { formatarMoeda } from '../lib/crmLogic';
import type { Pedido, Produto } from '../types';

export type DestinoErp = { aba: 'vendas' | 'estoque' | 'financeiro'; sub?: string };

/** Painel inicial: o que precisa de atenção hoje e os números do mês, sem precisar caçar em cada tela. */
export default function ErpInicio({ empresaId, produtos }: { empresaId: string; produtos: Produto[]; ir?: (d: DestinoErp) => void }) {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  useEffect(() => ouvirPedidosDesde(empresaId, `${new Date().getFullYear() - 1}-01-01`, setPedidos), [empresaId]);

  const d = useMemo(() => {
    const h = new Date().toISOString().slice(0, 10); const mes = h.slice(0, 7);
    const vendas = pedidos.filter((p) => p.status !== 'cancelado' && p.status !== 'orcamento' && p.criadoEm.slice(0, 7) === mes);
    const total = vendas.reduce((s, p) => s + p.total, 0);
    const porProduto = new Map<string, { nome: string; qtd: number }>();
    vendas.forEach((p) => p.itens.forEach((i) => porProduto.set(i.produtoId, { nome: i.nome, qtd: (porProduto.get(i.produtoId)?.qtd ?? 0) + i.quantidade })));
    const ano = new Date().getFullYear();
    const meses = Array.from({ length: 12 }, (_, m) => {
      const soma = (a: number) => pedidos.filter((p) => p.status !== 'cancelado' && p.status !== 'orcamento' && p.criadoEm.slice(0, 7) === `${a}-${String(m + 1).padStart(2, '0')}`).reduce((s, p) => s + p.total, 0);
      return { atual: soma(ano), anterior: soma(ano - 1) };
    });
    const unidades = Array.from(porProduto.values()).reduce((x, y) => x + y.qtd, 0);
    const maisIds = new Set(Array.from(porProduto.entries()).sort((x, y) => y[1].qtd - x[1].qtd).slice(0, 5).map(([id]) => id));
    const menos = produtos.filter((p) => p.ativo && !maisIds.has(p.id) && (p.estoque > 0 || porProduto.has(p.id))).map((p) => ({ nome: p.nome, qtd: porProduto.get(p.id)?.qtd ?? 0 })).sort((x, y) => x.qtd - y.qtd).slice(0, 5);
    return {
      ano, meses, total, qtd: vendas.length, ticket: vendas.length ? total / vendas.length : 0,
      top: Array.from(porProduto.values()).sort((a, b) => b.qtd - a.qtd).slice(0, 5),
      unidades, menos,
    };
  }, [pedidos, produtos]);

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <Cartao t="Vendido no mês" v={formatarMoeda(d.total)} />
        <Cartao t="Pedidos no mês" v={String(d.qtd)} />
        <Cartao t="Ticket médio" v={formatarMoeda(d.ticket)} />
      </div>
      <GraficoAnual ano={d.ano} meses={d.meses} />
      <div className="grid md:grid-cols-2 gap-4">
        <ListaRanking titulo="5 mais vendidos no mês" itens={d.top} total={d.unidades} />
        <ListaRanking titulo="5 menos vendidos no mês" itens={d.menos} total={d.unidades} />
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

function ListaRanking({ titulo, itens, total }: { titulo: string; itens: { nome: string; qtd: number }[]; total: number }) {
  return (
    <div>
      <h2 className="text-sm font-extrabold text-ink mb-2">{titulo}</h2>
      <div className="rounded-xl border border-line bg-white divide-y divide-line">
        {itens.map((p, i) => (
          <div key={i} className="flex justify-between gap-3 px-4 py-2 text-sm">
            <span className="truncate">{i + 1}. {p.nome}</span>
            <span className="shrink-0"><b>{p.qtd} un.</b> <span className="text-ink-soft">· {total ? ((p.qtd / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '0'}%</span></span>
          </div>
        ))}
        {itens.length === 0 && <p className="px-4 py-3 text-sm text-ink-soft">Ainda sem dados neste mês.</p>}
      </div>
    </div>
  );
}
