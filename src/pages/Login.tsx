import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import AuthShell from '../components/AuthShell';
import CampoSenha from '../components/CampoSenha';
import { modulosDaEmpresa, rotaInicial, type Modulo } from '../lib/modulos';

const NOMES_MODULO: Record<Modulo, { nome: string; desc: string }> = {
  crm: { nome: 'Fluxa CRM', desc: 'Funil de vendas, clientes, vendedores, metas e agenda.' },
  chat: { nome: 'Fluxa Chat', desc: 'Atendimento por WhatsApp, Instagram e Messenger.' },
  erp: { nome: 'Fluxa ERP', desc: 'Produtos, estoque, pedidos, trocas e financeiro.' },
  prospect: { nome: 'Fluxa Prospect', desc: 'Encontrar e qualificar novos clientes em potencial.' },
  marketing: { nome: 'Fluxa Marketing', desc: 'Anúncios, lives e ROI cruzados com o funil.' },
};
const CHAVE_MODULO = 'fluxa_modulo_atual';
function abrirModulo(m: Modulo, navigate: (to: string) => void) {
  try {
    sessionStorage.setItem(CHAVE_MODULO, m);
  } catch {
    /* sem armazenamento */
  }
  navigate(rotaInicial(m));
}

export default function Login() {
  const { login, loginVendedor, empresa } = useAuth();
  const [aposLogin, setAposLogin] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Link direto de um vendedor (aba "Links dos vendedores") já vem com
  // ?empresa=ID&login=LOGIN — pula a busca e pré-preenche o formulário.
  const empresaHint = params.get('empresa') ?? undefined;
  const loginHint = params.get('login') ?? '';
  const [modo, setModo] = useState<'admin' | 'vendedor'>(empresaHint ? 'vendedor' : 'admin');
  const [identificador, setIdentificador] = useState(loginHint); // e-mail (admin) ou login (vendedor)
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  const [aviso, setAviso] = useState('');
  const produtoDoLink = params.get('plataforma') as Modulo | null;
  const meusModulos = empresa ? modulosDaEmpresa(empresa) : [];
  useEffect(() => {
    if (!aposLogin || !empresa) return;
    if (produtoDoLink && meusModulos.includes(produtoDoLink)) abrirModulo(produtoDoLink, navigate);
    else if (meusModulos.length <= 1) abrirModulo(meusModulos[0] ?? 'crm', navigate);
    // vários produtos: mostra a escolha abaixo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aposLogin, empresa]);

  async function esqueci() {
    setErro(''); setAviso('');
    if (!identificador.includes('@')) { setErro('Digite seu e-mail acima e clique de novo em "Esqueci minha senha".'); return; }
    try {
      await sendPasswordResetEmail(auth, identificador.trim());
      setAviso('Se esse e-mail tiver conta, enviamos um link para criar uma nova senha. Olhe também o spam.');
    } catch {
      setErro('Não foi possível enviar agora. Confira o e-mail e tente de novo.');
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setCarregando(true);
    try {
      if (modo === 'admin') {
        await login(identificador, senha);
      } else {
        await loginVendedor(identificador, senha, empresaHint);
      }
      // Administrador: entra direto se a empresa tem um produto só (ou veio de um produto); senão escolhe qual abrir.
      if (modo === 'admin') setAposLogin(true);
      else navigate('/dashboard');
    } catch (err) {
      // No modo vendedor, loginVendedor já lança mensagens próprias em
      // português (credenciais inválidas, autenticação indisponível, sem
      // conexão) — mostramos elas direto em vez de sempre genérico.
      if (modo === 'vendedor' && err instanceof Error && err.message) {
        setErro(err.message);
      } else {
        const codigo = (err as { code?: string } | null)?.code ?? '';
        if (codigo === 'auth/too-many-requests') {
          setErro('Muitas tentativas seguidas. O acesso foi bloqueado por alguns minutos por segurança — espere uns 15 minutos ou redefina a senha.');
        } else if (codigo === 'auth/network-request-failed') {
          setErro('Sem conexão com o servidor. Verifique a internet e tente de novo.');
        } else if (codigo === 'auth/user-disabled') {
          setErro('Esta conta está desativada. Fale com o administrador.');
        } else if (codigo === 'resource-exhausted' || codigo === 'unavailable' || codigo === 'permission-denied') {
          setErro('O sistema está temporariamente indisponível (' + codigo + '). Tente de novo em alguns minutos.');
        } else if (modo === 'admin' && codigo && !codigo.startsWith('auth/invalid-') && codigo !== 'auth/wrong-password' && codigo !== 'auth/user-not-found') {
          setErro('Não foi possível entrar (' + codigo + '). Tente de novo em alguns minutos.');
        } else {
          setErro(modo === 'admin' ? 'E-mail ou senha inválidos.' : 'Login ou senha inválidos.');
        }
      }
    } finally {
      setCarregando(false);
    }
  }

  if (aposLogin && empresa && meusModulos.length > 1 && !(produtoDoLink && meusModulos.includes(produtoDoLink))) {
    return (
      <AuthShell titulo="O que você quer acessar?" subtitulo={`${empresa.nome} tem mais de um produto Fluxa. Escolha por onde entrar.`} rodape={null}>
        <div className="space-y-3">
          {meusModulos.map((m) => (
            <button key={m} onClick={() => abrirModulo(m, navigate)} className="w-full text-left rounded-xl border border-line bg-white px-4 py-3 hover:border-teal-500 hover:bg-teal-500/5 transition-colors">
              <div className="text-sm font-extrabold text-ink">{NOMES_MODULO[m].nome}</div>
              <div className="text-xs text-ink-soft">{NOMES_MODULO[m].desc}</div>
            </button>
          ))}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      titulo={`Entrar no ${produtoDoLink && NOMES_MODULO[produtoDoLink] ? NOMES_MODULO[produtoDoLink].nome : 'Fluxa'}`}
      subtitulo={produtoDoLink && NOMES_MODULO[produtoDoLink] ? `Acesse o ${NOMES_MODULO[produtoDoLink].nome.replace('Fluxa ', '')} da sua empresa.` : 'Acesse a sua empresa.'}
      rodape={
        <>
          Ainda não tem uma empresa cadastrada?{' '}
          <Link to="/cadastrar" className="font-bold text-blue-600">
            Cadastrar empresa
          </Link>
        </>
      }
    >
      <div className="flex bg-cream2 bg-slate-100 rounded-xl p-1 mb-4">
        <button
          type="button"
          onClick={() => setModo('admin')}
          className={`flex-1 rounded-lg py-2 text-xs font-bold uppercase tracking-wide transition-colors ${
            modo === 'admin' ? 'bg-white text-ink shadow-sm' : 'text-ink-soft'
          }`}
        >
          Administrador
        </button>
        <button
          type="button"
          onClick={() => setModo('vendedor')}
          className={`flex-1 rounded-lg py-2 text-xs font-bold uppercase tracking-wide transition-colors ${
            modo === 'vendedor' ? 'bg-white text-ink shadow-sm' : 'text-ink-soft'
          }`}
        >
          Usuário
        </button>
      </div>

      <form onSubmit={onSubmit} className="bg-white border border-line rounded-2xl p-6 space-y-4">
        <div>
          <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
            {modo === 'admin' ? 'E-mail' : 'Login do usuário'}
          </label>
          <input
            type={modo === 'admin' ? 'email' : 'text'}
            required
            value={identificador}
            onChange={(e) => setIdentificador(e.target.value)}
            className="w-full rounded-xl border border-line px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
          />
        </div>
        <CampoSenha label="Senha" value={senha} onChange={setSenha} required autoComplete="current-password" />
        {erro && <p className="text-xs text-red-500">{erro}</p>}
        {aviso && <p className="text-xs text-teal-700">{aviso}</p>}
        <button
          type="submit"
          disabled={carregando}
          className="w-full rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold py-2.5 hover:opacity-90 disabled:opacity-60"
        >
          {carregando ? 'Entrando...' : 'Entrar'}
        </button>
        {modo === 'admin' && (
          <button type="button" onClick={() => void esqueci()} className="w-full text-xs font-bold text-blue-600 hover:underline">
            Esqueci minha senha
          </button>
        )}
      </form>
    </AuthShell>
  );
}
