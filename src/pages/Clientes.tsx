import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ouvirClientes, ouvirEmpresa, ouvirVendedores } from '../lib/crmData';
import type { Cliente, Vendedor } from '../types';
import {
  DIAS_INATIVIDADE_PADRAO,
  diasSemAtend,
  formatarMoeda,
  inicioRiscoDe,
  matchVendedor,
  statusInfo,
  totalGeralReal,
} from '../lib/crmLogic';
import { ouvirTodasConversas } from '../lib/chatData';
import type { ConversaChat } from '../types';
import ClienteDetalheModal from '../components/ClienteDetalheModal';
import { IconClientes } from '../components/NavIcons';

type FiltroStatus = 'todos' | 'com' | 'sem' | 'inat' | 'risco' | 'at';

/** Lista de clientes com busca e filtros. */
export default function Clientes() {
  const { empresa, perfil, sessaoVendedor, papel } = useAuth();
  const empresaId = empresa?.id;
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [conversas, setConversas] = useState<ConversaChat[]>([]);
  const [busca, setBusca] = useState('');
  const [conversaDe, setConversaDe] = useState('');
  const [conversaAte, setConversaAte] = useState('');
  const [filtro, setFiltro] = useState<FiltroStatus>('todos');
  const [selecionado, setSelecionado] = useState<Cliente | null>(null);
  // Prazo de inatividade configurado pelo admin no Dashboard (30/60/90/
  // personalizado) — mesmo parâmetro usado ali, pra "Risco"/"Inativo" aqui
  // baterem com o funil de atendimento.
  const [diasInatividade, setDiasInatividade] = useState<number>(empresa?.diasInatividade ?? DIAS_INATIVIDADE_PADRAO);
  const inicioRisco = inicioRiscoDe(diasInatividade);

  useEffect(() => {
    if (!empresaId) return;
    const unsubC = ouvirClientes(empresaId, setClientes);
    const unsubV = ouvirVendedores(empresaId, setVendedores);
    const unsubChat = ouvirTodasConversas(empresaId, setConversas);
    const unsubE = ouvirEmpresa(empresaId, (emp) => {
      setDiasInatividade(emp?.diasInatividade ?? DIAS_INATIVIDADE_PADRAO);
    });
    return () => {
      unsubC();
      unsubV();
      unsubE();
      unsubChat();
    };
  }, [empresaId]);

  // Última conversa por cliente: vínculo direto (clienteId), telefone (últimos 8 dígitos) ou nome/razão igual.
  const ultimaConversaDe = useMemo(() => {
    const norm = (s?: string) => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const fim8 = (s?: string) => { const d = (s ?? '').replace(/\D/g, ''); return d.length >= 8 ? d.slice(-8) : ''; };
    const porId = new Map<string, string>(), porTel = new Map<string, string>(), porNome = new Map<string, string>();
    const maior = (m: Map<string, string>, k: string, v: string) => { if (k && v > (m.get(k) ?? '')) m.set(k, v); };
    for (const cv of conversas) {
      if (!cv.ultimaEm) continue;
      if (cv.clienteId) maior(porId, cv.clienteId, cv.ultimaEm);
      maior(porTel, fim8(cv.telefone ?? cv.contato), cv.ultimaEm);
      maior(porNome, norm(cv.nome), cv.ultimaEm);
    }
    return (c: Cliente): string | undefined => {
      const cands = [porId.get(c.id), porTel.get(fim8(c.telefone)), porNome.get(norm(c.razao)), porNome.get(norm(c.nome))].filter(Boolean) as string[];
      return cands.sort().pop();
    };
  }, [conversas]);

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
    if (filtro === 'inat') lista = lista.filter((c) => diasSemAtend(c) > diasInatividade);
    if (filtro === 'risco') lista = lista.filter((c) => diasSemAtend(c) >= inicioRisco && diasSemAtend(c) <= diasInatividade);
    if (filtro === 'at') lista = lista.filter((c) => diasSemAtend(c) < inicioRisco);

    // Período da última conversa (datas no fuso do usuário, inclusive nos dois extremos).
    if (conversaDe || conversaAte) {
      lista = lista.filter((c) => {
        const u = ultimaConversaDe(c);
        if (!u) return false;
        const dia = new Date(u).toLocaleDateString('sv-SE');
        return (!conversaDe || dia >= conversaDe) && (!conversaAte || dia <= conversaAte);
      });
    }

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
  }, [listaBase, filtro, busca, diasInatividade, inicioRisco, conversaDe, conversaAte, ultimaConversaDe]);

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
            <option value="inat">Inativos (+{diasInatividade} dias)</option>
            <option value="risco">
              Risco ({inicioRisco}-{diasInatividade} dias)
            </option>
            <option value="at">Ativos (até {Math.max(0, inicioRisco - 1)} dias)</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs font-bold text-ink-soft">
            Última conversa de
            <input type="date" value={conversaDe} onChange={(e) => setConversaDe(e.target.value)} className="rounded-xl border border-line px-2.5 py-1.5 text-sm text-ink outline-none focus:ring-2 focus:ring-teal-500/30" />
            até
            <input type="date" value={conversaAte} onChange={(e) => setConversaAte(e.target.value)} className="rounded-xl border border-line px-2.5 py-1.5 text-sm text-ink outline-none focus:ring-2 focus:ring-teal-500/30" />
          </label>
          <button
            onClick={() => { const h = new Date().toLocaleDateString('sv-SE'); setConversaDe(h); setConversaAte(h); }}
            className="rounded-xl border border-line px-3 py-1.5 text-xs font-bold text-ink hover:bg-surface"
          >
            Hoje
          </button>
          {(conversaDe || conversaAte) && (
            <button onClick={() => { setConversaDe(''); setConversaAte(''); }} className="rounded-xl border border-line px-3 py-1.5 text-xs font-bold text-ink-soft hover:bg-surface">
              Limpar período
            </button>
          )}
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
              <th className="text-left px-4 py-2.5 font-bold">Dias sem compra</th>
              <th className="text-left px-4 py-2.5 font-bold">Última conversa</th>
              <th className="text-right px-4 py-2.5 font-bold">Total geral</th>
              <th className="text-left px-4 py-2.5 font-bold">Vendedor</th>
            </tr>
          </thead>
          <tbody>
            {listaFiltrada.map((c) => {
              const dias = diasSemAtend(c);
              const status = statusInfo(dias, diasInatividade);
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
                  <td className="px-4 py-2.5 font-bold whitespace-nowrap" style={{ color: status.cor }}>
                    {dias >= 9999 ? 'Sem compra' : `${dias} ${dias === 1 ? 'dia' : 'dias'}`}
                  </td>
                  <td className="px-4 py-2.5 text-ink-soft whitespace-nowrap">
                    {(() => {
                      const u = ultimaConversaDe(c);
                      if (!u) return '—';
                      const dd = Math.floor((Date.now() - new Date(u).getTime()) / 86400000);
                      return (
                        <>
                          {new Date(u).toLocaleDateString('pt-BR')} às {new Date(u).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          <span className="text-xs block">{dd <= 0 ? 'hoje' : `há ${dd} ${dd === 1 ? 'dia' : 'dias'}`}</span>
                        </>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold text-ink">{formatarMoeda(totalGeralReal(c) ?? 0)}</td>
                  <td className="px-4 py-2.5 text-ink-soft">{vend?.nome ?? c.vend_nome ?? '—'}</td>
                </tr>
              );
            })}
            {listaFiltrada.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-ink-soft text-sm">
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
          diasInatividade={diasInatividade}
          onClose={() => setSelecionado(null)}
        />
      )}
    </div>
  );
}
