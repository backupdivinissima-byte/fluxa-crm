import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { criarPedido, mudarStatusPedido, ouvirPedidos, totalDoPedido } from '../lib/erpData';
import { formatarMoeda, parseValorBR } from '../lib/crmLogic';
import type { ItemPedido, Pedido, Produto, StatusPedido } from '../types';

const campo = 'w-full rounded-lg border border-line px-3 h-10 text-sm bg-white';
const rotulo = 'block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1';
const num = (t: string) => { const n = parseValorBR(t); return Number.isNaN(n) ? 0 : n; };
const ROTULO: Record<StatusPedido, string> = { aberto: 'Aberto', pago: 'Pago', enviado: 'Enviado', entregue: 'Entregue', cancelado: 'Cancelado' };
const COR: Record<StatusPedido, string> = { aberto: 'bg-amber-100 text-amber-700', pago: 'bg-teal-100 text-teal-700', enviado: 'bg-blue-100 text-blue-700', entregue: 'bg-emerald-100 text-emerald-700', cancelado: 'bg-slate-200 text-slate-500' };
const PROXIMO: Partial<Record<StatusPedido, StatusPedido>> = { aberto: 'pago', pago: 'enviado', enviado: 'entregue' };

export default function ErpPedidos({ empresaId, produtos }: { empresaId: string; produtos: Produto[] }) {
  const { perfil } = useAuth();
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [novo, setNovo] = useState(false);
  const [filtro, setFiltro] = useState<StatusPedido | 'todos'>('todos');
  const [erro, setErro] = useState('');
  useEffect(() => ouvirPedidos(empresaId, setPedidos), [empresaId]);

  const lista = pedidos.filter((p) => filtro === 'todos' || p.status === filtro);
  const vendido = useMemo(() => pedidos.filter((p) => p.status !== 'cancelado').reduce((s, p) => s + p.total, 0), [pedidos]);

  async function avancar(p: Pedido, st: StatusPedido) {
    try { setErro(''); await mudarStatusPedido(empresaId, p, st, perfil?.nome); } catch (e) { setErro(e instanceof Error ? e.message : 'Erro.'); }
  }

  return (
    <>
      <div className="flex gap-2 flex-wrap items-center mb-3">
        <select className={`${campo} max-w-[180px]`} value={filtro} onChange={(e) => setFiltro(e.target.value as StatusPedido | 'todos')}>
          <option value="todos">Todos os status</option>
          {(Object.keys(ROTULO) as StatusPedido[]).map((s) => <option key={s} value={s}>{ROTULO[s]}</option>)}
        </select>
        <span className="text-sm text-ink-soft">Vendido (sem cancelados): <b className="text-ink">{formatarMoeda(vendido)}</b></span>
        <button onClick={() => setNovo(true)} className="ml-auto rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-4 h-10">+ Novo pedido</button>
      </div>
      {erro && <p className="text-sm text-red-600 mb-2">{erro}</p>}
      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-ink-soft bg-surface"><tr><th className="text-left p-3">Nº</th><th className="text-left p-3">Cliente</th><th className="text-left p-3">Itens</th><th className="text-right p-3">Total</th><th className="text-left p-3">Status</th><th className="p-3" /></tr></thead>
          <tbody>
            {lista.map((p) => (
              <tr key={p.id} className="border-t border-line align-top">
                <td className="p-3 font-bold">#{p.numero}<div className="text-[11px] font-normal text-ink-soft">{new Date(p.criadoEm).toLocaleDateString('pt-BR')}</div></td>
                <td className="p-3">{p.clienteNome}{p.clienteTelefone && <div className="text-xs text-ink-soft">{p.clienteTelefone}</div>}</td>
                <td className="p-3 text-ink-soft">{p.itens.map((i) => `${i.quantidade}× ${i.nome}`).join(', ')}</td>
                <td className="p-3 text-right font-bold">{formatarMoeda(p.total)}</td>
                <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${COR[p.status]}`}>{ROTULO[p.status]}</span></td>
                <td className="p-3 whitespace-nowrap text-right">
                  {PROXIMO[p.status] && <button className="text-xs font-bold text-teal-500 mr-2" onClick={() => void avancar(p, PROXIMO[p.status] as StatusPedido)}>Marcar {ROTULO[PROXIMO[p.status] as StatusPedido].toLowerCase()}</button>}
                  {p.status !== 'cancelado' && p.status !== 'entregue' && <button className="text-xs font-bold text-red-600" onClick={() => { if (confirm(`Cancelar o pedido #${p.numero}? Os itens voltam ao estoque.`)) void avancar(p, 'cancelado'); }}>Cancelar</button>}
                </td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-ink-soft">Nenhum pedido ainda.</td></tr>}
          </tbody>
        </table>
      </div>
      {novo && <FormPedido produtos={produtos.filter((p) => p.ativo)} onFechar={() => setNovo(false)} onSalvar={async (d) => { try { await criarPedido(empresaId, d, perfil?.nome); setNovo(false); setErro(''); } catch (e) { return e instanceof Error ? e.message : 'Erro ao salvar.'; } }} />}
    </>
  );
}

function FormPedido({ produtos, onFechar, onSalvar }: { produtos: Produto[]; onFechar: () => void; onSalvar: (d: Parameters<typeof criarPedido>[1]) => Promise<string | void> }) {
  const [nome, setNome] = useState('');
  const [tel, setTel] = useState('');
  const [itens, setItens] = useState<ItemPedido[]>([]);
  const [prodId, setProdId] = useState('');
  const [qtd, setQtd] = useState('1');
  const [desc, setDesc] = useState('0');
  const [frete, setFrete] = useState('0');
  const [pag, setPag] = useState('Pix');
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const total = totalDoPedido(itens, num(desc), num(frete));

  function adicionar() {
    const p = produtos.find((x) => x.id === prodId);
    const q = num(qtd);
    if (!p || q <= 0) return;
    setItens((atual) => {
      const ex = atual.find((i) => i.produtoId === p.id);
      return ex ? atual.map((i) => (i.produtoId === p.id ? { ...i, quantidade: i.quantidade + q } : i)) : [...atual, { produtoId: p.id, sku: p.sku, nome: p.nome, quantidade: q, preco: p.preco }];
    });
    setProdId(''); setQtd('1');
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onFechar}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-extrabold text-ink mb-3">Novo pedido</h2>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={rotulo}>Cliente</label><input className={campo} value={nome} onChange={(e) => setNome(e.target.value)} /></div>
          <div><label className={rotulo}>Telefone</label><input className={campo} value={tel} onChange={(e) => setTel(e.target.value)} /></div>
        </div>
        <label className={`${rotulo} mt-4`}>Adicionar produto</label>
        <div className="flex gap-2">
          <select className={campo} value={prodId} onChange={(e) => setProdId(e.target.value)}>
            <option value="">Escolha…</option>
            {produtos.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.nome} (estoque {p.estoque})</option>)}
          </select>
          <input className={`${campo} max-w-[80px]`} value={qtd} onChange={(e) => setQtd(e.target.value)} />
          <button onClick={adicionar} className="rounded-xl border border-line text-sm font-bold px-3">Incluir</button>
        </div>
        {itens.length > 0 && (
          <div className="mt-3 rounded-lg border border-line divide-y divide-line">
            {itens.map((i) => (
              <div key={i.produtoId} className="flex items-center gap-2 p-2 text-sm">
                <span className="flex-1">{i.nome}</span>
                <input className="w-14 rounded border border-line px-2 h-8 text-sm" value={i.quantidade} onChange={(e) => setItens(itens.map((x) => (x.produtoId === i.produtoId ? { ...x, quantidade: num(e.target.value) } : x)))} />
                <span className="text-ink-soft">×</span>
                <input className="w-20 rounded border border-line px-2 h-8 text-sm" value={String(i.preco).replace('.', ',')} onChange={(e) => setItens(itens.map((x) => (x.produtoId === i.produtoId ? { ...x, preco: num(e.target.value) } : x)))} />
                <button className="text-red-600 text-xs font-bold" onClick={() => setItens(itens.filter((x) => x.produtoId !== i.produtoId))}>remover</button>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-3 gap-3 mt-4">
          <div><label className={rotulo}>Desconto</label><input className={campo} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
          <div><label className={rotulo}>Frete</label><input className={campo} value={frete} onChange={(e) => setFrete(e.target.value)} /></div>
          <div><label className={rotulo}>Pagamento</label>
            <select className={campo} value={pag} onChange={(e) => setPag(e.target.value)}>{['Pix', 'Cartão de crédito', 'Cartão de débito', 'Dinheiro', 'Boleto', 'Outro'].map((x) => <option key={x}>{x}</option>)}</select>
          </div>
        </div>
        <label className={`${rotulo} mt-3`}>Observação</label>
        <input className={campo} value={obs} onChange={(e) => setObs(e.target.value)} />
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-ink-soft">Total <b className="text-lg text-ink">{formatarMoeda(total)}</b></span>
          <div className="flex gap-2">
            <button disabled={salvando} onClick={async () => { setSalvando(true); const r = await onSalvar({ clienteNome: nome, clienteTelefone: tel, itens, desconto: num(desc), frete: num(frete), pagamento: pag, observacao: obs }); if (r) setErro(r); setSalvando(false); }} className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-4 h-10 disabled:opacity-40">Criar pedido</button>
            <button onClick={onFechar} className="rounded-xl border border-line text-sm font-bold px-4">Cancelar</button>
          </div>
        </div>
        {erro && <p className="text-sm text-red-600 mt-2">{erro}</p>}
        <p className="text-xs text-ink-soft mt-2">Ao criar, o estoque dos itens é baixado na hora. Cancelar o pedido devolve ao estoque.</p>
      </div>
    </div>
  );
}
