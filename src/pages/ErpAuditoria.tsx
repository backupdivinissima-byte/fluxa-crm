import { useMemo, useState } from 'react';
import { movimentarEstoque } from '../lib/erpData';
import { parseValorBR } from '../lib/crmLogic';
import type { MovimentoEstoque, Produto } from '../types';

const campo = 'w-full rounded-lg border border-line px-3 h-10 text-sm bg-white';
const rotulo = 'block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1';

/** Auditoria de estoque: contagem física x saldo do sistema, com ajuste em lote e histórico de movimentações. */
export default function ErpAuditoria({ empresaId, produtos, movimentos, usuario }: { empresaId: string; produtos: Produto[]; movimentos: MovimentoEstoque[]; usuario?: string }) {
  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState('');
  const [soDif, setSoDif] = useState(false);
  const [contagem, setContagem] = useState<Record<string, string>>({});
  const [aplicando, setAplicando] = useState(false);
  const [msg, setMsg] = useState('');
  const [verHist, setVerHist] = useState(false);

  const categorias = useMemo(() => Array.from(new Set(produtos.map((p) => p.categoria).filter(Boolean) as string[])).sort(), [produtos]);
  const contado = (p: Produto) => { const t = contagem[p.id]; if (t === undefined || t.trim() === '') return undefined; const n = parseValorBR(t); return Number.isNaN(n) ? undefined : n; };
  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return produtos.filter((p) => {
      if (!p.ativo) return false;
      if (q && !(p.nome.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))) return false;
      if (categoria && p.categoria !== categoria) return false;
      if (soDif) { const c = contado(p); if (c === undefined || c === p.estoque) return false; }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtos, busca, categoria, soDif, contagem]);

  const divergentes = produtos.filter((p) => { const c = contado(p); return c !== undefined && c !== p.estoque; });
  const contados = produtos.filter((p) => contado(p) !== undefined).length;
  const sobra = divergentes.reduce((s, p) => s + Math.max(0, (contado(p) as number) - p.estoque), 0);
  const falta = divergentes.reduce((s, p) => s + Math.max(0, p.estoque - (contado(p) as number)), 0);

  async function aplicar() {
    if (!divergentes.length) return;
    if (!confirm(`Ajustar o estoque de ${divergentes.length} produto(s) para a quantidade contada?`)) return;
    setAplicando(true); setMsg('');
    try {
      for (const p of divergentes) await movimentarEstoque(empresaId, p, 'ajuste', contado(p) as number, 'Auditoria de estoque', usuario);
      setMsg(`${divergentes.length} produto(s) ajustado(s).`);
      setContagem({});
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Erro ao ajustar.'); }
    setAplicando(false);
  }

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Resumo t="Produtos contados" v={`${contados} de ${produtos.filter((p) => p.ativo).length}`} />
        <Resumo t="Com divergência" v={String(divergentes.length)} alerta={divergentes.length > 0} />
        <Resumo t="Sobra (un)" v={String(sobra)} />
        <Resumo t="Falta (un)" v={String(falta)} alerta={falta > 0} />
      </div>

      <div className="flex gap-2 flex-wrap items-end mb-3 rounded-xl border border-line bg-white p-3">
        <div className="flex-1 min-w-[220px]"><label className={rotulo}>Pesquisar</label><input className={campo} placeholder="Descrição ou código" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
        <div><label className={rotulo}>Categoria</label>
          <select className={campo} value={categoria} onChange={(e) => setCategoria(e.target.value)}><option value="">Todas</option>{categorias.map((c) => <option key={c}>{c}</option>)}</select></div>
        <label className="flex items-center gap-2 text-sm font-bold h-10"><input type="checkbox" checked={soDif} onChange={(e) => setSoDif(e.target.checked)} /> Só divergências</label>
        <button disabled={aplicando || divergentes.length === 0} onClick={() => void aplicar()} className="rounded-xl bg-emerald-600 text-white text-sm font-bold px-4 h-10 disabled:opacity-40">{aplicando ? 'Ajustando…' : `Ajustar estoque (${divergentes.length})`}</button>
      </div>
      {msg && <p className={`text-sm mb-3 ${msg.includes('ajustado') ? 'text-emerald-700' : 'text-red-600'}`}>{msg}</p>}

      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-ink-soft bg-surface"><tr>
            <th className="text-left p-3">Código</th><th className="text-left p-3">Descrição</th><th className="text-right p-3">No sistema</th><th className="text-right p-3 w-32">Contado</th><th className="text-right p-3">Diferença</th>
          </tr></thead>
          <tbody>
            {lista.map((p) => {
              const c = contado(p);
              const dif = c === undefined ? undefined : c - p.estoque;
              return (
                <tr key={p.id} className="border-t border-line">
                  <td className="p-3 font-mono text-xs">{p.sku}</td>
                  <td className="p-3 font-semibold text-ink">{p.nome}</td>
                  <td className="p-3 text-right">{p.estoque} {p.unidade}</td>
                  <td className="p-2 text-right"><input inputMode="decimal" className="w-24 rounded-lg border border-line px-2 h-9 text-sm text-right" value={contagem[p.id] ?? ''} onChange={(e) => setContagem((a) => ({ ...a, [p.id]: e.target.value }))} placeholder="—" /></td>
                  <td className={`p-3 text-right font-bold ${dif === undefined || dif === 0 ? 'text-ink-soft' : dif > 0 ? 'text-emerald-700' : 'text-red-600'}`}>{dif === undefined ? '—' : dif > 0 ? `+${dif}` : dif}</td>
                </tr>
              );
            })}
            {lista.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-ink-soft">{soDif ? 'Nenhuma divergência até agora.' : 'Nenhum produto encontrado.'}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-soft mt-2">Digite a quantidade contada de cada produto. Só os produtos preenchidos e diferentes do sistema serão ajustados; o ajuste fica registrado no histórico.</p>

      <button onClick={() => setVerHist((v) => !v)} className="mt-5 text-sm font-bold text-teal-600">{verHist ? '▾' : '▸'} Histórico de movimentações ({movimentos.length})</button>
      {verHist && (
        <div className="overflow-x-auto rounded-xl border border-line bg-white mt-2">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-ink-soft bg-surface"><tr><th className="text-left p-3">Quando</th><th className="text-left p-3">Produto</th><th className="text-left p-3">Tipo</th><th className="text-right p-3">Qtd</th><th className="text-right p-3">Saldo</th><th className="text-left p-3">Motivo</th></tr></thead>
            <tbody>
              {movimentos.map((m) => (
                <tr key={m.id} className="border-t border-line">
                  <td className="p-3 whitespace-nowrap">{new Date(m.criadoEm).toLocaleString('pt-BR')}</td>
                  <td className="p-3">{m.produtoNome} <span className="font-mono text-xs text-ink-soft">{m.sku}</span></td>
                  <td className="p-3 capitalize">{m.tipo === 'saida' ? 'saída' : m.tipo}</td>
                  <td className={`p-3 text-right font-bold ${m.quantidade < 0 ? 'text-red-600' : 'text-teal-500'}`}>{m.quantidade > 0 ? '+' : ''}{m.quantidade}</td>
                  <td className="p-3 text-right">{m.saldoApos}</td>
                  <td className="p-3 text-ink-soft">{m.motivo ?? '—'}{m.usuario ? ` · ${m.usuario}` : ''}</td>
                </tr>
              ))}
              {movimentos.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-ink-soft">Nenhuma movimentação ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Resumo({ t, v, alerta }: { t: string; v: string; alerta?: boolean }) {
  return (
    <div className={`rounded-xl border bg-white p-4 ${alerta ? 'border-red-300' : 'border-line'}`}>
      <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">{t}</div>
      <div className={`text-xl font-extrabold ${alerta ? 'text-red-600' : 'text-ink'}`}>{v}</div>
    </div>
  );
}
