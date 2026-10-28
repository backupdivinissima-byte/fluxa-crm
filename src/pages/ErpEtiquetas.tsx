import { useMemo, useRef, useState } from 'react';
import { imprimirLote, type ItemLote } from '../components/EtiquetaProduto';
import { formatarMoeda, parseValorBR } from '../lib/crmLogic';
import type { Produto } from '../types';

const campo = 'w-full rounded-lg border border-line px-3 h-10 text-sm bg-white';
const rotulo = 'block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1';

/** Gerar etiquetas: digita (ou bipa) o código, a quantidade e o tipo; monta a fila e imprime tudo de uma vez. */
export default function ErpEtiquetas({ produtos }: { produtos: Produto[] }) {
  const [codigo, setCodigo] = useState('');
  const [qtd, setQtd] = useState('1');
  const [promo, setPromo] = useState(false);
  const [fila, setFila] = useState<{ p: Produto; copias: number; promo: boolean }[]>([]);
  const [aviso, setAviso] = useState('');
  const refCodigo = useRef<HTMLInputElement>(null);
  const refQtd = useRef<HTMLInputElement>(null);

  const achado = useMemo(() => {
    const c = codigo.trim();
    if (!c) return undefined;
    return produtos.find((p) => p.sku.toLowerCase() === c.toLowerCase() || (p.gtin ?? '').trim() === c);
  }, [codigo, produtos]);
  const temPromo = !!achado?.precoPromocional && achado.precoPromocional > 0;
  const total = fila.reduce((t, f) => t + f.copias, 0);

  function adicionar() {
    if (!achado) { setAviso(codigo.trim() ? `Código "${codigo.trim()}" não encontrado.` : 'Digite ou bipe um código.'); return; }
    const n = Math.round(parseValorBR(qtd));
    if (Number.isNaN(n) || n <= 0) { setAviso('Informe a quantidade de etiquetas.'); return; }
    if (promo && !temPromo) { setAviso('Esse produto não tem preço promocional cadastrado.'); return; }
    setAviso('');
    setFila((f) => {
      const i = f.findIndex((x) => x.p.id === achado.id && x.promo === promo);
      if (i >= 0) return f.map((x, k) => (k === i ? { ...x, copias: x.copias + n } : x));
      return [...f, { p: achado, copias: n, promo }];
    });
    setCodigo(''); setQtd('1');
    refCodigo.current?.focus();
  }

  function imprimir() {
    const itens: ItemLote[] = fila.map((f) => ({ d: { sku: f.p.sku, nome: f.p.nome, gtin: f.p.gtin, preco: f.p.preco, precoPromocional: f.p.precoPromocional }, copias: f.copias, promo: f.promo }));
    imprimirLote(itens);
  }

  return (
    <>
      <div className="rounded-xl border border-line bg-white p-4 mb-3">
        <div className="flex gap-3 flex-wrap items-end">
          <div className="flex-1 min-w-[220px]">
            <label className={rotulo}>Código do produto</label>
            <input ref={refCodigo} autoFocus className={`${campo} text-base font-mono`} placeholder="Digite ou bipe o código e tecle Enter" value={codigo}
              onChange={(e) => { setCodigo(e.target.value); setAviso(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (achado) { refQtd.current?.focus(); refQtd.current?.select(); } else adicionar(); } }} />
          </div>
          <div className="w-32">
            <label className={rotulo}>Qtd. etiquetas</label>
            <input ref={refQtd} inputMode="numeric" className={`${campo} text-base font-bold text-center`} value={qtd} onChange={(e) => setQtd(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); adicionar(); } }} />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setPromo(false)} className={`h-10 px-3 rounded-lg text-sm font-bold border ${!promo ? 'bg-emerald-600 text-white border-emerald-600' : 'border-line text-ink-soft'}`}>Padrão</button>
            <button onClick={() => setPromo(true)} className={`h-10 px-3 rounded-lg text-sm font-bold border ${promo ? 'bg-orange-500 text-white border-orange-500' : 'border-line text-ink-soft'}`}>🔥 Promoção</button>
          </div>
          <button onClick={adicionar} className="rounded-xl bg-emerald-600 text-white text-sm font-bold px-4 h-10">Adicionar</button>
        </div>
        {achado && (
          <p className="mt-3 text-sm text-ink"><b>{achado.nome}</b> — venda {formatarMoeda(achado.preco)}{temPromo ? ` · promoção ${formatarMoeda(achado.precoPromocional as number)}` : ' · sem preço promocional'}</p>
        )}
        {aviso && <p className="mt-2 text-sm text-red-600 font-bold">{aviso}</p>}
      </div>

      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <p className="text-sm text-ink-soft"><b className="text-ink">{total}</b> etiqueta(s) na fila · {fila.length} produto(s)</p>
        <div className="ml-auto flex gap-2">
          <button disabled={!fila.length} onClick={() => setFila([])} className="rounded-xl border border-line text-sm font-bold px-4 h-10 disabled:opacity-40">Limpar fila</button>
          <button disabled={!fila.length} onClick={imprimir} className="rounded-xl bg-emerald-600 text-white text-sm font-bold px-5 h-10 disabled:opacity-40">🏷️ Imprimir etiquetas</button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-ink-soft bg-surface"><tr>
            <th className="text-left p-3">Código</th><th className="text-left p-3">Descrição</th><th className="text-left p-3">Tipo</th><th className="text-right p-3">Preço na etiqueta</th><th className="text-right p-3 w-28">Etiquetas</th><th className="p-3" />
          </tr></thead>
          <tbody>
            {fila.map((f, i) => (
              <tr key={`${f.p.id}-${f.promo}`} className="border-t border-line">
                <td className="p-3 font-mono text-xs">{f.p.sku}</td>
                <td className="p-3 font-semibold text-ink">{f.p.nome}</td>
                <td className="p-3">{f.promo ? <span className="text-orange-600 font-bold">Promoção</span> : 'Padrão'}</td>
                <td className="p-3 text-right">{formatarMoeda(f.promo ? (f.p.precoPromocional ?? 0) : f.p.preco)}</td>
                <td className="p-2 text-right"><input inputMode="numeric" className="w-20 rounded-lg border border-line px-2 h-9 text-sm text-right" value={f.copias}
                  onChange={(e) => { const n = Math.max(1, Math.round(parseValorBR(e.target.value)) || 1); setFila((a) => a.map((x, k) => (k === i ? { ...x, copias: n } : x))); }} /></td>
                <td className="p-3 text-right"><button className="text-xs font-bold text-red-600" onClick={() => setFila((a) => a.filter((_, k) => k !== i))}>Remover</button></td>
              </tr>
            ))}
            {fila.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-ink-soft">Nenhuma etiqueta na fila. Digite o código acima e a quantidade.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-soft mt-2">Formato 29 × 12 mm, 3 por linha. Na tela de impressão escolha a Zebra TLP 2844, margens “Nenhuma” e escala 100%.</p>
    </>
  );
}
