import { useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { gerarPlanilhaModelo, importarPlanilha, type ResultadoImportacaoPlanilha } from '../lib/importarPlanilha';
import { IconImportar } from '../components/NavIcons';

/** Importar / Sincronização — disponível pra qualquer empresa (todo login
 * administrador), com três formas de trazer dados pro Fluxa CRM. Hoje só a
 * planilha Excel está pronta; API e banco de dados ficam com o texto "Em
 * breve" até virarem recursos reais (cada uma precisa de definição própria
 * de credenciais/endpoint antes de dar pra construir). */
export default function Importar() {
  const { empresa, papel } = useAuth();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [rodando, setRodando] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacaoPlanilha | null>(null);
  const [erro, setErro] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  if (papel !== 'admin' || !empresa) {
    return (
      <div className="p-6 w-full">
        <p className="text-sm text-ink-soft">Somente administradores podem importar dados.</p>
      </div>
    );
  }

  const empresaId = empresa.id;

  async function baixarModelo() {
    setBaixando(true);
    try {
      const blob = await gerarPlanilhaModelo();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'modelo-importacao-fluxa-crm.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBaixando(false);
    }
  }

  async function rodarImportacao() {
    if (!arquivo) return;
    setRodando(true);
    setErro('');
    setResultado(null);
    try {
      const r = await importarPlanilha(empresaId, arquivo);
      setResultado(r);
      setArquivo(null);
      if (inputRef.current) inputRef.current.value = '';
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro desconhecido ao importar a planilha.');
    } finally {
      setRodando(false);
    }
  }

  return (
    <div className="p-6 w-full max-w-2xl">
      <h1 className="text-base font-extrabold text-ink flex items-center gap-2 mb-1">
        <IconImportar /> Importar / Sincronização
      </h1>
      <p className="text-sm text-ink-soft mb-6">
        Traga seus clientes e vendedores pro Fluxa CRM. É seguro importar a mesma planilha mais de uma vez — os dados
        não duplicam, só atualizam.
      </p>

      <div className="bg-white border border-line rounded-2xl p-6 mb-4">
        <h2 className="text-sm font-extrabold text-ink mb-1">Planilha Excel</h2>
        <p className="text-sm text-ink-soft mb-5">
          Baixe o modelo, preencha com seus dados e envie de volta aqui. O modelo já vem com as colunas certas
          (formatadas como texto, pra não perder zero à esquerda em código/telefone/CNPJ) e uma aba de instruções.
          Também aceita .csv com esses mesmos nomes de coluna.
        </p>

        <div className="flex flex-wrap items-center gap-3 mb-5">
          <button
            onClick={baixarModelo}
            disabled={baixando}
            className="rounded-xl border border-line text-ink text-sm font-bold px-4 py-2.5 hover:bg-surface disabled:opacity-60"
          >
            {baixando ? 'Preparando...' : 'Baixar planilha modelo'}
          </button>
        </div>

        <div className="border-t border-line pt-5">
          <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-2">
            Planilha preenchida
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              className="text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-surface file:px-3 file:py-2 file:text-sm file:font-bold file:text-ink hover:file:bg-line/50"
            />
            <button
              onClick={rodarImportacao}
              disabled={!arquivo || rodando}
              className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-5 py-2.5 hover:opacity-90 disabled:opacity-60"
            >
              {rodando ? 'Importando...' : 'Importar planilha'}
            </button>
          </div>
          {!arquivo && (
            <p className="text-xs text-ink-soft mt-2">
              O botão "Importar planilha" só liga depois que você escolhe um arquivo em "Escolher arquivo" acima.
            </p>
          )}
        </div>

        {erro && <p className="text-xs text-red-500 mt-4">{erro}</p>}

        {resultado && (
          <div className="mt-5 bg-teal-500/10 rounded-xl p-4 text-sm">
            <p className="font-bold text-ink mb-1">Importação concluída!</p>
            <p className="text-ink-soft">{resultado.clientesImportados} cliente(s) importado(s)</p>
            {resultado.clientesIgnorados > 0 && (
              <p className="text-ink-soft">{resultado.clientesIgnorados} linha(s) de cliente ignorada(s)</p>
            )}
            <p className="text-ink-soft">{resultado.vendedoresImportados} vendedor(es) importado(s)</p>
            {resultado.vendedoresIgnorados > 0 && (
              <p className="text-ink-soft">{resultado.vendedoresIgnorados} linha(s) de vendedor ignorada(s)</p>
            )}
            {resultado.erros.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-amber-700">
                {resultado.erros.map((e, i) => (
                  <li key={i}>• {e}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="bg-white border border-line rounded-2xl p-6 opacity-70">
          <span className="inline-block text-xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-full bg-slate-100 text-ink-soft mb-3">
            Em breve
          </span>
          <h2 className="text-sm font-extrabold text-ink mb-1">Importar via API</h2>
          <p className="text-sm text-ink-soft">
            Conecte o Fluxa CRM diretamente ao seu sistema atual e mantenha os dados sincronizados automaticamente.
          </p>
        </div>
        <div className="bg-white border border-line rounded-2xl p-6">
          <span className="inline-block text-xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-full bg-teal-500/10 text-teal-700 mb-3">
            Já dá pra usar
          </span>
          <h2 className="text-sm font-extrabold text-ink mb-1">Importar via banco de dados</h2>
          <p className="text-sm text-ink-soft">
            Exporte a tabela de clientes ou vendedores do seu banco de dados atual em <strong>.csv</strong>, usando os
            mesmos nomes de coluna do modelo Excel acima (ex.: "Código*", "Nome", "Login*"). Depois é só enviar esse
            .csv no campo "Planilha preenchida" — funciona igual à planilha.
          </p>
        </div>
      </div>
    </div>
  );
}
