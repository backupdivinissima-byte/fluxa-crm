import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { ouvirVendedores, salvarVendedor } from '../lib/crmData';
import { useAuth } from '../contexts/AuthContext';
import { modulosBase, type Modulo } from '../lib/modulos';
import type { Empresa, Vendedor } from '../types';

/** Logins que administram a plataforma Fluxa (quem vende os módulos). Só eles veem esta tela. */
export const DONOS_PLATAFORMA = ['divinissima.comercial@gmail.com', 'josycampos.comercial@gmail.com', 'backupdivinissima@gmail.com'];

const TODOS: { id: Modulo; nome: string }[] = [
  { id: 'crm', nome: 'CRM' },
  { id: 'marketing', nome: 'Marketing' },
  { id: 'chat', nome: 'Chat' },
  { id: 'erp', nome: 'ERP' },
  { id: 'prospect', nome: 'Prospect' },
];

/** Tela do dono da plataforma: liga e desliga o CRM, o Marketing e o Chat de cada empresa. */
export default function Modulos() {
  const { perfil, empresa: empresaAtual, definirVinculoModulos } = useAuth();
  const dono = !!perfil?.email && DONOS_PLATAFORMA.includes(perfil.email.toLowerCase());
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState<string | null>(null);
  const [aviso, setAviso] = useState('');
  // Por padrão cada empresa vê só os próprios módulos; a lista de todas as empresas é só do dono da plataforma, sob pedido.
  const [verTodas, setVerTodas] = useState(false);
  const [moduloAberto, setModuloAberto] = useState<Modulo | null>(null);
  const [usuarios, setUsuarios] = useState<Vendedor[]>([]);
  const idEmpresaAtual = empresaAtual?.id;
  useEffect(() => {
    if (!idEmpresaAtual) return;
    return ouvirVendedores(idEmpresaAtual, setUsuarios);
  }, [idEmpresaAtual]);
  // Dono da plataforma: cada empresa existente ganha o cadastro de cada módulo que já usa (só acrescenta, nada é alterado).
  useEffect(() => {
    if (!dono) return;
    try { if (localStorage.getItem('cadastros-modulos-v1')) return; } catch { /* ignore */ }
    (async () => {
      const snap = await getDocs(collection(db, 'empresas'));
      for (const d of snap.docs) {
        const e = { ...(d.data() as Empresa), id: d.id };
        const faltam = modulosBase(e).filter((m) => !e.cadastrosModulos?.[m]);
        if (faltam.length === 0) continue;
        const novos: Record<string, unknown> = {};
        for (const m of faltam) {
          novos[`cadastrosModulos.${m}`] = { nomeEmpresa: e.nome, ...(e.cnpj ? { documento: e.cnpj, documentoTipo: e.documentoTipo ?? 'cnpj' } : {}), ...(e.whatsapp ? { whatsapp: e.whatsapp } : {}), criadoEm: e.criadoEm ?? new Date().toISOString() };
          const dig = (e.cnpj ?? '').replace(/\D/g, '');
          if (dig) {
            const ref = doc(db, 'documentosModulo', `${m}_${dig}`);
            const ja = await getDoc(ref).catch(() => null);
            if (ja && !ja.exists()) await setDoc(ref, { empresaId: e.id, modulo: m, em: new Date().toISOString() }).catch(() => {});
          }
        }
        await updateDoc(doc(db, 'empresas', e.id), novos).catch(() => {});
      }
      try { localStorage.setItem('cadastros-modulos-v1', '1'); } catch { /* ignore */ }
    })().catch(() => {});
  }, [dono]);

  async function marcarUsuario(v: Vendedor, m: Modulo, marcar: boolean) {
    if (!idEmpresaAtual) return;
    const atuais = v.acessos ?? ['crm', 'chat'];
    const novos = (marcar ? [...atuais, m] : atuais.filter((x) => x !== m)) as NonNullable<Vendedor['acessos']>;
    await salvarVendedor(idEmpresaAtual, { ...v, acessos: novos });
  }

  useEffect(() => {
    if (!dono || !verTodas) return;
    getDocs(collection(db, 'empresas'))
      .then((s) => setEmpresas(s.docs.map((d) => ({ ...(d.data() as Empresa), id: d.id })).sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? ''))))
      .catch((e) => setErro(e instanceof Error ? e.message : 'Não foi possível carregar as empresas.'))
      .finally(() => setCarregando(false));
  }, [dono, verTodas]);



  async function alternar(e: Empresa, m: Modulo) {
    const atuais = modulosBase(e);
    const novos = atuais.includes(m) ? atuais.filter((x) => x !== m) : [...atuais, m];
    if (novos.length === 0) {
      setErro('A empresa precisa ficar com pelo menos um módulo.');
      return;
    }
    setErro('');
    setAviso('');
    setSalvando(e.id);
    try {
      await updateDoc(doc(db, 'empresas', e.id), { modulos: novos });
      setEmpresas((lista) => lista.map((x) => (x.id === e.id ? { ...x, modulos: novos } : x)));
      setAviso(`${e.nome}: módulos salvos (${novos.join(', ')}).`);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(null);
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-extrabold text-ink">Módulos por empresa</h1>
        <p className="text-sm text-ink-soft">
          Marque o que cada empresa contratou. Com o Chat marcado, ele ganha uma aba própria e pode ser vinculado aos outros módulos.
          Empresas antigas sem o Chat marcado continuam com o Chat dentro do CRM.
        </p>
      </div>
      {dono && (
        <button onClick={() => setVerTodas((v) => !v)} className="text-xs font-bold text-blue-600 hover:underline">
          {verTodas ? '← Voltar aos módulos desta empresa' : 'Administração da plataforma: ver todas as empresas'}
        </button>
      )}
      {erro && <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-bold p-3">{erro}</div>}
      {aviso && <div className="rounded-xl bg-teal-50 border border-teal-200 text-teal-700 text-sm font-bold p-3">{aviso}</div>}
      {!verTodas ? (
        <div className="bg-white border border-line rounded-2xl p-4">
          <div className="text-sm font-extrabold text-ink mb-2">{empresaAtual?.nome}</div>
          <div className="flex flex-wrap gap-2">
            {TODOS.map((m) => {
              const ativo = modulosBase(empresaAtual as Empresa).includes(m.id);
              const aberto = moduloAberto === m.id;
              return (
                <button
                  key={m.id}
                  disabled={!ativo}
                  onClick={() => setModuloAberto(aberto ? null : m.id)}
                  className={`rounded-full px-3 py-1 text-xs font-bold border ${aberto ? 'bg-teal-600 border-teal-600 text-white' : ativo ? 'bg-teal-50 border-teal-300 text-teal-700 hover:bg-teal-100' : 'bg-surface border-line text-ink-soft line-through cursor-not-allowed'}`}
                >
                  {m.nome}
                </button>
              );
            })}
          </div>
          {moduloAberto && (
            <div className="mt-4 rounded-xl border border-line p-3">
              <div className="text-sm font-extrabold text-ink mb-2">Quem acessa o {TODOS.find((t) => t.id === moduloAberto)?.nome}</div>
              {usuarios.length === 0 && <div className="text-xs text-ink-soft">Nenhum usuário cadastrado ainda. Cadastre na aba Usuários.</div>}
              <div className="grid gap-1.5 sm:grid-cols-2">
                {usuarios.map((v) => (
                  <label key={v.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={(v.acessos ?? ['crm', 'chat']).includes(moduloAberto as NonNullable<Vendedor['acessos']>[number])} onChange={(e) => void marcarUsuario(v, moduloAberto, e.target.checked)} />
                    {v.nome} <span className="text-xs text-ink-soft">({v.login})</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {modulosBase(empresaAtual as Empresa).filter((m) => m !== 'erp' && m !== 'prospect' && m !== 'chat').length > 1 && (
            <label className="flex items-center gap-2 text-sm font-semibold text-ink mt-3 cursor-pointer">
              <input type="checkbox" checked={empresaAtual?.associarModulos === true} onChange={(e) => void definirVinculoModulos(e.target.checked)} />
              Associar módulos (abas de todos juntas na mesma tela)
            </label>
          )}
          <p className="text-xs text-ink-soft mt-3">Clique em um módulo para marcar quais usuários terão acesso a ele.</p>
        </div>
      ) : carregando ? (
        <div className="text-sm text-ink-soft">Carregando empresas…</div>
      ) : (
        <div className="bg-white border border-line rounded-2xl divide-y divide-line">
          {empresas.map((e) => {
            const mods = modulosBase(e);
            return (
              <div key={e.id} className="flex flex-wrap items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-extrabold text-ink truncate">{e.nome}</div>
                  <div className="text-xs text-ink-soft">
                    Plano {e.plano ?? '—'} · {e.modulos ? 'módulos definidos' : 'empresa antiga (tudo liberado)'}
                  </div>
                </div>
                <div className="flex gap-3">
                  {TODOS.map((m) => (
                    <label key={m.id} className="flex items-center gap-1.5 text-sm font-semibold text-ink cursor-pointer">
                      <input
                        type="checkbox"
                        checked={mods.includes(m.id)}
                        disabled={salvando === e.id}
                        onChange={() => void alternar(e, m.id)}
                      />
                      {m.nome}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
          {empresas.length === 0 && <div className="p-4 text-sm text-ink-soft">Nenhuma empresa encontrada.</div>}
        </div>
      )}
    </div>
  );
}
