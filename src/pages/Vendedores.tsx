import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ouvirClientes, ouvirVendedores, removerVendedor, salvarVendedor } from '../lib/crmData';
import type { Cliente, Vendedor } from '../types';
import { formatarMoeda, vendasMesVendedor } from '../lib/crmLogic';

/** CRUD de vendedores — cada um recebe um login/senha simples (sem e-mail
 * próprio), definido pelo admin, igual ao padrão já usado na Divinissima. */
export default function Vendedores() {
  const { empresa, papel, sessaoVendedor } = useAuth();
  const empresaId = empresa?.id;
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [modalAberto, setModalAberto] = useState(false);
  const [editando, setEditando] = useState<Vendedor | null>(null);
  const [nome, setNome] = useState('');
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [meta, setMeta] = useState('');
  const [erro, setErro] = useState('');

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

  const contagemClientes = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const c of clientes) {
      if (c.cod_vendedor) mapa.set(c.cod_vendedor, (mapa.get(c.cod_vendedor) ?? 0) + 1);
    }
    return mapa;
  }, [clientes]);

  function abrirNovo() {
    setEditando(null);
    setNome('');
    setLogin('');
    setSenha('');
    setMeta('');
    setErro('');
    setModalAberto(true);
  }

  function abrirEdicao(v: Vendedor) {
    setEditando(v);
    setNome(v.nome);
    setLogin(v.login);
    setSenha(v.senha);
    setMeta(v.meta ? String(v.meta) : '');
    setErro('');
    setModalAberto(true);
  }

  async function salvar() {
    if (!empresaId) return;
    if (!nome.trim() || !login.trim() || !senha.trim()) {
      setErro('Preencha nome, login e senha.');
      return;
    }
    if (!editando && vendedores.some((v) => v.login === login.trim())) {
      setErro('Já existe um vendedor com esse login.');
      return;
    }
    setErro('');
    try {
      await salvarVendedor(empresaId, {
        id: editando?.id,
        nome: nome.trim(),
        login: editando ? editando.login : login.trim(), // login não muda depois de criado
        senha: senha.trim(),
        ativo: true,
        meta: meta ? Number(meta) : undefined,
        criadoEm: editando?.criadoEm ?? new Date().toISOString(),
      });
      setModalAberto(false);
    } catch (err) {
      console.error('Erro ao salvar vendedor:', err);
      setErro('Não foi possível salvar o vendedor. Tente novamente em instantes.');
    }
  }

  async function remover(v: Vendedor) {
    if (!empresaId) return;
    if (!confirm(`Remover o vendedor "${v.nome}"? Os clientes vinculados a ele ficarão sem vendedor.`)) return;
    try {
      await removerVendedor(empresaId, v.id);
    } catch (err) {
      console.error('Erro ao remover vendedor:', err);
      alert('Não foi possível remover o vendedor. Tente novamente em instantes.');
    }
  }

  if (!empresaId) return null;

  if (!ehAdmin) {
    const meu = sessaoVendedor?.vendedor;
    return (
      <div className="p-6 w-full max-w-md">
        <h1 className="text-base font-extrabold text-ink flex items-center gap-2 mb-4">🏷️ Meu perfil</h1>
        {meu && (
          <div className="bg-white border border-line rounded-2xl p-6">
            <div className="text-lg font-extrabold text-ink">{meu.nome}</div>
            <div className="text-sm text-ink-soft mb-3">Login: {meu.login}</div>
            <div className="text-xs text-ink-soft">Clientes na minha carteira: {contagemClientes.get(meu.login) ?? 0}</div>
            <div className="text-xs text-ink-soft">Vendas no mês: {formatarMoeda(vendasMesVendedor(clientes, meu.login))}</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 w-full">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-base font-extrabold text-ink flex items-center gap-2">🏷️ Vendedores</h1>
        <button
          onClick={abrirNovo}
          className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-4 py-2.5 hover:opacity-90"
        >
          + Novo vendedor
        </button>
      </div>

      <div className="bg-white border border-line rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface text-ink-soft text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-2.5 font-bold">Vendedor</th>
              <th className="text-left px-4 py-2.5 font-bold">Login</th>
              <th className="text-right px-4 py-2.5 font-bold">Clientes</th>
              <th className="text-right px-4 py-2.5 font-bold">Vendas no mês</th>
              <th className="text-right px-4 py-2.5 font-bold">Ações</th>
            </tr>
          </thead>
          <tbody>
            {vendedores.map((v) => (
              <tr key={v.id} className="border-t border-line">
                <td className="px-4 py-2.5 font-bold text-ink">{v.nome}</td>
                <td className="px-4 py-2.5 text-ink-soft">{v.login}</td>
                <td className="px-4 py-2.5 text-right text-ink-soft">{contagemClientes.get(v.login) ?? 0}</td>
                <td className="px-4 py-2.5 text-right font-bold text-ink">
                  {formatarMoeda(vendasMesVendedor(clientes, v.login))}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button onClick={() => abrirEdicao(v)} className="text-teal-600 font-bold text-xs mr-3 hover:underline">
                    Editar
                  </button>
                  <button onClick={() => remover(v)} className="text-red-500 font-bold text-xs hover:underline">
                    Remover
                  </button>
                </td>
              </tr>
            ))}
            {vendedores.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-ink-soft text-sm">
                  Nenhum vendedor cadastrado ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modalAberto && (
        <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4" onClick={() => setModalAberto(false)}>
          <div className="bg-white rounded-2xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-extrabold text-ink mb-4">{editando ? 'Editar vendedor' : 'Novo vendedor'}</h2>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1">Nome</label>
                <input
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500/30"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1">Login</label>
                <input
                  value={login}
                  disabled={!!editando}
                  onChange={(e) => setLogin(e.target.value)}
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500/30 disabled:bg-surface disabled:text-ink-soft"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1">Senha</label>
                <input
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500/30"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1">Meta pessoal (R$, opcional)</label>
                <input
                  type="number"
                  min="0"
                  value={meta}
                  onChange={(e) => setMeta(e.target.value)}
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500/30"
                />
              </div>
            </div>
            {erro && <p className="text-xs text-red-500 mb-3">{erro}</p>}
            <div className="flex gap-3">
              <button
                onClick={salvar}
                className="flex-1 rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold py-2.5 hover:opacity-90"
              >
                Salvar
              </button>
              <button
                onClick={() => setModalAberto(false)}
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
