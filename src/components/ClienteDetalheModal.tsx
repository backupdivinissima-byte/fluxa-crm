import { useState } from 'react';
import type { Cliente, Vendedor } from '../types';
import {
  DIAS_INATIVIDADE_PADRAO,
  diasSemAtend,
  formatarDataBR,
  formatarMoeda,
  statusInfo,
  ultimasCompras,
} from '../lib/crmLogic';
import { atualizarCampoCliente, removerCliente } from '../lib/crmData';
import { useAuth } from '../contexts/AuthContext';
import { chaveTelefone, vincularPorTelefone } from '../lib/chatData';

interface Props {
  empresaId: string;
  cliente: Cliente;
  vendedores: Vendedor[];
  ehAdmin: boolean;
  // Prazo de inatividade configurado no Dashboard (30/60/90/personalizado)
  // — opcional só pra não quebrar quem ainda não repassa a prop; usa o
  // padrão de 30 dias nesse caso.
  diasInatividade?: number;
  // Falso quando o vínculo do funil com o vendedor já venceu (cliente ficou
  // sem venda no prazo): aí o vendedor do funil não é mais mostrado.
  vinculoVigente?: boolean;
  // Telefone já preenchido (ex.: o do contato do Chat que está sendo cadastrado).
  telefoneInicial?: string;
  // Mostra o cadastro como painel fixo dentro da página (sem janela por cima).
  embutido?: boolean;
  onClose: () => void;
}

const ROTULO = 'block text-[11px] font-bold uppercase tracking-wide text-ink-soft mb-1.5';
const CAMPO =
  'w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-ink-soft/70 focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500';

/** Cidade e UF vivem em campos separados no cliente, mas a tela mostra um
 * campo só ("Cidade / UF"): junta pra exibir e separa de novo ao salvar. */
function juntarCidadeUf(cidade?: string, uf?: string): string {
  if (cidade && uf) return `${cidade}/${uf}`;
  return cidade ?? uf ?? '';
}

function separarCidadeUf(texto: string): { cidade: string; uf: string } {
  const m = /^(.*?)\s*[/-]\s*([A-Za-z]{2})$/.exec(texto.trim());
  if (m) return { cidade: m[1].trim(), uf: m[2].toUpperCase() };
  return { cidade: texto.trim(), uf: '' };
}

/** Modal de detalhe/edição de um cliente — usado no Kanban e na tela de Clientes. */
export default function ClienteDetalheModal({
  empresaId,
  cliente,
  vendedores,
  ehAdmin,
  diasInatividade = DIAS_INATIVIDADE_PADRAO,
  vinculoVigente = true,
  telefoneInicial,
  embutido = false,
  onClose,
}: Props) {
  const { papel, sessaoVendedor } = useAuth();
  const [cnpj, setCnpj] = useState(cliente.cnpj ?? '');
  const [telefone, setTelefone] = useState(telefoneInicial || cliente.telefone || '');
  const [cidadeUf, setCidadeUf] = useState(juntarCidadeUf(cliente.cidade, cliente.uf));
  const [codVendedor, setCodVendedor] = useState(vinculoVigente && cliente.crmVendedorLogin ? cliente.crmVendedorLogin : cliente.cod_vendedor ?? '');
  const [salvando, setSalvando] = useState(false);

  const dias = diasSemAtend(cliente);
  const semCompra = dias >= 9999;
  const status = statusInfo(dias, diasInatividade);

  // Vendedor mostrado: o do funil (se o vínculo ainda vale), senão o dono
  // cadastral do cliente (vendedor da importação).
  const loginExibido = vinculoVigente && cliente.crmVendedorLogin ? cliente.crmVendedorLogin : cliente.cod_vendedor;
  const nomeVendedor =
    vendedores.find((v) => v.login === loginExibido)?.nome ??
    (loginExibido === cliente.cod_vendedor ? cliente.vend_nome : undefined) ??
    loginExibido;

  const compras = ultimasCompras(cliente);
  const totalCompras = compras.reduce((s, c) => s + c.valor, 0);

  const produtosOrdenados = Object.entries(cliente.produtos ?? {})
    .filter(([, qtd]) => qtd > 0)
    .sort((a, b) => b[1] - a[1]);
  const totalUnidades = produtosOrdenados.reduce((s, [, qtd]) => s + qtd, 0);

  async function salvar() {
    setSalvando(true);
    try {
      const patch: Partial<Cliente> = { cnpj, telefone };
      // Cidade/UF e vendedor só são gravados se a pessoa mexeu neles: o
      // vendedor vindo da importação nem sempre bate com um login cadastrado
      // (o seletor então aparece vazio) e salvar não pode apagá-lo.
      if (cidadeUf !== juntarCidadeUf(cliente.cidade, cliente.uf)) {
        const { cidade, uf } = separarCidadeUf(cidadeUf);
        patch.cidade = cidade;
        patch.uf = uf;
      }
      const donoAtual = vinculoVigente && cliente.crmVendedorLogin ? cliente.crmVendedorLogin : cliente.cod_vendedor ?? '';
      if (codVendedor !== donoAtual) {
        // Troca o dono de verdade: o cadastro e também o vendedor do funil (é ele que aparece no CRM e no Chat).
        patch.cod_vendedor = codVendedor || undefined;
        patch.vend_nome = vendedores.find((v) => v.login === codVendedor)?.nome;
        if (cliente.crmVendedorLogin) patch.crmVendedorLogin = codVendedor || undefined;
      }
      await atualizarCampoCliente(empresaId, cliente.id, patch);
      // Telefone novo que bate com uma conversa do Chat: cliente vai para "em atendimento".
      if (chaveTelefone(telefone) !== chaveTelefone(cliente.telefone) && chaveTelefone(telefone).length >= 10) {
        const vend =
          papel === 'admin'
            ? vendedores.find((v) => v.login === cliente.crmVendedorLogin)
            : sessaoVendedor?.vendedor;
        if (vend) {
          try {
            if (await vincularPorTelefone(empresaId, cliente.id, telefone, { login: vend.login, nome: vend.nome })) {
              alert('Esse telefone tem conversa no Fluxa Chat: o cliente foi para "Em atendimento" no CRM.');
            }
          } catch (e) {
            console.error('Vínculo com o Chat:', e);
          }
        }
      }
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
    <div className={embutido ? '' : 'fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4'} onClick={embutido ? undefined : onClose}>
      <div
        className={
          embutido
            ? 'bg-white border border-line rounded-2xl w-full max-h-[calc(100vh-140px)] overflow-y-auto'
            : 'bg-white rounded-2xl max-w-5xl w-full max-h-[92vh] overflow-y-auto shadow-xl'
        }
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div className="flex items-start justify-between gap-4 px-6 sm:px-8 py-5 border-b border-line">
          <div className="min-w-0">
            <h2 className="text-xl font-extrabold text-ink uppercase truncate">
              {cliente.razao ?? cliente.nome ?? 'Cliente'}
            </h2>
            <p className="text-xs text-ink-soft mt-0.5">Cód: {cliente.cod}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span
              title={status.label}
              aria-label={status.label}
              className="w-5 h-5 rounded-full"
              style={{ backgroundColor: status.cor, boxShadow: `0 0 0 4px ${status.cor}33` }}
            />
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="w-10 h-9 rounded-xl border border-line text-ink-soft hover:bg-surface text-lg leading-none"
            >
              ×
            </button>
          </div>
        </div>

        <div className="px-6 sm:px-8 py-6">
          {/* Dados do cliente */}
          <div className={`grid grid-cols-1 ${embutido ? '' : 'md:grid-cols-2'} gap-x-8 gap-y-4`}>
            <div>
              <span className={ROTULO}>Razão social</span>
              <div className="text-[15px] text-ink">{cliente.razao ?? cliente.nome ?? '—'}</div>
            </div>
            <div>
              <span className={ROTULO}>Código</span>
              <div className="text-[15px] text-ink">{cliente.cod}</div>
            </div>

            <div>
              <label className={ROTULO}>CNPJ / CPF</label>
              <input
                value={cnpj}
                onChange={(e) => setCnpj(e.target.value)}
                placeholder="Digite o CNPJ/CPF"
                className={CAMPO}
              />
            </div>
            <div>
              <label className={ROTULO}>Telefone</label>
              <input
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                placeholder="Digite o telefone"
                className={CAMPO}
              />
            </div>

            <div>
              <label className={ROTULO}>Cidade / UF</label>
              <input
                value={cidadeUf}
                onChange={(e) => setCidadeUf(e.target.value)}
                placeholder="Digite a cidade"
                className={CAMPO}
              />
            </div>
            <div>
              <span className={ROTULO}>Vendedor</span>
              <div className="text-[15px] text-ink">{nomeVendedor || 'Sem vendedor'}</div>
            </div>

            <div>
              <span className={ROTULO}>Última compra</span>
              <div className="text-[15px] text-ink">{formatarDataBR(cliente.dtUltCompra)}</div>
            </div>
            <div>
              <span className={ROTULO}>Dias sem compra</span>
              <div className="text-[15px] font-extrabold" style={{ color: status.cor }}>
                {semCompra ? '—' : `${dias}d`}
              </div>
            </div>
          </div>

          {/* Últimas compras e produtos */}
          <div className={`grid grid-cols-1 ${embutido ? '' : 'md:grid-cols-2'} gap-x-8 gap-y-6 mt-7`}>
            <div>
              <span className={ROTULO}>Últimas compras</span>
              {compras.length > 0 ? (
                <>
                  <div className="grid grid-cols-3 gap-3 mt-1">
                    {compras.map((c, i) => {
                      const dataCompra = c.data ?? (i === 0 ? cliente.dtUltCompra : undefined);
                      return (
                        <div
                          key={i}
                          
                          className={`rounded-xl border px-2 py-3.5 text-center ${
                            i === 0 ? 'border-teal-500 bg-teal-50' : 'border-line bg-white'
                          }`}
                        >
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
                            {dataCompra ? formatarDataBR(dataCompra) : `Compra ${i + 1}`}
                          </div>
                          <div className="text-base font-extrabold text-ink mt-1.5">{formatarMoeda(c.valor)}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="rounded-xl bg-surface text-center py-4 mt-3">
                    <div className="text-[11px] text-ink-soft">
                      Total ({compras.length === 1 ? 'última compra' : `últimas ${compras.length} compras`})
                    </div>
                    <div className="text-xl font-extrabold text-teal-700 mt-0.5">{formatarMoeda(totalCompras)}</div>
                  </div>
                </>
              ) : (
                <p className="text-sm text-ink-soft mt-1">Sem compras registradas.</p>
              )}
            </div>

            <div>
              <span className={ROTULO}>
                Produtos mais comprados
                {totalUnidades > 0 && (
                  <span className="normal-case font-semibold tracking-normal"> ({totalUnidades} un. total)</span>
                )}
              </span>
              {produtosOrdenados.length > 0 ? (
                <div className="max-h-64 overflow-y-auto pr-2 mt-1">
                  {produtosOrdenados.map(([nome, qtd]) => {
                    const pct = Math.round((qtd / totalUnidades) * 100);
                    return (
                      <div key={nome} className="py-2.5 border-b border-line last:border-b-0">
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-sm font-semibold text-ink uppercase">{nome}</span>
                          <span className="text-sm font-extrabold text-ink shrink-0">{qtd} un.</span>
                        </div>
                        <div className="flex items-center gap-3 mt-1.5">
                          <div className="flex-1 h-1.5 rounded-full bg-[#ebe8f5] overflow-hidden">
                            <div className="h-full rounded-full bg-ink" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="w-9 text-right text-xs text-ink-soft shrink-0">{pct}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-ink-soft mt-1">Sem produtos registrados.</p>
              )}
            </div>
          </div>

          {/* Atribuir vendedor (admin e vendedor: o vendedor usa para transferir o atendimento) e salvar */}
          {true && (
            <div className="flex items-center gap-4 mt-6">
              <label className="text-[11px] font-bold uppercase tracking-wide text-ink-soft w-20 shrink-0 leading-tight">
                Atribuir vendedor
              </label>
              <select
                value={codVendedor}
                onChange={(e) => setCodVendedor(e.target.value)}
                className={CAMPO}
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

          <div className="flex items-center justify-between gap-3 mt-5">
            {ehAdmin ? (
              <button
                type="button"
                onClick={excluir}
                className="rounded-xl border border-red-200 text-red-500 text-sm font-bold px-4 py-2.5 hover:bg-red-50"
              >
                Excluir
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={salvar}
              disabled={salvando}
              className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-8 py-3 hover:opacity-90 disabled:opacity-60"
            >
              {salvando ? 'Salvando...' : '💾 Salvar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
