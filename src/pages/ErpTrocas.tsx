import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ouvirTrocas, registrarTroca } from '../lib/erpData';
import { formatarMoeda, parseValorBR } from '../lib/crmLogic';
import type { ItemPedido, Pedido, Produto, Troca } from '../types';

const campo = 'w-full rounded-lg border border-line px-3 h-10 text-sm bg-white';
const num = (t: string) => { const n = parseValorBR(t); return Number.isNaN(n) ? 0 : n; };

export function ListaTrocas({ empresaId }: { empresaId: string }) {
  const [trocas, setTrocas] = useState<Troca[]>([]);
  useEffect(() => ouvirTrocas(empresaId, setTrocas), [empresaId]);
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase text-ink-soft bg-surface"><tr><th className="text-left p-3">Nº</th><th className="text-left p-3">Cliente / pedido</th><th className="text-left p-3">Voltou</th><th className="text-left p-3">Saiu</th><th className="text-right p-3">Diferença</th></tr></thead>
        <tbody>
          {trocas.map((t) => (
            <tr key={t.id} className="border-t border-line align-top">
              <td className="p-3 font-bold">#{t.numero}<div className="text-[11px] font-normal text-ink-soft">{new Date(t.criadoEm).toLocaleDateString('pt-BR')}</div></td>
              <td className="p-3">{t.clienteNome}<div className="text-xs text-ink-soft">{t.tipo === 'troca' ? 'Troca' : 'Devolução'} · pedido #{t.pedidoNumero}{t.motivo ? ` · ${t.motivo}` : ''}</div></td>
              <td className="p-3 text-ink-soft">{t.devolvidos.map((i) => `${i.quantidade}× ${i.nome}`).join(', ')}</td>
              <td className="p-3 text-ink-soft">{t.novos.length ? t.novos.map((i) => `${i.quantidade}× ${i.nome}`).join(', ') : '—'}</td>
              <td className={`p-3 text-right font-bold ${t.diferenca > 0 ? 'text-teal-600' : t.diferenca < 0 ? 'text-red-600' : ''}`}>{t.diferenca === 0 ? '—' : `${t.diferenca > 0 ? 'cliente paga ' : 'devolver '}${formatarMoeda(Math.abs(t.diferenca))}`}</td>
            </tr>
          ))}
          {trocas.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-ink-soft">Nenhuma troca ou devolução ainda. Para registrar, abra um pedido na aba Pedidos e use “Troca / devolução”.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** Uma janela só para devolução e troca: marque o que voltou e, se for troca, o que sai no lugar. */
export function FormTroca({ empresaId, pedido, produtos, onFechar }: { empresaId: string; pedido: Pedido; produtos: Produto[]; onFechar: () => void }) {
  const { perfil } = useAuth();
  const [volta, setVolta] = useState<Record<string, string>>({});
  const [novos, setNovos] = useState<ItemPedido[]>([]);
  const [prodId, setProdId] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const devolvidos: ItemPedido[] = pedido.itens.map((i) => ({ ...i, quantidade: num(volta[i.produtoId] ?? '0') })).filter((i) => i.quantidade > 0);
  const vDev = devolvidos.reduce((s, i) => s + i.quantidade * i.preco, 0);
  const vNovo = novos.reduce((s, i) => s + i.quantidade * i.preco, 0);
  const dif = Math.round((vNovo - vDev) * 100) / 100;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onFechar}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-extrabold text-ink">Troca / devolução — pedido #{pedido.numero}</h2>
        <p className="text-sm text-ink-soft mb-3">{pedido.clienteNome}</p>
        <div className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-1">1. O que o cliente está devolvendo</div>
        <div className="rounded-lg border border-line divide-y divide-line">
          {pedido.itens.map((i) => {
            const resta = i.quantidade - (pedido.devolvidos?.[i.produtoId] ?? 0);
            return (
              <div key={i.produtoId} className="flex items-center gap-2 p-2 text-sm">
                <span className="flex-1">{i.nome} <span className="text-xs text-ink-soft">({resta} de {i.quantidade} podem voltar · {formatarMoeda(i.preco)})</span></span>
                <input disabled={resta <= 0} className="w-16 rounded border border-line px-2 h-8 text-sm" placeholder="0" value={volta[i.produtoId] ?? ''} onChange={(e) => setVolta({ ...volta, [i.produtoId]: e.target.value })} />
              </div>
            );
          })}
        </div>
        <div className="text-xs font-bold uppercase tracking-wide text-ink-soft mt-4 mb-1">2. Quer levar outra peça no lugar? (opcional)</div>
        <div className="flex gap-2">
          <select className={campo} value={prodId} onChange={(e) => setProdId(e.target.value)}>
            <option value="">Escolha a peça nova…</option>
            {produtos.filter((p) => p.ativo).map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.nome} (estoque {p.estoque})</option>)}
          </select>
          <button className="rounded-xl border border-line text-sm font-bold px-3" onClick={() => { const p = produtos.find((x) => x.id === prodId); if (!p) return; setNovos((a) => a.some((i) => i.produtoId === p.id) ? a.map((i) => i.produtoId === p.id ? { ...i, quantidade: i.quantidade + 1 } : i) : [...a, { produtoId: p.id, sku: p.sku, nome: p.nome, quantidade: 1, preco: p.preco }]); setProdId(''); }}>Incluir</button>
        </div>
        {novos.length > 0 && (
          <div className="mt-2 rounded-lg border border-line divide-y divide-line">
            {novos.map((i) => (
              <div key={i.produtoId} className="flex items-center gap-2 p-2 text-sm">
                <span className="flex-1">{i.nome}</span>
                <input className="w-14 rounded border border-line px-2 h-8 text-sm" value={i.quantidade} onChange={(e) => setNovos(novos.map((x) => x.produtoId === i.produtoId ? { ...x, quantidade: num(e.target.value) } : x))} />
                <span>× {formatarMoeda(i.preco)}</span>
                <button className="text-red-600 text-xs font-bold" onClick={() => setNovos(novos.filter((x) => x.produtoId !== i.produtoId))}>remover</button>
              </div>
            ))}
          </div>
        )}
        <label className="block text-xs font-bold uppercase tracking-wide text-ink-soft mt-4 mb-1">Motivo (opcional)</label>
        <input className={campo} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Defeito, tamanho, arrependimento…" />
        <div className="mt-4 rounded-lg bg-surface p-3 text-sm">
          {vDev === 0 ? <span className="text-ink-soft">Marque a quantidade devolvida para ver o resumo.</span>
            : dif === 0 ? <span>Troca de mesmo valor: <b>nada a acertar</b>.</span>
            : dif > 0 ? <span>O cliente paga <b className="text-teal-600">{formatarMoeda(dif)}</b> de diferença.</span>
            : <span>Devolver ao cliente <b className="text-red-600">{formatarMoeda(-dif)}</b>.</span>}
          <div className="text-xs text-ink-soft mt-1">O que voltar entra no estoque. O que sair é baixado. O valor acertado vai para o Financeiro.</div>
        </div>
        {erro && <p className="text-sm text-red-600 mt-2">{erro}</p>}
        <div className="flex gap-2 mt-4">
          <button disabled={salvando || devolvidos.length === 0} onClick={async () => { setSalvando(true); try { await registrarTroca(empresaId, pedido, devolvidos, novos, motivo, perfil?.nome); onFechar(); } catch (e) { setErro(e instanceof Error ? e.message : 'Erro.'); } setSalvando(false); }} className="flex-1 rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold h-10 disabled:opacity-40">Confirmar</button>
          <button onClick={onFechar} className="rounded-xl border border-line text-sm font-bold px-4">Cancelar</button>
        </div>
      </div>
    </div>
  );
}
