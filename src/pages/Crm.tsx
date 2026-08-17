import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ouvirClientes, ouvirVendedores, atualizarCampoCliente } from '../lib/crmData';
import { KB_COLUNAS, type Cliente, type KbColunaId, type Vendedor } from '../types';
import { calcularMovimentoCliente, formatarMoeda, kbValorCliente, colunaDoCliente } from '../lib/crmLogic';
import ClienteDetalheModal from '../components/ClienteDetalheModal';

/** Quadro Kanban do funil de vendas — 8 colunas em CSS Grid (mesma correção
 * de largura já aplicada na Divinissima: repeat(8,minmax(150px,1fr))), com
 * arrastar-e-soltar nativo (HTML5 DnD) pra mover cliente entre estágios. */
export default function Crm() {
  const { empresa, perfil, sessaoVendedor, papel } = useAuth();
  const empresaId = empresa?.id;
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [busca, setBusca] = useState('');
  const [detalheCliente, setDetalheCliente] = useState<Cliente | null>(null);
  const [arrastandoSobre, setArrastandoSobre] = useState<KbColunaId | null>(null);

  const [pendMove, setPendMove] = useState<{ cliente: Cliente; destino: KbColunaId } | null>(null);
  const [vendedorEscolhido, setVendedorEscolhido] = useState('');
  const [valorOrcamento, setValorOrcamento] = useState('');

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
  const vendedorAtualObj = ehAdmin ? ('admin' as const) : sessaoVendedor?.vendedor;

  const colunas = useMemo(() => {
    const mapa = new Map<KbColunaId, Cliente[]>(KB_COLUNAS.map((c) => [c.id, []]));
    for (const c of clientes) {
      const destino = colunaDoCliente(c, ehAdmin ? 'admin' : 'vendedor', loginAtual, nomeAtual);
      if (destino) mapa.get(destino)?.push(c);
    }
    return mapa;
  }, [clientes, ehAdmin, loginAtual, nomeAtual]);

  const totalEmpresa = useMemo(() => clientes.reduce((s, c) => s + (c.totalGeral ?? 0), 0) || 1, [clientes]);

  function filtrar(lista: Cliente[]) {
    if (!busca.trim()) return lista;
    const termo = busca.trim().toLowerCase();
    return lista.filter(
      (c) =>
        (c.razao ?? c.nome ?? '').toLowerCase().includes(termo) ||
        c.cod.toLowerCase().includes(termo) ||
        (c.telefone ?? '').includes(termo)
    );
  }

  function onDrop(destino: KbColunaId, cliente: Cliente) {
    setArrastandoSobre(null);
    if (!vendedorAtualObj) return;
    const resultado = calcularMovimentoCliente(cliente, destino, vendedorAtualObj);
    if (!resultado.ok) {
      alert(resultado.erro ?? 'Não foi possível mover este cliente.');
      return;
    }
    if (resultado.precisaVendedor || resultado.precisaValorOrcamento) {
      setPendMove({ cliente, destino });
      setVendedorEscolhido('');
      setValorOrcamento('');
      return;
    }
    if (resultado.patch && empresaId) {
      atualizarCampoCliente(empresaId, cliente.id, resultado.patch);
    }
  }

  async function confirmarPendencia() {
    if (!pendMove || !empresaId) return;
    const { cliente, destino } = pendMove;
    const loginParaUsar = ehAdmin ? vendedorEscolhido : loginAtual;
    if (!loginParaUsar) {
      alert('Escolha um vendedor responsável.');
      return;
    }
    const precisaValor = destino === 'orcamento_live' || destino === 'orcamento_catalogo';
    if (precisaValor && (!valorOrcamento || Number(valorOrcamento) <= 0)) {
      alert('Informe o valor do orçamento.');
      return;
    }
    const origem = destino.includes('catalogo') ? 'catalogo' : 'live';
    const stage = destino === 'atendimento' ? 'atendimento' : destino.startsWith('orcamento') ? 'orcamento' : 'concluido';
    await atualizarCampoCliente(empresaId, cliente.id, {
      crmStage: stage,
      crmOrigem: stage === 'atendimento' ? undefined : origem,
      crmVendedorLogin: loginParaUsar,
      crmOrcamentoValor: precisaValor ? Number(valorOrcamento) : cliente.crmOrcamentoValor,
      crmStageChangedAt: new Date().toISOString(),
    });
    setPendMove(null);
  }

  if (!empresaId) return null;

  return (
    <div className="p-6 w-full">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h1 className="text-base font-extrabold text-ink flex items-center gap-2">📋 CRM — Funil de vendas</h1>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar cliente por nome, código ou telefone..."
          className="w-full sm:w-80 rounded-xl border border-line px-3.5 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500/30"
        />
      </div>

      <div
        className="grid gap-2.5 pb-3 items-start overflow-x-auto"
        style={{ gridTemplateColumns: 'repeat(8,minmax(150px,1fr))' }}
      >
        {KB_COLUNAS.map((col) => {
          const cardsBrutos = colunas.get(col.id) ?? [];
          const cards = filtrar(cardsBrutos);
          const soma = cardsBrutos.reduce((s, c) => s + kbValorCliente(c), 0);
          const pct = Math.round((soma / totalEmpresa) * 100);
          return (
            <div
              key={col.id}
              onDragOver={(e) => {
                e.preventDefault();
                setArrastandoSobre(col.id);
              }}
              onDragLeave={() => setArrastandoSobre(null)}
              onDrop={(e) => {
                e.preventDefault();
                const cod = e.dataTransfer.getData('text/plain');
                const cliente = clientes.find((c) => c.id === cod);
                if (cliente) onDrop(col.id, cliente);
              }}
              className={`bg-surface rounded-xl border flex flex-col max-h-[calc(100vh-230px)] min-h-[220px] overflow-hidden transition-colors ${
                arrastandoSobre === col.id ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-line'
              }`}
            >
              <div className="px-2.5 py-2 border-b border-line shrink-0" style={{ borderTopColor: col.cor }}>
                <div className="h-1 -mt-2 -mx-2.5 mb-2 rounded-t-xl" style={{ backgroundColor: col.cor }} />
                <div className="text-[11px] font-extrabold text-ink leading-tight">{col.titulo}</div>
                {col.sub && <div className="text-[10px] text-ink-soft">{col.sub}</div>}
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-ink-soft">{cardsBrutos.length} cliente(s)</span>
                  <span className="text-[10px] font-bold text-ink">{pct}%</span>
                </div>
                <div className="text-[11px] font-bold text-ink">{formatarMoeda(soma)}</div>
              </div>
              <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
                {cards.map((c) => {
                  const vend = vendedores.find((v) => v.login === c.crmVendedorLogin);
                  return (
                    <div
                      key={c.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', c.id)}
                      onClick={() => setDetalheCliente(c)}
                      className="bg-white rounded-lg border border-line p-2 text-[11px] cursor-pointer hover:shadow-sm active:cursor-grabbing"
                    >
                      <div className="font-bold text-ink truncate">{c.razao ?? c.nome}</div>
                      <div className="text-ink-soft">{formatarMoeda(kbValorCliente(c))}</div>
                      {vend && <div className="text-teal-600 truncate">👤 {vend.nome}</div>}
                    </div>
                  );
                })}
                {cards.length === 0 && <div className="text-[10px] text-ink-soft text-center py-4">Vazio</div>}
              </div>
            </div>
          );
        })}
      </div>

      {detalheCliente && (
        <ClienteDetalheModal
          empresaId={empresaId}
          cliente={detalheCliente}
          vendedores={vendedores}
          ehAdmin={ehAdmin}
          onClose={() => setDetalheCliente(null)}
        />
      )}

      {pendMove && (
        <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4" onClick={() => setPendMove(null)}>
          <div className="bg-white rounded-2xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-extrabold text-ink mb-1">Mover "{pendMove.cliente.razao ?? pendMove.cliente.nome}"</h2>
            <p className="text-xs text-ink-soft mb-4">para {KB_COLUNAS.find((c) => c.id === pendMove.destino)?.titulo}</p>

            {ehAdmin && (
              <div className="mb-4">
                <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1">Vendedor responsável</label>
                <select
                  value={vendedorEscolhido}
                  onChange={(e) => setVendedorEscolhido(e.target.value)}
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500/30"
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

            {(pendMove.destino === 'orcamento_live' || pendMove.destino === 'orcamento_catalogo') && (
              <div className="mb-4">
                <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1">Valor do orçamento (R$)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={valorOrcamento}
                  onChange={(e) => setValorOrcamento(e.target.value)}
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500/30"
                />
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={confirmarPendencia}
                className="flex-1 rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold py-2.5 hover:opacity-90"
              >
                Confirmar
              </button>
              <button
                onClick={() => setPendMove(null)}
                className="rounded-xl border border-line text-ink text-sm font-bold px-4 py-2.5 hover:bg-surface"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
