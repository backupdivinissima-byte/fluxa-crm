import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import PainelVendedor from './pages/PainelVendedor';
import Login from './pages/Login';
import Cadastrar from './pages/Cadastrar';
import Crm from './pages/Crm';
import Clientes from './pages/Clientes';
import Vendedores from './pages/Vendedores';
import Metas from './pages/Metas';
import Links from './pages/Links';
import Importar from './pages/Importar';
import LancarOrcamento from './pages/LancarOrcamento';
import Marketing from './pages/Marketing';
import Chat from './pages/Chat';
import Agenda from './pages/Agenda';
import Modulos from './pages/Modulos';
import Erp from './pages/Erp';
import Prospect from './pages/Prospect';
import MetaAds from './pages/marketing/MetaAds';
import Live from './pages/marketing/Live';
import AnaliseMarketing from './pages/marketing/AnaliseMarketing';
import InstagramLives from './pages/marketing/Instagram';

function Carregando() {
  return <div className="min-h-screen flex items-center justify-center text-ink-soft text-sm">Carregando...</div>;
}

// Raiz pública: quem não está logado vê a página inicial (institucional);
// quem já está logado é levado direto pro painel da empresa.
function Raiz() {
  const { carregando, papel } = useAuth();
  if (carregando) return <Carregando />;
  if (papel) return <Navigate to="/dashboard" replace />;
  return <Home />;
}

function RotaProtegida({ children }: { children: React.ReactNode }) {
  const { carregando, papel } = useAuth();
  if (carregando) return <Carregando />;
  if (!papel) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Raiz />} />
      <Route path="/planos" element={<Home />} />
      <Route path="/produtos" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/cadastrar" element={<Cadastrar />} />
      <Route
        element={
          <RotaProtegida>
            <Layout />
          </RotaProtegida>
        }
      >
        <Route path="/dashboard" element={<PainelOuDashboard />} />
        <Route path="/crm" element={<Crm />} />
        <Route path="/agenda" element={<Agenda />} />
        <Route path="/clientes" element={<Clientes />} />
        <Route path="/vendedores" element={<Vendedores />} />
        <Route path="/metas" element={<Metas />} />
        <Route path="/links" element={<Links />} />
        <Route path="/lancar-orcamento" element={<LancarOrcamento />} />
        <Route path="/importar" element={<Importar />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/modulos" element={<Modulos />} />
        <Route path="/erp/:aba?" element={<Erp />} />
        <Route path="/prospect" element={<Prospect />} />
        <Route path="/marketing" element={<Marketing />}>
          <Route index element={null} />
          <Route path="meta" element={<MetaAds />} />
          <Route path="live" element={<Live />} />
          <Route path="instagram" element={<InstagramLives />} />
          <Route path="analise" element={<AnaliseMarketing />} />
        </Route>
      </Route>
    </Routes>
  );
}

/** Admin vê o dashboard da empresa; vendedor cai direto no painel individual. */
function PainelOuDashboard() {
  const { papel } = useAuth();
  return papel === 'admin' ? <Dashboard /> : <PainelVendedor />;
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </HashRouter>
  );
}
