import { useEffect, useMemo, useRef, useState } from 'react';
import { movimentarEstoque } from '../lib/erpData';
import { parseValorBR } from '../lib/crmLogic';
import type { MovimentoEstoque, Produto } from '../types';

const campo = 'w-full rounded-lg border border-line px-3 h-10 text-sm bg-white';
const rotulo = 'block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1';

/** Auditoria de estoque: bipa o código (ou digita), informa a quantidade, e compara com o saldo do sistema. */
export default function ErpAuditoria({ empresaId, produtos, movimentos, usuario }: { empresaId: string; produtos: Produto[]; movimentos: MovimentoEstoque[]; usuario?: string }) {
  const chave = `fluxa_auditoria_${empresaId}`;
  const [contagem, setContagem] = useState<Record<string, number>>(() => { try { return JSON.parse(localStorage.getItem(chave) ?? '{}') as Record<string, number>; } catch { return {}; } });
  useEffect(() => { try { localStorage.setItem(chave, JSON.stringify(contagem)); } catch { /* sem armazenamento */ } }, [contagem, chave]);
  const [codigo, setCodigo] = useState('');
  const [atual, setAtual] = useState<Produto | null>(null);
  const [qtd, setQtd] = useState('1');
  const [auto, setAuto] = useState(false);
  const [aviso, setAviso] = useState('');
  const [naoContados, setNaoContados] = useState(false);
  const [soDif, setSoDif] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [msg, setMsg] = useState('');
  const [verHist, setVerHist] = useState(false);
  const refCodigo = useRef<HTMLInputElement>(null);
  const refQtd = useRef<HTMLInputElement>(null);

  const porId = useMemo(() => new Map(produtos.map((p) => [p.id, p])), [produtos]);
  const ativos = useMemo(() => produtos.filter((p) => p.ativo), [produtos]);

  function achar(c: string): Produto | undefined {
    const t = c.trim().toLowerCase();
    if (!t) return undefined;
    return ativos.find((p) => p.sku.toLowerCase() === t || (p.gtin ?? '').trim() === c.trim()) ?? produtos.find((p) => p.sku.toLowerCase() === t);
  }
  function somar(p: Produto, n: number) {
    setContagem((a) => ({ ...a, [p.id]: Math.max(0, (a[p.id] ?? 0) + n) }));
  }
  function aoBipar() {
    const p = achar(codigo);
    if (!p) { if (codigo.trim()) setAviso(`Código "${codigo.trim()}" não encontrado.`); setCodigo(''); return; }
    setAviso('');
    setCodigo('');
    if (auto) { somar(p, 1); setAtual(p); return; }
    setAtual(p); setQtd('1');
    setTimeout(() => { refQtd.current?.focus(); refQtd.current?.select(); }, 0);
  }
  function confirmarQtd() {
    if (!atual) return;
    const n = parseValorBR(qtd);
    if (Number.isNaN(n) || n <= 0) return;
    somar(atual, n);
    setQtd('1');
    refCodigo.current?.focus();
  }

  const linhas = useMemo(() => {
    const ids = Object.keys(contagem);
    const lista = ids.map((id) => porId.get(id)).filter(Boolean) as Produto[];
    return soDif ? lista.filter((p) => contagem[p.id] !== p.estoque) : lista;
  }, [contagem, porId, soDif]);
  const divergentes = useMemo(() => {
    const cont = Object.keys(contagem).map((id) => porId.get(id)).filter((p): p is Produto => !!p && contagem[p.id] !== p.estoque).map((p) => ({ p, novo: contagem[p.id] }));
    if (naoContados) ativos.forEach((p) => { if (contagem[p.id] === undefined && p.estoque !== 0) cont.push({ p, novo: 0 }); });
    return cont;
  }, [contagem, porId, ativos, naoContados]);
  const sobra = divergentes.reduce((t, d) => t + Math.max(0, d.novo - d.p.estoque), 0);
  const falta = divergentes.reduce((t, d) => t + Math.max(0, d.p.estoque - d.novo), 0);
  const naoBipados = ativos.filter((p) => contagem[p.id] === undefined).length;

  async function aplicar() {
    if (!divergentes.length) return;
    if (!confirm(`Ajustar o estoque de ${divergentes.length} produto(s) para a quantidade contada?`)) return;
    setAplicando(true); setMsg('');
    try {
      for (const d of divergentes) await movimentarEstoque(empresaId, d.p, 'ajuste', d.novo, 'Auditoria de estoque', usuario);
      setMsg(`${divergentes.length} produto(s) ajustado(s).`);
      setContagem({}); setAtual(null);
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Erro ao ajustar.'); }
    setAplicando(false);
  }

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Resumo t="Produtos conferidos" v={`${Object.keys(contagem).length} de ${ativos.length}`} />
        <Resumo t="Com divergência" v={String(divergentes.length)} alerta={divergentes.length > 0} />
        <Resumo t="Sobra (un)" v={String(sobra)} />
        <Resumo t="Falta (un)" v={String(falta)} alerta={falta > 0} />
      </div>

      <div className="rounded-xl border border-line bg-white p-4 mb-3">
        <div className="flex gap-3 flex-wrap items-end">
          <div className="flex-1 min-w-[240px]">
            <label className={rotulo}>Bipar ou digitar o código</label>
            <input ref={refCodigo} autoFocus className={`${campo} text-base font-mono`} placeholder="Bipe o código de barras e tecle Enter" value={codigo}
              onChange={(e) => setCodigo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); aoBipar(); } }} />
          </div>
          {!auto && atual && (
            <div className="w-32">
              <label className={rotulo}>Quantidade</label>
              <input ref={refQtd} inputMode="decimal" className={`${campo} text-base font-bold text-center`} value={qtd} onChange={(e) => setQtd(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmarQtd(); } }} />
            </div>
          )}
          {!auto && atual && <button onClick={confirmarQtd} className="rounded-xl bg-emerald-600 text-white text-sm font-bold px-4 h-10">Adicionar</button>}
        </div>
        {atual && (
          <p className="mt-3 text-sm text-ink"><b>{atual.nome}</b> <span className="font-mono text-xs text-ink-soft">({atual.sku})</span> — contado até agora: <b>{contagem[atual.id] ?? 0}</b> · no sistema: {atual.estoque}</p>
        )}
        {aviso && <p className="mt-2 text-sm text-red-600 font-bold">{aviso}</p>}
        <label className="flex items-center gap-2 text-sm text-ink-soft mt-3"><input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); refCodigo.current?.focus(); }} /> Somar 1 automaticamente a cada bipe (sem perguntar quantidade)</label>
      </div>

      <div className="flex gap-3 flex-wrap items-center mb-3">
        <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={soDif} onChange={(e) => setSoDif(e.target.checked)} /> Só divergências</label>
        <label className="flex items-center gap-2 text-sm text-ink-soft"><input type="checkbox" checked={naoContados} onChange={(e) => setNaoContados(e.target.checked)} /> Produtos não bipados ficam zerados ({naoBipados})</label>
        <div className="ml-auto flex gap-2">
          <button disabled={Object.keys(contagem).length === 0} onClick={() => { if (confirm('Limpar toda a contagem?')) { setContagem({}); setAtual(null); } }} className="rounded-xl border border-line text-sm font-bold px-4 h-10 disabled:opacity-40">Limpar contagem</button>
          <button disabled={aplicando || divergentes.length === 0} onClick={() => void aplicar()} className="rounded-xl bg-emerald-600 text-white text-sm font-bold px-4 h-10 disabled:opacity-40">{aplicando ? 'Ajustando…' : `Ajustar estoque (${divergentes.length})`}</button>
        </div>
      </div>
      {msg && <p className={`text-sm mb-3 ${msg.includes('ajustado') ? 'text-emerald-700' : 'text-red-600'}`}>{msg}</p>}

      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-ink-soft bg-surface"><tr>
            <th className="text-left p-3">Código</th><th className="text-left p-3">Descrição</th><th className="text-right p-3">No sistema</th><th className="text-right p-3 w-32">Contado</th><th className="text-right p-3">Diferença</th><th className="p-3" />
          </tr></thead>
          <tbody>
            {linhas.map((p) => {
              const c = contagem[p.id];
              const dif = c - p.estoque;
              return (
                <tr key={p.id} className="border-t border-line">
                  <td className="p-3 font-mono text-xs">{p.sku}</td>
                  <td className="p-3 font-semibold text-ink">{p.nome}</td>
                  <td className="p-3 text-right">{p.estoque} {p.unidade}</td>
                  <td className="p-2 text-right"><input inputMode="decimal" className="w-24 rounded-lg border border-line px-2 h-9 text-sm text-right" value={c} onChange={(e) => { const n = parseValorBR(e.target.value); setContagem((a) => ({ ...a, [p.id]: Number.isNaN(n) ? 0 : Math.max(0, n) })); }} /></td>
                  <td className={`p-3 text-right font-bold ${dif === 0 ? 'text-ink-soft' : dif > 0 ? 'text-emerald-700' : 'text-red-600'}`}>{dif > 0 ? `+${dif}` : dif}</td>
                  <td className="p-3 text-right"><button className="text-xs font-bold text-red-600" onClick={() => setContagem((a) => { const n = { ...a }; delete n[p.id]; return n; })}>Remover</button></td>
                </tr>
              );
            })}
            {linhas.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-ink-soft">{soDif ? 'Nenhuma divergência até agora.' : 'Nada conferido ainda. Bipe o primeiro código acima.'}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-soft mt-2">A contagem fica guardada neste computador até você ajustar ou limpar. Ao ajustar, o saldo do sistema passa a ser a quantidade contada e fica registrado no histórico.</p>

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
