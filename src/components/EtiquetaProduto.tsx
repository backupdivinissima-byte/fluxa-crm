import { useState } from 'react';
import JsBarcode from 'jsbarcode';

export interface DadosEtiqueta { sku: string; nome: string; gtin?: string; preco?: number; precoPromocional?: number }
const moeda = (n?: number) => (n === undefined ? '' : `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

const TAMANHOS: Record<string, { l: number; a: number; nome: string; col?: number }> = {
  '29x12x3': { l: 29, a: 12, col: 3, nome: '29 × 12 mm — 3 por linha (Zebra TLP 2844)' },
  '29x12': { l: 29, a: 12, nome: '29 × 12 mm — 1 por linha' },
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
export function imprimirEtiquetas(d: DadosEtiqueta, copias: number, tamanho: string, promo = false) {
  const valor = promo ? d.precoPromocional : d.preco;
  const precoTxt = valor === undefined ? '' : `${promo ? 'PROMO ' : ''}${moeda(valor)}`;
  const t = TAMANHOS[tamanho] ?? TAMANHOS['29x12x3'];
  const codigo = d.sku.trim();
  const barras = svgBarras(codigo);
  const nome = esc(d.nome.toUpperCase());
  const um = `<div class="et"><div class="nm">${nome}</div><div class="br">${barras}</div><div class="cd"><span>${esc(d.sku)}</span>${precoTxt ? `<span>${esc(precoTxt)}</span>` : ''}</div></div>`;
  const n = Math.max(1, copias);
  const col = t.col ?? 1;
  const GL = 3, GV = 3, M = 1.5; // espaço entre etiquetas (mm) e margem lateral do rolo
  const largura = col * t.l + (col - 1) * GL + 2 * M;
  const altura = t.a + (col > 1 ? GV : 0);
  const linhas: string[] = [];
  for (let i = 0; i < n; i += col) {
    const itens = Array.from({ length: Math.min(col, n - i) }, () => um).join('');
    linhas.push(`<div class="ln">${itens}</div>`);
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Etiqueta ${esc(d.sku)}</title><style>
@page{size:${largura}mm ${altura}mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#000}
.ln{width:${largura}mm;height:${altura}mm;padding:0 ${M}mm;display:flex;gap:${GL}mm;align-items:flex-start;page-break-after:always;break-after:page;overflow:hidden}
.et{width:${t.l}mm;height:${t.a}mm;padding:${t.a * 0.07}mm ${t.l * 0.05}mm;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden}
.nm{font-size:${t.a * 0.2}mm;font-weight:700;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.br{flex:1;margin:${t.a * 0.04}mm 0}.cd{display:flex;justify-content:space-between;font-size:${t.a * 0.18}mm;font-weight:700;letter-spacing:.3mm}
</style></head><body>${linhas.join('')}</body></html>`;
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
  const temPromo = !!dados.precoPromocional && dados.precoPromocional > 0;
  const [promo, setPromo] = useState(false);
  const [tamanho, setTamanho] = useState(() => { try { return localStorage.getItem('fluxa_etq_tam') || '29x12x3'; } catch { return '29x12x3'; } });
  const campo = 'w-full rounded-lg border border-line px-3 h-10 text-sm bg-white';
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onFechar}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-extrabold text-ink mb-1">{titulo ?? 'Etiqueta do produto'}</h3>
        <p className="text-sm text-ink-soft mb-3">{dados.nome} <span className="font-mono">({dados.sku})</span></p>
        <div className="border border-line rounded-lg p-2 mb-3 bg-slate-50">
          <div className="text-[11px] font-bold">{dados.nome.toUpperCase()}</div>
          <div className="h-8 my-1 bg-[repeating-linear-gradient(90deg,#000_0_2px,#fff_2px_4px,#000_4px_5px,#fff_5px_8px)]" />
          <div className="text-[11px] font-bold flex justify-between"><span>{dados.sku}</span><span>{promo && temPromo ? `PROMO ${moeda(dados.precoPromocional)}` : moeda(dados.preco)}</span></div>
        </div>
        <div className="flex gap-2 mb-3">
          <button onClick={() => setPromo(false)} className={`flex-1 h-9 rounded-lg text-sm font-bold border ${!promo ? 'bg-emerald-600 text-white border-emerald-600' : 'border-line text-ink-soft'}`}>Etiqueta normal</button>
          <button disabled={!temPromo} onClick={() => setPromo(true)} title={temPromo ? '' : 'Cadastre o preço promocional no produto'} className={`flex-1 h-9 rounded-lg text-sm font-bold border disabled:opacity-40 ${promo ? 'bg-orange-500 text-white border-orange-500' : 'border-line text-ink-soft'}`}>🔥 Etiqueta promoção</button>
        </div>
        {!temPromo && <p className="text-[11px] text-ink-soft -mt-1 mb-3">Para gerar a etiqueta de promoção, preencha o “Preço promocional” no cadastro do produto.</p>}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div><label className="block text-xs font-bold text-ink-soft uppercase mb-1">Quantidade</label>
            <input className={campo} type="number" min={1} value={copias} onChange={(e) => setCopias(e.target.value)} /></div>
          <div><label className="block text-xs font-bold text-ink-soft uppercase mb-1">Tamanho</label>
            <select className={campo} value={tamanho} onChange={(e) => { setTamanho(e.target.value); try { localStorage.setItem('fluxa_etq_tam', e.target.value); } catch { /* ignora */ } }}>
              {Object.entries(TAMANHOS).map(([k, v]) => <option key={k} value={k}>{v.nome}</option>)}
            </select></div>
        </div>
        {(TAMANHOS[tamanho]?.col ?? 1) > 1 && <p className="text-[11px] text-ink-soft mb-3">Na tela de impressão, escolha a <b>Zebra TLP 2844</b>, margens “Nenhuma” e escala 100%. A quantidade é de etiquetas: elas saem de 3 em 3 por linha.</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={onFechar} className="rounded-xl border border-line text-sm font-bold px-4 h-10">Fechar</button>
          <button onClick={() => imprimirEtiquetas(dados, parseInt(copias, 10) || 1, tamanho, promo && temPromo)} className="rounded-xl bg-emerald-600 text-white text-sm font-bold px-5 h-10">🏷️ Imprimir etiqueta</button>
        </div>
      </div>
    </div>
  );
}
