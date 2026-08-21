import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ouvirClientes, ouvirEmpresa, ouvirVendedores, salvarVendasAnuais } from '../lib/crmData';
import { CRM_COLUNAS_PADRAO, type Cliente, type ColunaCrm, type Vendedor } from '../types';
import {
  formatarMoeda,
  funilAtendimento,
  rankingVendedores,
  resumoAtendimento,
  vendasMesAtualEmpresa,
  vendasTotalEmpresa,
} from '../lib/crmLogic';

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MESES_EXTENSO = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];
// Paleta cíclica pras barras do gráfico por ano (mesma lógica de cores fixas
// usada no resto do app, só que uma cor por ano em vez de por status).
const CORES_ANOS = ['#7C5CFC', '#22C55E', '#F97316', '#0EA5A0', '#3B82F6', '#EC4899', '#EAB308'];

function formatarCompacto(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}k`;
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 1).toUpperCase();
  return (partes[0][0] + partes[1][0]).toUpperCase();
}

export default function Dashboard() {
  const { perfil, sessaoVendedor, papel, empresa } = useAuth();
  const nome = papel === 'admin' ? perfil?.nome : sessaoVendedor?.vendedor.nome;
  const empresaId = empresa?.id;
  const ehAdmin = papel === 'admin';

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [colunas, setColunas] = useState<ColunaCrm[]>(empresa?.crmColunas ?? CRM_COLUNAS_PADRAO);
  const [vendasAnuais, setVendasAnuais] = useState<{ ano: number; meses: number[] }[]>(empresa?.vendasAnuais ?? []);
  const [anosSelecionados, setAnosSelecionados] = useState<Set<number> | null>(null);
  const [editando, setEditando] = useState(false);
  const [novoAno, setNovoAno] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!empresaId) return;
    const unsubC = ouvirClientes(empresaId, setClientes);
    const unsubV = ouvirVendedores(empresaId, setVendedores);
    const unsubE = ouvirEmpresa(empresaId, (emp) => {
      setColunas(emp?.crmColunas && emp.crmColunas.length > 0 ? emp.crmColunas : CRM_COLUNAS_PADRAO);
      setVendasAnuais((atual) => (editando ? atual : (emp?.vendasAnuais ?? [])));
    });
    return () => {
      unsubC();
      unsubV();
      unsubE();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId]);

  const colunasFechamentoIds = useMemo(() => colunas.filter((c) => c.fechamento).map((c) => c.id), [colunas]);

  const agora = new Date();
  const anoAtual = agora.getFullYear();
  const mesAtualIdx = agora.getMonth(); // 0-11

  const resumo = useMemo(() => resumoAtendimento(clientes), [clientes]);
  const funil = useMemo(() => funilAtendimento(clientes), [clientes]);
  const vendasTotal = useMemo(() => vendasTotalEmpresa(clientes), [clientes]);
  const vendasMes = useMemo(() => vendasMesAtualEmpresa(clientes, colunasFechamentoIds), [clientes, colunasFechamentoIds]);

  const metaReferencia = empresa?.metas && empresa.metas.length > 0 ? empresa.metas[empresa.metas.length - 1].valor : undefined;
  const ranking = useMemo(
    () => rankingVendedores(vendedores, clientes, colunasFechamentoIds, metaReferencia),
    [vendedores, clientes, colunasFechamentoIds, metaReferencia]
  );

  // O ano corrente sempre aparece no gráfico (mesmo sem nenhum valor
  // lançado ainda), pra garantir que o mês atual real sempre esteja visível.
  const anosDisponiveis = useMemo(() => {
    const anos = new Set(vendasAnuais.map((a) => a.ano));
    anos.add(anoAtual);
    return Array.from(anos).sort((a, b) => a - b);
  }, [vendasAnuais, anoAtual]);

  const selecionados = anosSelecionados ?? new Set(anosDisponiveis);

  function mesesDoAno(ano: number): number[] {
    const registro = vendasAnuais.find((a) => a.ano === ano);
    const base = registro ? [...registro.meses] : new Array(12).fill(0);
    while (base.length < 12) base.push(0);
    if (ano === anoAtual) base[mesAtualIdx] = vendasMes.total; // mês atual sempre real, nunca manual
    return base;
  }

  const maxValor = useMemo(() => {
    let max = 0;
    for (const ano of anosDisponiveis) {
      if (!selecionados.has(ano)) continue;
      for (const v of mesesDoAno(ano)) max = Math.max(max, v);
    }
    return max || 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anosDisponiveis, selecionados, vendasAnuais, vendasMes.total]);

  function alternarAno(ano: number) {
    setAnosSelecionados((atual) => {
      const base = new Set(atual ?? anosDisponiveis);
      if (base.has(ano)) base.delete(ano);
      else base.add(ano);
      return base;
    });
  }

  function adicionarAno() {
    const ano = Number(novoAno);
    if (!ano || ano < 2000 || ano > 2100) return;
    setVendasAnuais((atual) => {
      if (atual.some((a) => a.ano === ano)) return atual;
      return [...atual, { ano, meses: new Array(12).fill(0) }].sort((a, b) => a.ano - b.ano);
    });
    setAnosSelecionados((sel) => new Set([...(sel ?? anosDisponiveis), ano]));
    setNovoAno('');
    setEditando(true);
  }

  function atualizarMes(ano: number, mesIdx: number, valor: string) {
    if (ano === anoAtual && mesIdx === mesAtualIdx) return; // mês atual não é editável manualmente
    setVendasAnuais((atual) => {
      const existe = atual.some((a) => a.ano === ano);
      const base = existe ? atual : [...atual, { ano, meses: new Array(12).fill(0) }];
      return base
        .map((a) => {
          if (a.ano !== ano) return a;
          const meses = [...a.meses];
          while (meses.length < 12) meses.push(0);
          meses[mesIdx] = Number(valor) || 0;
          return { ...a, meses };
        })
        .sort((a, b) => a.ano - b.ano);
    });
  }

  async function salvarHistorico() {
    if (!empresaId) return;
    setSalvando(true);
    try {
      // Nunca persiste o mês atual manualmente — ele é sempre recalculado.
      const paraSalvar = vendasAnuais.map((a) => {
        if (a.ano !== anoAtual) return a;
        const meses = [...a.meses];
        meses[mesAtualIdx] = 0; // não guarda o valor "congelado", ele é sempre lido ao vivo
        return { ...a, meses };
      });
      await salvarVendasAnuais(empresaId, paraSalvar);
      setEditando(false);
    } catch (err) {
      console.error('Erro ao salvar histórico de vendas:', err);
      alert('Não foi possível salvar o histórico de vendas. Tente novamente em instantes.');
    } finally {
      setSalvando(false);
    }
  }

  if (!ehAdmin) {
    return (
      <div className="p-8 w-full">
        <h1 className="text-2xl font-extrabold text-ink tracking-tight mb-8">Olá, {nome?.split(' ')[0]}</h1>
        <div className="bg-gradient-to-br from-teal-500 to-blue-600 rounded-2xl p-6 text-white max-w-2xl">
          <div className="text-sm font-bold uppercase tracking-wide opacity-80 mb-1">Bem-vindo(a) ao Fluxa CRM</div>
          <h2 className="text-lg font-extrabold mb-2">Funil de vendas, clientes e equipe num só lugar</h2>
          <p className="text-sm opacity-90">
            Use o menu acima pra organizar seu funil de vendas no CRM, cadastrar clientes e acompanhar suas metas e
            comissões.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 w-full max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-xl font-extrabold text-ink tracking-tight">Visão geral</h1>
        <span className="text-xs font-bold text-ink-soft bg-white border border-line rounded-full px-3 py-1.5">
          {MESES_EXTENSO[mesAtualIdx]} de {anoAtual}
        </span>
      </div>

      {/* Cards de resumo */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <div className="bg-white border border-line rounded-2xl p-4">
          <p className="text-xs font-bold text-ink-soft uppercase tracking-wide mb-1">Total de clientes</p>
          <p className="text-2xl font-extrabold text-ink">{resumo.total.toLocaleString('pt-BR')}</p>
          <p className="text-[11px] text-ink-soft mt-1">base completa</p>
        </div>
        <div className="bg-white border border-line rounded-2xl p-4">
          <p className="text-xs font-bold text-ink-soft uppercase tracking-wide mb-1">Com atendimento</p>
          <p className="text-2xl font-extrabold" style={{ color: '#27AE60' }}>
            {resumo.comAtendimento.toLocaleString('pt-BR')}
          </p>
          <p className="text-[11px] mt-1" style={{ color: '#27AE60' }}>
            {resumo.pctCom}% da base
          </p>
        </div>
        <div className="bg-white border border-line rounded-2xl p-4">
          <p className="text-xs font-bold text-ink-soft uppercase tracking-wide mb-1">Sem atendimento</p>
          <p className="text-2xl font-extrabold" style={{ color: '#C0392B' }}>
            {resumo.semAtendimento.toLocaleString('pt-BR')}
          </p>
          <p className="text-[11px] mt-1" style={{ color: '#C0392B' }}>
            {resumo.pctSem}% da base
          </p>
        </div>
        <div className="bg-white border border-line rounded-2xl p-4">
          <p className="text-xs font-bold text-ink-soft uppercase tracking-wide mb-1">Vendas total</p>
          <p className="text-2xl font-extrabold text-ink">{formatarMoeda(vendasTotal)}</p>
          <p className="text-[11px] text-ink-soft mt-1">todos os clientes</p>
        </div>
        <div className="bg-white border border-line rounded-2xl p-4">
          <p className="text-xs font-bold text-ink-soft uppercase tracking-wide mb-1">
            Vendas {MESES_EXTENSO[mesAtualIdx]}/{anoAtual}
          </p>
          <p className="text-2xl font-extrabold" style={{ color: '#27AE60' }}>
            {formatarMoeda(vendasMes.total)}
          </p>
          <p className="text-[11px] mt-1" style={{ color: vendasMes.variacaoPct != null && vendasMes.variacaoPct < 0 ? '#C0392B' : '#27AE60' }}>
            {vendasMes.variacaoPct != null
              ? `${vendasMes.variacaoPct >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(vendasMes.variacaoPct))}%`
              : 'sem mês anterior p/ comparar'}
          </p>
        </div>
      </div>

      {/* Gráfico de evolução de vendas por mês */}
      <div className="bg-white border border-line rounded-2xl p-5 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-sm font-extrabold text-ink">Evolução de vendas por mês</h2>
          <div className="flex items-center gap-2">
            <input
              type="number"
              placeholder="Ano (ex: 2023)"
              value={novoAno}
              onChange={(e) => setNovoAno(e.target.value)}
              className="w-32 rounded-lg border border-line px-2 py-1.5 text-xs"
            />
            <button
              onClick={adicionarAno}
              className="rounded-lg border border-line text-ink text-xs font-bold px-3 py-1.5 hover:bg-surface"
            >
              + Ano
            </button>
            <button
              onClick={() => setEditando((v) => !v)}
              className="rounded-lg border border-line text-ink text-xs font-bold px-3 py-1.5 hover:bg-surface"
            >
              {editando ? 'Fechar edição' : 'Editar valores'}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          {anosDisponiveis.map((ano, i) => (
            <label key={ano} className="flex items-center gap-1.5 text-xs font-bold text-ink cursor-pointer select-none">
              <input type="checkbox" checked={selecionados.has(ano)} onChange={() => alternarAno(ano)} />
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: CORES_ANOS[i % CORES_ANOS.length] }} />
              {ano}
            </label>
          ))}
        </div>

        {/* Barras */}
        <div className="overflow-x-auto">
          <div className="flex items-end gap-4 min-w-[720px] h-56 border-b border-line pb-1">
            {MESES.map((mesLabel, mesIdx) => (
              <div key={mesLabel} className="flex flex-col items-center justify-end flex-1 h-full">
                <div className="flex items-end gap-1 h-full">
                  {anosDisponiveis.map((ano, i) => {
                    if (!selecionados.has(ano)) return null;
                    const valor = mesesDoAno(ano)[mesIdx];
                    const alturaPct = Math.max(valor > 0 ? 3 : 0, (valor / maxValor) * 100);
                    return (
                      <div key={ano} className="flex flex-col items-center justify-end h-full w-3.5" title={`${ano}: ${formatarMoeda(valor)}`}>
                        {valor > 0 && (
                          <span className="text-[9px] font-bold text-ink-soft mb-0.5 rotate-0 whitespace-nowrap">
                            {formatarCompacto(valor)}
                          </span>
                        )}
                        <div
                          className="w-full rounded-t-sm"
                          style={{ height: `${alturaPct}%`, background: CORES_ANOS[i % CORES_ANOS.length] }}
                        />
                      </div>
                    );
                  })}
                </div>
                <span className="text-[10px] font-bold text-ink-soft mt-1">{mesLabel}</span>
              </div>
            ))}
          </div>
        </div>

        {editando && (
          <div className="mt-5 overflow-x-auto border-t border-line pt-4">
            <p className="text-xs text-ink-soft mb-3">
              Lance aqui o faturamento de anos anteriores (sem histórico automático no sistema). O mês atual (
              {MESES_EXTENSO[mesAtualIdx]}/{anoAtual}) é sempre calculado ao vivo e não pode ser editado.
            </p>
            <table className="text-xs min-w-[600px]">
              <thead>
                <tr>
                  <th className="text-left pr-3 pb-2 text-ink-soft font-bold">Mês</th>
                  {anosDisponiveis.map((ano) => (
                    <th key={ano} className="text-right px-2 pb-2 text-ink-soft font-bold">
                      {ano}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MESES.map((mesLabel, mesIdx) => (
                  <tr key={mesLabel} className="border-t border-line">
                    <td className="py-1.5 pr-3 text-ink-soft font-bold">{mesLabel}</td>
                    {anosDisponiveis.map((ano) => {
                      const travado = ano === anoAtual && mesIdx === mesAtualIdx;
                      return (
                        <td key={ano} className="py-1.5 px-2 text-right">
                          {travado ? (
                            <span className="text-ink-soft italic">{formatarCompacto(vendasMes.total)} (atual)</span>
                          ) : (
                            <input
                              type="number"
                              value={mesesDoAno(ano)[mesIdx] || ''}
                              onChange={(e) => atualizarMes(ano, mesIdx, e.target.value)}
                              className="w-24 rounded-lg border border-line px-1.5 py-1 text-right"
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              onClick={salvarHistorico}
              disabled={salvando}
              className="mt-4 rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-xs font-bold px-4 py-2.5 hover:opacity-90 disabled:opacity-60"
            >
              {salvando ? 'Salvando...' : 'Salvar histórico'}
            </button>
          </div>
        )}
      </div>

      {/* Funil de atendimento */}
      <div className="bg-white border border-line rounded-2xl p-5 mb-6">
        <h2 className="text-sm font-extrabold text-ink mb-4">Funil de atendimento</h2>
        <div className="space-y-2">
          <BarraFunil label="Total na base" valor={funil.total} pct={funil.pctTotal} cor="#0EA5A0" />
          <BarraFunil label="Com vendedor" valor={funil.comVendedor} pct={funil.pctComVendedor} cor="#2563EB" />
          <BarraFunil label="Ativos (≤30d)" valor={funil.ativos} pct={funil.pctAtivos} cor="#27AE60" estreita />
          <BarraFunil label="31 a 40 dias" valor={funil.risco} pct={funil.pctRisco} cor="#E67E22" estreita />
          <BarraFunil label="Inativos (+40d)" valor={funil.inativos} pct={funil.pctInativos} cor="#C0392B" />
        </div>
      </div>

      {/* Ranking de vendedores */}
      <div className="bg-white border border-line rounded-2xl p-5">
        <h2 className="text-sm font-extrabold text-ink mb-4">🏆 Ranking de vendedores</h2>
        <div className="space-y-3">
          {ranking.map((r, i) => (
            <div key={r.vendedor.id} className="flex items-center gap-3">
              <span
                className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[11px] font-extrabold ${
                  i === 0 ? 'bg-amber-200 text-amber-800' : i === 1 ? 'bg-slate-200 text-slate-700' : i === 2 ? 'bg-orange-200 text-orange-800' : 'bg-surface text-ink-soft'
                }`}
              >
                {i + 1}
              </span>
              <span className="w-9 h-9 shrink-0 rounded-full bg-teal-500/10 text-teal-700 font-extrabold text-xs flex items-center justify-center">
                {iniciais(r.vendedor.nome)}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-extrabold text-ink truncate">{r.vendedor.nome}</p>
                <p className="text-[11px] text-ink-soft">
                  {r.clientesCount} cliente{r.clientesCount === 1 ? '' : 's'}
                  {r.pctMeta != null ? ` · ${r.pctMeta}% da meta` : ''}
                </p>
                {r.pctMeta != null && (
                  <div className="h-1.5 bg-surface rounded-full overflow-hidden mt-1 max-w-xs">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${r.pctMeta}%`, background: r.pctMeta >= 50 ? '#0EA5A0' : '#C0392B' }}
                    />
                  </div>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs font-extrabold text-ink">{formatarMoeda(r.totalHistorico)}</p>
                <p className="text-[10px] text-ink-soft">total histórico</p>
                <p className="text-[11px] font-bold mt-0.5" style={{ color: r.vendasMes > 0 ? '#0EA5A0' : undefined }}>
                  {r.vendasMes > 0
                    ? `${formatarMoeda(r.vendasMes)} · ${MESES[mesAtualIdx]}/${anoAtual}`
                    : 'sem venda no mês'}
                </p>
              </div>
            </div>
          ))}
          {ranking.length === 0 && <p className="text-sm text-ink-soft py-6 text-center">Nenhum vendedor cadastrado ainda.</p>}
        </div>
      </div>
    </div>
  );
}

function BarraFunil({
  label,
  valor,
  pct,
  cor,
  estreita,
}: {
  label: string;
  valor: number;
  pct: number;
  cor: string;
  estreita?: boolean;
}) {
  return (
    <div
      className="rounded-xl px-4 py-2.5 flex items-center justify-between text-white text-xs font-bold"
      style={{ background: cor, width: estreita ? `${Math.max(pct, 14)}%` : '100%', minWidth: 190 }}
    >
      <span className="truncate">{label}</span>
      <span className="whitespace-nowrap ml-3">
        {valor.toLocaleString('pt-BR')} ({pct}%)
      </span>
    </div>
  );
}
