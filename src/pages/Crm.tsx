import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  ouvirClientes,
  ouvirVendedores,
  ouvirEmpresa,
  atualizarCampoCliente,
  salvarFiltrosCrm,
  salvarColunasCrm,
} from '../lib/crmData';
import { CRM_COLUNAS_PADRAO, MAX_COLUNAS_CRM, type Cliente, type ColunaCrm, type FiltroCrm, type Vendedor } from '../types';
import { DIAS_INATIVIDADE_PADRAO, cartaoVisivelPara, clientePassaFiltro, formatarMoeda, valorCliente } from '../lib/crmLogic';
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

// Paleta cíclica só pra dar uma cor de destaque no topo de cada coluna —
// colunas são livres/personalizadas, não têm um significado fixo que
// justifique uma cor "certa" pra cada uma.
const PALETA_CORES = ['#2980B9', '#8E6FBE', '#1791A8', '#E67E22', '#27AE60', '#C0392B', '#1E7A46', '#4C51BF'];

/** Quadro Kanban do funil de vendas — colunas 100% personalizáveis pela
 * empresa (até MAX_COLUNAS_CRM), com arrastar-e-soltar nativo (HTML5 DnD)
 * pra mover cliente entre colunas. Uma coluna marcada como "fechamento"
 * conta como venda concluída pra fins de comissão (pede vendedor + valor
 * combinado ao soltar o card lá). */
export default function Crm() {
  const { empresa, perfil, sessaoVendedor, papel } = useAuth();
  const empresaId = empresa?.id;
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [busca, setBusca] = useState('');
  const [detalheCliente, setDetalheCliente] = useState<Cliente | null>(null);
  const [arrastandoSobre, setArrastandoSobre] = useState<string | null>(null);

  const [pendMove, setPendMove] = useState<{ cliente: Cliente; destino: string } | null>(null);
  const [vendedorEscolhido, setVendedorEscolhido] = useState('');
  const [valorOrcamento, setValorOrcamento] = useState('');

  // Colunas personalizadas do quadro — vêm do doc da empresa (live). Toda
  // empresa nova começa só com 1 coluna ("Novo"); o resto é criado/editado
  // por quem usa o CRM (admin ou vendedor).
  const [colunas, setColunas] = useState<ColunaCrm[]>(CRM_COLUNAS_PADRAO);
  const [editandoColunaId, setEditandoColunaId] = useState<string | null>(null);
  const [nomeColunaEdit, setNomeColunaEdit] = useState('');
  const [salvandoColuna, setSalvandoColuna] = useState(false);

  // Filtros personalizados do quadro — mesmo padrão das colunas.
  const [filtros, setFiltros] = useState<FiltroCrm[]>([]);
  const [filtroAtivoId, setFiltroAtivoId] = useState<string | null>(null);
  const [modalFiltro, setModalFiltro] = useState<{ editandoId: string | null } | null>(null);
  const [formFiltro, setFormFiltro] = useState(FILTRO_VAZIO);
  const [salvandoFiltro, setSalvandoFiltro] = useState(false);
  const [diasInatividade, setDiasInatividade] = useState<number>(empresa?.diasInatividade ?? DIAS_INATIVIDADE_PADRAO);

  useEffect(() => {
    if (!empresaId) return;
    const unsubC = ouvirClientes(empresaId, setClientes);
    const unsubV = ouvirVendedores(empresaId, setVendedores);
    const unsubE = ouvirEmpresa(empresaId, (emp) => {
      setFiltros(emp?.crmFiltros ?? []);
      setColunas(emp?.crmColunas && emp.crmColunas.length > 0 ? emp.crmColunas : CRM_COLUNAS_PADRAO);
      setDiasInatividade(emp?.diasInatividade ?? DIAS_INATIVIDADE_PADRAO);
    });
    return () => {
      unsubC();
      unsubV();
      unsubE();
    };
  }, [empresaId]);

  const ehAdmin = papel === 'admin';
  const loginAtual = ehAdmin ? undefined : sessaoVendedor?.vendedor.login;
  const nomeAtual = ehAdmin ? perfil?.nome : sessaoVendedor?.vendedor.nome;

  const colunaPrincipalId = colunas[0]?.id;

  const cardsPorColuna = useMemo(() => {
    const mapa = new Map<string, Cliente[]>(colunas.map((c) => [c.id, []]));
    for (const c of clientes) {
      if (!cartaoVisivelPara(c, ehAdmin ? 'admin' : 'vendedor', loginAtual, nomeAtual)) continue;
      const alvo = c.crmColunaId && mapa.has(c.crmColunaId) ? c.crmColunaId : colunaPrincipalId;
      if (alvo) mapa.get(alvo)?.push(c);
    }
    return mapa;
  }, [clientes, colunas, colunaPrincipalId, ehAdmin, loginAtual, nomeAtual]);

  const totalEmpresa = useMemo(() => clientes.reduce((s, c) => s + valorCliente(c), 0) || 1, [clientes]);

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

  // ---- Filtros personalizados ----

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

  // ---- Colunas personalizadas ----

  async function adicionarColuna() {
    if (!empresaId || colunas.length >= MAX_COLUNAS_CRM) return;
    const novaLista = [...colunas, { id: `coluna-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, nome: 'Novo' }];
    setSalvandoColuna(true);
    try {
      await salvarColunasCrm(empresaId, novaLista);
    } catch (err) {
      console.error('Erro ao criar coluna:', err);
      alert('Não foi possível criar a coluna. Tente novamente em instantes.');
    } finally {
      setSalvandoColuna(false);
    }
  }

  function iniciarRenomeacao(col: ColunaCrm) {
    setEditandoColunaId(col.id);
    setNomeColunaEdit(col.nome);
  }

  async function salvarRenomeacao() {
    if (!empresaId || !editandoColunaId) return;
    const nome = nomeColunaEdit.trim() || 'Novo';
    const idEditado = editandoColunaId;
    setEditandoColunaId(null);
    const novaLista = colunas.map((c) => (c.id === idEditado ? { ...c, nome } : c));
    try {
      await salvarColunasCrm(empresaId, novaLista);
    } catch (err) {
      console.error('Erro ao renomear coluna:', err);
      alert('Não foi possível renomear a coluna. Tente novamente em instantes.');
    }
  }

  async function alternarFechamento(col: ColunaCrm) {
    if (!empresaId) return;
    const novaLista = colunas.map((c) => (c.id === col.id ? { ...c, fechamento: !c.fechamento } : c));
    try {
      await salvarColunasCrm(empresaId, novaLista);
    } catch (err) {
      console.error('Erro ao atualizar coluna:', err);
      alert('Não foi possível atualizar a coluna. Tente novamente em instantes.');
    }
  }

  async function excluirColuna(col: ColunaCrm) {
    if (!empresaId || colunas.length <= 1) return;
    if (!confirm(`Excluir a coluna "${col.nome}"? Os clientes nela voltam pra primeira coluna do quadro.`)) return;
    const restante = colunas.filter((c) => c.id !== col.id);
    try {
      await salvarColunasCrm(empresaId, restante);
      const afetados = clientes.filter((c) => c.crmColunaId === col.id);
      await Promise.all(
        afetados.map((c) => atualizarCampoCliente(empresaId, c.id, { crmColunaId: restante[0].id }))
      );
    } catch (err) {
      console.error('Erro ao excluir coluna:', err);
      alert('Não foi possível excluir a coluna. Tente novamente em instantes.');
    }
  }

  // ---- Mover cliente entre colunas ----

  function onDrop(destinoId: string, cliente: Cliente) {
    setArrastandoSobre(null);
    if (!empresaId) return;
    if (!ehAdmin && cliente.crmVendedorLogin && cliente.crmVendedorLogin !== loginAtual) {
      alert('Esse cliente já está sendo atendido por outro vendedor.');
      return;
    }
    const destino = colunas.find((c) => c.id === destinoId);
    if (!destino) return;
    if (destino.fechamento) {
      setPendMove({ cliente, destino: destino.id });
      setVendedorEscolhido(cliente.crmVendedorLogin ?? loginAtual ?? '');
      setValorOrcamento(cliente.crmOrcamentoValor != null ? String(cliente.crmOrcamentoValor) : '');
      return;
    }
    atualizarCampoCliente(empresaId, cliente.id, {
      crmColunaId: destino.id,
      crmColunaChangedAt: new Date().toISOString(),
    }).catch((err) => {
      console.error('Erro ao mover cliente:', err);
      alert('Não foi possível mover o cliente. Tente novamente em instantes.');
    });
  }

  async function confirmarPendencia() {
    if (!pendMove || !empresaId) return;
    const { cliente, destino } = pendMove;
    const loginParaUsar = ehAdmin ? vendedorEscolhido : loginAtual;
    if (!loginParaUsar) {
      alert('Escolha um vendedor responsável.');
      return;
    }
    if (!valorOrcamento || Number(valorOrcamento) <= 0) {
      alert('Informe o valor combinado.');
      return;
    }
    try {
      await atualizarCampoCliente(empresaId, cliente.id, {
        crmColunaId: destino,
        crmColunaChangedAt: new Date().toISOString(),
        crmVendedorLogin: loginParaUsar,
        crmOrcamentoValor: Number(valorOrcamento),
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

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
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
          {filtros.length}/{MAX_FILTROS} filtros · {colunas.length}/{MAX_COLUNAS_CRM} colunas
        </span>
      </div>

      <div
        className="grid gap-2.5 pb-3 items-start overflow-x-auto"
        style={{
          gridTemplateColumns: `repeat(${colunas.length + (colunas.length < MAX_COLUNAS_CRM ? 1 : 0)},minmax(150px,1fr))`,
        }}
      >
        {colunas.map((col, i) => {
          const cardsBrutos = cardsPorColuna.get(col.id) ?? [];
          const cards = filtrar(cardsBrutos);
          const soma = cardsBrutos.reduce((s, c) => s + valorCliente(c), 0);
          const pct = Math.round((soma / totalEmpresa) * 100);
          const cor = PALETA_CORES[i % PALETA_CORES.length];
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
              <div className="px-2.5 py-2 border-b border-line shrink-0">
                <div className="h-1 -mt-2 -mx-2.5 mb-2 rounded-t-xl" style={{ backgroundColor: cor }} />
                <div className="flex items-center gap-1">
                  {editandoColunaId === col.id ? (
                    <input
                      autoFocus
                      value={nomeColunaEdit}
                      onChange={(e) => setNomeColunaEdit(e.target.value)}
                      onBlur={salvarRenomeacao}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') setEditandoColunaId(null);
                      }}
                      className="min-w-0 flex-1 text-[11px] font-extrabold text-ink border border-teal-500 rounded px-1 py-0.5 outline-none"
                    />
                  ) : (
                    <>
                      <span className="text-[11px] font-extrabold text-ink leading-tight truncate flex-1">
                        {col.nome}
                      </span>
                      <button
                        type="button"
                        onClick={() => iniciarRenomeacao(col)}
                        title="Renomear coluna"
                        className="w-4 h-4 shrink-0 text-ink-soft hover:text-ink text-[10px]"
                      >
                        ✎
                      </button>
                      {colunas.length > 1 && (
                        <button
                          type="button"
                          onClick={() => excluirColuna(col)}
                          title="Excluir coluna"
                          className="w-4 h-4 shrink-0 text-ink-soft hover:text-red-500 text-[11px] font-bold"
                        >
                          ×
                        </button>
                      )}
                    </>
                  )}
                </div>
                <label className="flex items-center gap-1 mt-1 text-[9px] text-ink-soft cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!!col.fechamento}
                    onChange={() => alternarFechamento(col)}
                    className="w-3 h-3"
                  />
                  Fechamento (conta comissão)
                </label>
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
                      <div className="text-ink-soft">{formatarMoeda(valorCliente(c))}</div>
                      {vend && <div className="text-teal-600 truncate">👤 {vend.nome}</div>}
                    </div>
                  );
                })}
                {cards.length === 0 && <div className="text-[10px] text-ink-soft text-center py-4">Vazio</div>}
              </div>
            </div>
          );
        })}

        {colunas.length < MAX_COLUNAS_CRM && (
          <button
            type="button"
            onClick={adicionarColuna}
            disabled={salvandoColuna}
            className="rounded-xl border-2 border-dashed border-line text-ink-soft text-xs font-bold flex items-center justify-center min-h-[220px] hover:bg-surface hover:text-ink hover:border-teal-500/50 transition-colors disabled:opacity-60"
          >
            {salvandoColuna ? 'Criando...' : '+ Mais colunas'}
          </button>
        )}
      </div>

      {detalheCliente && (
        <ClienteDetalheModal
          empresaId={empresaId}
          cliente={detalheCliente}
          vendedores={vendedores}
          ehAdmin={ehAdmin}
          diasInatividade={diasInatividade}
          onClose={() => setDetalheCliente(null)}
        />
      )}

      {pendMove && (
        <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4" onClick={() => setPendMove(null)}>
          <div className="bg-white rounded-2xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-extrabold text-ink mb-1">Mover "{pendMove.cliente.razao ?? pendMove.cliente.nome}"</h2>
            <p className="text-xs text-ink-soft mb-4">
              para {colunas.find((c) => c.id === pendMove.destino)?.nome} — essa coluna conta como venda concluída.
            </p>

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

            <div className="mb-4">
              <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1">Valor combinado (R$)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={valorOrcamento}
                onChange={(e) => setValorOrcamento(e.target.value)}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500/30"
              />
            </div>

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
