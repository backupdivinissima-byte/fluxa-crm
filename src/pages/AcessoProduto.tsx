import { Link, Navigate, useSearchParams } from 'react-router-dom';
import AuthShell from '../components/AuthShell';

const PRODUTOS: Record<string, { nome: string; desc: string }> = {
  crm: { nome: 'Fluxa CRM', desc: 'Organize o funil de vendas: clientes, vendedores, metas e comissões.' },
  chat: { nome: 'Fluxa Chat', desc: 'Atendimento de WhatsApp, Instagram Direct e Messenger em um só lugar.' },
  erp: { nome: 'Fluxa ERP', desc: 'Produtos, estoque, pedidos, trocas, consignação e financeiro.' },
  marketing: { nome: 'Fluxa Marketing', desc: 'Anúncios do Meta, calendário de lives e ROI/CAC cruzados com o funil.' },
  prospect: { nome: 'Fluxa Prospect', desc: 'Encontre e qualifique novos clientes em potencial para o seu funil.' },
};

/** Porta de entrada de cada produto (menu "Produtos" do site): já tem conta → Entrar; não tem → Cadastrar. */
export default function AcessoProduto() {
  const [params] = useSearchParams();
  const id = params.get('plataforma') ?? '';
  const p = PRODUTOS[id];
  if (!p) return <Navigate to="/login" replace />;
  return (
    <AuthShell titulo={p.nome} subtitulo={p.desc} rodape={<Link to="/" className="font-bold text-blue-600">← Voltar ao site</Link>}>
      <div className="bg-white border border-line rounded-2xl p-6 space-y-3">
        <Link
          to={`/login?plataforma=${id}`}
          className="block w-full text-center rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold py-3 hover:opacity-90"
        >
          Já tenho conta — Entrar
        </Link>
        <Link
          to={`/cadastrar?plataforma=${id}`}
          className="block w-full text-center rounded-xl border border-line text-ink text-sm font-bold py-3 hover:bg-surface"
        >
          Ainda não tenho — Cadastrar e testar grátis
        </Link>
        <p className="text-xs text-ink-soft text-center pt-1">Já tem conta no Fluxa? Entre com o mesmo e-mail: o {p.nome} é adicionado à sua empresa.</p>
      </div>
    </AuthShell>
  );
}
