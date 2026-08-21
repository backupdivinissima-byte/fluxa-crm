import { useState } from 'react';
import type { Cliente, Vendedor } from '../types';
import { DIAS_INATIVIDADE_PADRAO, diasSemAtend, formatarMoeda, statusInfo } from '../lib/crmLogic';
import { atualizarCampoCliente, removerCliente } from '../lib/crmData';

interface Props {
  empresaId: string;
  cliente: Cliente;
  vendedores: Vendedor[];
  ehAdmin: boolean;
  // Prazo de inatividade configurado no Dashboard (30/60/90/personalizado)
  // — opcional só pra não quebrar quem ainda não repassa a prop; usa o
  // padrão de 30 dias nesse caso.
  diasInatividade?: number;
  onClose: () => void;
}

/** Modal de detalhe/edição de um cliente — usado no Kanban e na tela de Clientes. */
export default function ClienteDetalheModal({
  empresaId,
  cliente,
  vendedores,
  ehAdmin,
  diasInatividade = DIAS_INATIVIDADE_PADRAO,
  onClose,
}: Props) {
  const [cnpj, setCnpj] = useState(cliente.cnpj ?? '');
  const [telefone, setTelefone] = useState(cliente.telefone ?? '');
  const [cidade, setCidade] = useState(cliente.cidade ?? '');
  const [codVendedor, setCodVendedor] = useState(cliente.cod_vendedor ?? '');
  const [salvando, setSalvando] = useState(false);

  const dias = diasSemAtend(cliente);
  const status = statusInfo(dias, diasInatividade);
  const nomeVendedorAtual = vendedores.find((v) => v.login === cliente.crmVendedorLogin)?.nome;

  const compras = [cliente.c1, cliente.c2, cliente.c3].filter((v): v is number => typeof v === 'number' && v > 0);
  const produtosOrdenados = Object.entries(cliente.produtos ?? {}).sort((a, b) => b[1] - a[1]);

  async function salvar() {
    setSalvando(true);
    try {
      await atualizarCampoCliente(empresaId, cliente.id, {
        cnpj,
        telefone,
        cidade,
        cod_vendedor: codVendedor || undefined,
      });
      onClose();
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!confirm(`Remover o cliente "${cliente.razao ?? cliente.nome}"? Essa ação não pode ser desfeita.`)) return;
    await removerCliente(empresaId, cliente.id);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-extrabold text-ink">{cliente.razao ?? cliente.nome ?? 'Cliente'}</h2>
            <p className="text-xs text-ink-soft">Código {cliente.cod}</p>
          </div>
          <button onClick={onClose} className="text-ink-soft hover:text-ink text-xl leading-none">
            ×
          </button>
        </div>

        <div className="flex items-center gap-2 mb-5">
          <span
            className="text-xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-full text-white"
            style={{ backgroundColor: status.cor }}
          >
            {status.label}
          </span>
          <span className="text-xs text-ink-soft">{dias === 9999 ? 'sem registro de compra' : `${dias} dias sem compra`}</span>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-5">
          <div>
            <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1">CNPJ</label>
            <input
              value={cnpj}
              onChange={(e) => setCnpj(e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500/30"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1">Telefone</label>
            <input
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500/30"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1">Cidade</label>
            <input
              value={cidade}
              onChange={(e) => setCidade(e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500/30"
            />
          </div>
          {ehAdmin && (
            <div className="col-span-2">
              <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1">
                Vendedor responsável
              </label>
              <select
                value={codVendedor}
                onChange={(e) => setCodVendedor(e.target.value)}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500/30"
              >
                <option value="">— sem vendedor —</option>
                {vendedores.map((v) => (
                  <option key={v.id} value={v.login}>
                    {v.nome}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {cliente.crmVendedorLogin && (
          <p className="text-xs text-ink-soft mb-4">
            Vendedor no funil: <span className="font-bold text-ink">{nomeVendedorAtual ?? cliente.crmVendedorLogin}</span>
          </p>
        )}

        {compras.length > 0 && (
          <div className="mb-5">
            <h3 className="text-xs font-bold text-ink-soft uppercase tracking-wide mb-2">Últimas compras</h3>
            <div className="flex gap-2">
              {compras.map((v, i) => (
                <div key={i} className="flex-1 bg-surface rounded-lg px-3 py-2 text-center">
                  <div className="text-[10px] text-ink-soft uppercase font-bold">Compra {i + 1}</div>
                  <div className="text-sm font-bold text-ink">{formatarMoeda(v)}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-ink-soft mt-2">
              Total geral: <span className="font-bold text-ink">{formatarMoeda(cliente.totalGeral ?? 0)}</span>
            </p>
          </div>
        )}

        {produtosOrdenados.length > 0 && (
          <div className="mb-5">
            <h3 className="text-xs font-bold text-ink-soft uppercase tracking-wide mb-2">Produtos mais comprados</h3>
            <div className="space-y-1.5">
              {produtosOrdenados.slice(0, 5).map(([nome, qtd]) => (
                <div key={nome} className="flex items-center justify-between text-xs">
                  <span className="text-ink-soft">{nome}</span>
                  <span className="font-bold text-ink">{qtd}x</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 pt-3 border-t border-line">
          <button
            onClick={salvar}
            disabled={salvando}
            className="flex-1 rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold py-2.5 hover:opacity-90 disabled:opacity-60"
          >
            {salvando ? 'Salvando...' : 'Salvar alterações'}
          </button>
          {ehAdmin && (
            <button
              onClick={excluir}
              className="rounded-xl border border-red-200 text-red-500 text-sm font-bold px-4 py-2.5 hover:bg-red-50"
            >
              Excluir
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
