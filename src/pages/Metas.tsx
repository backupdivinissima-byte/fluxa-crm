import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ouvirClientes, ouvirEmpresa, ouvirVendedores, salvarMetasEmpresa } from '../lib/crmData';
import { CRM_COLUNAS_PADRAO, METAS_PADRAO, type Cliente, type ColunaCrm, type MetaTier, type Vendedor } from '../types';
import { formatarMoeda, nivelDeMeta, vendasDoMesVendedor } from '../lib/crmLogic';
import { IconMetas } from '../components/NavIcons';

/** Faixas de meta/comissão da empresa + acompanhamento por vendedor.
 * A comissão do mês usa a MAIOR faixa atingida (não cumulativa entre
 * faixas). "Vendas do mês" aqui é a soma dos orçamentos marcados como
 * Concluído no funil dentro do mês corrente. */
export default function Metas() {
  const { empresa, papel, sessaoVendedor } = useAuth();
  const empresaId = empresa?.id;
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [metas, setMetas] = useState<MetaTier[]>(empresa?.metas ?? METAS_PADRAO);
  const [colunas, setColunas] = useState<ColunaCrm[]>(empresa?.crmColunas ?? CRM_COLUNAS_PADRAO);
  const [salvando, setSalvando] = useState(false);
  // true enquanto há edição ainda não salva: o que chega do banco não pisa nela.
  const editando = useRef(false);
  const [salvoOk, setSalvoOk] = useState(false);

  const ehAdmin = papel === 'admin';

  useEffect(() => {
    if (!empresaId) return;
    const unsubV = ouvirVendedores(empresaId, setVendedores);
    const unsubC = ouvirClientes(empresaId, setClientes);
    const unsubE = ouvirEmpresa(empresaId, (emp) => {
      setColunas(emp?.crmColunas && emp.crmColunas.length > 0 ? emp.crmColunas : CRM_COLUNAS_PADRAO);
      // Metas sempre vêm do banco (o `empresa` do login fica desatualizado
      // depois de salvar — por isso as metas "sumiam" ao trocar de aba).
      if (!editando.current) setMetas(emp?.metas && emp.metas.length > 0 ? emp.metas : METAS_PADRAO);
    });
    return () => {
      unsubV();
      unsubC();
      unsubE();
    };
  }, [empresaId]);

  // IDs das colunas marcadas como "fechamento" — só essas contam como venda
  // concluída pra fins de comissão (independente de como a empresa nomeou
  // ou organizou o resto do quadro).
  const colunasFechamentoIds = useMemo(() => colunas.filter((c) => c.fechamento).map((c) => c.id), [colunas]);

  const hoje = new Date();
  const mesRef = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  const metasOrdenadas = useMemo(() => metas.filter((m) => m.valor > 0), [metas]);

  function calcularNivel(vendasMes: number) {
    const n = nivelDeMeta(metasOrdenadas, vendasMes);
    return n.tier ? { tier: n.tier, comissao: n.comissao } : null;
  }

  async function salvarMetas() {
    if (!empresaId) return;
    setSalvando(true);
    try {
      await salvarMetasEmpresa(empresaId, metas);
      editando.current = false;
      setSalvoOk(true);
      setTimeout(() => setSalvoOk(false), 3000);
    } catch (err) {
      console.error('Erro ao salvar metas:', err);
      alert('Não foi possível salvar as metas. Tente novamente em instantes.');
    } finally {
      setSalvando(false);
    }
  }

  function atualizarFaixa(i: number, campo: keyof MetaTier, valor: string) {
    editando.current = true;
    setMetas((atual) =>
      atual.map((m, idx) => (idx === i ? { ...m, [campo]: campo === 'label' ? valor : Number(valor) } : m))
    );
  }

  const LIMITE_FAIXAS = 5;

  function adicionarFaixa() {
    editando.current = true;
    setMetas((atual) => {
      if (atual.length >= LIMITE_FAIXAS) return atual;
      return [...atual, { label: `Meta ${atual.length + 1}`, valor: 0, comissao: 0, bonus: 0 }];
    });
  }

  function removerFaixa(i: number) {
    editando.current = true;
    if (i === 0) return; // a primeira faixa é fixa, não pode ser removida
    setMetas((atual) => atual.filter((_, idx) => idx !== i));
  }

  const vendedoresComVendas = useMemo(
    () =>
      vendedores.map((v) => ({
        vendedor: v,
        vendasMes: vendasDoMesVendedor(clientes, v.login, v.nome, colunasFechamentoIds, mesRef),
      })),
    [vendedores, clientes, colunasFechamentoIds, mesRef]
  );

  if (!empresaId) return null;

  // Visão do próprio vendedor: progresso pessoal.
  if (!ehAdmin) {
    const meu = sessaoVendedor?.vendedor;
    const vendasMes = meu ? vendasDoMesVendedor(clientes, meu.login, meu.nome, colunasFechamentoIds, mesRef) : 0;
    const nivel = calcularNivel(vendasMes);
    return (
      <div className="p-6 w-full max-w-lg">
        <h1 className="text-base font-extrabold text-ink flex items-center gap-2 mb-4">
          <IconMetas /> Minhas metas
        </h1>
        <div className="bg-white border border-line rounded-2xl p-6 mb-4">
          <p className="text-xs text-ink-soft uppercase font-bold tracking-wide mb-1">Vendas no mês</p>
          <p className="text-2xl font-extrabold text-ink mb-4">{formatarMoeda(vendasMes)}</p>
          {nivel ? (
            <div className="bg-teal-500/10 rounded-xl p-4">
              <p className="text-sm font-bold text-teal-600">Nível atingido: {nivel.tier.label}</p>
              <p className="text-xs text-ink-soft">
                {nivel.tier.comissao}% de comissão + bônus {formatarMoeda(nivel.tier.bonus)}
              </p>
              <p className="text-lg font-extrabold text-ink mt-1">Ganho estimado: {formatarMoeda(nivel.comissao)}</p>
            </div>
          ) : (
            <p className="text-sm text-ink-soft">Ainda não atingiu a primeira faixa de meta este mês.</p>
          )}
        </div>
        <div className="space-y-2">
          {metasOrdenadas.map((m) => {
            const pct = Math.min(100, Math.round((vendasMes / m.valor) * 100));
            return (
              <div key={m.label + m.valor} className="bg-white border border-line rounded-xl p-3">
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-bold text-ink">{m.label}</span>
                  <span className="text-ink-soft">{formatarMoeda(m.valor)}</span>
                </div>
                <div className="h-2 bg-surface rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-teal-500 to-blue-600" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Visão do admin: editor de faixas + tabela por vendedor.
  return (
    <div className="p-6 w-full">
      <h1 className="text-base font-extrabold text-ink flex items-center gap-2 mb-4">
        <IconMetas /> Metas &amp; Comissões
      </h1>

      <div className="bg-white border border-line rounded-2xl p-5 mb-6 overflow-x-auto">
        <h2 className="text-sm font-extrabold text-ink mb-3">Faixas de meta da empresa</h2>
        <table className="w-full text-sm min-w-[480px]">
          <thead className="text-xs text-ink-soft uppercase tracking-wide">
            <tr>
              <th className="text-left pb-2">Nome</th>
              <th className="text-right pb-2">Meta (R$)</th>
              <th className="text-right pb-2">Comissão (%)</th>
              <th className="text-right pb-2">Bônus (R$)</th>
              <th className="pb-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {metas.map((m, i) => (
              <tr key={i} className="border-t border-line">
                <td className="py-2 pr-2">
                  <input
                    value={m.label}
                    onChange={(e) => atualizarFaixa(i, 'label', e.target.value)}
                    className="w-full rounded-lg border border-line px-2 py-1.5 text-sm"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    type="number"
                    value={m.valor}
                    onChange={(e) => atualizarFaixa(i, 'valor', e.target.value)}
                    className="w-full rounded-lg border border-line px-2 py-1.5 text-sm text-right"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    type="number"
                    value={m.comissao}
                    onChange={(e) => atualizarFaixa(i, 'comissao', e.target.value)}
                    className="w-full rounded-lg border border-line px-2 py-1.5 text-sm text-right"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    type="number"
                    value={m.bonus}
                    onChange={(e) => atualizarFaixa(i, 'bonus', e.target.value)}
                    className="w-full rounded-lg border border-line px-2 py-1.5 text-sm text-right"
                  />
                </td>
                <td className="py-2 text-right">
                  {i > 0 && (
                    <button
                      onClick={() => removerFaixa(i)}
                      title="Remover faixa"
                      aria-label="Remover faixa"
                      className="text-ink-soft hover:text-red-500 font-bold text-sm w-6 h-6"
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={salvarMetas}
            disabled={salvando}
            className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-4 py-2.5 hover:opacity-90 disabled:opacity-60"
          >
            {salvando ? 'Salvando...' : 'Salvar faixas'}
          </button>
          <button
            onClick={adicionarFaixa}
            disabled={metas.length >= LIMITE_FAIXAS}
            title={metas.length >= LIMITE_FAIXAS ? `Máximo de ${LIMITE_FAIXAS} faixas` : undefined}
            className="rounded-xl border border-line text-ink text-sm font-bold px-4 py-2.5 hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed"
          >
            + Meta
          </button>
          {salvoOk && <span className="text-xs font-bold text-green-600">✓ Metas salvas</span>}
          {metas.length >= LIMITE_FAIXAS && (
            <span className="text-xs text-ink-soft">Máximo de {LIMITE_FAIXAS} faixas.</span>
          )}
        </div>
      </div>

      <div className="bg-white border border-line rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface text-ink-soft text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-2.5 font-bold">Vendedor</th>
              <th className="text-right px-4 py-2.5 font-bold">Vendas no mês</th>
              <th className="text-left px-4 py-2.5 font-bold">Nível</th>
              <th className="text-right px-4 py-2.5 font-bold">Comissão estimada</th>
            </tr>
          </thead>
          <tbody>
            {vendedoresComVendas.map(({ vendedor, vendasMes }) => {
              const nivel = calcularNivel(vendasMes);
              const proxima = metasOrdenadas[0];
              return (
                <tr key={vendedor.id} className="border-t border-line">
                  <td className="px-4 py-2.5 font-bold text-ink">{vendedor.nome}</td>
                  <td className="px-4 py-2.5 text-right text-ink-soft">{formatarMoeda(vendasMes)}</td>
                  <td className="px-4 py-2.5 text-ink-soft">
                    {nivel ? (
                      nivel.tier.label || 'Meta atingida'
                    ) : proxima ? (
                      <span title={`Falta ${formatarMoeda(proxima.valor - vendasMes)} para a ${proxima.label || 'primeira meta'}`}>
                        Abaixo de {proxima.label || 'Meta 1'} ({formatarMoeda(proxima.valor)})
                      </span>
                    ) : (
                      'Sem meta cadastrada'
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold text-ink">
                    {nivel ? formatarMoeda(nivel.comissao) : '—'}
                  </td>
                </tr>
              );
            })}
            {vendedoresComVendas.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-ink-soft text-sm">
                  Nenhum vendedor cadastrado ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
