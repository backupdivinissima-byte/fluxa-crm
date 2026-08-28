import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { ouvirClientes, ouvirEmpresa } from '../../lib/crmData';
import { ouvirCampanhasMeta, ouvirReservasLive } from '../../lib/marketingData';
import { resumoMarketingMes, ultimosMeses } from '../../lib/marketingLogic';
import { formatarMoeda } from '../../lib/crmLogic';
import { CRM_COLUNAS_PADRAO, type CampanhaMeta, type Cliente, type ColunaCrm, type ReservaLive } from '../../types';

function mesAtualISO() {
  return new Date().toISOString().slice(0, 7);
}

function rotuloMes(mesRef: string) {
  const [ano, mes] = mesRef.split('-').map(Number);
  return new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function rotuloMesCurto(mesRef: string) {
  const [ano, mes] = mesRef.split('-').map(Number);
  return new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
}

function formatarPct(v: number | undefined): string {
  if (v === undefined) return '—';
  return `${v >= 0 ? '+' : ''}${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

/** Aba "Análise Marketing": ROI e CAC do mês, combinando o investimento
 * registrado na aba Meta com a receita fechada no CRM e a receita atribuída
 * às lives (aba Live) — mais a evolução dos últimos meses. */
export default function AnaliseMarketing() {
  const { empresa, papel } = useAuth();
  const empresaId = empresa?.id;

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [campanhas, setCampanhas] = useState<CampanhaMeta[]>([]);
  const [reservas, setReservas] = useState<ReservaLive[]>([]);
  const [colunas, setColunas] = useState<ColunaCrm[]>(empresa?.crmColunas ?? CRM_COLUNAS_PADRAO);
  const [mesRef, setMesRef] = useState(mesAtualISO());

  useEffect(() => {
    if (!empresaId) return;
    const unsubC = ouvirClientes(empresaId, setClientes);
    const unsubM = ouvirCampanhasMeta(empresaId, setCampanhas);
    const unsubR = ouvirReservasLive(empresaId, setReservas);
    const unsubE = ouvirEmpresa(empresaId, (emp) => {
      setColunas(emp?.crmColunas && emp.crmColunas.length > 0 ? emp.crmColunas : CRM_COLUNAS_PADRAO);
    });
    return () => {
      unsubC();
      unsubM();
      unsubR();
      unsubE();
    };
  }, [empresaId]);

  const colunasFechamentoIds = useMemo(() => colunas.filter((c) => c.fechamento).map((c) => c.id), [colunas]);

  const resumo = useMemo(
    () => resumoMarketingMes(campanhas, clientes, reservas, colunasFechamentoIds, mesRef),
    [campanhas, clientes, reservas, colunasFechamentoIds, mesRef]
  );

  const evolucao = useMemo(
    () => ultimosMeses(6).map((mes) => resumoMarketingMes(campanhas, clientes, reservas, colunasFechamentoIds, mes)),
    [campanhas, clientes, reservas, colunasFechamentoIds]
  );

  if (papel !== 'admin' || !empresaId) {
    return (
      <div className="p-6 w-full">
        <p className="text-sm text-ink-soft">Somente administradores acessam essa tela.</p>
      </div>
    );
  }

  const semColunaFechamento = colunasFechamentoIds.length === 0;

  return (
    <div className="p-6 w-full max-w-5xl">
      <h1 className="text-base font-extrabold text-ink mb-1">Análise Marketing</h1>
      <p className="text-sm text-ink-soft mb-6">ROI e CAC do investimento em anúncios e lives, mês a mês.</p>

      {semColunaFechamento && (
        <div className="bg-amber-500/10 border border-amber-200 rounded-2xl p-4 mb-4 text-sm text-amber-800">
          Nenhuma coluna do quadro CRM está marcada como "fechamento" ainda — configure isso na aba CRM pra a receita
          total do mês entrar nesse cálculo (a receita atribuída à live continua funcionando normalmente).
        </div>
      )}

      <div className="bg-white border border-line rounded-2xl p-6 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <h2 className="text-sm font-extrabold text-ink capitalize">{rotuloMes(mesRef)}</h2>
          <input
            type="month"
            value={mesRef}
            onChange={(e) => setMesRef(e.target.value)}
            className="rounded-lg border border-line px-3 py-1.5 text-sm"
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="bg-surface rounded-xl p-4">
            <div className="text-xs text-ink-soft font-bold uppercase tracking-wide">Investimento (Meta Ads)</div>
            <div className="text-xl font-extrabold text-ink">{formatarMoeda(resumo.investimentoMeta)}</div>
          </div>
          <div className="bg-surface rounded-xl p-4">
            <div className="text-xs text-ink-soft font-bold uppercase tracking-wide">Receita total do mês</div>
            <div className="text-xl font-extrabold text-ink">{formatarMoeda(resumo.receitaTotal)}</div>
          </div>
          <div className="bg-surface rounded-xl p-4">
            <div className="text-xs text-ink-soft font-bold uppercase tracking-wide">Receita atribuída à live</div>
            <div className="text-xl font-extrabold text-ink">{formatarMoeda(resumo.receitaLive)}</div>
          </div>
          <div className="bg-surface rounded-xl p-4">
            <div className="text-xs text-ink-soft font-bold uppercase tracking-wide">Clientes novos</div>
            <div className="text-xl font-extrabold text-ink">{resumo.clientesNovos}</div>
          </div>
          <div className="bg-surface rounded-xl p-4">
            <div className="text-xs text-ink-soft font-bold uppercase tracking-wide">CAC</div>
            <div className="text-xl font-extrabold text-ink">{resumo.cac !== undefined ? formatarMoeda(resumo.cac) : '—'}</div>
          </div>
          <div className="bg-surface rounded-xl p-4">
            <div className="text-xs text-ink-soft font-bold uppercase tracking-wide">ROI</div>
            <div className={`text-xl font-extrabold ${resumo.roi !== undefined && resumo.roi < 0 ? 'text-red-600' : 'text-ink'}`}>
              {formatarPct(resumo.roi)}
            </div>
          </div>
        </div>
        <p className="text-xs text-ink-soft mt-4">
          CAC = investimento em Meta Ads ÷ clientes novos do mês (pela 1ª compra registrada). ROI = (receita total do
          mês − investimento) ÷ investimento. Os dois ficam "—" quando não há investimento ou clientes novos
          suficientes no mês pra um cálculo com sentido.
        </p>
      </div>

      <div className="bg-white border border-line rounded-2xl p-6">
        <h2 className="text-sm font-extrabold text-ink mb-5">Evolução — últimos 6 meses</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-bold text-ink-soft uppercase tracking-wide border-b border-line">
                <th className="py-2 pr-3">Mês</th>
                <th className="py-2 pr-3 text-right">Investimento</th>
                <th className="py-2 pr-3 text-right">Receita total</th>
                <th className="py-2 pr-3 text-right">Receita live</th>
                <th className="py-2 pr-3 text-right">CAC</th>
                <th className="py-2 pr-3 text-right">ROI</th>
              </tr>
            </thead>
            <tbody>
              {evolucao.map((r) => (
                <tr key={r.mesRef} className="border-b border-line/60">
                  <td className="py-2 pr-3 font-semibold text-ink capitalize">{rotuloMesCurto(r.mesRef)}</td>
                  <td className="py-2 pr-3 text-right">{formatarMoeda(r.investimentoMeta)}</td>
                  <td className="py-2 pr-3 text-right">{formatarMoeda(r.receitaTotal)}</td>
                  <td className="py-2 pr-3 text-right">{formatarMoeda(r.receitaLive)}</td>
                  <td className="py-2 pr-3 text-right">{r.cac !== undefined ? formatarMoeda(r.cac) : '—'}</td>
                  <td className={`py-2 pr-3 text-right font-semibold ${r.roi !== undefined && r.roi < 0 ? 'text-red-600' : 'text-ink'}`}>
                    {formatarPct(r.roi)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
