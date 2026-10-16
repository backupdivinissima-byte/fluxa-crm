import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { modulosDaEmpresa, moduloDaRota, type Modulo } from '../lib/modulos';
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
  IconMarketing,
  IconChat,
} from './NavIcons';

const itens = [
  { to: '/dashboard', label: 'Dashboard', labelVendedor: 'Meu painel', icon: <IconDashboard />, fim: true },
  { to: '/crm', label: 'CRM', labelVendedor: 'Meu CRM', icon: <IconCrm /> },
  { to: '/clientes', label: 'Clientes', labelVendedor: 'Meus clientes', icon: <IconClientes /> },
  { to: '/vendedores', label: 'Vendedores', icon: <IconVendedores />, apenasAdmin: true },
  { to: '/metas', label: 'Metas & Comissões', icon: <IconMetas /> },
  { to: '/links', label: 'Links dos vendedores', icon: <IconLinks />, apenasAdmin: true },
  // Disponível pra qualquer empresa, só não faz sentido pro login de
  // vendedor (só o administrador importa/sincroniza dados).
  { to: '/importar', label: 'Importar / Sincronização', icon: <IconImportar />, apenasAdmin: true },
  // Análise gerencial (anúncios, lives, ROI/CAC) — só admin, mesma regra de "Importar".
  { to: '/marketing', label: 'Marketing', icon: <IconMarketing />, apenasAdmin: true },
  // Atendimento (WhatsApp, Instagram Direct, Messenger): admin e vendedores.
  { to: '/chat', label: 'Chat', icon: <IconChat /> },
];

const NOME_MODULO: Record<Modulo, string> = { crm: 'CRM', marketing: 'Marketing' };
const CHAVE_MODULO_ATUAL = 'fluxa_modulo_atual';

/** Nav superior única (marca + abas): nada de menu lateral, todas as abas
 * acessíveis no topo, tela toda livre para os dados. */
export default function Layout() {
  const { empresa, perfil, sessaoVendedor, papel, sair, definirVinculoModulos } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Módulos contratados: cada um mostra só as próprias abas. Com mais de um,
  // a empresa escolhe vincular tudo (todas as abas juntas) ou trabalhar em
  // módulos separados (um de cada vez, trocando no seletor).
  const modulos = modulosDaEmpresa(empresa);
  const varios = modulos.length > 1;
  const vinculados = varios && empresa?.modulosVinculados === true;
  const [moduloEscolhido, setModuloEscolhido] = useState<Modulo | null>(() => {
    try {
      return sessionStorage.getItem(CHAVE_MODULO_ATUAL) as Modulo | null;
    } catch {
      return null;
    }
  });
  const moduloAtual: Modulo = moduloEscolhido && modulos.includes(moduloEscolhido) ? moduloEscolhido : modulos[0];
  const visiveis: Modulo[] = vinculados || !varios ? modulos : [moduloAtual];
  const perguntarVinculo = papel === 'admin' && varios && empresa?.modulosVinculados === undefined;

  function trocarModulo(m: Modulo) {
    setModuloEscolhido(m);
    try {
      sessionStorage.setItem(CHAVE_MODULO_ATUAL, m);
    } catch {
      /* sem armazenamento */
    }
    navigate(m === 'marketing' ? '/marketing' : '/dashboard');
  }

  // Quem abre uma tela de um módulo que não está liberado vai para o módulo certo.
  if (empresa?.id && !visiveis.includes(moduloDaRota(location.pathname))) {
    return <Navigate to={visiveis[0] === 'marketing' ? '/marketing' : '/dashboard'} replace />;
  }

  const nomeUsuario = papel === 'admin' ? perfil?.nome : sessaoVendedor?.vendedor.nome;

  return (
    <div className="min-h-screen flex flex-col bg-surface">
      <header className="sticky top-0 z-40 bg-white border-b border-line shrink-0">
        <div className="flex items-center gap-1 px-5 py-2 min-h-14 flex-wrap">
          <div className="flex items-center gap-2 mr-4 shrink-0">
            <img src={fluxaIcon} alt="Fluxa CRM" className="w-8 h-8" />
            <span className="text-lg font-extrabold tracking-tight text-ink">
              {modulos.length === 1 && modulos[0] === 'marketing' ? 'Fluxa Marketing' : 'Fluxa CRM'}
            </span>
          </div>

          {varios && !vinculados && !perguntarVinculo && (
            <div className="flex bg-slate-100 rounded-lg p-0.5 mr-2 shrink-0">
              {modulos.map((m) => (
                <button
                  key={m}
                  onClick={() => trocarModulo(m)}
                  className={`px-3 h-8 rounded-md text-xs font-bold uppercase tracking-wide ${m === moduloAtual ? 'bg-white text-ink shadow-sm' : 'text-ink-soft'}`}
                >
                  {NOME_MODULO[m]}
                </button>
              ))}
            </div>
          )}

          <nav className="flex items-center gap-1 flex-wrap">
            {itens
              .filter((item) => !item.apenasAdmin || papel === 'admin')
              .filter((item) => visiveis.includes(moduloDaRota(item.to)))
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
                  {item.icon} {papel !== 'admin' && 'labelVendedor' in item ? item.labelVendedor : item.label}
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

      {perguntarVinculo && (
        <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <h3 className="text-base font-extrabold text-ink">Vincular todos os módulos?</h3>
            <p className="text-xs text-ink-soft mt-2">
              Você tem mais de um módulo ({modulos.map((m) => NOME_MODULO[m]).join(' e ')}). Se vincular, as abas de todos aparecem juntas na barra
              de cima. Se não, cada módulo funciona separado e você troca entre eles no seletor.
            </p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => void definirVinculoModulos(true)} className="flex-1 rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold py-2">
                Sim, vincular tudo
              </button>
              <button onClick={() => void definirVinculoModulos(false)} className="flex-1 rounded-xl border border-line text-sm font-bold py-2 text-ink">
                Não, separados
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
