import { useEffect, useState } from 'react';
import { collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../lib/firebase';
import type { Cliente } from '../types';
import { recalcularAgregadosDeOrigens } from '../lib/importarPlanilha';

const VERSAO = 'v1';
const EMPRESAS: Record<string, () => Promise<{ default: unknown }>> = {
  Kb5nOo3SK0dAi3SsHk20Y0Oa1aE3: () => import('../tmp/refCarla.json'),
};

/** Reconcilia (uma vez) o histórico de vendas da empresa com os relatórios de Movimentações já conferidos. */
export default function Reconciliador() {
  const { empresa } = useAuth();
  const [msg, setMsg] = useState('');
  useEffect(() => {
    const id = empresa?.id;
    if (!id || !EMPRESAS[id]) return;
    const chave = `reconc-${id}-${VERSAO}`;
    try { if (localStorage.getItem(chave)) return; } catch { /* ignore */ }
    (async () => {
      setMsg('Conferindo histórico de vendas…');
      const ref = (await EMPRESAS[id]()).default as Record<string, Record<string, Record<string, unknown>>>;
      const snap = await getDocs(collection(db, 'empresas', id, 'clientes'));
      let alterados = 0, valor = 0, semCliente = 0;
      const tarefas: (() => Promise<void>)[] = [];
      const existentes = new Set<string>();
      for (const d of snap.docs) {
        existentes.add(d.id);
        const meses = ref[d.id];
        if (!meses) continue;
        const origens = ((d.data() as Cliente).origensImportacao ?? {}) as Record<string, any>;
        let mudou = false;
        for (const [mk, e] of Object.entries(meses)) {
          const k = `mes-${mk}`;
          const atual = origens[k];
          if (!atual || Math.abs((atual.totalGeral ?? 0) - Number(e.totalGeral)) > 0.5) {
            valor += Number(e.totalGeral) - (atual?.totalGeral ?? 0);
            origens[k] = { ...(atual ?? {}), ...e };
            mudou = true;
          }
        }
        if (!mudou) continue;
        alterados++;
        const ag = recalcularAgregadosDeOrigens(origens);
        const payload = JSON.parse(JSON.stringify({ origensImportacao: origens, totalGeral: ag.totalGeral, dtUltCompra: ag.dtUltCompra, cod_vendedor: ag.cod_vendedor, vend_nome: ag.vend_nome }));
        tarefas.push(() => setDoc(doc(db, 'empresas', id, 'clientes', d.id), payload, { merge: true }));
      }
      for (const cod of Object.keys(ref)) if (!existentes.has(cod)) semCliente++;
      for (let i = 0; i < tarefas.length; i += 25) {
        await Promise.all(tarefas.slice(i, i + 25).map((t) => t()));
        setMsg(`Atualizando histórico… ${Math.min(i + 25, tarefas.length)}/${tarefas.length}`);
      }
      try { localStorage.setItem(chave, '1'); } catch { /* ignore */ }
      setMsg(`Histórico conferido: ${alterados} clientes ajustados (${valor >= 0 ? '+' : ''}R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}); ${semCliente} sem cadastro. Recarregue (F5).`);
    })().catch((e) => setMsg('Erro na conferência: ' + (e?.message ?? e)));
  }, [empresa?.id]);
  return msg ? <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{msg}</div> : null;
}
