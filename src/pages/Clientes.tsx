import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ouvirClientes, ouvirVendedores } from '../lib/crmData';
import type { Cliente, Vendedor } from '../types';
import { diasSemAtend, formatarMoeda, matchVendedor, statusInfo } from '../lib/crmLogic';
import ClienteDetalheModal from '../components/ClienteDetalheModal';
import { IconClientes } from '../components/NavIcons';

type FiltroStatus = 'todos' | 'com' | 'sem' | 'inat' | '31_40' | 'at';

/** Lista de clientes com busca e filtros — equivalente à aba "Clientes" da Divinissima. */
export default function Clientes() {
  const { empresa, perfil, sessaoVendedor, papel } = useAuth();
  const empresaId = empresa?.id;
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<FiltroStatus>('todos');
  const [selecionado, setSelecionado] = useState<Cliente | null>(null);

  useEffect(() => {
    if (!empresaId) return;
    const unsubC = ouvirClientes(empresaId, setClientes);
    const unsubV = ouvirVendedores(empresaId, setVendedores);
    return () => {
      unsubC();
      unsubV();
    };
  }, [empresaId]);

  const ehAdmin = papel === 'admin';
  const loginAtual = ehAdmin ? undefined : sessaoVendedor?.vendedor.login;
  const nomeAtual = ehAdmin ? perfil?.nome : sessaoVendedor?.vendedor.nome;

  const listaBase = useMemo(() => {
    const ordenada = [...clientes].sort((a, b) => (b.dtUltCompra ?? '').localeCompare(a.dtUltCompra ?? ''));
    if (ehAdmin) return ordenada;
    return ordenada.filter((c) => matchVendedor(c, loginAtual ?? '', nomeAtual) || c.crmVendedorLogin === loginAtual);
  }, [clientes, ehAdmin, loginAtual, nomeAtual]);

  const listaFiltrada = useMemo(() => {
    let lista = listaBase;
    if (filtro === 'com') lista = lista.filter((c) => !!c.cod_vendedor);
    if (filtro === 'sem') lista = lista.filter((c) => !c.cod_vendedor);
    if (filtro === 'inat') lista = lista.filter((c) => diasSemAtend(c) > 40);
    if (filtro === '31_40') lista = lista.filter((c) => diasSemAtend(c) > 30 && diasSemAtend(c) <= 40);
    if (filtro === 'at') lista = lista.filter((c) => diasSemAtend(c) <= 30);

    if (busca.trim()) {
      const termo = busca.trim().toLowerCase();
      lista = lista.filter(
        (c) =>
          (c.razao ?? c.nome ?? '').toLowerCase().includes(termo) ||
          c.cod.toLowerCase().includes(termo) ||
          (c.telefone ?? '').includes(termo)
      );
    }
    return lista;
  }, [listaBase, filtro, busca]);

  if (!empresaId) return null;

  return (
    <div className="p-6 w-full">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h1 className="text-base font-extrabold text-ink flex items-center gap-2">
          <IconClientes /> Clientes
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={filtro}
            onChange={(e) => setFiltro(e.target.value as FiltroStatus)}
            className="rounded-xl border border-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500/30"
          >
            <option value="todos">Todos</option>
            <option value="com">Com vendedor</option>
            <option value="sem">Sem vendedor</option>
            <option value="inat">Inativos (+40 dias)</option>
            <option value="31_40">Risco (31-40 dias)</option>
            <option value="at">Ativos (até 30 dias)</option>
          </select>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, código ou telefone..."
            className="w-full sm:w-72 rounded-xl border border-line px-3.5 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500/30"
          />
        </div>
      </div>

      <div className="bg-white border border-line rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface text-ink-soft text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-2.5 font-bold">Cliente</th>
              <th className="text-left px-4 py-2.5 font-bold">Telefone</th>
              <th className="text-left px-4 py-2.5 font-bold">Status</th>
              <th className="text-right px-4 py-2.5 font-bold">Total geral</th>
              <th className="text-left px-4 py-2.5 font-bold">Vendedor</th>
            </tr>
          </thead>
          <tbody>
            {listaFiltrada.map((c) => {
              const dias = diasSemAtend(c);
              const status = statusInfo(dias);
              const vend = vendedores.find((v) => v.login === c.cod_vendedor);
              return (
                <tr
                  key={c.id}
                  onClick={() => setSelecionado(c)}
                  className="border-t border-line hover:bg-surface cursor-pointer"
                >
                  <td className="px-4 py-2.5">
                    <div className="font-bold text-ink">{c.razao ?? c.nome}</div>
                    <div className="text-xs text-ink-soft">{c.cod}</div>
                  </td>
                  <td className="px-4 py-2.5 text-ink-soft">{c.telefone ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className="text-xs font-bold uppercase tracking-wide px-2 py-1 rounded-full text-white"
                      style={{ backgroundColor: status.cor }}
                    >
                      {status.label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold text-ink">{formatarMoeda(c.totalGeral ?? 0)}</td>
                  <td className="px-4 py-2.5 text-ink-soft">{vend?.nome ?? c.vend_nome ?? '—'}</td>
                </tr>
              );
            })}
            {listaFiltrada.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-ink-soft text-sm">
                  Nenhum cliente encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selecionado && (
        <ClienteDetalheModal
          empresaId={empresaId}
          cliente={selecionado}
          vendedores={vendedores}
          ehAdmin={ehAdmin}
          onClose={() => setSelecionado(null)}
        />
      )}
    </div>
  );
}
