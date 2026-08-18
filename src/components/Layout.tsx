import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import fluxaIcon from '../assets/fluxa-icon.svg';
import { useAuth } from '../contexts/AuthContext';
import {
  IconDashboard,
  IconCrm,
  IconClientes,
  IconVendedores,
  IconMetas,
  IconLinks,
  IconImportar,
} from './NavIcons';

const itens = [
  { to: '/dashboard', label: 'Dashboard', icon: <IconDashboard />, fim: true },
  { to: '/crm', label: 'CRM', icon: <IconCrm /> },
  { to: '/clientes', label: 'Clientes', icon: <IconClientes /> },
  { to: '/vendedores', label: 'Vendedores', icon: <IconVendedores /> },
  { to: '/metas', label: 'Metas & Comissões', icon: <IconMetas /> },
  { to: '/links', label: 'Links dos vendedores', icon: <IconLinks /> },
  // Disponível pra qualquer empresa, só não faz sentido pro login de
  // vendedor (só o administrador importa/sincroniza dados).
  { to: '/importar', label: 'Importar / Sincronização', icon: <IconImportar />, apenasAdmin: true },
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
        <div className="flex items-center gap-1 px-5 py-2 min-h-14 flex-wrap">
          <div className="flex items-center gap-2 mr-4 shrink-0">
            <img src={fluxaIcon} alt="Fluxa CRM" className="w-8 h-8" />
            <span className="text-lg font-extrabold tracking-tight text-ink">Fluxa CRM</span>
          </div>

          <nav className="flex items-center gap-1 flex-wrap">
            {itens
              .filter((item) => !item.apenasAdmin || papel === 'admin')
              .map((item) => (
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
