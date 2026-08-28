import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { IconMarketing, IconMetaAds, IconLive } from '../components/NavIcons';

const ABAS = [
  { to: '/marketing/meta', label: 'Meta', icon: <IconMetaAds /> },
  { to: '/marketing/live', label: 'Live', icon: <IconLive /> },
  { to: '/marketing/analise', label: 'Análise Marketing', icon: <IconMarketing /> },
];

/** Casca do módulo Marketing: cabeçalho + sub-abas (Meta / Live / Análise
 * Marketing) + conteúdo da aba atual. Só admin acessa (mesma regra do item
 * de nav em Layout.tsx), então a rota raiz "/marketing" só existe pra
 * redirecionar pra "/marketing/meta". */
export default function Marketing() {
  const { papel } = useAuth();
  const location = useLocation();

  if (papel !== 'admin') {
    return (
      <div className="p-6 w-full">
        <p className="text-sm text-ink-soft">Somente administradores acessam o módulo Marketing.</p>
      </div>
    );
  }

  if (location.pathname === '/marketing' || location.pathname === '/marketing/') {
    return <Navigate to="/marketing/meta" replace />;
  }

  return (
    <div className="w-full">
      <div className="border-b border-line bg-white px-5">
        <div className="flex items-center gap-1 flex-wrap">
          {ABAS.map((aba) => (
            <NavLink
              key={aba.to}
              to={aba.to}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 h-11 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
                  isActive ? 'border-teal-500 text-teal-600' : 'border-transparent text-ink-soft hover:text-ink'
                }`
              }
            >
              {aba.icon} {aba.label}
            </NavLink>
          ))}
        </div>
      </div>
      <Outlet />
    </div>
  );
}
