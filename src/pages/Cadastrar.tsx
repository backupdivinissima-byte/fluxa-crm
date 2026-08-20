import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import AuthShell from '../components/AuthShell';
import CampoSenha from '../components/CampoSenha';

/** Primeira etapa do cadastro: qual plataforma Fluxa a pessoa quer testar.
 * Hoje só o Fluxa CRM está disponível — os demais levam pra um "quero ser
 * avisado" por e-mail, mesmo padrão já usado na seção "Produtos" da home. */
const PLATAFORMAS = [
  {
    id: 'crm',
    nome: 'Fluxa CRM',
    status: 'Disponível agora',
    statusCls: 'bg-teal-500/10 text-teal-600',
    desc: 'Funil de vendas, clientes, vendedores, metas e comissões.',
    disponivel: true,
  },
  {
    id: 'erp',
    nome: 'Fluxa ERP',
    status: 'Em breve',
    statusCls: 'bg-slate-100 text-ink-soft',
    desc: 'Financeiro, estoque e nota fiscal, integrados ao resto da empresa.',
    disponivel: false,
  },
  {
    id: 'marketing',
    nome: 'Fluxa Marketing',
    status: 'Em breve',
    statusCls: 'bg-slate-100 text-ink-soft',
    desc: 'Campanhas, automação e relacionamento com seus clientes.',
    disponivel: false,
  },
  {
    id: 'prospect',
    nome: 'Fluxa Prospect',
    status: 'Em breve',
    statusCls: 'bg-slate-100 text-ink-soft',
    desc: 'Encontre e qualifique novos clientes em potencial pro seu funil.',
    disponivel: false,
  },
  {
    id: 'live',
    nome: 'Fluxa Live',
    status: 'Em breve',
    statusCls: 'bg-slate-100 text-ink-soft',
    desc: 'Venda ao vivo em lives e redes sociais, tudo já organizado no Fluxa.',
    disponivel: false,
  },
] as const;

const SEGMENTOS = [
  'Varejo / loja física',
  'E-commerce / venda online',
  'Moda, joias e acessórios',
  'Alimentação e bebidas',
  'Serviços',
  'Indústria e fabricação',
  'Distribuição e atacado',
  'Saúde e beleza',
  'Tecnologia',
  'Outro',
];

function formatarCnpj(valor: string) {
  const digitos = valor.replace(/\D/g, '').slice(0, 14);
  return digitos
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

function formatarCpf(valor: string) {
  const digitos = valor.replace(/\D/g, '').slice(0, 11);
  return digitos
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');
}

function formatarWhatsapp(valor: string) {
  const digitos = valor.replace(/\D/g, '').slice(0, 11);
  if (digitos.length <= 10) {
    return digitos.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
  }
  return digitos.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
}

/** Tela de cadastro/"Teste grátis" — mesmo conjunto de informações do
 * formulário de cadastro do Bling (razão social, e-mail, WhatsApp,
 * CNPJ/CPF, segmento de trabalho e atividade principal), adaptado ao
 * Fluxa CRM: sem login social (ainda não integrado) e sem cupom/código de
 * parceiro (não existe programa de afiliados aqui). Toda entrada "Teste
 * grátis" do site (menu, hero, cards de planos, CTA final) leva pra cá. */
export default function Cadastrar() {
  const { cadastrar } = useAuth();
  const navigate = useNavigate();
  // null = ainda escolhendo a plataforma (etapa 1). Só o Fluxa CRM tem
  // formulário completo hoje; os outros abrem "quero ser avisado".
  const [plataforma, setPlataforma] = useState<'crm' | null>(null);
  const [nomeEmpresa, setNomeEmpresa] = useState('');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [tipoDocumento, setTipoDocumento] = useState<'cnpj' | 'cpf'>('cnpj');
  const [documento, setDocumento] = useState('');
  const [segmento, setSegmento] = useState('');
  const [atividadePrincipal, setAtividadePrincipal] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [aceitaTermos, setAceitaTermos] = useState(false);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  function trocarTipoDocumento(tipo: 'cnpj' | 'cpf') {
    setTipoDocumento(tipo);
    setDocumento(''); // máscaras diferentes — evita ficar com formatação errada
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    if (senha !== confirmarSenha) {
      setErro('As senhas não coincidem. Confira e tente de novo.');
      return;
    }
    if (!aceitaTermos) {
      setErro('Você precisa aceitar os termos e políticas de serviço pra continuar.');
      return;
    }
    setCarregando(true);
    try {
      await cadastrar({
        nome,
        email,
        senha,
        nomeEmpresa,
        whatsapp,
        segmento,
        atividadePrincipal,
        ...(documento ? { documento, documentoTipo: tipoDocumento } : {}),
      });
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

  // Etapa 1: qual plataforma Fluxa a pessoa quer testar.
  if (plataforma === null) {
    return (
      <AuthShell
        titulo="Qual plataforma deseja testar?"
        subtitulo="Escolha o produto Fluxa que você quer conhecer."
        rodape={
          <>
            Já tem uma empresa cadastrada?{' '}
            <Link to="/login" className="font-bold text-blue-600">
              Entrar
            </Link>
          </>
        }
      >
        <div className="space-y-3">
          {PLATAFORMAS.map((p) =>
            p.disponivel ? (
              <button
                key={p.id}
                type="button"
                onClick={() => setPlataforma('crm')}
                className="w-full flex items-center justify-between gap-3 rounded-xl border border-line bg-white p-4 text-left hover:border-teal-500 hover:bg-teal-500/5 transition-colors"
              >
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-extrabold text-ink">{p.nome}</span>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${p.statusCls}`}
                    >
                      {p.status}
                    </span>
                  </div>
                  <p className="text-xs text-ink-soft mt-0.5">{p.desc}</p>
                </div>
                <span aria-hidden="true" className="text-ink-soft shrink-0">
                  →
                </span>
              </button>
            ) : (
              <a
                key={p.id}
                href={`mailto:josycampos.comercial@gmail.com?subject=${encodeURIComponent(
                  `Quero ser avisado sobre o ${p.nome}`
                )}`}
                className="w-full flex items-center justify-between gap-3 rounded-xl border border-line bg-white p-4 text-left hover:bg-surface transition-colors"
              >
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-extrabold text-ink">{p.nome}</span>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${p.statusCls}`}
                    >
                      {p.status}
                    </span>
                  </div>
                  <p className="text-xs text-ink-soft mt-0.5">{p.desc}</p>
                </div>
                <span className="text-xs font-bold text-ink-soft shrink-0">Quero ser avisado</span>
              </a>
            )
          )}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      titulo="Crie sua conta no Fluxa CRM"
      subtitulo="Comece seu teste grátis e organize o funil de vendas da sua empresa."
      rodape={
        <>
          Já tem uma empresa cadastrada?{' '}
          <Link to="/login" className="font-bold text-blue-600">
            Entrar
          </Link>
        </>
      }
    >
      <button
        type="button"
        onClick={() => setPlataforma(null)}
        className="flex items-center gap-1.5 text-xs font-bold text-ink-soft hover:text-ink transition-colors mb-4"
      >
        <span aria-hidden="true">←</span> Escolher outra plataforma
      </button>
      <form onSubmit={onSubmit} className="bg-white border border-line rounded-2xl p-6 space-y-4">
        <div>
          <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
            Razão social
          </label>
          <input
            required
            placeholder="Ex: Empresa XYZ"
            value={nomeEmpresa}
            onChange={(e) => setNomeEmpresa(e.target.value)}
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
            E-mail de conta <span className="normal-case font-semibold text-ink-soft/70">(login de administrador)</span>
          </label>
          <input
            type="email"
            required
            placeholder="seuemail@exemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-line px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
            Nº de WhatsApp
          </label>
          <input
            required
            placeholder="(00) 00000-0000"
            inputMode="numeric"
            value={whatsapp}
            onChange={(e) => setWhatsapp(formatarWhatsapp(e.target.value))}
            className="w-full rounded-xl border border-line px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
            CNPJ / CPF <span className="normal-case font-semibold text-ink-soft/70">(opcional)</span>
          </label>
          <div className="flex gap-2">
            <div className="inline-flex rounded-xl border border-line overflow-hidden text-sm font-bold shrink-0">
              <button
                type="button"
                onClick={() => trocarTipoDocumento('cnpj')}
                className={`px-3.5 py-2.5 transition-colors ${
                  tipoDocumento === 'cnpj' ? 'bg-ink text-white' : 'text-ink-soft hover:bg-surface'
                }`}
              >
                CNPJ
              </button>
              <button
                type="button"
                onClick={() => trocarTipoDocumento('cpf')}
                className={`px-3.5 py-2.5 border-l border-line transition-colors ${
                  tipoDocumento === 'cpf' ? 'bg-ink text-white' : 'text-ink-soft hover:bg-surface'
                }`}
              >
                CPF
              </button>
            </div>
            <input
              placeholder={tipoDocumento === 'cnpj' ? '00.000.000/0000-00' : '000.000.000-00'}
              inputMode="numeric"
              value={documento}
              onChange={(e) =>
                setDocumento(tipoDocumento === 'cnpj' ? formatarCnpj(e.target.value) : formatarCpf(e.target.value))
              }
              className="w-full rounded-xl border border-line px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
            Qual seu segmento de trabalho?
          </label>
          <select
            required
            value={segmento}
            onChange={(e) => setSegmento(e.target.value)}
            className="w-full rounded-xl border border-line px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
          >
            <option value="">Selecione uma opção</option>
            {SEGMENTOS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
            Qual é a atividade principal da sua empresa?
          </label>
          <input
            required
            placeholder="Ex: Loja de semijoias"
            value={atividadePrincipal}
            onChange={(e) => setAtividadePrincipal(e.target.value)}
            className="w-full rounded-xl border border-line px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
          />
        </div>

        <CampoSenha
          label="Digite uma senha"
          value={senha}
          onChange={setSenha}
          required
          minLength={6}
          autoComplete="new-password"
        />
        <CampoSenha
          label="Confirme sua senha"
          value={confirmarSenha}
          onChange={setConfirmarSenha}
          required
          minLength={6}
          autoComplete="new-password"
        />

        <label className="flex items-start gap-2.5 text-xs text-ink-soft cursor-pointer select-none">
          <input
            type="checkbox"
            checked={aceitaTermos}
            onChange={(e) => setAceitaTermos(e.target.checked)}
            className="mt-0.5 w-4 h-4 shrink-0"
          />
          Declaro ter lido e aceitado os <span className="font-bold text-ink">termos e políticas de serviço</span>.
        </label>

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
