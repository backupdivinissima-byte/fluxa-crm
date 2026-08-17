import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import type { Empresa, UsuarioPerfil, Vendedor } from '../types';

// Sessão de vendedor (login/senha simples, sem Firebase Auth) — guardada só
// em memória + localStorage, igual ao padrão atual da Divinissima.
interface SessaoVendedor {
  vendedor: Vendedor;
  empresaId: string;
}

interface AuthState {
  carregando: boolean;
  usuario: User | null;
  perfil: UsuarioPerfil | null;
  empresa: Empresa | null;
  sessaoVendedor: SessaoVendedor | null;
  papel: 'admin' | 'vendedor' | null;
  login: (email: string, senha: string) => Promise<void>;
  loginVendedor: (login: string, senha: string, empresaIdHint?: string) => Promise<void>;
  cadastrar: (nome: string, email: string, senha: string, nomeEmpresa: string) => Promise<void>;
  sair: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const CHAVE_SESSAO_VENDEDOR = 'fluxacrm_sessao_vendedor';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [carregando, setCarregando] = useState(true);
  const [usuario, setUsuario] = useState<User | null>(null);
  const [perfil, setPerfil] = useState<UsuarioPerfil | null>(null);
  const [empresa, setEmpresa] = useState<Empresa | null>(null);
  const [sessaoVendedor, setSessaoVendedor] = useState<SessaoVendedor | null>(null);

  useEffect(() => {
    // Restaura sessão de vendedor salva localmente (se houver e não houver
    // admin logado via Firebase Auth).
    const salvo = localStorage.getItem(CHAVE_SESSAO_VENDEDOR);
    if (salvo) {
      try {
        setSessaoVendedor(JSON.parse(salvo));
      } catch {
        localStorage.removeItem(CHAVE_SESSAO_VENDEDOR);
      }
    }

    const unsub = onAuthStateChanged(auth, async (u) => {
      setUsuario(u);
      if (u) {
        const perfilSnap = await getDoc(doc(db, 'usuarios', u.uid));
        if (perfilSnap.exists()) {
          const p = perfilSnap.data() as UsuarioPerfil;
          setPerfil(p);
          const empresaSnap = await getDoc(doc(db, 'empresas', p.empresaId));
          if (empresaSnap.exists()) {
            setEmpresa({ id: empresaSnap.id, ...empresaSnap.data() } as Empresa);
          }
        }
      } else {
        setPerfil(null);
        setEmpresa(null);
      }
      setCarregando(false);
    });
    return unsub;
  }, []);

  async function login(email: string, senha: string) {
    localStorage.removeItem(CHAVE_SESSAO_VENDEDOR);
    setSessaoVendedor(null);
    await signInWithEmailAndPassword(auth, email, senha);
  }

  async function loginVendedor(loginVend: string, senha: string, empresaIdHint?: string) {
    // Caminho rápido: quando o vendedor entra pelo próprio link (aba "Links
    // dos vendedores", que já embute ?empresa=ID), consultamos direto a
    // empresa certa em O(1) — sem varrer o Firestore inteiro.
    if (empresaIdHint) {
      const vendQuery = query(
        collection(db, 'empresas', empresaIdHint, 'vendedores'),
        where('login', '==', loginVend),
        where('senha', '==', senha)
      );
      const vendSnap = await getDocs(vendQuery);
      if (!vendSnap.empty) {
        await autenticarVendedor(empresaIdHint, vendSnap.docs[0]);
        return;
      }
      // Se o hint não bateu (link antigo, empresa errada etc.) cai no
      // fallback abaixo em vez de falhar direto.
    }

    // TODO(escala/segurança): fallback pra quando não há hint de empresa na
    // URL — varre a lista de empresas e tenta achar login+senha em cada
    // uma. Funciona bem com poucas empresas; com muitas, fica lento e exige
    // regras do Firestore bem abertas pra leitura de "empresas" e das
    // subcoleções de vendedores. Antes de abrir cadastro público de novas
    // empresas em produção, considerar substituir por uma coleção de topo
    // tipo loginsVendedor/{login} -> {empresaId} pra achar a empresa em
    // O(1) mesmo sem o link direto.
    const empresasSnap = await getDocs(collection(db, 'empresas'));
    for (const empresaDoc of empresasSnap.docs) {
      const vendQuery = query(
        collection(db, 'empresas', empresaDoc.id, 'vendedores'),
        where('login', '==', loginVend),
        where('senha', '==', senha)
      );
      const vendSnap = await getDocs(vendQuery);
      if (!vendSnap.empty) {
        await autenticarVendedor(empresaDoc.id, vendSnap.docs[0]);
        return;
      }
    }
    throw new Error('Login ou senha inválidos.');
  }

  async function autenticarVendedor(empresaId: string, vDoc: { id: string; data: () => unknown }) {
    const vendedor = { id: vDoc.id, ...(vDoc.data() as object) } as Vendedor;
    const sessao: SessaoVendedor = { vendedor, empresaId };
    localStorage.setItem(CHAVE_SESSAO_VENDEDOR, JSON.stringify(sessao));
    setSessaoVendedor(sessao);
    const empresaSnap = await getDoc(doc(db, 'empresas', empresaId));
    if (empresaSnap.exists()) {
      setEmpresa({ id: empresaSnap.id, ...empresaSnap.data() } as Empresa);
    }
  }

  async function cadastrar(nome: string, email: string, senha: string, nomeEmpresa: string) {
    const cred = await createUserWithEmailAndPassword(auth, email, senha);
    const empresaRef = doc(db, 'empresas', cred.user.uid); // 1ª empresa = doc com id do próprio admin fundador
    const novaEmpresa: Empresa = {
      id: empresaRef.id,
      nome: nomeEmpresa,
      criadoEm: new Date().toISOString(),
      plano: 'trial',
    };
    await setDoc(empresaRef, novaEmpresa);

    const novoPerfil: UsuarioPerfil = {
      uid: cred.user.uid,
      nome,
      email,
      empresaId: empresaRef.id,
      papel: 'admin',
      criadoEm: new Date().toISOString(),
    };
    await setDoc(doc(db, 'usuarios', cred.user.uid), novoPerfil);
  }

  async function sair() {
    localStorage.removeItem(CHAVE_SESSAO_VENDEDOR);
    setSessaoVendedor(null);
    if (usuario) await firebaseSignOut(auth);
  }

  const papel: 'admin' | 'vendedor' | null = perfil ? 'admin' : sessaoVendedor ? 'vendedor' : null;

  return (
    <AuthContext.Provider
      value={{ carregando, usuario, perfil, empresa, sessaoVendedor, papel, login, loginVendedor, cadastrar, sair }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return ctx;
}
