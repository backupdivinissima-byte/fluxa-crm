import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import fluxaIcon from '../assets/fluxa-icon.svg';

/** Ícones dos cards de recursos — mesmo quadrado arredondado com gradiente
 * teal→azul da logo (fluxa-icon.svg), com um traço branco simples por
 * dentro, pra manter a identidade visual da marca em vez de emojis genéricos. */
function IconBase({ children }: { children: ReactNode }) {
  return (
    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 flex items-center justify-center">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-6 h-6"
      >
        {children}
      </svg>
    </div>
  );
}

function IconFunil() {
  return (
    <IconBase>
      <path d="M4 5h16l-6.2 7.2v6.3l-3.6 1.8v-8.1L4 5z" />
    </IconBase>
  );
}

function IconClientes() {
  return (
    <IconBase>
      <circle cx="9" cy="8.2" r="3" />
      <path d="M3.3 20c.3-3.6 2.8-6 5.7-6s5.4 2.4 5.7 6" />
      <circle cx="17" cy="9.2" r="2.2" />
      <path d="M14.6 14.4c2.3.5 4 2.6 4.2 5.6" />
    </IconBase>
  );
}

function IconVendedores() {
  return (
    <IconBase>
      <path d="M12 3.2 14.3 5l2.9.4.5 2.9 2 2.1-1.7 2.5.3 2.9-2.8.9-1.6 2.5-2.7-.8-2.7.8-1.6-2.5-2.8-.9.3-2.9L2.5 10.4l2-2.1.5-2.9L7.9 5 12 3.2Z" />
      <circle cx="12" cy="10.8" r="2.3" />
    </IconBase>
  );
}

function IconMetas() {
  return (
    <IconBase>
      <circle cx="12" cy="12" r="7.8" />
      <circle cx="12" cy="12" r="4.3" />
      <circle cx="12" cy="12" r="0.9" fill="white" stroke="none" />
    </IconBase>
  );
}

const recursos = [
  {
    titulo: 'Funil de vendas',
    desc: 'Acompanhe cada cliente da primeira conversa até a venda fechada, num quadro visual fácil de arrastar e organizar.',
    icon: <IconFunil />,
    bg: 'bg-teal-50',
  },
  {
    titulo: 'Clientes',
    desc: 'Todo o histórico de cada cliente num só lugar — contato, última compra, vendedor responsável e etapa atual.',
    icon: <IconClientes />,
    bg: 'bg-blue-50',
  },
  {
    titulo: 'Vendedores',
    desc: 'Cada vendedor com seu próprio acesso e sua própria carteira de clientes, sem misturar dados entre a equipe.',
    icon: <IconVendedores />,
    bg: 'bg-violet-50',
  },
  {
    titulo: 'Metas & Comissões',
    desc: 'Defina metas por vendedor e acompanhe o progresso em tempo real, com o cálculo de comissão sempre atualizado.',
    icon: <IconMetas />,
    bg: 'bg-amber-50',
  },
];

const planos = [
  {
    nome: 'Starter',
    preco: 79,
    desc: 'Pra quem está começando a organizar o time de vendas.',
    destaque: false,
    limite: 'Até 3 vendedores',
    recursos: [
      'Funil de vendas (Kanban)',
      'Cadastro de clientes ilimitado',
      'Metas e comissões por vendedor',
      'Sincronização em nuvem',
      'Suporte por e-mail',
    ],
  },
  {
    nome: 'Pro',
    preco: 179,
    desc: 'Pra equipes de vendas em crescimento.',
    destaque: true,
    limite: 'Até 10 vendedores',
    recursos: [
      'Tudo do plano Starter',
      'Painel individual por vendedor',
      'Links de acesso ilimitados p/ equipe',
      'Relatórios e ranking de vendas',
      'Suporte prioritário via WhatsApp',
    ],
  },
  {
    nome: 'Empresas',
    preco: 390,
    desc: 'Pra operações maiores, com times grandes.',
    destaque: false,
    limite: 'Vendedores ilimitados',
    recursos: [
      'Tudo do plano Pro',
      'Múltiplas equipes/filiais',
      'Gerente de conta dedicado',
      'Onboarding e treinamento da equipe',
      'Suporte prioritário 24/7',
    ],
  },
];

const passos = [
  {
    numero: '1',
    titulo: 'Cadastre sua empresa',
    desc: 'Leva menos de dois minutos — só o nome da empresa, seu nome e um e-mail de acesso.',
  },
  {
    numero: '2',
    titulo: 'Organize seu funil',
    desc: 'Adicione seus clientes e sua equipe de vendas, e comece a mover cada negociação pelas etapas do funil.',
  },
  {
    numero: '3',
    titulo: 'Acompanhe os resultados',
    desc: 'Veja metas, comissões e o desempenho de cada vendedor num painel só, sempre atualizado.',
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav pública */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-line">
        <div className="max-w-6xl mx-auto flex items-center gap-6 px-5 h-16">
          <Link to="/" className="flex items-center gap-2 shrink-0">
            <img src={fluxaIcon} alt="Fluxa CRM" className="w-8 h-8" />
            <span className="text-lg font-extrabold tracking-tight text-ink">Fluxa CRM</span>
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-sm font-semibold text-ink-soft">
            <a href="#recursos" className="hover:text-ink transition-colors">
              Funcionalidades
            </a>
            <a href="#como-funciona" className="hover:text-ink transition-colors">
              Como funciona
            </a>
            <a href="#planos" className="hover:text-ink transition-colors">
              Planos
            </a>
          </nav>

          <div className="ml-auto flex items-center gap-3 shrink-0">
            <Link to="/login" className="text-sm font-bold text-ink-soft hover:text-ink transition-colors">
              Entrar
            </Link>
            <Link
              to="/cadastrar"
              className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-4 py-2.5 hover:opacity-90 transition-opacity"
            >
              Teste grátis
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-4xl mx-auto text-center px-5 pt-20 pb-16">
        <span className="inline-block bg-teal-500/10 text-teal-600 text-xs font-bold uppercase tracking-wide px-3 py-1.5 rounded-full mb-6">
          Teste grátis
        </span>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-ink leading-tight mb-5">
          Cada cliente, no momento certo do funil.
        </h1>
        <p className="text-lg text-ink-soft max-w-2xl mx-auto mb-9">
          O CRM que organiza o funil de vendas da sua empresa, do primeiro contato até o fechamento — com clientes,
          vendedores, metas e comissões, tudo num só lugar.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <a
            href="mailto:josycampos.comercial@gmail.com?subject=Quero%20conhecer%20o%20Fluxa%20CRM"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-6 py-3.5 hover:opacity-90 transition-opacity"
          >
            Fale com vendas <span aria-hidden="true">→</span>
          </a>
        </div>
      </section>

      {/* Recursos */}
      <section id="recursos" className="max-w-6xl mx-auto px-5 py-16">
        <h2 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight text-center mb-2">
          Tudo que sua equipe de vendas precisa
        </h2>
        <p className="text-ink-soft text-center max-w-xl mx-auto mb-12">
          Um sistema só para cuidar de cada etapa da venda, sem planilha e sem perder o histórico do cliente.
        </p>
        <div className="grid sm:grid-cols-2 gap-5">
          {recursos.map((r) => (
            <div key={r.titulo} className={`${r.bg} rounded-2xl p-7 border border-line/60`}>
              <div className="mb-4">{r.icon}</div>
              <h3 className="text-base font-extrabold text-ink mb-2">{r.titulo}</h3>
              <p className="text-sm text-ink-soft leading-relaxed">{r.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Como funciona */}
      <section id="como-funciona" className="bg-surface py-16">
        <div className="max-w-5xl mx-auto px-5">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight text-center mb-12">
            Como funciona
          </h2>
          <div className="grid sm:grid-cols-3 gap-8">
            {passos.map((p) => (
              <div key={p.numero} className="text-center sm:text-left">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-500 to-blue-600 text-white font-extrabold flex items-center justify-center mx-auto sm:mx-0 mb-4">
                  {p.numero}
                </div>
                <h3 className="text-base font-extrabold text-ink mb-2">{p.titulo}</h3>
                <p className="text-sm text-ink-soft leading-relaxed">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Planos */}
      <section id="planos" className="max-w-6xl mx-auto px-5 py-16">
        <h2 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight text-center mb-2">
          Planos pra cada tamanho de equipe
        </h2>
        <p className="text-ink-soft text-center max-w-xl mx-auto mb-4">
          Comece com 14 dias grátis em qualquer plano, sem cartão de crédito. Cancele quando quiser.
        </p>
        <div className="grid sm:grid-cols-3 gap-6 items-start">
          {planos.map((p) => (
            <div
              key={p.nome}
              className={`relative rounded-2xl p-7 border ${
                p.destaque ? 'border-teal-500 shadow-lg shadow-teal-500/10 sm:-translate-y-2' : 'border-line'
              } bg-white flex flex-col h-full`}
            >
              {p.destaque && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-br from-teal-500 to-blue-600 text-white text-xs font-bold uppercase tracking-wide px-3 py-1">
                  Mais popular
                </span>
              )}
              <h3 className="text-lg font-extrabold text-ink mb-1">{p.nome}</h3>
              <p className="text-sm text-ink-soft mb-5">{p.desc}</p>
              <div className="mb-1 flex items-baseline gap-1">
                <span className="text-3xl font-extrabold text-ink">
                  R$ {p.preco.toLocaleString('pt-BR')}
                </span>
                <span className="text-sm text-ink-soft">/mês</span>
              </div>
              <p className="text-xs font-bold text-teal-600 uppercase tracking-wide mb-6">{p.limite}</p>
              <ul className="space-y-3 mb-8 flex-1">
                {p.recursos.map((r) => (
                  <li key={r} className="flex items-start gap-2 text-sm text-ink-soft">
                    <svg
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-4 h-4 mt-0.5 shrink-0 text-teal-500"
                    >
                      <path d="M4 10.5 8 14.5 16 6" />
                    </svg>
                    {r}
                  </li>
                ))}
              </ul>
              <Link
                to="/cadastrar"
                className={`w-full text-center rounded-xl text-sm font-bold px-4 py-3 transition-opacity hover:opacity-90 ${
                  p.destaque
                    ? 'bg-gradient-to-br from-teal-500 to-blue-600 text-white'
                    : 'bg-surface text-ink border border-line'
                }`}
              >
                Teste grátis
              </Link>
            </div>
          ))}
        </div>
        <p className="text-center text-xs text-ink-soft mt-8">
          Precisa de um plano sob medida para uma operação maior?{' '}
          <a
            href="mailto:josycampos.comercial@gmail.com?subject=Quero%20conhecer%20o%20Fluxa%20CRM"
            className="font-bold text-blue-600"
          >
            Fale com vendas
          </a>
          .
        </p>
      </section>

      {/* CTA final */}
      <section className="max-w-5xl mx-auto px-5 py-16">
        <div className="bg-gradient-to-br from-teal-500 to-blue-600 rounded-3xl px-8 py-14 text-center text-white">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-3">Comece agora, é grátis</h2>
          <p className="text-white/85 max-w-lg mx-auto mb-8">
            Cadastre sua empresa em poucos minutos e organize seu funil de vendas ainda hoje.
          </p>
          <Link
            to="/cadastrar"
            className="inline-block rounded-xl bg-white text-ink text-sm font-bold px-6 py-3.5 hover:opacity-90 transition-opacity"
          >
            Criar minha conta
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-line">
        <div className="max-w-6xl mx-auto px-5 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src={fluxaIcon} alt="Fluxa CRM" className="w-6 h-6" />
            <span className="text-sm font-extrabold text-ink">Fluxa CRM</span>
          </div>
          <div className="flex items-center gap-6 text-sm font-semibold text-ink-soft">
            <Link to="/login" className="hover:text-ink transition-colors">
              Entrar
            </Link>
            <Link to="/cadastrar" className="hover:text-ink transition-colors">
              Criar empresa
            </Link>
          </div>
          <p className="text-xs text-ink-soft">© 2026 Fluxa CRM. Todos os direitos reservados.</p>
        </div>
      </footer>
    </div>
  );
}
