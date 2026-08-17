import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import AuthShell from '../components/AuthShell';
import CampoSenha from '../components/CampoSenha';

export default function Login() {
  const { login, loginVendedor } = useAuth();
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
      navigate('/dashboard');
    } catch {
      setErro(modo === 'admin' ? 'E-mail ou senha inválidos.' : 'Login ou senha inválidos.');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <AuthShell
      titulo="Entrar no Fluxa CRM"
      subtitulo="Acesse o CRM da sua empresa."
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
          Vendedor
        </button>
      </div>

      <form onSubmit={onSubmit} className="bg-white border border-line rounded-2xl p-6 space-y-4">
        <div>
          <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
            {modo === 'admin' ? 'E-mail' : 'Login'}
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
        <button
          type="submit"
          disabled={carregando}
          className="w-full rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold py-2.5 hover:opacity-90 disabled:opacity-60"
        >
          {carregando ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </AuthShell>
  );
}
