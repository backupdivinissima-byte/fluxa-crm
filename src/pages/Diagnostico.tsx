import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../lib/firebase';
import { totalGeralReal } from '../lib/crmLogic';
import type { Cliente } from '../types';
import REF from '../tmp/refMov.json';
import FIX from '../tmp/fixNov.json';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { recalcularAgregadosDeOrigens } from '../lib/importarPlanilha';

const f = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Página técnica (administrador): confere de onde vem cada real do "Vendas total", direto do banco, sem filtros. */
export default function Diagnostico({ compacto = false, semRestaurar = false }: { compacto?: boolean; semRestaurar?: boolean }) {
  const { empresa } = useAuth();
  const [txt, setTxt] = useState('Carregando…');
  const [msg, setMsg] = useState('');
  async function restaurar() {
    if (!empresa?.id) return;
    setMsg('Restaurando…');
    let n = 0, v = 0;
    for (const [cod, e] of Object.entries(FIX as Record<string, Record<string, unknown>>)) {
      const ref = doc(db, 'empresas', empresa.id, 'clientes', cod);
      const sn = await getDoc(ref);
      if (!sn.exists()) continue;
      const origens = ((sn.data() as Cliente).origensImportacao ?? {}) as Record<string, any>;
      if (origens['mes-2025-11']) continue;
      origens['mes-2025-11'] = e;
      const ag = recalcularAgregadosDeOrigens(origens);
      await setDoc(ref, JSON.parse(JSON.stringify({ origensImportacao: origens, totalGeral: ag.totalGeral, dtUltCompra: ag.dtUltCompra, cod_vendedor: ag.cod_vendedor, vend_nome: ag.vend_nome })), { merge: true });
      n++; v += Number(e.totalGeral);
    }
    setMsg(`Restaurados ${n} clientes · R$ ${f(v)}. Recarregue a página (F5).`);
  }
  useEffect(() => {
    if (compacto && !semRestaurar && empresa?.id) void restaurar();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresa?.id]);
  useEffect(() => {
    if (!empresa?.id) return;
    (async () => {
      const snap = await getDocs(collection(db, 'empresas', empresa.id, 'clientes'));
      const cl = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Cliente);
      const L: string[] = [];
      L.push(`Clientes no banco (sem filtro): ${cl.length}`);
      const semDt = cl.filter((c) => !c.dtUltCompra);
      L.push(`Clientes SEM dtUltCompra (somem da lista ordenada do app): ${semDt.length} · soma ${f(semDt.reduce((s, c) => s + (totalGeralReal(c) ?? 0), 0))}`);
      L.push(`Total real (todos): ${f(cl.reduce((s, c) => s + (totalGeralReal(c) ?? 0), 0))}`);
      L.push(`Total real (só com dtUltCompra = o que o app mostra): ${f(cl.filter((c) => !!c.dtUltCompra).reduce((s, c) => s + (totalGeralReal(c) ?? 0), 0))}`);
      L.push(`Soma do campo totalGeral cru: ${f(cl.reduce((s, c) => s + (c.totalGeral ?? 0), 0))}`);
      // por mês (origem mes-AAAA-MM), bruto e líquido
      const mes = new Map<string, { t: number; l: number; p: number; n: number }>();
      const outras = new Map<string, number>();
      let totalSemMes = 0;
      const vend = new Map<string, number>();
      let somaMesesVend = 0;
      let mesesSemVend = 0;
      for (const c of cl) {
        for (const [k, o] of Object.entries(c.origensImportacao ?? {})) {
          const m = /^mes-(\d{4}-\d{2})$/.exec(k);
          if (m) {
            const a = mes.get(m[1]) ?? { t: 0, l: 0, p: 0, n: 0 };
            a.t += o.totalGeral ?? 0; a.l += o.liquido ?? 0; a.p += o.pedidos ?? 0; a.n += 1;
            mes.set(m[1], a);
            if (o.porVendedor) for (const x of o.porVendedor) { const n = `${x.cod ?? ''} ${x.nome ?? ''}`.trim(); vend.set(n, (vend.get(n) ?? 0) + x.valor); somaMesesVend += x.valor; }
            else mesesSemVend += o.totalGeral ?? 0;
          } else {
            outras.set(k, (outras.get(k) ?? 0) + (o.totalGeral ?? 0));
            totalSemMes += o.totalGeral ?? 0;
          }
        }
      }
      L.push('', `== Origens que NÃO são "mes-AAAA-MM" (arquivo/sem data): ${outras.size} · soma ${f(totalSemMes)}`);
      [...outras.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, v]) => L.push(`  ${k}: ${f(v)}`));
      L.push('', '== Por mês (bruto = Vlr. Total | líquido | pedidos | clientes)');
      let totMes = 0, totLiq = 0;
      [...mes.entries()].sort().forEach(([k, a]) => { totMes += a.t; totLiq += a.l; L.push(`${k}  ${f(a.t)} | ${f(a.l)} | ${a.p} | ${a.n}`); });
      L.push(`TOTAL meses: bruto ${f(totMes)} | líquido ${f(totLiq)}`);
      L.push('', `== Por vendedor (somando porVendedor dos meses) — soma ${f(somaMesesVend)}; meses SEM detalhe de vendedor: ${f(mesesSemVend)}`);
      [...vend.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => L.push(`  ${k}: ${f(v)}`));
      // meses em que totalGeral do mês difere da soma de seus vendedores
      let dif = 0; const exemplos: string[] = [];
      for (const c of cl) for (const [k, o] of Object.entries(c.origensImportacao ?? {})) {
        if (!o.porVendedor) continue;
        const s = o.porVendedor.reduce((q, x) => q + x.valor, 0);
        if (Math.abs(s - (o.totalGeral ?? 0)) > 0.01) { dif += (o.totalGeral ?? 0) - s; if (exemplos.length < 8) exemplos.push(`${c.cod} ${c.nome} ${k}: total ${f(o.totalGeral ?? 0)} vs vendedores ${f(s)}`); }
      }
      L.push('', `== Meses cujo total difere da soma dos vendedores: diferença acumulada ${f(dif)}`, ...exemplos);
      // clientes cujo totalGeralReal difere da soma dos meses (regra do "maior por mês" etc.)
      let d2 = 0; const ex2: string[] = [];
      for (const c of cl) {
        const soma = Object.values(c.origensImportacao ?? {}).reduce((s, o) => s + (o.totalGeral ?? 0), 0);
        const real = totalGeralReal(c) ?? 0;
        if (Object.keys(c.origensImportacao ?? {}).length && Math.abs(soma - real) > 0.01) { d2 += soma - real; if (ex2.length < 8) ex2.push(`${c.cod} ${c.nome}: soma das origens ${f(soma)} vs real ${f(real)}`); }
      }
      L.push('', `== Clientes em que "totalGeralReal" descarta valor das origens: diferença acumulada ${f(d2)}`, ...ex2);
      // Vendedor x mês (jun a out/2026) e por ano, para achar onde mora cada diferença
      const vm = new Map<string, Map<string, number>>();
      for (const c of cl) for (const [k, o] of Object.entries(c.origensImportacao ?? {})) {
        const m = /^mes-(\d{4}-\d{2})$/.exec(k);
        if (!m || !o.porVendedor) continue;
        const chaveMes = m[1] >= '2026-06' ? m[1] : m[1].slice(0, 4);
        for (const x of o.porVendedor) {
          const n = (x.nome ?? x.cod ?? '—').slice(0, 14);
          const mp = vm.get(n) ?? new Map<string, number>();
          mp.set(chaveMes, (mp.get(chaveMes) ?? 0) + x.valor);
          vm.set(n, mp);
        }
      }
      L.push('', '== VENDEDOR x PERÍODO (anos fechados e jun–out/2026)');
      for (const [n, mp] of [...vm.entries()].sort()) L.push(`  ${n}: ` + [...mp.entries()].sort().map(([k, v]) => `${k} ${f(v)}`).join(' | '));
      // Conferência cliente a cliente contra o relatório Movimentações (01/2024 a 05/2026)
      const ref = REF as Record<string, Record<string, number>>;
      const porCod = new Map<string, Cliente>();
      for (const c of cl) porCod.set(String(c.cod), c);
      const difMes = new Map<string, number>();
      const itens: { d: number; txt: string }[] = [];
      let ausentes = 0, valAus = 0;
      for (const [cod, ms] of Object.entries(ref)) {
        const c = porCod.get(cod);
        for (const [m, v] of Object.entries(ms)) {
          const db = c?.origensImportacao?.['mes-' + m]?.totalGeral ?? 0;
          const d = db - v;
          if (Math.abs(d) < 0.01) continue;
          if (!c) { ausentes++; valAus += v; }
          difMes.set(m, (difMes.get(m) ?? 0) + d);
          itens.push({ d, txt: `${cod} ${(c?.nome ?? '(NÃO EXISTE)').slice(0, 22)} ${m}: banco ${f(db)} x relatório ${f(v)}` });
        }
      }
      L.push('', `== CONFERÊNCIA com Movimentações: ${itens.length} cliente-mês diferentes · clientes ausentes: ${ausentes} (${f(valAus)})`);
      [...difMes.entries()].sort().forEach(([m, d]) => L.push(`  dif ${m}: ${f(d)}`));
      itens.sort((a, b) => a.d - b.d).slice(0, 45).forEach((x) => L.push('  ' + x.txt));
      setTxt(L.join('\n'));
    })().catch((e) => setTxt(`Erro: ${e?.message ?? e}`));
  }, [empresa?.id]);
  return compacto ? (
    <div>
    <pre id="diag" className="rounded-xl border-2 border-amber-400 bg-amber-50 p-3 text-[10px] leading-[1.25] whitespace-pre-wrap font-mono [column-count:3] [column-gap:16px]">{'DIAGNÓSTICO TEMPORÁRIO\n' + txt}</pre>
    </div>
  ) : (
    <pre id="diag" className="p-6 text-xs whitespace-pre-wrap font-mono">{txt}</pre>
  );
}
