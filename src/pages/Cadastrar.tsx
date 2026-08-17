import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import AuthShell from '../components/AuthShell';
import CampoSenha from '../components/CampoSenha';

export default function Cadastrar() {
  const { cadastrar } = useAuth();
  const navigate = useNavigate();
  const [nome, setNome] = useState('');
  const [nomeEmpresa, setNomeEmpresa] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  function formatarCnpj(valor: string) {
    const digitos = valor.replace(/\D/g, '').slice(0, 14);
    return digitos
      .replace(/^(\d{2})(\d)/, '$1.$2')
      .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1/$2')
      .replace(/(\d{4})(\d)/, '$1-$2');
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    if (senha !== confirmarSenha) {
      setErro('As senhas não coincidem. Confira e tente de novo.');
      return;
    }
    setCarregando(true);
    try {
      await cadastrar(nome, email, senha, nomeEmpresa, cnpj || undefined);
      navigate('/dashboard');
    } catch (err) {
      console.error('Erro ao cadastrar empresa:', err);
      const codigo = (err as { code?: string })?.code;
      if (codigo === 'auth/email-already-in-use') {
        setErro('Esse e-mail já tem uma empresa cadastrada. Tente entrar em vez de cadastrar.');
      } else if (codigo === 'auth/invalid-email') {
        setErro('E-mail inválido. Confira e tente de novo.');
      } else if (codigo === 'auth/weak-password') {
        setErro('Senha muito fraca — use pelo menos 6 caracteres.');
      } else if (codigo === 'auth/network-request-failed') {
        setErro('Falha de conexão. Verifique sua internet e tente de novo.');
      } else if (codigo === 'auth/operation-not-allowed') {
        setErro('Cadastro por e-mail/senha está desativado nas configurações do Firebase. Fale com o suporte.');
      } else {
        setErro(
          `Não foi possível criar a empresa. Verifique os dados e tente novamente.${
            codigo ? ` (código: ${codigo})` : ''
          }`
        );
      }
    } finally {
      setCarregando(false);
    }
  }

  return (
    <AuthShell
      titulo="Cadastre sua empresa"
      subtitulo="Crie o CRM da sua empresa em poucos minutos."
      rodape={
        <>
          Já tem uma empresa cadastrada?{' '}
          <Link to="/login" className="font-bold text-blue-600">
            Entrar
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="bg-white border border-line rounded-2xl p-6 space-y-4">
        <div>
          <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
            Nome da empresa
          </label>
          <input
            required
            value={nomeEmpresa}
            onChange={(e) => setNomeEmpresa(e.target.value)}
            className="w-full rounded-xl border border-line px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
            CNPJ <span className="normal-case font-semibold text-ink-soft/70">(opcional)</span>
          </label>
          <input
            value={cnpj}
            onChange={(e) => setCnpj(formatarCnpj(e.target.value))}
            placeholder="00.000.000/0000-00"
            inputMode="numeric"
            className="w-full rounded-xl border border-line px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">Seu nome</label>
          <input
            required
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="w-full rounded-xl border border-line px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
            Seu e-mail (login de administrador)
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-line px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
          />
        </div>
        <CampoSenha
          label="Senha"
          value={senha}
          onChange={setSenha}
          required
          minLength={6}
          autoComplete="new-password"
        />
        <CampoSenha
          label="Confirmar senha"
          value={confirmarSenha}
          onChange={setConfirmarSenha}
          required
          minLength={6}
          autoComplete="new-password"
        />
        {erro && <p className="text-xs text-red-500">{erro}</p>}
        <button
          type="submit"
          disabled={carregando}
          className="w-full rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold py-2.5 hover:opacity-90 disabled:opacity-60"
        >
          {carregando ? 'Criando...' : 'Criar empresa'}
        </button>
      </form>
    </AuthShell>
  );
}
