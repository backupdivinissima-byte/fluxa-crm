import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ouvirClientes, ouvirVendedores, atualizarCampoCliente } from '../lib/crmData';
import { matchVendedor } from '../lib/crmLogic';
import type { Cliente, Vendedor } from '../types';
import { IconOrcamento } from '../components/NavIcons';

/** Lançamento rápido de orçamento — disponível pra qualquer login (vendedor
 * vê só os próprios clientes; administrador vê todos e escolhe o
 * vendedor responsável). Ao registrar, o cliente cai automaticamente na
 * coluna de Orçamento do quadro CRM (aba "CRM") e fica lá até alguém
 * movê-lo manualmente pra outra etapa — mesma regra de negócio que já
 * vale pra quando o card é arrastado no Kanban. */
export default function LancarOrcamento() {
  const { empresa, papel, sessaoVendedor, perfil } = useAuth();
  const empresaId = empresa?.id;
  const ehAdmin = papel === 'admin';

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [clienteId, setClienteId] = useState('');
  const [vendedorEscolhido, setVendedorEscolhido] = useState('');
  const [tipo, setTipo] = useState<'live' | 'catalogo'>('live');
  const [valor, setValor] = useState('');
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [enviando, setEnviando] = useState(false);
  const [sucesso, setSucesso] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!empresaId) return;
    const unsubC = ouvirClientes(empresaId, setClientes);
    const unsubV = ouvirVendedores(empresaId, setVendedores);
    return () => {
      unsubC();
      unsubV();
    };
  }, [empresaId]);

  const loginAtual = ehAdmin ? undefined : sessaoVendedor?.vendedor.login;
  const nomeAtual = ehAdmin ? perfil?.nome : sessaoVendedor?.vendedor.nome;

  // Vendedor só lança orçamento pros próprios clientes; administrador vê e
  // escolhe entre todos os clientes da empresa.
  const clientesVisiveis = useMemo(() => {
    if (ehAdmin) return clientes;
    return clientes.filter((c) => matchVendedor(c, loginAtual ?? '', nomeAtual));
  }, [clientes, ehAdmin, loginAtual, nomeAtual]);

  if (!empresaId) return null;

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    if (!clienteId) {
      setErro('Selecione um cliente.');
      return;
    }
    const valorNum = Number(valor);
    if (!valorNum || valorNum <= 0) {
      setErro('Informe o valor do orçamento.');
      return;
    }
    const loginParaUsar = ehAdmin ? vendedorEscolhido : loginAtual;
    if (!loginParaUsar) {
      setErro('Selecione o vendedor responsável.');
      return;
    }
    setEnviando(true);
    try {
      await atualizarCampoCliente(empresaId!, clienteId, {
        crmStage: 'orcamento',
        crmOrigem: tipo,
        crmVendedorLogin: loginParaUsar,
        crmOrcamentoValor: valorNum,
        crmStageChangedAt: data ? new Date(`${data}T12:00:00`).toISOString() : new Date().toISOString(),
      });
      setSucesso(true);
      setClienteId('');
      setValor('');
      setTimeout(() => setSucesso(false), 5000);
    } catch (err) {
      console.error('Erro ao lançar orçamento:', err);
      setErro('Não foi possível lançar o orçamento. Tente novamente em instantes.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="p-6 w-full max-w-lg">
      <h1 className="text-base font-extrabold text-ink flex items-center gap-2 mb-1">
        <IconOrcamento /> Lançar orçamento
      </h1>
      <p className="text-sm text-ink-soft mb-6">
        Registre um orçamento pra um cliente. Ele já cai automaticamente na coluna de Orçamento do quadro CRM e fica
        lá até ser movido manualmente pra outra etapa.
      </p>

      <form onSubmit={registrar} className="bg-white border border-line rounded-2xl p-6 space-y-4">
        <div>
          <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">Cliente</label>
          <select
            value={clienteId}
            onChange={(e) => setClienteId(e.target.value)}
            required
            className="w-full rounded-xl border border-line px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
          >
            <option value="">Selecione o cliente</option>
            {clientesVisiveis.map((c) => (
              <option key={c.id} value={c.id}>
                {c.razao ?? c.nome ?? c.cod}
              </option>
            ))}
          </select>
        </div>

        {ehAdmin && (
          <div>
            <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
              Vendedor responsável
            </label>
            <select
              value={vendedorEscolhido}
              onChange={(e) => setVendedorEscolhido(e.target.value)}
              required
              className="w-full rounded-xl border border-line px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
            >
              <option value="">Selecione...</option>
              {vendedores.map((v) => (
                <option key={v.id} value={v.login}>
                  {v.nome}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
            Tipo de orçamento
          </label>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as 'live' | 'catalogo')}
            className="w-full rounded-xl border border-line px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
          >
            <option value="live">Orçamento Live</option>
            <option value="catalogo">Orçamento Catálogo</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
            Valor do orçamento (R$)
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            required
            className="w-full rounded-xl border border-line px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">Data</label>
          <input
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="w-full rounded-xl border border-line px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
          />
        </div>

        {erro && <p className="text-xs text-red-500">{erro}</p>}
        {sucesso && (
          <p className="text-xs text-teal-600 font-bold">
            Orçamento lançado! O cliente já está na coluna de Orçamento do CRM.
          </p>
        )}

        <button
          type="submit"
          disabled={enviando}
          className="w-full rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold py-2.5 hover:opacity-90 disabled:opacity-60"
        >
          {enviando ? 'Registrando...' : '✓ Registrar orçamento'}
        </button>
      </form>
    </div>
  );
}
