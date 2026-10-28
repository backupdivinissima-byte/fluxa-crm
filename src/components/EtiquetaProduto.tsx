import { useState } from 'react';
import JsBarcode from 'jsbarcode';

export interface DadosEtiqueta { sku: string; nome: string; gtin?: string }

const TAMANHOS: Record<string, { l: number; a: number; nome: string }> = {
  '29x12': { l: 29, a: 12, nome: '29 × 12 mm (padrão)' },
  '50x25': { l: 50, a: 25, nome: '50 × 25 mm' },
  '40x25': { l: 40, a: 25, nome: '40 × 25 mm' },
  '60x30': { l: 60, a: 30, nome: '60 × 30 mm' },
  '100x50': { l: 100, a: 50, nome: '100 × 50 mm' },
};

function svgBarras(valor: string): string {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  try {
    JsBarcode(el, valor, { format: 'CODE128', displayValue: false, margin: 0, height: 40, width: 2 });
  } catch { return ''; }
  el.setAttribute('preserveAspectRatio', 'none');
  el.setAttribute('style', 'width:100%;height:100%');
  return el.outerHTML;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** Imprime etiquetas no formato: descrição em cima, código de barras e código embaixo. */
export function imprimirEtiquetas(d: DadosEtiqueta, copias: number, tamanho: string) {
  const t = TAMANHOS[tamanho] ?? TAMANHOS['29x12'];
  const codigo = (d.gtin?.trim() || d.sku).trim();
  const barras = svgBarras(codigo);
  const nome = esc(d.nome.toUpperCase());
  const um = `<div class="et"><div class="nm">${nome}</div><div class="br">${barras}</div><div class="cd"><span>${esc(d.sku)}</span>${d.gtin?.trim() ? `<span>${esc(d.gtin.trim())}</span>` : ''}</div></div>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Etiqueta ${esc(d.sku)}</title><style>
@page{size:${t.l}mm ${t.a}mm;margin:0}*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#000}
.et{width:${t.l}mm;height:${t.a}mm;padding:${t.a * 0.07}mm ${t.l * 0.05}mm;page-break-after:always;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden}
.nm{font-size:${t.a * 0.2}mm;font-weight:700;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.br{flex:1;margin:${t.a * 0.04}mm 0}.cd{display:flex;justify-content:space-between;font-size:${t.a * 0.18}mm;font-weight:700;letter-spacing:.3mm}
</style></head><body>${Array.from({ length: Math.max(1, copias) }, () => um).join('')}</body></html>`;
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  const doc = f.contentDocument;
  if (!doc) return;
  doc.open(); doc.write(html); doc.close();
  setTimeout(() => { f.contentWindow?.focus(); f.contentWindow?.print(); setTimeout(() => f.remove(), 2000); }, 300);
}

/** Janela "Produto salvo — imprimir etiqueta". */
export default function EtiquetaDialogo({ dados, titulo, onFechar }: { dados: DadosEtiqueta; titulo?: string; onFechar: () => void }) {
  const [copias, setCopias] = useState('1');
  const [tamanho, setTamanho] = useState(() => { try { return localStorage.getItem('fluxa_etq_tam') || '29x12'; } catch { return '29x12'; } });
  const campo = 'w-full rounded-lg border border-line px-3 h-10 text-sm bg-white';
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onFechar}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-extrabold text-ink mb-1">{titulo ?? 'Etiqueta do produto'}</h3>
        <p className="text-sm text-ink-soft mb-3">{dados.nome} <span className="font-mono">({dados.sku})</span></p>
        <div className="border border-line rounded-lg p-2 mb-3 bg-slate-50">
          <div className="text-[11px] font-bold">{dados.nome.toUpperCase()}</div>
          <div className="h-8 my-1 bg-[repeating-linear-gradient(90deg,#000_0_2px,#fff_2px_4px,#000_4px_5px,#fff_5px_8px)]" />
          <div className="text-[11px] font-bold flex justify-between"><span>{dados.sku}</span><span>{dados.gtin ?? ''}</span></div>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div><label className="block text-xs font-bold text-ink-soft uppercase mb-1">Quantidade</label>
            <input className={campo} type="number" min={1} value={copias} onChange={(e) => setCopias(e.target.value)} /></div>
          <div><label className="block text-xs font-bold text-ink-soft uppercase mb-1">Tamanho</label>
            <select className={campo} value={tamanho} onChange={(e) => { setTamanho(e.target.value); try { localStorage.setItem('fluxa_etq_tam', e.target.value); } catch { /* ignora */ } }}>
              {Object.entries(TAMANHOS).map(([k, v]) => <option key={k} value={k}>{v.nome}</option>)}
            </select></div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onFechar} className="rounded-xl border border-line text-sm font-bold px-4 h-10">Fechar</button>
          <button onClick={() => imprimirEtiquetas(dados, parseInt(copias, 10) || 1, tamanho)} className="rounded-xl bg-emerald-600 text-white text-sm font-bold px-5 h-10">🏷️ Imprimir etiqueta</button>
        </div>
      </div>
    </div>
  );
}
