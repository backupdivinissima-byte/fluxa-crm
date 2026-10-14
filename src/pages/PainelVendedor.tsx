import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ouvirClientes, ouvirEmpresa, ouvirVendedores } from '../lib/crmData';
import { COMISSAO_BASE_PADRAO, CRM_COLUNAS_PADRAO, METAS_PADRAO, type Cliente, type ColunaCrm, type MetaTier, type Vendedor } from '../types';
import {
  DIAS_INATIVIDADE_PADRAO,
  diasUteisDoMes,
  formatarMoeda,
  inicioRiscoDe,
  nivelDeMeta,
  resumoCarteiraVendedor,
  vendasDoMesVendedor,
  vendasMensaisDoVendedor,
} from '../lib/crmLogic';

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
const MESES_CURTO = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const CORES_ANOS = ['#8B7FE0', '#2FB36B', '#E8893A', '#2563EB', '#C0392B'];
const COR_ATIVO = '#27AE60';
const COR_RISCO = '#E67E22';
const COR_INATIVO = '#C0392B';

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/** 17402,6 → "17,4 mil"; 1250000 → "1,3 mi" — pra caber em cima das barras. */
function compacto(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (v >= 1_000) return `${(v / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return Math.round(v).toLocaleString('pt-BR');
}

function corProgresso(pct: number, atingida: boolean): string {
  if (atingida) return COR_ATIVO;
  return pct >= 50 ? COR_RISCO : COR_INATIVO;
}

function Cartao({ titulo, direita, children }: { titulo: string; direita?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-line rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="text-sm font-extrabold text-ink">{titulo}</h2>
        {direita}
      </div>
      {children}
    </section>
  );
}

function Indicador({
  rotulo,
  valor,
  detalhe,
  cor,
}: {
  rotulo: string;
  valor: string;
  detalhe: string;
  cor?: string;
}) {
  return (
    <div className="bg-white border border-line rounded-2xl p-4">
      <p className="text-[11px] font-bold text-ink-soft uppercase tracking-wide mb-1">{rotulo}</p>
      <p className="text-2xl font-extrabold tabular-nums text-ink" style={cor ? { color: cor } : undefined}>
        {valor}
      </p>
      <p className="text-[11px] mt-1 text-ink-soft" style={cor ? { color: cor } : undefined}>
        {detalhe}
      </p>
    </div>
  );
}

/** Evolução das vendas do vendedor, mês a mês, por ano. Só o ano mais
 * recente selecionado leva o valor em cima da barra (com vários anos juntos
 * os números se sobrepõem); todos têm o valor exato ao passar o mouse. */
function GraficoMensal({ vendas }: { vendas: Record<string, number> }) {
  const anos = useMemo(
    () => [...new Set(Object.keys(vendas).map((k) => Number(k.slice(0, 4))))].sort((a, b) => a - b),
    [vendas]
  );
  const [escolhidos, setEscolhidos] = useState<number[] | null>(null);
  const selecionados = (escolhidos ?? anos).filter((a) => anos.includes(a));

  if (anos.length === 0) {
    return <p className="text-sm text-ink-soft py-6 text-center">Ainda não há vendas importadas para mostrar aqui.</p>;
  }

  const valorDe = (ano: number, mesIdx: number) => vendas[`${ano}-${String(mesIdx + 1).padStart(2, '0')}`] ?? 0;
  const maximo = Math.max(1, ...selecionados.flatMap((a) => MESES_CURTO.map((_, m) => valorDe(a, m))));

  // Melhor mês entre os anos selecionados.
  let melhor: { ano: number; mes: number; valor: number } | null = null;
  for (const a of selecionados) {
    for (let m = 0; m < 12; m++) {
      const v = valorDe(a, m);
      if (v > 0 && (!melhor || v > melhor.valor)) melhor = { ano: a, mes: m, valor: v };
    }
  }

  function alternar(ano: number) {
    setEscolhidos((atual) => {
      const base = atual ?? anos;
      return base.includes(ano) ? base.filter((a) => a !== ano) : [...base, ano].sort((a, b) => a - b);
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {anos.map((ano, i) => {
          const ligado = selecionados.includes(ano);
          const cor = CORES_ANOS[i % CORES_ANOS.length];
          return (
            <button
              key={ano}
              type="button"
              onClick={() => alternar(ano)}
              aria-pressed={ligado}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                ligado ? 'border-line bg-white text-ink' : 'border-transparent bg-surface text-ink-soft'
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: ligado ? cor : '#cbd5e1' }} />
              {ano}
            </button>
          );
        })}
        {melhor && (
          <span className="ml-auto text-[11px] text-ink-soft">
            Melhor mês: <b className="text-ink">{MESES_CURTO[melhor.mes]}/{melhor.ano}</b> ·{' '}
            <b className="text-ink">{formatarMoeda(melhor.valor)}</b>
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="flex items-end gap-2 h-72 border-b border-line px-1">
            {MESES_CURTO.map((mes, m) => (
              <div key={mes} className="flex-1 h-full flex items-end justify-center gap-0.5">
                {selecionados.map((ano) => {
                  const v = valorDe(ano, m);
                  const cor = CORES_ANOS[anos.indexOf(ano) % CORES_ANOS.length];
                  return (
                    <div
                      key={ano}
                      className="flex-1 max-w-7 h-full flex flex-col justify-end items-center"
                      title={`${mes}/${ano}: ${formatarMoeda(v)}`}
                    >
                      {v > 0 && (
                        <span
                          className="text-[9px] font-bold text-ink-soft mb-1 whitespace-nowrap"
                          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                        >
                          {compacto(v)}
                        </span>
                      )}
                      <div
                        className="w-full rounded-t-md"
                        style={{ height: `${Math.max(v > 0 ? 2 : 0, (v / maximo) * 70)}%`, background: cor }}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="flex gap-2 px-1 mt-1.5">
            {MESES_CURTO.map((mes) => (
              <div key={mes} className="flex-1 text-center text-[11px] text-ink-soft">
                {mes}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** "Meu painel": a primeira tela do login de vendedor. Tudo aqui é só do
 * vendedor logado — carteira, orçamentos, metas, comissão e vendas. */
export default function PainelVendedor() {
  const { empresa, sessaoVendedor } = useAuth();
  const empresaId = empresa?.id;
  const loginAtual = sessaoVendedor?.vendedor.login ?? '';
  const nomeAtual = sessaoVendedor?.vendedor.nome ?? '';

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [colunas, setColunas] = useState<ColunaCrm[]>(empresa?.crmColunas ?? CRM_COLUNAS_PADRAO);
  const [metas, setMetas] = useState<MetaTier[]>(empresa?.metas ?? METAS_PADRAO);
  const [comissaoBase, setComissaoBase] = useState<number>(empresa?.comissaoBase ?? COMISSAO_BASE_PADRAO);
  const [diasInatividade, setDiasInatividade] = useState<number>(empresa?.diasInatividade ?? DIAS_INATIVIDADE_PADRAO);

  useEffect(() => {
    if (!empresaId) return;
    const unsubC = ouvirClientes(empresaId, setClientes);
    const unsubV = ouvirVendedores(empresaId, setVendedores);
    const unsubE = ouvirEmpresa(empresaId, (emp) => {
      setColunas(emp?.crmColunas && emp.crmColunas.length > 0 ? emp.crmColunas : CRM_COLUNAS_PADRAO);
      setMetas(emp?.metas && emp.metas.length > 0 ? emp.metas : METAS_PADRAO);
      setComissaoBase(emp?.comissaoBase ?? COMISSAO_BASE_PADRAO);
      setDiasInatividade(emp?.diasInatividade ?? DIAS_INATIVIDADE_PADRAO);
    });
    return () => {
      unsubC();
      unsubV();
      unsubE();
    };
  }, [empresaId]);

  const hoje = new Date();
  const mesRef = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  const uteis = diasUteisDoMes(hoje);

  const colunasFechamentoIds = useMemo(() => colunas.filter((c) => c.fechamento).map((c) => c.id), [colunas]);
  const meuCadastro = vendedores.find((v) => v.login === loginAtual) ?? sessaoVendedor?.vendedor;
  const metaPessoal = meuCadastro?.meta ?? 0;

  const carteira = useMemo(
    () => resumoCarteiraVendedor(clientes, loginAtual, nomeAtual, colunas, diasInatividade),
    [clientes, loginAtual, nomeAtual, colunas, diasInatividade]
  );
  const vendasMes = useMemo(
    () => vendasDoMesVendedor(clientes, loginAtual, nomeAtual, colunasFechamentoIds, mesRef),
    [clientes, loginAtual, nomeAtual, colunasFechamentoIds, mesRef]
  );
  const vendasPorMes = useMemo(
    () => vendasMensaisDoVendedor(clientes, loginAtual, nomeAtual),
    [clientes, loginAtual, nomeAtual]
  );

  const nivel = nivelDeMeta(metas, vendasMes, comissaoBase);
  // Meta de referência do mês: a pessoal, se existir; senão a próxima faixa.
  const metaRef = metaPessoal > 0 ? { valor: metaPessoal, rotulo: 'meta pessoal' } : nivel.proxima ? { valor: nivel.proxima.valor, rotulo: nivel.proxima.label } : null;
  const pctMeta = metaRef ? Math.min(100, Math.round((vendasMes / metaRef.valor) * 100)) : null;

  const ritmoDia = uteis.decorridos > 0 ? vendasMes / uteis.decorridos : 0;
  const projecao = vendasMes + ritmoDia * uteis.restantes;
  const falta = metaRef ? Math.max(0, metaRef.valor - vendasMes) : 0;
  const precisaPorDia = uteis.restantes > 0 && falta > 0 ? falta / uteis.restantes : 0;
  const pctProjecao = metaRef ? Math.min(100, Math.round((projecao / metaRef.valor) * 100)) : null;

  const limiteRisco = diasInatividade;
  const inicioRisco = inicioRiscoDe(diasInatividade);
  const metasValidas = metas.filter((m) => m.valor > 0);

  if (!empresaId) return null;

  return (
    <div className="p-6 md:p-8 w-full space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-teal-500/15 text-teal-600 font-extrabold flex items-center justify-center shrink-0">
          {iniciais(nomeAtual)}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg md:text-xl font-extrabold text-ink uppercase truncate">{nomeAtual}</h1>
          <p className="text-xs text-ink-soft">
            {MESES_EXTENSO[hoje.getMonth()]} de {hoje.getFullYear()} · Dia {hoje.getDate()} · {uteis.decorridos}/
            {uteis.total} dias úteis
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-bold whitespace-nowrap ${
            nivel.tier ? 'border-green-500 bg-green-50 text-green-700' : 'border-line bg-white text-ink-soft'
          }`}
        >
          {nivel.tier ? `✓ ${nivel.tier.label} atingida` : 'Sem meta atingida'}
        </span>
        <Link
          to="/crm"
          className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-4 py-2 hover:opacity-90"
        >
          Abrir meu CRM
        </Link>
      </div>

      {/* Visão geral do mês */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Indicador rotulo="Minha carteira" valor={carteira.total.toLocaleString('pt-BR')} detalhe="clientes na carteira" />
        <Indicador
          rotulo={`Ativos (até ${Math.max(0, inicioRisco - 1)}d)`}
          valor={carteira.ativos.toLocaleString('pt-BR')}
          detalhe="compraram recentemente"
          cor={COR_ATIVO}
        />
        <Indicador
          rotulo={`Em risco (${inicioRisco}–${limiteRisco}d)`}
          valor={carteira.risco.toLocaleString('pt-BR')}
          detalhe="prestes a ficar inativos"
          cor={COR_RISCO}
        />
        <Indicador
          rotulo={`Inativos (+${limiteRisco}d)`}
          valor={carteira.inativos.toLocaleString('pt-BR')}
          detalhe="sem compra no prazo"
          cor={COR_INATIVO}
        />
        <Indicador
          rotulo="Vendas do mês"
          valor={formatarMoeda(vendasMes)}
          detalhe={
            pctMeta != null && metaRef
              ? `${pctMeta}% da ${metaRef.rotulo}`
              : nivel.indice >= 0
                ? 'todas as metas atingidas'
                : 'sem meta definida'
          }
          cor="#0F766E"
        />
      </div>

      <div className="space-y-5">
        {/* Metas e comissão */}
        <div>
          <Cartao
            titulo="Metas e comissão"
            direita={
              <span className="text-xs text-ink-soft">
                Comissão estimada hoje:{' '}
                <b className="text-ink">{formatarMoeda(nivel.comissao)}</b>
              </span>
            }
          >
            {metasValidas.length > 0 ? (
              <div className="flex gap-3 overflow-x-auto pb-1">
                {metasValidas.map((m, i) => {
                  // Efeito cascata: cada meta só começa a ser preenchida depois que
                  // a anterior foi batida. O "alvo" do card é o trecho entre a meta
                  // anterior e esta (ex.: Meta 2 de R$ 121 mil depois da Meta 1 de
                  // R$ 110 mil = trecho de R$ 11 mil).
                  const base = i === 0 ? 0 : metasValidas[i - 1].valor;
                  const trecho = Math.max(0, m.valor - base);
                  const vendido = Math.min(trecho, Math.max(0, vendasMes - base));
                  const atingida = vendasMes >= m.valor;
                  const pct = trecho > 0 ? Math.min(100, Math.round((vendido / trecho) * 100)) : 100;
                  const cor = corProgresso(pct, atingida);
                  return (
                    <div key={i} className="rounded-xl border p-3 flex-1 min-w-[190px]" style={{ borderColor: cor, borderTopWidth: 3 }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-extrabold text-ink truncate">{m.label || `Meta ${i + 1}`}</span>
                        <span className="text-[11px] font-bold" style={{ color: cor }}>
                          {atingida ? '✓ OK' : `${pct}%`}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-surface overflow-hidden mb-2">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: cor }} />
                      </div>
                      <p className="text-[11px] text-ink-soft">
                        Alvo: <b className="text-ink">{formatarMoeda(trecho)}</b>
                        {i > 0 && <span className="ml-1">(meta total {formatarMoeda(m.valor)})</span>}
                      </p>
                      <p className="text-[11px] text-ink-soft">
                        Vendido: <b className="text-ink">{formatarMoeda(vendido)}</b>
                      </p>
                      <p className="text-[11px]" style={{ color: atingida ? COR_ATIVO : COR_INATIVO }}>
                        Falta: <b>{formatarMoeda(trecho - vendido)}</b>
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-ink-soft">Nenhuma meta cadastrada ainda. Peça ao administrador.</p>
            )}
          </Cartao>
        </div>

        {/* Orçamentos e atendimento */}
        <Cartao titulo="Atendimento e orçamentos">
          <div className="flex items-baseline justify-between mb-3">
            <span className="text-xs text-ink-soft">Em atendimento agora</span>
            <span className="text-lg font-extrabold text-ink tabular-nums">{carteira.emAtendimento}</span>
          </div>
          <div className="flex items-baseline justify-between pb-3 border-b border-line">
            <span className="text-xs text-ink-soft">Orçamentos em aberto</span>
            <span className="text-lg font-extrabold tabular-nums" style={{ color: '#0F766E' }}>
              {formatarMoeda(carteira.orcamentoTotal)}
            </span>
          </div>
          {carteira.orcamentos.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {carteira.orcamentos.map((o) => (
                <li key={o.coluna.id} className="flex items-center justify-between text-xs">
                  <span className="text-ink font-semibold truncate">{o.coluna.nome}</span>
                  <span className="text-ink-soft shrink-0 ml-2">
                    {o.qtd} cliente{o.qtd === 1 ? '' : 's'} · <b className="text-ink">{formatarMoeda(o.valor)}</b>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-ink-soft mt-3">Nenhuma coluna de orçamento no seu CRM ainda.</p>
          )}
        </Cartao>
      </div>

      {/* Ritmo e projeção */}
      <Cartao
        titulo="Ritmo e projeção do mês"
        direita={<span className="text-xs text-ink-soft">{uteis.restantes} dias úteis restantes</span>}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p className="text-xs font-bold text-ink-soft uppercase tracking-wide mb-2">Ritmo de vendas</p>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {[
                { rotulo: 'Dia útil', valor: ritmoDia },
                { rotulo: 'Semana', valor: ritmoDia * 5 },
                { rotulo: 'Mês até hoje', valor: vendasMes },
              ].map((r) => (
                <div key={r.rotulo} className="rounded-xl bg-surface p-3 text-center">
                  <p className="text-[10px] font-bold text-ink-soft uppercase mb-0.5">{r.rotulo}</p>
                  <p className="text-sm md:text-base font-extrabold text-ink tabular-nums">{formatarMoeda(r.valor)}</p>
                </div>
              ))}
            </div>
            {metaRef && falta > 0 ? (
              <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Para chegar na {metaRef.rotulo} ({formatarMoeda(metaRef.valor)}), venda{' '}
                <b>{formatarMoeda(precisaPorDia)}</b> por dia útil nos próximos {uteis.restantes} dias úteis.
              </p>
            ) : metaRef ? (
              <p className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-800">
                Você já bateu a {metaRef.rotulo}.
              </p>
            ) : (
              <p className="text-xs text-ink-soft">Sem meta de referência para comparar o ritmo.</p>
            )}
          </div>

          <div>
            <p className="text-xs font-bold text-ink-soft uppercase tracking-wide mb-2">Projeção</p>
            <p className="text-[11px] text-ink-soft">Se mantiver o ritmo até o fim do mês</p>
            <p
              className="text-2xl font-extrabold tabular-nums"
              style={{ color: metaRef && projecao >= metaRef.valor ? COR_ATIVO : '#0F172A' }}
            >
              {formatarMoeda(projecao)}
            </p>
            {metaRef && pctProjecao != null ? (
              <>
                <div className="h-2 rounded-full bg-surface overflow-hidden my-2">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pctProjecao}%`, background: projecao >= metaRef.valor ? COR_ATIVO : COR_RISCO }}
                  />
                </div>
                <p
                  className={`rounded-lg px-3 py-2 text-xs font-semibold text-center ${
                    projecao >= metaRef.valor ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
                  }`}
                >
                  {projecao >= metaRef.valor
                    ? `Vai bater a ${metaRef.rotulo}!`
                    : `${formatarMoeda(metaRef.valor - projecao)} abaixo da ${metaRef.rotulo}`}
                </p>
              </>
            ) : (
              <p className="text-xs text-ink-soft mt-2">Defina uma meta para ver quanto falta.</p>
            )}
          </div>
        </div>
      </Cartao>

      {/* Evolução de vendas por mês */}
      <Cartao titulo="Evolução das minhas vendas por mês">
        <GraficoMensal vendas={vendasPorMes} />
      </Cartao>

    </div>
  );
}
