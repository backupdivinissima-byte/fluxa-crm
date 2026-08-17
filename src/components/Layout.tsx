import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import fluxaIcon from '../assets/fluxa-icon.svg';
import { useAuth } from '../contexts/AuthContext';

/** Ícones da nav do sistema — traço fino em currentColor (herda a cor do
 * NavLink: cinza quando inativo, teal quando ativo), no mesmo estilo dos
 * ícones da página institucional, no lugar dos emojis antigos. */
function NavIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-[18px] h-[18px] shrink-0"
    >
      {children}
    </svg>
  );
}

function IconDashboard() {
  return (
    <NavIcon>
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.3" />
      <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.3" />
      <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.3" />
      <rect x="13" y="13" width="7.5" height="7.5" rx="1.3" />
    </NavIcon>
  );
}

function IconCrm() {
  return (
    <NavIcon>
      <path d="M4 5h16l-6.2 7.2v6.3l-3.6 1.8v-8.1L4 5z" />
    </NavIcon>
  );
}

function IconClientes() {
  return (
    <NavIcon>
      <circle cx="9" cy="8.2" r="3" />
      <path d="M3.3 20c.3-3.6 2.8-6 5.7-6s5.4 2.4 5.7 6" />
      <circle cx="17" cy="9.2" r="2.2" />
      <path d="M14.6 14.4c2.3.5 4 2.6 4.2 5.6" />
    </NavIcon>
  );
}

function IconVendedores() {
  return (
    <NavIcon>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="M6.5 15.5c.4-1.6 1.5-2.5 2.5-2.5s2.1.9 2.5 2.5" />
      <path d="M14.5 10h4M14.5 13h4" />
    </NavIcon>
  );
}

function IconMetas() {
  return (
    <NavIcon>
      <circle cx="12" cy="12" r="7.8" />
      <circle cx="12" cy="12" r="4.3" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
    </NavIcon>
  );
}

function IconLinks() {
  return (
    <NavIcon>
      <path d="M8 16 5.8 13.8a3.5 3.5 0 0 1 0-5l1-1a3.5 3.5 0 0 1 5 0L14 10" />
      <path d="M16 8l2.2 2.2a3.5 3.5 0 0 1 0 5l-1 1a3.5 3.5 0 0 1-5 0L10 14" />
      <path d="M9.5 14.5 14.5 9.5" />
    </NavIcon>
  );
}

function IconImportar() {
  return (
    <NavIcon>
      <path d="M7 18a4 4 0 0 1-.5-7.97A5 5 0 0 1 16.3 8.2 4.5 4.5 0 0 1 16.5 18H7Z" />
      <path d="M12 10.5v6M9.5 13l2.5-2.5 2.5 2.5" />
    </NavIcon>
  );
}

const itens = [
  { to: '/dashboard', label: 'Dashboard', icon: <IconDashboard />, fim: true },
  { to: '/crm', label: 'CRM', icon: <IconCrm /> },
  { to: '/clientes', label: 'Clientes', icon: <IconClientes /> },
  { to: '/vendedores', label: 'Vendedores', icon: <IconVendedores /> },
  { to: '/metas', label: 'Metas & Comissões', icon: <IconMetas /> },
  { to: '/links', label: 'Links dos vendedores', icon: <IconLinks /> },
  { to: '/importar', label: 'Importar / Sincronização', icon: <IconImportar /> },
];

/** Nav superior única (marca + abas), mesmo padrão já validado no Fluxa ERP
 * e na própria Divinissima hoje: nada de menu lateral, todas as abas
 * acessíveis no topo, tela toda livre para os dados. */
export default function Layout() {
  const { empresa, perfil, sessaoVendedor, papel, sair } = useAuth();
  const location = useLocation();

  useEffect(() => {
    // Reservado para fechar dropdowns futuros ao trocar de rota.
  }, [location.pathname]);

  const nomeUsuario = papel === 'admin' ? perfil?.nome : sessaoVendedor?.vendedor.nome;

  return (
    <div className="min-h-screen flex flex-col bg-surface">
      <header className="sticky top-0 z-40 bg-white border-b border-line shrink-0">
        <div className="flex items-center gap-1 px-5 h-14 flex-wrap">
          <div className="flex items-center gap-2 mr-4 shrink-0">
            <img src={fluxaIcon} alt="Fluxa CRM" className="w-8 h-8" />
            <span className="text-lg font-extrabold tracking-tight text-ink">Fluxa CRM</span>
          </div>

          <nav className="flex items-center gap-1 flex-wrap">
            {itens.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.fim}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 h-9 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${
                    isActive ? 'bg-teal-500/10 text-teal-500' : 'text-ink-soft hover:bg-surface'
                  }`
                }
              >
                {item.icon} {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-4 pl-4 shrink-0">
            <div className="text-right hidden sm:block">
              <div className="text-xs font-bold text-ink-soft uppercase tracking-wide truncate max-w-[160px]">
                {empresa?.nome ?? '—'}
              </div>
              <div className="text-xs text-ink-soft truncate max-w-[160px]">{nomeUsuario}</div>
            </div>
            <button
              onClick={() => sair()}
              className="text-xs font-bold text-ink-soft hover:text-ink transition-colors border border-line rounded-lg px-3 py-1.5 shrink-0"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
