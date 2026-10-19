import { useEffect, useMemo, useState } from 'react';
import { ENTIDADES, entidadePorKey, excluirCadastro, ouvirCadastro, salvarCadastro, type CampoCad, type EntidadeCad, type RegistroCad } from '../lib/erpCadastros';

const campoCls = 'w-full rounded-lg border border-line px-3 h-10 text-sm bg-white';
const rotulo = 'block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1';

/** Hook: carrega os registros de vários cadastros (para mostrar o nome nos campos de referência). */
function useRefs(empresaId: string, keys: string[]) {
  const [dados, setDados] = useState<Record<string, RegistroCad[]>>({});
  const chave = keys.join(',');
  useEffect(() => {
    const subs = chave.split(',').filter(Boolean).map((k) => ouvirCadastro(empresaId, k, (r) => setDados((d) => ({ ...d, [k]: r }))));
    return () => subs.forEach((u) => u());
  }, [empresaId, chave]);
  return dados;
}

export default function ErpCadastros({ empresaId }: { empresaId: string }) {
  const [key, setKey] = useState(ENTIDADES[0].key);
  const ent = entidadePorKey(key) as EntidadeCad;
  const [registros, setRegistros] = useState<RegistroCad[]>([]);
  const [busca, setBusca] = useState('');
  const [edicao, setEdicao] = useState<RegistroCad | 'novo' | null>(null);
  const [erro, setErro] = useState('');
  const refs = useRefs(empresaId, ent.campos.filter((c) => c.t === 'ref').map((c) => c.ref as string));

  useEffect(() => { setRegistros([]); setBusca(''); setEdicao(null); setErro(''); return ouvirCadastro(empresaId, key, setRegistros); }, [empresaId, key]);

  const colunas = ent.campos.filter((c) => c.coluna);
  const nomeRef = (campo: CampoCad, id: unknown) => (refs[campo.ref as string] ?? []).find((r) => r.id === id)?.nome as string | undefined;
  const texto = (c: CampoCad, r: RegistroCad) => (c.t === 'ref' ? nomeRef(c, r[c.k]) ?? '—' : c.t === 'bool' ? (r[c.k] ? 'Sim' : 'Não') : String(r[c.k] ?? '—'));

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return !q ? registros : registros.filter((r) => colunas.some((c) => texto(c, r).toLowerCase().includes(q)) || String(r.codigo).includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registros, busca, refs, key]);

  const grupos = Array.from(new Set(ENTIDADES.map((e) => e.grupo)));

  return (
    <div className="flex gap-5 flex-col md:flex-row">
      <aside className="md:w-56 shrink-0">
        {grupos.map((g) => (
          <div key={g} className="mb-3">
            <div className="text-[11px] font-bold uppercase tracking-wide text-ink-soft mb-1">{g}</div>
            {ENTIDADES.filter((e) => e.grupo === g).map((e) => (
              <button key={e.key} onClick={() => setKey(e.key)} className={`block w-full text-left px-3 py-1.5 rounded-lg text-sm font-semibold ${e.key === key ? 'bg-teal-500/10 text-teal-500' : 'text-ink-soft hover:bg-surface'}`}>{e.titulo}</button>
            ))}
          </div>
        ))}
      </aside>

      <section className="flex-1 min-w-0">
        <div className="flex items-start gap-3 flex-wrap mb-3">
          <div><h2 className="text-lg font-extrabold text-ink">{ent.titulo}</h2><p className="text-sm text-ink-soft">{ent.descricao}</p></div>
          <button onClick={() => setEdicao('novo')} className="ml-auto rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-4 h-10">+ Novo</button>
        </div>
        <input className={`${campoCls} max-w-xs mb-3`} placeholder="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} />
        {erro && <p className="text-sm text-red-600 mb-2">{erro}</p>}
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-ink-soft bg-surface"><tr><th className="text-left p-3 w-16">Cód.</th>{colunas.map((c) => <th key={c.k} className="text-left p-3">{c.l}</th>)}<th className="p-3" /></tr></thead>
            <tbody>
              {lista.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="p-3 text-ink-soft">{r.codigo}</td>
                  {colunas.map((c, i) => <td key={c.k} className={`p-3 ${i === 0 ? 'font-semibold text-ink' : 'text-ink-soft'}`}>{texto(c, r)}</td>)}
                  <td className="p-3 text-right whitespace-nowrap">
                    <button className="text-xs font-bold text-teal-500 mr-3" onClick={() => setEdicao(r)}>Editar</button>
                    <button className="text-xs font-bold text-red-600" onClick={async () => { if (confirm('Excluir este registro?')) { try { await excluirCadastro(empresaId, key, r.id); } catch (e) { setErro(e instanceof Error ? e.message : 'Erro.'); } } }}>Excluir</button>
                  </td>
                </tr>
              ))}
              {lista.length === 0 && <tr><td colSpan={colunas.length + 2} className="p-6 text-center text-ink-soft">Nenhum registro encontrado.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {edicao && <Formulario ent={ent} refs={refs} registro={edicao === 'novo' ? undefined : edicao} onFechar={() => setEdicao(null)} onSalvar={async (d) => { try { await salvarCadastro(empresaId, key, d, edicao === 'novo' ? undefined : edicao); setEdicao(null); } catch (e) { return e instanceof Error ? e.message : 'Erro ao salvar.'; } }} />}
    </div>
  );
}

function Formulario({ ent, refs, registro, onFechar, onSalvar }: { ent: EntidadeCad; refs: Record<string, RegistroCad[]>; registro?: RegistroCad; onFechar: () => void; onSalvar: (d: Record<string, unknown>) => Promise<string | void> }) {
  const [v, setV] = useState<Record<string, unknown>>(() => Object.fromEntries(ent.campos.map((c) => [c.k, registro?.[c.k] ?? (c.t === 'bool' ? false : '')])));
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const faltando = ent.campos.filter((c) => c.obrigatorio && !String(v[c.k] ?? '').trim());
  const set = (k: string, x: unknown) => setV((a) => ({ ...a, [k]: x }));
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onFechar}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-lg max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-extrabold text-ink mb-3">{registro ? 'Editar' : 'Novo'} {ent.singular}</h3>
        <div className="grid grid-cols-2 gap-3">
          {ent.campos.map((c) => (
            <div key={c.k} className={c.t === 'area' || c.k === 'nome' || c.k === 'endereco' ? 'col-span-2' : ''}>
              <label className={rotulo}>{c.l}{c.obrigatorio && ' *'}</label>
              {c.t === 'area' ? <textarea className="w-full rounded-lg border border-line px-3 py-2 text-sm min-h-[70px]" value={String(v[c.k] ?? '')} onChange={(e) => set(c.k, e.target.value)} />
                : c.t === 'select' ? <select className={campoCls} value={String(v[c.k] ?? '')} onChange={(e) => set(c.k, e.target.value)}><option value="">—</option>{c.opcoes?.map((o) => <option key={o}>{o}</option>)}</select>
                : c.t === 'ref' ? <select className={campoCls} value={String(v[c.k] ?? '')} onChange={(e) => set(c.k, e.target.value)}><option value="">—</option>{(refs[c.ref as string] ?? []).map((r) => <option key={r.id} value={r.id}>{String(r.nome ?? r.id)}</option>)}</select>
                : c.t === 'bool' ? <input type="checkbox" checked={!!v[c.k]} onChange={(e) => set(c.k, e.target.checked)} />
                : c.t === 'numero' ? <input className={campoCls} inputMode="decimal" value={String(v[c.k] ?? '')} onChange={(e) => set(c.k, e.target.value.replace(',', '.'))} />
                : <input type={c.t === 'data' ? 'date' : 'text'} className={campoCls} value={String(v[c.k] ?? '')} onChange={(e) => set(c.k, e.target.value)} />}
              {c.dica && <p className="text-[11px] text-ink-soft mt-0.5">{c.dica}</p>}
            </div>
          ))}
        </div>
        {erro && <p className="text-sm text-red-600 mt-3">{erro}</p>}
        <div className="flex gap-2 mt-4">
          <button disabled={faltando.length > 0 || salvando} onClick={async () => {
            setSalvando(true);
            const d: Record<string, unknown> = { ...v };
            for (const c of ent.campos) if (c.t === 'numero' && d[c.k] !== '') d[c.k] = Number(d[c.k]);
            const r = await onSalvar(d); if (r) setErro(r); setSalvando(false);
          }} className="flex-1 rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold h-10 disabled:opacity-40">Salvar</button>
          <button onClick={onFechar} className="rounded-xl border border-line text-sm font-bold px-4">Cancelar</button>
        </div>
        {faltando.length > 0 && <p className="text-xs text-ink-soft mt-2">Preencha: {faltando.map((c) => c.l).join(', ')}.</p>}
      </div>
    </div>
  );
}
