import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { importarDadosDivinissima, type ResultadoImportacao } from '../lib/importarDivinissima';
import { IconImportar } from '../components/NavIcons';

/** Ferramenta de importação — traz os clientes e vendedores reais da
 * Divinissima (mesmo projeto Firebase, coleções legadas) pra dentro da
 * empresa atual no Fluxa CRM. Pensada pra ser usada uma vez, logo depois do
 * cadastro da empresa "Divinissima" (a primeira empresa do Fluxa CRM), mas
 * pode ser rodada de novo com segurança pra ressincronizar (não duplica). */
export default function Importar() {
  const { empresa, papel } = useAuth();
  const [rodando, setRodando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null);
  const [erro, setErro] = useState('');

  if (papel !== 'admin' || !empresa) {
    return (
      <div className="p-6 w-full">
        <p className="text-sm text-ink-soft">Somente administradores podem importar dados.</p>
      </div>
    );
  }

  const empresaId = empresa.id;

  async function rodarImportacao() {
    if (
      !confirm(
        'Importar todos os clientes e vendedores da Divinissima para esta empresa? Isso pode levar alguns minutos e é seguro rodar mais de uma vez (não duplica registros).'
      )
    ) {
      return;
    }
    setRodando(true);
    setErro('');
    setResultado(null);
    try {
      const r = await importarDadosDivinissima(empresaId);
      setResultado(r);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro desconhecido ao importar.');
    } finally {
      setRodando(false);
    }
  }

  return (
    <div className="p-6 w-full max-w-xl">
      <h1 className="text-base font-extrabold text-ink flex items-center gap-2 mb-1">
        <IconImportar /> Importar / Sincronização
      </h1>
      <p className="text-sm text-ink-soft mb-6">
        Traz os clientes e vendedores já cadastrados na Divinissima para dentro desta empresa no Fluxa CRM. Os dados
        de origem continuam intactos — nada é alterado ou removido do sistema atual da Divinissima.
      </p>

      <div className="bg-white border border-line rounded-2xl p-6">
        <button
          onClick={rodarImportacao}
          disabled={rodando}
          className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-5 py-3 hover:opacity-90 disabled:opacity-60"
        >
          {rodando ? 'Importando...' : 'Importar dados da Divinissima'}
        </button>

        {erro && <p className="text-xs text-red-500 mt-4">{erro}</p>}

        {resultado && (
          <div className="mt-5 bg-teal-500/10 rounded-xl p-4 text-sm">
            <p className="font-bold text-ink mb-1">Importação concluída!</p>
            <p className="text-ink-soft">{resultado.clientesImportados} cliente(s) importado(s)</p>
            {resultado.clientesIgnorados > 0 && (
              <p className="text-ink-soft">{resultado.clientesIgnorados} ignorado(s) (excluído ou sem código)</p>
            )}
            <p className="text-ink-soft">{resultado.vendedoresImportados} vendedor(es) importado(s)</p>
          </div>
        )}
      </div>
    </div>
  );
}
