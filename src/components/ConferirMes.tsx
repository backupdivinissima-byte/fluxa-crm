import { useState } from 'react';
import { ouvirClientes } from '../lib/crmData';
import { formatarMoeda } from '../lib/crmLogic';

interface Resumo {
  clientes: number;
  comOrigem: number;
  comPorVendedor: number;
  semPorVendedor: number;
  valorSemPorVendedor: number;
  total: number;
  somaPorVendedor: number;
  pedidos: number;
  semPedidos: number;
  porVendedor: Array<{ nome: string; valor: number; pedidos: number }>;
  antigas: number;
}

/** Conferência somente leitura: mostra o que está gravado para um mês, por vendedor (para comparar com a Curva ABC do ERP). */
export default function ConferirMes({ empresaId }: { empresaId: string }) {
  const [mes, setMes] = useState('');
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [carregando, setCarregando] = useState(false);

  function conferir() {
    if (!/^\d{4}-\d{2}$/.test(mes)) return;
    setCarregando(true);
    let unsub: (() => void) | undefined;
    unsub = ouvirClientes(empresaId, (clientes) => {
      const r: Resumo = { clientes: clientes.length, comOrigem: 0, comPorVendedor: 0, semPorVendedor: 0, valorSemPorVendedor: 0, total: 0, somaPorVendedor: 0, pedidos: 0, semPedidos: 0, porVendedor: [], antigas: 0 };
      const mapa = new Map<string, { nome: string; valor: number; pedidos: number }>();
      for (const c of clientes) {
        const o = c.origensImportacao ?? {};
        for (const [k, v] of Object.entries(o)) if (!k.startsWith('mes-') && v.dtUltCompra?.startsWith(mes)) r.antigas++;
        const m = o[`mes-${mes}`];
        if (!m) continue;
        r.comOrigem++;
        r.total += m.totalGeral ?? 0;
        if (m.porVendedor) {
          r.comPorVendedor++;
          for (const x of m.porVendedor) {
            const nome = `${x.cod ?? ''} - ${x.nome ?? '(sem nome)'}`;
            const atual = mapa.get(nome) ?? { nome, valor: 0, pedidos: 0 };
            atual.valor += x.valor;
            atual.pedidos += x.pedidos ?? 0;
            mapa.set(nome, atual);
            r.somaPorVendedor += x.valor;
            r.pedidos += x.pedidos ?? 0;
          }
        } else {
          r.semPorVendedor++;
          r.valorSemPorVendedor += m.totalGeral ?? 0;
        }
        if (m.pedidos === undefined) r.semPedidos++;
      }
      r.porVendedor = [...mapa.values()].sort((a, b) => b.valor - a.valor);
      setResumo(r);
      setCarregando(false);
      unsub?.();
    });
  }

  return (
    <div className="bg-white border border-line rounded-2xl p-6 mt-6">
      <h2 className="text-sm font-extrabold text-ink mb-1">Conferir um mês importado</h2>
      <p className="text-xs text-ink-soft mb-3">
        Mostra o que está gravado no Fluxa para um mês, por vendedor, para comparar com a Curva ABC do ERP. Só leitura — não altera nada.
      </p>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="rounded-lg border border-line px-3 py-2 text-sm" />
        <button
          type="button"
          onClick={conferir}
          disabled={!mes || carregando}
          className="rounded-xl bg-teal-600 text-white text-sm font-bold px-4 py-2 disabled:opacity-40"
        >
          {carregando ? 'Lendo...' : 'Conferir'}
        </button>
      </div>
      {resumo && (
        <div className="text-xs text-ink space-y-1">
          <p>
            Clientes com venda no mês: <b>{resumo.comOrigem}</b> de {resumo.clientes} · Total gravado: <b>{formatarMoeda(resumo.total)}</b>
          </p>
          <p>
            Com vendedor por venda (importação nova): <b>{resumo.comPorVendedor}</b> clientes · soma {formatarMoeda(resumo.somaPorVendedor)} · {resumo.pedidos} pedidos
          </p>
          <p>
            Sem vendedor por venda (importação antiga): <b>{resumo.semPorVendedor}</b> clientes · {formatarMoeda(resumo.valorSemPorVendedor)}
            {resumo.semPedidos > 0 ? ` · ${resumo.semPedidos} sem contagem de pedidos` : ''}
          </p>
          {resumo.antigas > 0 && <p>Registros antigos (por arquivo) com data nesse mês: {resumo.antigas}</p>}
          <table className="mt-2 text-xs w-full max-w-xl">
            <thead>
              <tr className="text-left text-ink-soft">
                <th className="py-1">Vendedor (como veio do ERP)</th>
                <th className="py-1 text-right">Valor</th>
                <th className="py-1 text-right">Pedidos</th>
              </tr>
            </thead>
            <tbody>
              {resumo.porVendedor.map((v) => (
                <tr key={v.nome} className="border-t border-line">
                  <td className="py-1">{v.nome}</td>
                  <td className="py-1 text-right tabular-nums">{formatarMoeda(v.valor)}</td>
                  <td className="py-1 text-right tabular-nums">{v.pedidos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
