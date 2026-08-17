import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ouvirClientes, ouvirVendedores, salvarMetasEmpresa } from '../lib/crmData';
import { METAS_PADRAO, type Cliente, type MetaTier, type Vendedor } from '../types';
import { formatarMoeda, vendasMesVendedor } from '../lib/crmLogic';

/** Faixas de meta/comissão da empresa + acompanhamento por vendedor.
 * A comissão do mês usa a MAIOR faixa atingida (não cumulativa entre
 * faixas) — mesma regra da Divinissima. Como o Fluxa CRM ainda não importa
 * o total de vendas do sistema de origem, "vendas do mês" aqui é a soma dos
 * orçamentos marcados como Concluído no funil dentro do mês corrente. */
export default function Metas() {
  const { empresa, papel, sessaoVendedor } = useAuth();
  const empresaId = empresa?.id;
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [metas, setMetas] = useState<MetaTier[]>(empresa?.metas ?? METAS_PADRAO);
  const [salvando, setSalvando] = useState(false);

  const ehAdmin = papel === 'admin';

  useEffect(() => {
    if (!empresaId) return;
    const unsubV = ouvirVendedores(empresaId, setVendedores);
    const unsubC = ouvirClientes(empresaId, setClientes);
    return () => {
      unsubV();
      unsubC();
    };
  }, [empresaId]);

  useEffect(() => {
    if (empresa?.metas && empresa.metas.length > 0) setMetas(empresa.metas);
  }, [empresa?.metas]);

  function calcularNivel(vendasMes: number) {
    for (let i = metas.length - 1; i >= 0; i--) {
      if (vendasMes >= metas[i].valor) {
        return { tier: metas[i], comissao: vendasMes * (metas[i].comissao / 100) + metas[i].bonus };
      }
    }
    return null;
  }

  async function salvarMetas() {
    if (!empresaId) return;
    setSalvando(true);
    try {
      await salvarMetasEmpresa(empresaId, metas);
    } catch (err) {
      console.error('Erro ao salvar metas:', err);
      alert('Não foi possível salvar as metas. Tente novamente em instantes.');
    } finally {
      setSalvando(false);
    }
  }

  function atualizarFaixa(i: number, campo: keyof MetaTier, valor: string) {
    setMetas((atual) =>
      atual.map((m, idx) => (idx === i ? { ...m, [campo]: campo === 'label' ? valor : Number(valor) } : m))
    );
  }

  const LIMITE_FAIXAS = 5;

  function adicionarFaixa() {
    setMetas((atual) => {
      if (atual.length >= LIMITE_FAIXAS) return atual;
      return [...atual, { label: `Meta ${atual.length + 1}`, valor: 0, comissao: 0, bonus: 0 }];
    });
  }

  function removerFaixa(i: number) {
    if (i === 0) return; // a primeira faixa é fixa, não pode ser removida
    setMetas((atual) => atual.filter((_, idx) => idx !== i));
  }

  const vendedoresComVendas = useMemo(
    () => vendedores.map((v) => ({ vendedor: v, vendasMes: vendasMesVendedor(clientes, v.login) })),
    [vendedores, clientes]
  );

  if (!empresaId) return null;

  // Visão do próprio vendedor: progresso pessoal.
  if (!ehAdmin) {
    const meu = sessaoVendedor?.vendedor;
    const vendasMes = meu ? vendasMesVendedor(clientes, meu.login) : 0;
    const nivel = calcularNivel(vendasMes);
    return (
      <div className="p-6 w-full max-w-lg">
        <h1 className="text-base font-extrabold text-ink flex items-center gap-2 mb-4">🎯 Minhas metas</h1>
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
          {metas.map((m) => {
            const pct = Math.min(100, Math.round((vendasMes / m.valor) * 100));
            return (
              <div key={m.label} className="bg-white border border-line rounded-xl p-3">
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
      <h1 className="text-base font-extrabold text-ink flex items-center gap-2 mb-4">🎯 Metas &amp; Comissões</h1>

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
              return (
                <tr key={vendedor.id} className="border-t border-line">
                  <td className="px-4 py-2.5 font-bold text-ink">{vendedor.nome}</td>
                  <td className="px-4 py-2.5 text-right text-ink-soft">{formatarMoeda(vendasMes)}</td>
                  <td className="px-4 py-2.5 text-ink-soft">{nivel?.tier.label ?? '—'}</td>
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
