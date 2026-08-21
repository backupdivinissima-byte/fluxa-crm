import { useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  gerarPlanilhaModelo,
  importarPlanilha,
  lerPlanilha,
  type LeituraPlanilha,
  type ResultadoImportacaoPlanilha,
} from '../lib/importarPlanilha';
import { gerarChaveApi, revogarChaveApi } from '../lib/apiKey';
import { IconImportar } from '../components/NavIcons';

// URL fixa da API (região e nome de função previsíveis — ver functions/index.js).
const API_BASE_URL = 'https://us-central1-fluxa-crm.cloudfunctions.net/api';

/** Importar / Sincronização — disponível pra qualquer empresa (todo login
 * administrador), com três formas de trazer dados pro Fluxa CRM: planilha
 * Excel/CSV (manual), API (integração automática com o sistema atual do
 * cliente) e explicação de como usar a mesma planilha pra exportar de um
 * banco de dados. */
export default function Importar() {
  const { empresa, papel } = useAuth();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [rodando, setRodando] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacaoPlanilha | null>(null);
  const [erro, setErro] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const [chaveGerada, setChaveGerada] = useState<string | null>(null);
  const [gerandoChave, setGerandoChave] = useState(false);
  const [revogando, setRevogando] = useState(false);
  const [erroChave, setErroChave] = useState('');
  const [copiado, setCopiado] = useState(false);

  // Conecte seu ERP — anexa um documento com todos os dados (mesmo pipeline
  // de leitura do card "Importar arquivo" acima), com um passo de conferência
  // ("Testar conexão", só lê e mostra o que encontrou) antes de gravar de
  // verdade ("Sincronizar agora").
  const [arquivoErp, setArquivoErp] = useState<File | null>(null);
  const inputRefErp = useRef<HTMLInputElement>(null);
  const [erroErp, setErroErp] = useState('');
  const [testandoErp, setTestandoErp] = useState(false);
  const [resultadoTesteErp, setResultadoTesteErp] = useState<LeituraPlanilha | null>(null);
  const [sincronizandoErp, setSincronizandoErp] = useState(false);
  const [resultadoSyncErp, setResultadoSyncErp] = useState<ResultadoImportacaoPlanilha | null>(null);

  if (papel !== 'admin' || !empresa) {
    return (
      <div className="p-6 w-full">
        <p className="text-sm text-ink-soft">Somente administradores podem importar dados.</p>
      </div>
    );
  }

  const empresaId = empresa.id;
  const apiKeyHash = empresa.apiKeyHash;
  const apiKeyGeradaEm = empresa.apiKeyGeradaEm;

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

  async function handleGerarChave() {
    if (apiKeyHash) {
      const ok = window.confirm(
        'Gerar uma nova chave substitui a atual — qualquer sistema já conectado com a chave antiga para de funcionar. Continuar?'
      );
      if (!ok) return;
    }
    setGerandoChave(true);
    setErroChave('');
    setCopiado(false);
    try {
      const chave = await gerarChaveApi(empresaId);
      setChaveGerada(chave);
    } catch (e) {
      setErroChave(e instanceof Error ? e.message : 'Erro ao gerar a chave de API.');
    } finally {
      setGerandoChave(false);
    }
  }

  async function handleRevogarChave() {
    const ok = window.confirm('Revogar a chave de API atual? Nenhuma integração externa vai conseguir sincronizar dados até gerar uma nova.');
    if (!ok) return;
    setRevogando(true);
    setErroChave('');
    try {
      await revogarChaveApi(empresaId);
      setChaveGerada(null);
    } catch (e) {
      setErroChave(e instanceof Error ? e.message : 'Erro ao revogar a chave de API.');
    } finally {
      setRevogando(false);
    }
  }

  async function handleCopiarChave() {
    if (!chaveGerada) return;
    try {
      await navigator.clipboard.writeText(chaveGerada);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // clipboard indisponível (ex.: contexto não seguro) — a chave já está
      // visível na tela pra copiar manualmente, então só ignoramos aqui.
    }
  }

  async function handleTestarErp() {
    if (!arquivoErp) return;
    setTestandoErp(true);
    setErroErp('');
    setResultadoTesteErp(null);
    setResultadoSyncErp(null);
    try {
      const r = await lerPlanilha(arquivoErp);
      setResultadoTesteErp(r);
    } catch (e) {
      setErroErp(e instanceof Error ? e.message : 'Erro ao ler o documento.');
    } finally {
      setTestandoErp(false);
    }
  }

  async function handleSincronizarErp() {
    if (!arquivoErp) return;
    const ok = window.confirm('Importar os dados desse documento pro Fluxa CRM agora?');
    if (!ok) return;
    setSincronizandoErp(true);
    setErroErp('');
    setResultadoTesteErp(null);
    setResultadoSyncErp(null);
    try {
      const r = await importarPlanilha(empresaId, arquivoErp);
      setResultadoSyncErp(r);
    } catch (e) {
      setErroErp(e instanceof Error ? e.message : 'Erro ao sincronizar o documento.');
    } finally {
      setSincronizandoErp(false);
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
        <h2 className="text-sm font-extrabold text-ink mb-1">Importar arquivo</h2>
        <p className="text-sm text-ink-soft mb-5">
          Baixe o modelo, preencha com seus dados e envie de volta aqui. O modelo já vem com as colunas certas
          (formatadas como texto, pra não perder zero à esquerda em código/telefone/CNPJ) e uma aba de instruções.
          Além de .xlsx/.xls, também aceita <strong>.csv</strong>, <strong>.docx</strong> (Word) e <strong>.pdf</strong> —
          desde que o arquivo tenha uma tabela com os mesmos nomes de coluna do modelo (ou uma variação parecida, ex.:
          "CNPJ" no lugar de "CNPJ/CPF"). Excel/CSV é o formato mais confiável; em Word funciona bem se os dados
          estiverem numa tabela de verdade; em PDF é um "melhor esforço" que depende de como o arquivo foi gerado —
          não funciona com PDF escaneado (imagem), só com texto de verdade.
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
            Arquivo preenchido (Excel, CSV, Word ou PDF)
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv,.docx,.pdf"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              className="text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-surface file:px-3 file:py-2 file:text-sm file:font-bold file:text-ink hover:file:bg-line/50"
            />
            <button
              onClick={rodarImportacao}
              disabled={!arquivo || rodando}
              className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-5 py-2.5 hover:opacity-90 disabled:opacity-60"
            >
              {rodando ? 'Importando...' : 'Importar arquivo'}
            </button>
          </div>
          {!arquivo && (
            <p className="text-xs text-ink-soft mt-2">
              O botão "Importar arquivo" só liga depois que você escolhe um arquivo em "Escolher arquivo" acima.
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

      <div className="bg-white border border-line rounded-2xl p-6 mb-4">
        <span className="inline-block text-xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-full bg-teal-500/10 text-teal-700 mb-3">
          Importar via API
        </span>
        <h2 className="text-sm font-extrabold text-ink mb-1">Conecte seu sistema atual</h2>
        <p className="text-sm text-ink-soft mb-5">
          Gere uma chave de API e configure seu sistema (ERP, e-commerce, planilha automatizada, etc.) pra enviar
          clientes e vendedores direto pro Fluxa CRM. É seguro chamar quantas vezes quiser — os dados não duplicam,
          só atualizam (mesmo código/login).
        </p>

        {apiKeyHash && !chaveGerada && (
          <div className="flex items-center gap-2 text-sm text-ink-soft mb-4">
            <span className="inline-block w-2 h-2 rounded-full bg-teal-500" />
            Chave de API ativa
            {apiKeyGeradaEm && ` desde ${new Date(apiKeyGeradaEm).toLocaleDateString("pt-BR")}`}.
          </div>
        )}

        {chaveGerada && (
          <div className="bg-teal-500/10 rounded-xl p-4 mb-4">
            <p className="text-xs font-bold text-ink mb-2">
              Copie sua chave agora — por segurança, ela não vai aparecer de novo depois que você sair desta tela.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="text-xs bg-white border border-line rounded-lg px-3 py-2 break-all">{chaveGerada}</code>
              <button
                type="button"
                onClick={handleCopiarChave}
                className="rounded-lg border border-line text-ink text-xs font-bold px-3 py-2 hover:bg-white shrink-0"
              >
                {copiado ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 mb-5">
          <button
            type="button"
            onClick={handleGerarChave}
            disabled={gerandoChave}
            className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-4 py-2.5 hover:opacity-90 disabled:opacity-60"
          >
            {gerandoChave ? 'Gerando...' : apiKeyHash ? "Gerar nova chave" : "Gerar chave de API"}
          </button>
          {apiKeyHash && (
            <button
              type="button"
              onClick={handleRevogarChave}
              disabled={revogando}
              className="rounded-xl border border-line text-ink text-sm font-bold px-4 py-2.5 hover:bg-surface disabled:opacity-60"
            >
              {revogando ? 'Revogando...' : 'Revogar chave'}
            </button>
          )}
        </div>
        {erroChave && <p className="text-xs text-red-500 mb-4">{erroChave}</p>}

        <div className="border-t border-line pt-5">
          <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-2">Como integrar</label>
          <p className="text-xs text-ink-soft mb-3">
            Envie um POST com sua chave no cabeçalho <code className="bg-surface rounded px-1">X-Api-Key</code>:
          </p>
          <pre className="text-[11px] bg-ink text-white rounded-xl p-4 overflow-x-auto">
            {`curl -X POST ${API_BASE_URL}/v1/sincronizar \\
  -H "Content-Type: application/json" \\
  -H "X-Api-Key: ${chaveGerada ?? 'SUA_CHAVE_AQUI'}" \\
  -d '{
    "clientes": [{ "cod": "C001", "nome": "Maria Silva", "telefone": "11999998888" }],
    "vendedores": [{ "nome": "Cecília Souza", "login": "cecilia" }]
  }'`}
          </pre>
          <p className="text-xs text-ink-soft mt-3">
            "cod" (cliente) e "login" (vendedor) são os identificadores únicos — reenviar o mesmo valor atualiza em
            vez de duplicar, mesmos campos aceitos da planilha (veja o modelo acima). Teste a chave a qualquer
            momento com <code className="bg-surface rounded px-1">GET {API_BASE_URL}/v1/status</code>.
          </p>
        </div>
      </div>

      <div className="bg-white border border-line rounded-2xl p-6 mb-4">
        <span className="inline-block text-xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-full bg-teal-500/10 text-teal-700 mb-3">
          Importar via API
        </span>
        <h2 className="text-sm font-extrabold text-ink mb-1">Conecte seu ERP</h2>
        <p className="text-sm text-ink-soft mb-5">
          Anexe um documento (Excel, CSV, Word ou PDF) com todos os dados de clientes/vendedores exportados do seu
          ERP ou sistema atual. Clique em "Testar conexão" pra conferir o que foi encontrado no arquivo antes de
          confirmar, e em "Sincronizar agora" pra trazer os dados pro Fluxa CRM de verdade — é seguro repetir, os
          dados não duplicam, só atualizam.
        </p>

        <div className="border-t border-line pt-5">
          <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-2">
            Arquivo preenchido (Excel, CSV, Word ou PDF)
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={inputRefErp}
              type="file"
              accept=".xlsx,.xls,.csv,.docx,.pdf"
              onChange={(e) => {
                setArquivoErp(e.target.files?.[0] ?? null);
                setResultadoTesteErp(null);
                setResultadoSyncErp(null);
                setErroErp('');
              }}
              className="text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-surface file:px-3 file:py-2 file:text-sm file:font-bold file:text-ink hover:file:bg-line/50"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-5">
          <button
            type="button"
            onClick={handleTestarErp}
            disabled={!arquivoErp || testandoErp || sincronizandoErp}
            className="rounded-xl border border-line text-ink text-sm font-bold px-4 py-2.5 hover:bg-surface disabled:opacity-60"
          >
            {testandoErp ? 'Testando...' : 'Testar conexão'}
          </button>
          <button
            type="button"
            onClick={handleSincronizarErp}
            disabled={!arquivoErp || sincronizandoErp || testandoErp}
            className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-4 py-2.5 hover:opacity-90 disabled:opacity-60"
          >
            {sincronizandoErp ? 'Sincronizando...' : 'Sincronizar agora'}
          </button>
        </div>
        {!arquivoErp && (
          <p className="text-xs text-ink-soft mt-2">
            Escolha um documento acima pra habilitar os botões.
          </p>
        )}
        {erroErp && <p className="text-xs text-red-500 mt-3">{erroErp}</p>}

        {resultadoTesteErp && (
          <div className="mt-4 bg-teal-500/10 rounded-xl p-4 text-sm">
            <p className="font-bold text-ink mb-1">
              Teste ok — {resultadoTesteErp.clientes.length} cliente(s) e {resultadoTesteErp.vendedores.length}{' '}
              vendedor(es) encontrado(s) no documento.
            </p>
            {resultadoTesteErp.clientes.length > 0 && (
              <pre className="text-[11px] bg-ink text-white rounded-xl p-3 mt-2 overflow-x-auto">
                {JSON.stringify(resultadoTesteErp.clientes.slice(0, 5), null, 2)}
              </pre>
            )}
            <p className="text-ink-soft mt-2">Confira se os dados bateram certo antes de clicar em "Sincronizar agora".</p>
            {resultadoTesteErp.erros.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-amber-700">
                {resultadoTesteErp.erros.slice(0, 10).map((e, i) => (
                  <li key={i}>• {e}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {resultadoSyncErp && (
          <div className="mt-4 bg-teal-500/10 rounded-xl p-4 text-sm">
            <p className="font-bold text-ink mb-1">Sincronização concluída!</p>
            <p className="text-ink-soft">{resultadoSyncErp.clientesImportados} cliente(s) importado(s)</p>
            {resultadoSyncErp.clientesIgnorados > 0 && (
              <p className="text-ink-soft">{resultadoSyncErp.clientesIgnorados} linha(s) de cliente ignorada(s)</p>
            )}
            <p className="text-ink-soft">{resultadoSyncErp.vendedoresImportados} vendedor(es) importado(s)</p>
            {resultadoSyncErp.vendedoresIgnorados > 0 && (
              <p className="text-ink-soft">{resultadoSyncErp.vendedoresIgnorados} linha(s) de vendedor ignorada(s)</p>
            )}
            {resultadoSyncErp.erros.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-amber-700">
                {resultadoSyncErp.erros.slice(0, 10).map((e, i) => (
                  <li key={i}>• {e}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="bg-white border border-line rounded-2xl p-6">
        <span className="inline-block text-xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-full bg-teal-500/10 text-teal-700 mb-3">
          Já dá pra usar
        </span>
        <h2 className="text-sm font-extrabold text-ink mb-1">Importar via banco de dados</h2>
        <p className="text-sm text-ink-soft">
          Exporte a tabela de clientes ou vendedores do seu banco de dados atual em <strong>.csv</strong>, usando os
          mesmos nomes de coluna do modelo Excel acima (ex.: "Código*", "Nome", "Login*"). Depois é só enviar esse
          .csv no campo "Arquivo preenchido" acima — funciona igual à planilha.
        </p>
      </div>
    </div>
  );
}
