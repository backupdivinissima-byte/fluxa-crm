import { Link } from 'react-router-dom';
import fluxaIcon from '../assets/fluxa-icon.svg';

const recursos = [
  {
    titulo: 'Funil de vendas',
    desc: 'Acompanhe cada cliente da primeira conversa até a venda fechada, num quadro visual fácil de arrastar e organizar.',
    icon: '📋',
    bg: 'bg-teal-50',
  },
  {
    titulo: 'Clientes',
    desc: 'Todo o histórico de cada cliente num só lugar — contato, última compra, vendedor responsável e etapa atual.',
    icon: '👥',
    bg: 'bg-blue-50',
  },
  {
    titulo: 'Vendedores',
    desc: 'Cada vendedor com seu próprio acesso e sua própria carteira de clientes, sem misturar dados entre a equipe.',
    icon: '🏷️',
    bg: 'bg-violet-50',
  },
  {
    titulo: 'Metas & Comissões',
    desc: 'Defina metas por vendedor e acompanhe o progresso em tempo real, com o cálculo de comissão sempre atualizado.',
    icon: '🎯',
    bg: 'bg-amber-50',
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
          </nav>

          <div className="ml-auto flex items-center gap-3 shrink-0">
            <Link to="/login" className="text-sm font-bold text-ink-soft hover:text-ink transition-colors">
              Entrar
            </Link>
            <Link
              to="/cadastrar"
              className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-4 py-2.5 hover:opacity-90 transition-opacity"
            >
              Criar empresa grátis
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-4xl mx-auto text-center px-5 pt-20 pb-16">
        <span className="inline-block bg-teal-500/10 text-teal-600 text-xs font-bold uppercase tracking-wide px-3 py-1.5 rounded-full mb-6">
          Comece hoje, é grátis
        </span>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-ink leading-tight mb-5">
          Cada cliente, no momento certo do funil.
        </h1>
        <p className="text-lg text-ink-soft max-w-2xl mx-auto mb-9">
          O CRM que organiza o funil de vendas da sua empresa, do primeiro contato até o fechamento — com clientes,
          vendedores, metas e comissões, tudo num só lugar.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/cadastrar"
            className="w-full sm:w-auto rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-6 py-3.5 hover:opacity-90 transition-opacity"
          >
            Criar minha empresa
          </Link>
          <Link
            to="/login"
            className="w-full sm:w-auto rounded-xl border border-line text-ink text-sm font-bold px-6 py-3.5 hover:bg-surface transition-colors"
          >
            Já tenho uma empresa → Entrar
          </Link>
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
              <div className="text-3xl mb-4">{r.icon}</div>
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
            Criar minha empresa
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
