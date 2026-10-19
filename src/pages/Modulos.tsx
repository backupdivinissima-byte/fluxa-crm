import { useEffect, useState } from 'react';
import { collection, doc, getDocs, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { modulosDaEmpresa, type Modulo } from '../lib/modulos';
import type { Empresa } from '../types';

/** Logins que administram a plataforma Fluxa (quem vende os módulos). Só eles veem esta tela. */
export const DONOS_PLATAFORMA = ['divinissima.comercial@gmail.com', 'josycampos.comercial@gmail.com', 'backupdivinissima@gmail.com'];

const TODOS: { id: Modulo; nome: string }[] = [
  { id: 'crm', nome: 'CRM' },
  { id: 'marketing', nome: 'Marketing' },
  { id: 'chat', nome: 'Chat' },
];

/** Tela do dono da plataforma: liga e desliga o CRM, o Marketing e o Chat de cada empresa. */
export default function Modulos() {
  const { perfil } = useAuth();
  const dono = !!perfil?.email && DONOS_PLATAFORMA.includes(perfil.email.toLowerCase());
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState<string | null>(null);
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    if (!dono) return;
    getDocs(collection(db, 'empresas'))
      .then((s) => setEmpresas(s.docs.map((d) => ({ ...(d.data() as Empresa), id: d.id })).sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? ''))))
      .catch((e) => setErro(e instanceof Error ? e.message : 'Não foi possível carregar as empresas.'))
      .finally(() => setCarregando(false));
  }, [dono]);

  if (!dono) return <div className="p-6 text-sm text-ink-soft">Esta tela é só do administrador da plataforma.</div>;

  async function alternar(e: Empresa, m: Modulo) {
    const atuais = modulosDaEmpresa(e);
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
      {erro && <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-bold p-3">{erro}</div>}
      {aviso && <div className="rounded-xl bg-teal-50 border border-teal-200 text-teal-700 text-sm font-bold p-3">{aviso}</div>}
      {carregando ? (
        <div className="text-sm text-ink-soft">Carregando empresas…</div>
      ) : (
        <div className="bg-white border border-line rounded-2xl divide-y divide-line">
          {empresas.map((e) => {
            const mods = modulosDaEmpresa(e);
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
