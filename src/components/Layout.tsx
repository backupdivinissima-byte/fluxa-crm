import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { ouvirVendedores } from '../lib/crmData';
import { DONOS_PLATAFORMA } from '../pages/Modulos';
import { modulosDaEmpresa, moduloDaRota, rotaInicial, MODULOS_SEPARADOS, type Modulo } from '../lib/modulos';
import AgendaLembrete from './AgendaLembrete';
import AcompanhamentoCarteira from './AcompanhamentoCarteira';
import CelebracaoMeta from './CelebracaoMeta';
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
  IconAgenda,
  IconEstoque,
  IconErpInicio,
  IconErpVendas,
  IconErpFinanceiro,
  IconErpCadastros,
  IconErpIntegracoes,
} from './NavIcons';

const itens = [
  { to: '/dashboard', label: 'Dashboard', labelVendedor: 'Meu painel', icon: <IconDashboard />, fim: true },
  { to: '/crm', label: 'CRM', labelVendedor: 'Meu CRM', icon: <IconCrm /> },
  { to: '/agenda', label: 'Agenda', labelVendedor: 'Minha agenda', icon: <IconAgenda /> },
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
  // Produtos e estoque (Fluxa ERP): só admin.
  { to: '/erp/inicio', label: 'Início', icon: <IconErpInicio />, apenasAdmin: true },
  { to: '/erp/vendas', label: 'Vendas', icon: <IconErpVendas />, apenasAdmin: true },
  { to: '/erp/estoque', label: 'Estoque', icon: <IconEstoque />, apenasAdmin: true },
  { to: '/erp/financeiro', label: 'Financeiro', icon: <IconErpFinanceiro />, apenasAdmin: true },
  { to: '/erp/cadastros', label: 'Cadastros', icon: <IconErpCadastros />, apenasAdmin: true },
  { to: '/erp/integracoes', label: 'Integrações', icon: <IconErpIntegracoes />, apenasAdmin: true },
  // Encontrar e qualificar novos clientes (Fluxa Prospect): só admin.
  { to: '/prospect', label: 'Prospecção', icon: <IconClientes />, apenasAdmin: true },
  // Só para os donos da plataforma: liga/desliga os produtos de cada empresa.
  { to: '/modulos', label: 'Módulos', icon: <IconLinks />, apenasAdmin: true, apenasDono: true },
];

const NOME_MODULO: Record<Modulo, string> = { crm: 'CRM', marketing: 'Marketing', chat: 'Chat', erp: 'ERP', prospect: 'Prospect' };
const CHAVE_MODULO_ATUAL = 'fluxa_modulo_atual';

/** Nav superior única (marca + abas): nada de menu lateral, todas as abas
 * acessíveis no topo, tela toda livre para os dados. */
export default function Layout() {
  const { empresa, perfil, sessaoVendedor, papel, sair, definirVinculoModulos } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  // O que o gerencial liberou para este vendedor (atualiza ao vivo, sem precisar sair e entrar).
  const [acessosVend, setAcessosVend] = useState<Array<'crm' | 'chat' | 'prospect'>>(sessaoVendedor?.vendedor.acessos ?? ['crm', 'chat']);
  useEffect(() => {
    if (papel !== 'vendedor' || !empresa?.id || !sessaoVendedor) return;
    return ouvirVendedores(empresa.id, (lista) => {
      const eu = lista.find((v) => v.login === sessaoVendedor.vendedor.login);
      if (eu) setAcessosVend(eu.acessos ?? ['crm', 'chat']);
    });
  }, [papel, empresa?.id, sessaoVendedor]);

  // Módulos contratados: cada um mostra só as próprias abas. Com mais de um,
  // a empresa escolhe vincular tudo (todas as abas juntas) ou trabalhar em
  // módulos separados (um de cada vez, trocando no seletor).
  const modulos = modulosDaEmpresa(empresa);
  // O ERP é um módulo individual: nunca entra no "vincular tudo" (não mistura abas nem dados com os outros).
  // A ligação dele com CRM/Marketing/Chat será só por API.
  const vinculaveis = modulos.filter((m) => !MODULOS_SEPARADOS.includes(m));
  const separados = modulos.filter((m) => MODULOS_SEPARADOS.includes(m));
  const varios = modulos.length > 1;
  // Cada módulo é separado (CRM, Marketing, Chat, ERP, Prospect): nunca juntamos as abas num grupo só.
  const vinculados = false;
  const [moduloEscolhido, setModuloEscolhido] = useState<Modulo | null>(() => {
    try {
      return sessionStorage.getItem(CHAVE_MODULO_ATUAL) as Modulo | null;
    } catch {
      return null;
    }
  });
  // A tela aberta manda: abrir /chat a partir do Prospect, por exemplo, troca para o módulo Chat em vez de voltar.
  const moduloDaTela = moduloDaRota(location.pathname, modulos);
  const rotaNeutra = location.pathname === '/modulos' || location.pathname === '/dashboard';
  const moduloAtual: Modulo = !rotaNeutra && modulos.includes(moduloDaTela) ? moduloDaTela : moduloEscolhido && modulos.includes(moduloEscolhido) ? moduloEscolhido : modulos[0];
  const visiveisAdmin: Modulo[] = !varios ? modulos : MODULOS_SEPARADOS.includes(moduloAtual) ? [moduloAtual] : vinculados ? vinculaveis : [moduloAtual];
  // Vendedor não troca de módulo: vê o que o gerencial liberou (abas filtradas abaixo).
  const visiveis: Modulo[] = papel === 'admin' ? visiveisAdmin : modulos;
  const perguntarVinculo = false;

  function trocarModulo(m: Modulo) {
    setModuloEscolhido(m);
    try {
      sessionStorage.setItem(CHAVE_MODULO_ATUAL, m);
    } catch {
      /* sem armazenamento */
    }
    navigate(rotaInicial(m));
  }

  // Quem abre uma tela de um módulo que não está liberado vai para o módulo certo.
  if (empresa?.id && !visiveis.includes(moduloDaRota(location.pathname, modulos))) {
    return <Navigate to={rotaInicial(visiveis[0])} replace />;
  }
  // Vendedor abrindo uma aba que o gerencial não liberou: volta para a primeira que ele tem.
  const grupoDe = (to: string): 'crm' | 'chat' | 'prospect' => (to.startsWith('/chat') ? 'chat' : to.startsWith('/prospect') ? 'prospect' : 'crm');
  const abaDoVendedor = (item: (typeof itens)[number]) => (!item.apenasAdmin || item.to === '/prospect') && !('apenasDono' in item) && acessosVend.includes(grupoDe(item.to)) && visiveis.includes(moduloDaRota(item.to, modulos));
  if (papel === 'vendedor' && /^\/(chat|prospect|dashboard|crm|agenda|clientes|metas)/.test(location.pathname) && !acessosVend.includes(grupoDe(location.pathname))) {
    const primeira = itens.find(abaDoVendedor);
    if (primeira && primeira.to !== location.pathname) return <Navigate to={primeira.to} replace />;
  }

  const nomeUsuario = papel === 'admin' ? perfil?.nome : sessaoVendedor?.vendedor.nome;

  return (
    <div className="min-h-screen flex flex-col bg-surface">
      <header className="sticky top-0 z-40 bg-white border-b border-line shrink-0">
        <div className="flex items-center gap-1 px-5 py-2 min-h-14 flex-wrap">
          <div className="flex items-center gap-2 mr-4 shrink-0">
            <img src={fluxaIcon} alt="Fluxa CRM" className="w-8 h-8" />
            <span className="text-lg font-extrabold tracking-tight text-ink">
              {modulos.length === 1 && modulos[0] === 'marketing' ? 'Fluxa Marketing' : modulos.length === 1 && modulos[0] === 'chat' ? 'Fluxa Chat' : modulos.length === 1 && modulos[0] === 'erp' ? 'Fluxa ERP' : modulos.length === 1 && modulos[0] === 'prospect' ? 'Fluxa Prospect' : 'Fluxa CRM'}
            </span>
          </div>

          {papel === 'admin' && varios && (!vinculados || separados.length > 0) && !perguntarVinculo && (
            <div className="flex bg-slate-100 rounded-lg p-0.5 mr-2 shrink-0">
              {(vinculados ? [vinculaveis[0], ...separados] : modulos).map((m) => {
                const grupo = vinculados && !MODULOS_SEPARADOS.includes(m);
                const ativo = grupo ? !MODULOS_SEPARADOS.includes(moduloAtual) : m === moduloAtual;
                return (
                  <button
                    key={m}
                    onClick={() => trocarModulo(m)}
                    className={`px-3 h-8 rounded-md text-xs font-bold uppercase tracking-wide ${ativo ? 'bg-white text-ink shadow-sm' : 'text-ink-soft'}`}
                  >
                    {grupo ? vinculaveis.map((x) => NOME_MODULO[x]).join(' + ') : NOME_MODULO[m]}
                  </button>
                );
              })}
            </div>
          )}

          <nav className="flex items-center gap-1 flex-wrap">
            {itens
              .filter((item) => (papel === 'admin' ? true : abaDoVendedor(item)))
              .filter((item) => !item.apenasAdmin || papel === 'admin' || item.to === '/prospect')
              .filter((item) => !('apenasDono' in item) || (!!perfil?.email && DONOS_PLATAFORMA.includes(perfil.email.toLowerCase())))
              .filter((item) => visiveis.includes(moduloDaRota(item.to, modulos)))
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

      {papel === 'vendedor' && <AgendaLembrete />}
      {papel === 'vendedor' && <AcompanhamentoCarteira />}
      {papel === 'vendedor' && <CelebracaoMeta />}

      {perguntarVinculo && (
        <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <h3 className="text-base font-extrabold text-ink">Vincular todos os módulos?</h3>
            <p className="text-xs text-ink-soft mt-2">
              Você tem mais de um módulo ({vinculaveis.map((m) => NOME_MODULO[m]).join(' e ')}). Se vincular, as abas de todos aparecem juntas na barra
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
