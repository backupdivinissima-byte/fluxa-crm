import { useAuth } from '../contexts/AuthContext';

export default function Dashboard() {
  const { empresa, perfil, sessaoVendedor, papel } = useAuth();
  const nome = papel === 'admin' ? perfil?.nome : sessaoVendedor?.vendedor.nome;

  return (
    <div className="p-8 w-full">
      <h1 className="text-2xl font-extrabold text-ink tracking-tight">Olá, {nome?.split(' ')[0]} 👋</h1>
      <p className="text-sm text-ink-soft mt-1 mb-8">
        Aqui está o resumo da <b>{empresa?.nome}</b>.
      </p>

      <div className="bg-gradient-to-br from-teal-500 to-blue-600 rounded-2xl p-6 text-white max-w-2xl">
        <div className="text-sm font-bold uppercase tracking-wide opacity-80 mb-1">Bem-vinda ao Fluxa CRM</div>
        <h2 className="text-lg font-extrabold mb-2">Funil de vendas, clientes e equipe num só lugar</h2>
        <p className="text-sm opacity-90">
          Use o menu acima pra organizar seu funil de vendas no CRM, cadastrar clientes e vendedores, e acompanhar
          metas e comissões. Um resumo com números da empresa chega aqui em breve.
        </p>
      </div>
    </div>
  );
}
