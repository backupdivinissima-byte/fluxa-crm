import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ouvirClientes, ouvirEmpresa, ouvirVendedores } from '../lib/crmData';
import { CRM_COLUNAS_PADRAO, type Cliente, type ColunaCrm, type Vendedor } from '../types';
import { formatarMoeda, vendasMesVendedor } from '../lib/crmLogic';
import { IconLinks } from '../components/NavIcons';

/** Link direto de cada vendedor: abre já na tela de login, com o login
 * pré-preenchido e a empresa certa identificada por ?empresa=ID — assim o
 * vendedor só digita a senha, e a consulta ao Firestore vai direto na
 * empresa certa (sem varrer todas as empresas cadastradas). */
export default function Links() {
  const { empresa, papel } = useAuth();
  const empresaId = empresa?.id;
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [colunas, setColunas] = useState<ColunaCrm[]>(empresa?.crmColunas ?? CRM_COLUNAS_PADRAO);
  const [copiado, setCopiado] = useState<string | null>(null);

  useEffect(() => {
    if (!empresaId) return;
    const unsubV = ouvirVendedores(empresaId, setVendedores);
    const unsubC = ouvirClientes(empresaId, setClientes);
    const unsubE = ouvirEmpresa(empresaId, (emp) => {
      setColunas(emp?.crmColunas && emp.crmColunas.length > 0 ? emp.crmColunas : CRM_COLUNAS_PADRAO);
    });
    return () => {
      unsubV();
      unsubC();
      unsubE();
    };
  }, [empresaId]);

  const colunasFechamentoIds = useMemo(() => colunas.filter((c) => c.fechamento).map((c) => c.id), [colunas]);

  if (!empresaId || papel !== 'admin') {
    return (
      <div className="p-6 w-full">
        <p className="text-sm text-ink-soft">Somente administradores podem ver os links dos vendedores.</p>
      </div>
    );
  }

  function linkDe(v: Vendedor) {
    const base = `${window.location.origin}${window.location.pathname}`;
    return `${base}#/login?empresa=${empresaId}&login=${encodeURIComponent(v.login)}`;
  }

  function copiar(v: Vendedor) {
    navigator.clipboard.writeText(linkDe(v)).then(() => {
      setCopiado(v.id);
      setTimeout(() => setCopiado(null), 2000);
    });
  }

  function compartilharWhatsapp(v: Vendedor) {
    const texto = `Olá ${v.nome}! Aqui está seu link de acesso ao Fluxa CRM: ${linkDe(v)}\n\nBasta abrir o link e digitar sua senha.`;
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank');
  }

  return (
    <div className="p-6 w-full">
      <h1 className="text-base font-extrabold text-ink flex items-center gap-2 mb-1">
        <IconLinks /> Links dos vendedores
      </h1>
      <p className="text-sm text-ink-soft mb-4">
        Cada vendedor tem um link próprio de acesso — ele só precisa digitar a senha ao abrir.
      </p>

      <div className="space-y-3">
        {vendedores.map((v) => (
          <div key={v.id} className="bg-white border border-line rounded-2xl p-4 flex items-center gap-4 flex-wrap">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-500 to-blue-600 text-white font-extrabold flex items-center justify-center shrink-0">
              {v.nome.slice(0, 1).toUpperCase()}
            </div>
            <div className="flex-1 min-w-[160px]">
              <div className="font-bold text-ink">{v.nome}</div>
              <div className="text-xs text-ink-soft">login: {v.login}</div>
            </div>
            <div className="text-xs text-ink-soft text-right">
              <div>Vendas no mês: {formatarMoeda(vendasMesVendedor(clientes, v.login, colunasFechamentoIds))}</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => copiar(v)}
                className="rounded-lg border border-line text-ink text-xs font-bold px-3 py-2 hover:bg-surface"
              >
                {copiado === v.id ? 'Copiado!' : 'Copiar link'}
              </button>
              <button
                onClick={() => compartilharWhatsapp(v)}
                className="rounded-lg bg-gradient-to-br from-teal-500 to-blue-600 text-white text-xs font-bold px-3 py-2 hover:opacity-90"
              >
                Enviar por WhatsApp
              </button>
            </div>
          </div>
        ))}
        {vendedores.length === 0 && (
          <div className="bg-white border border-line rounded-2xl p-10 text-center text-ink-soft text-sm">
            Cadastre vendedores na aba "Vendedores" pra gerar os links de acesso.
          </div>
        )}
      </div>
    </div>
  );
}
