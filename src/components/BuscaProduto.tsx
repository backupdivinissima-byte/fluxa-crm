import { useMemo, useState } from 'react';
import type { Produto } from '../types';

/** Campo de busca de produto: digite parte da descrição, do código (SKU), do GTIN ou da marca e escolha na lista. */
export default function BuscaProduto({ produtos, aoEscolher, placeholder = 'Buscar produto por nome, código ou GTIN' }: { produtos: Produto[]; aoEscolher: (p: Produto) => void; placeholder?: string }) {
  const [q, setQ] = useState('');
  const [aberto, setAberto] = useState(false);
  const achados = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return produtos.slice(0, 8);
    return produtos.filter((p) => p.nome.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t) || (p.gtin ?? '').includes(t) || (p.marca ?? '').toLowerCase().includes(t)).slice(0, 12);
  }, [produtos, q]);
  return (
    <div className="relative flex-1">
      <input
        className="w-full rounded-lg border border-line px-3 h-10 text-sm bg-white"
        placeholder={placeholder}
        value={q}
        onChange={(e) => { setQ(e.target.value); setAberto(true); }}
        onFocus={() => setAberto(true)}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
      />
      {aberto && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-line rounded-lg shadow-lg max-h-64 overflow-auto">
          {achados.map((p) => (
            <button key={p.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { aoEscolher(p); setQ(''); setAberto(false); }} className="w-full text-left px-3 py-2 text-sm hover:bg-surface border-b border-line last:border-0 flex items-center gap-2">
              {p.imagemUrl ? <img src={p.imagemUrl} alt="" className="w-8 h-8 rounded object-cover" /> : <span className="w-8 h-8 rounded bg-slate-100 shrink-0" />}
              <span className="min-w-0 flex-1"><b className="font-mono text-xs">{p.sku}</b> — {p.nome}</span>
              <span className="text-xs text-ink-soft shrink-0">estoque {p.estoque}</span>
            </button>
          ))}
          {achados.length === 0 && <div className="px-3 py-2 text-sm text-ink-soft">Nenhum produto encontrado.</div>}
        </div>
      )}
    </div>
  );
}
