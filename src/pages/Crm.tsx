import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ouvirClientes, ouvirVendedores, ouvirEmpresa, atualizarCampoCliente, salvarFiltrosCrm } from '../lib/crmData';
import { KB_COLUNAS, type Cliente, type FiltroCrm, type KbColunaId, type Vendedor } from '../types';
import {
  calcularMovimentoCliente,
  clientePassaFiltro,
  formatarMoeda,
  kbValorCliente,
  colunaDoCliente,
} from '../lib/crmLogic';
import ClienteDetalheModal from '../components/ClienteDetalheModal';
import { IconCrm } from '../components/NavIcons';

const MAX_FILTROS = 10;

const FILTRO_VAZIO = {
  nome: '',
  texto: '',
  cidade: '',
  uf: '',
  vendedorLogin: '',
  valorMin: '',
  valorMax: '',
};

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

  // Filtros personalizados do quadro — vêm do doc da empresa (live), pra
  // qualquer login (admin ou vendedor) ver e usar os mesmos filtros.
  const [filtros, setFiltros] = useState<FiltroCrm[]>([]);
  const [filtroAtivoId, setFiltroAtivoId] = useState<string | null>(null);
  const [modalFiltro, setModalFiltro] = useState<{ editandoId: string | null } | null>(null);
  const [formFiltro, setFormFiltro] = useState(FILTRO_VAZIO);
  const [salvandoFiltro, setSalvandoFiltro] = useState(false);

  useEffect(() => {
    if (!empresaId) return;
    const unsubC = ouvirClientes(empresaId, setClientes);
    const unsubV = ouvirVendedores(empresaId, setVendedores);
    const unsubE = ouvirEmpresa(empresaId, (emp) => setFiltros(emp?.crmFiltros ?? []));
    return () => {
      unsubC();
      unsubV();
      unsubE();
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

  const filtroAtivo = filtros.find((f) => f.id === filtroAtivoId) ?? null;

  function filtrar(lista: Cliente[]) {
    let out = lista;
    if (busca.trim()) {
      const termo = busca.trim().toLowerCase();
      out = out.filter(
        (c) =>
          (c.razao ?? c.nome ?? '').toLowerCase().includes(termo) ||
          c.cod.toLowerCase().includes(termo) ||
          (c.telefone ?? '').includes(termo)
      );
    }
    if (filtroAtivo) out = out.filter((c) => clientePassaFiltro(c, filtroAtivo));
    return out;
  }

  function abrirNovoFiltro() {
    if (filtros.length >= MAX_FILTROS) return;
    setFormFiltro(FILTRO_VAZIO);
    setModalFiltro({ editandoId: null });
  }

  function abrirEditarFiltro(f: FiltroCrm) {
    setFormFiltro({
      nome: f.nome,
      texto: f.texto ?? '',
      cidade: f.cidade ?? '',
      uf: f.uf ?? '',
      vendedorLogin: f.vendedorLogin ?? '',
      valorMin: f.valorMin != null ? String(f.valorMin) : '',
      valorMax: f.valorMax != null ? String(f.valorMax) : '',
    });
    setModalFiltro({ editandoId: f.id });
  }

  async function salvarFiltro() {
    if (!empresaId || !modalFiltro) return;
    const nome = formFiltro.nome.trim();
    if (!nome) {
      alert('Dê um nome para o filtro.');
      return;
    }
    const dados: FiltroCrm = {
      id: modalFiltro.editandoId ?? `filtro-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      nome,
      ...(formFiltro.texto.trim() && { texto: formFiltro.texto.trim() }),
      ...(formFiltro.cidade.trim() && { cidade: formFiltro.cidade.trim() }),
      ...(formFiltro.uf.trim() && { uf: formFiltro.uf.trim().toUpperCase() }),
      ...(formFiltro.vendedorLogin && { vendedorLogin: formFiltro.vendedorLogin }),
      ...(formFiltro.valorMin.trim() && { valorMin: Number(formFiltro.valorMin) }),
      ...(formFiltro.valorMax.trim() && { valorMax: Number(formFiltro.valorMax) }),
    };
    const novaLista = modalFiltro.editandoId
      ? filtros.map((f) => (f.id === modalFiltro.editandoId ? dados : f))
      : [...filtros, dados];
    if (novaLista.length > MAX_FILTROS) {
      alert(`Você já tem o máximo de ${MAX_FILTROS} filtros.`);
      return;
    }
    setSalvandoFiltro(true);
    try {
      await salvarFiltrosCrm(empresaId, novaLista);
      setModalFiltro(null);
    } catch (err) {
      console.error('Erro ao salvar filtro:', err);
      alert('Não foi possível salvar o filtro. Tente novamente em instantes.');
    } finally {
      setSalvandoFiltro(false);
    }
  }

  async function excluirFiltroAtual() {
    if (!empresaId || !modalFiltro?.editandoId) return;
    if (!confirm('Excluir este filtro?')) return;
    setSalvandoFiltro(true);
    try {
      const novaLista = filtros.filter((f) => f.id !== modalFiltro.editandoId);
      await salvarFiltrosCrm(empresaId, novaLista);
      if (filtroAtivoId === modalFiltro.editandoId) setFiltroAtivoId(null);
      setModalFiltro(null);
    } catch (err) {
      console.error('Erro ao excluir filtro:', err);
      alert('Não foi possível excluir o filtro. Tente novamente em instantes.');
    } finally {
      setSalvandoFiltro(false);
    }
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
      atualizarCampoCliente(empresaId, cliente.id, resultado.patch).catch((err) => {
        console.error('Erro ao mover cliente:', err);
        alert('Não foi possível mover o cliente. Tente novamente em instantes.');
      });
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
    try {
      await atualizarCampoCliente(empresaId, cliente.id, {
        crmStage: stage,
        crmOrigem: stage === 'atendimento' ? undefined : origem,
        crmVendedorLogin: loginParaUsar,
        crmOrcamentoValor: precisaValor ? Number(valorOrcamento) : cliente.crmOrcamentoValor,
        crmStageChangedAt: new Date().toISOString(),
      });
      setPendMove(null);
    } catch (err) {
      console.error('Erro ao mover cliente:', err);
      alert('Não foi possível mover o cliente. Tente novamente em instantes.');
    }
  }

  if (!empresaId) return null;

  return (
    <div className="p-6 w-full">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h1 className="text-base font-extrabold text-ink flex items-center gap-2">
          <IconCrm /> CRM — Funil de vendas
        </h1>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar cliente por nome, código ou telefone..."
          className="w-full sm:w-80 rounded-xl border border-line px-3.5 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500/30"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        <span className="text-[11px] font-bold text-ink-soft uppercase tracking-wide mr-1">Filtros</span>
        {filtros.map((f) => (
          <div
            key={f.id}
            className={`group flex items-center gap-0.5 rounded-full border pl-3 pr-1 py-1 text-xs font-semibold transition-colors ${
              filtroAtivoId === f.id
                ? 'bg-teal-500/10 border-teal-500 text-teal-600'
                : 'border-line text-ink-soft hover:bg-surface'
            }`}
          >
            <button
              type="button"
              onClick={() => setFiltroAtivoId(filtroAtivoId === f.id ? null : f.id)}
              className="whitespace-nowrap"
              title="Clique para ativar/desativar este filtro"
            >
              {f.nome}
            </button>
            <button
              type="button"
              onClick={() => abrirEditarFiltro(f)}
              title="Editar filtro"
              className="w-5 h-5 rounded-full hover:bg-line/60 flex items-center justify-center text-[10px] shrink-0"
            >
              ✎
            </button>
          </div>
        ))}
        {filtros.length < MAX_FILTROS ? (
          <button
            type="button"
            onClick={abrirNovoFiltro}
            className="rounded-full border border-dashed border-line text-ink-soft text-xs font-bold px-3 py-1 hover:bg-surface hover:text-ink"
          >
            + Novo filtro
          </button>
        ) : (
          <span className="text-[10px] text-ink-soft">Limite de {MAX_FILTROS} filtros atingido</span>
        )}
        <span className="text-[10px] text-ink-soft ml-auto">
          {filtros.length}/{MAX_FILTROS} filtros
        </span>
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

      {modalFiltro && (
        <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4" onClick={() => setModalFiltro(null)}>
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-extrabold text-ink mb-1">
              {modalFiltro.editandoId ? 'Editar filtro' : 'Novo filtro'}
            </h2>
            <p className="text-xs text-ink-soft mb-4">
              Preencha só os critérios que quiser combinar. Deixe em branco o que não importa pra esse filtro.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1">Nome do filtro *</label>
                <input
                  value={formFiltro.nome}
                  onChange={(e) => setFormFiltro((f) => ({ ...f, nome: e.target.value }))}
                  placeholder="Ex.: SP alto valor"
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500/30"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1">
                  Texto (nome, código ou telefone)
                </label>
                <input
                  value={formFiltro.texto}
                  onChange={(e) => setFormFiltro((f) => ({ ...f, texto: e.target.value }))}
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500/30"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1">Cidade</label>
                  <input
                    value={formFiltro.cidade}
                    onChange={(e) => setFormFiltro((f) => ({ ...f, cidade: e.target.value }))}
                    className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1">UF</label>
                  <input
                    value={formFiltro.uf}
                    maxLength={2}
                    onChange={(e) => setFormFiltro((f) => ({ ...f, uf: e.target.value.toUpperCase() }))}
                    className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500/30 uppercase"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1">Vendedor</label>
                <select
                  value={formFiltro.vendedorLogin}
                  onChange={(e) => setFormFiltro((f) => ({ ...f, vendedorLogin: e.target.value }))}
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500/30"
                >
                  <option value="">Todos</option>
                  {vendedores.map((v) => (
                    <option key={v.id} value={v.login}>
                      {v.nome}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1">Valor mínimo (R$)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formFiltro.valorMin}
                    onChange={(e) => setFormFiltro((f) => ({ ...f, valorMin: e.target.value }))}
                    className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1">Valor máximo (R$)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formFiltro.valorMax}
                    onChange={(e) => setFormFiltro((f) => ({ ...f, valorMax: e.target.value }))}
                    className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500/30"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button
                onClick={salvarFiltro}
                disabled={salvandoFiltro}
                className="flex-1 rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold py-2.5 hover:opacity-90 disabled:opacity-60"
              >
                {salvandoFiltro ? 'Salvando...' : 'Salvar filtro'}
              </button>
              <button
                onClick={() => setModalFiltro(null)}
                className="rounded-xl border border-line text-ink text-sm font-bold px-4 py-2.5 hover:bg-surface"
              >
                Cancelar
              </button>
            </div>
            {modalFiltro.editandoId && (
              <button
                onClick={excluirFiltroAtual}
                disabled={salvandoFiltro}
                className="w-full text-center mt-3 text-xs font-bold text-red-500 hover:text-red-600 disabled:opacity-60"
              >
                Excluir filtro
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
