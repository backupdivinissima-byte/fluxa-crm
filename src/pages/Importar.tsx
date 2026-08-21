import { useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { gerarPlanilhaModelo, importarPlanilha, type ResultadoImportacaoPlanilha } from '../lib/importarPlanilha';
import { gerarChaveApi, revogarChaveApi } from '../lib/apiKey';
import {
  CAMPOS_MAPEAVEIS,
  MAPEAMENTO_PADRAO,
  salvarConexaoErp,
  sincronizarComErp,
  type ErpConexao,
  type ResultadoSincronizacaoErp,
} from '../lib/erpConexao';
import { IconImportar } from '../components/NavIcons';

// URL fixa da API (região e nome de função previsíveis — ver functions/index.js).
const API_BASE_URL = 'https://us-central1-fluxa-crm.cloudfunctions.net/api';

/** Importar / Sincronização — disponível pra qualquer empresa (todo login
 * administrador), com três formas de trazer dados pro Fluxa CRM: planilha
 * Excel/CSV (manual), API (integração automática com o sistema atual do
 * cliente) e explicação de como usar a mesma planilha pra exportar de um
 * banco de dados. */
export default function Importar() {
  const { empresa, papel, usuario } = useAuth();
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

  // Conectar seu ERP (Fluxa puxando dados de fora) — inicializa com o que
  // já estiver salvo na empresa, se houver.
  const conexaoSalva = empresa?.erpConexao;
  const [erpUrl, setErpUrl] = useState(conexaoSalva?.url ?? '');
  const [erpAutenticacao, setErpAutenticacao] = useState<ErpConexao['autenticacao']>(conexaoSalva?.autenticacao ?? 'nenhuma');
  const [erpHeaderNome, setErpHeaderNome] = useState(conexaoSalva?.headerNome ?? '');
  const [erpValorAuth, setErpValorAuth] = useState('');
  const [erpUsuarioBasic, setErpUsuarioBasic] = useState(conexaoSalva?.usuarioBasic ?? '');
  const [erpListaPath, setErpListaPath] = useState(conexaoSalva?.listaPath ?? '');
  const [erpMapeamento, setErpMapeamento] = useState<Record<string, string>>(conexaoSalva?.mapeamento ?? MAPEAMENTO_PADRAO);
  const [salvandoErp, setSalvandoErp] = useState(false);
  const [erroErp, setErroErp] = useState('');
  const [testandoErp, setTestandoErp] = useState(false);
  const [resultadoTesteErp, setResultadoTesteErp] = useState<ResultadoSincronizacaoErp | null>(null);
  const [sincronizandoErp, setSincronizandoErp] = useState(false);
  const [resultadoSyncErp, setResultadoSyncErp] = useState<ResultadoSincronizacaoErp | null>(null);

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

  function montarConfigErp(): ErpConexao {
    return {
      url: erpUrl.trim(),
      autenticacao: erpAutenticacao,
      headerNome: erpAutenticacao === 'header' ? erpHeaderNome.trim() : undefined,
      valorAuth: erpValorAuth.trim() || undefined,
      usuarioBasic: erpAutenticacao === 'basic' ? erpUsuarioBasic.trim() : undefined,
      listaPath: erpListaPath.trim() || undefined,
      mapeamento: erpMapeamento,
      configuradoEm: conexaoSalva?.configuradoEm,
      ultimaSincronizacao: conexaoSalva?.ultimaSincronizacao,
    };
  }

  async function salvarErp() {
    setSalvandoErp(true);
    setErroErp('');
    try {
      await salvarConexaoErp(empresaId, montarConfigErp(), {
        valorAuth: conexaoSalva?.valorAuth,
        usuarioBasic: conexaoSalva?.usuarioBasic,
      });
      setErpValorAuth('');
    } catch (e) {
      setErroErp(e instanceof Error ? e.message : 'Erro ao salvar a configuração.');
      throw e;
    } finally {
      setSalvandoErp(false);
    }
  }

  async function handleTestarErp() {
    if (!usuario) return;
    setTestandoErp(true);
    setErroErp('');
    setResultadoTesteErp(null);
    setResultadoSyncErp(null);
    try {
      await salvarErp();
      const idToken = await usuario.getIdToken();
      const r = await sincronizarComErp(idToken, true);
      setResultadoTesteErp(r);
    } catch (e) {
      setErroErp(e instanceof Error ? e.message : 'Erro ao testar a conexão com o ERP.');
    } finally {
      setTestandoErp(false);
    }
  }

  async function handleSincronizarErp() {
    if (!usuario) return;
    const ok = window.confirm('Buscar os dados no seu ERP agora e importar pro Fluxa CRM?');
    if (!ok) return;
    setSincronizandoErp(true);
    setErroErp('');
    setResultadoTesteErp(null);
    setResultadoSyncErp(null);
    try {
      await salvarErp();
      const idToken = await usuario.getIdToken();
      const r = await sincronizarComErp(idToken, false);
      setResultadoSyncErp(r);
    } catch (e) {
      setErroErp(e instanceof Error ? e.message : 'Erro ao sincronizar com o ERP.');
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
          Caminho inverso do card acima: aqui é o Fluxa CRM que busca os dados direto na API do seu sistema atual
          (ERP, e-commerce etc.), em vez de você precisar programar o envio. Informe a URL, a autenticação e o
          mapeamento de campos uma vez — depois é só clicar em "Sincronizar agora" sempre que quiser trazer os dados
          mais recentes (é seguro repetir, os dados não duplicam).
        </p>

        {conexaoSalva?.ultimaSincronizacao && (
          <div className="flex items-center gap-2 text-sm text-ink-soft mb-4">
            <span className="inline-block w-2 h-2 rounded-full bg-teal-500" />
            Última sincronização: {new Date(conexaoSalva.ultimaSincronizacao).toLocaleString('pt-BR')}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
              URL da API do seu ERP
            </label>
            <input
              value={erpUrl}
              onChange={(e) => setErpUrl(e.target.value)}
              placeholder="https://meuerp.com.br/api/clientes"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
              Autenticação
            </label>
            <select
              value={erpAutenticacao}
              onChange={(e) => setErpAutenticacao(e.target.value as ErpConexao['autenticacao'])}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm bg-white"
            >
              <option value="nenhuma">Nenhuma (API pública)</option>
              <option value="bearer">Bearer Token</option>
              <option value="header">Cabeçalho personalizado (ex.: X-Api-Key)</option>
              <option value="basic">Usuário e senha (Basic Auth)</option>
            </select>
          </div>

          {erpAutenticacao === 'header' && (
            <div>
              <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
                Nome do cabeçalho
              </label>
              <input
                value={erpHeaderNome}
                onChange={(e) => setErpHeaderNome(e.target.value)}
                placeholder="X-Api-Key"
                className="w-full rounded-lg border border-line px-3 py-2 text-sm"
              />
            </div>
          )}

          {erpAutenticacao === 'basic' && (
            <div>
              <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">Usuário</label>
              <input
                value={erpUsuarioBasic}
                onChange={(e) => setErpUsuarioBasic(e.target.value)}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm"
              />
            </div>
          )}

          {erpAutenticacao !== 'nenhuma' && (
            <div>
              <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
                {erpAutenticacao === 'basic' ? 'Senha' : 'Token/Chave'}
              </label>
              <input
                type="password"
                value={erpValorAuth}
                onChange={(e) => setErpValorAuth(e.target.value)}
                placeholder={conexaoSalva?.valorAuth ? '•••• (salvo — deixe em branco pra manter)' : ''}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
              Caminho da lista na resposta (opcional)
            </label>
            <input
              value={erpListaPath}
              onChange={(e) => setErpListaPath(e.target.value)}
              placeholder="Deixe em branco se a resposta já for uma lista. Ex.: data.clientes"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm"
            />
          </div>

          <div className="border-t border-line pt-4">
            <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-2">
              Mapeamento de campos
            </label>
            <p className="text-xs text-ink-soft mb-3">
              Pra cada campo do Fluxa, informe o nome (ou caminho) do campo correspondente na resposta da API do seu
              ERP. "Código do cliente" é obrigatório — é o identificador que evita duplicar ao sincronizar de novo.
            </p>
            <div className="space-y-2">
              {CAMPOS_MAPEAVEIS.map(({ campo, label, obrigatorio }) => (
                <div key={campo} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 text-xs font-bold text-ink">
                    {label}
                    {obrigatorio && <span className="text-red-500">*</span>}
                  </span>
                  <input
                    value={erpMapeamento[campo] ?? ''}
                    onChange={(e) => setErpMapeamento((atual) => ({ ...atual, [campo]: e.target.value }))}
                    placeholder="caminho no JSON (ex.: nome ou dados.nome)"
                    className="flex-1 rounded-lg border border-line px-2.5 py-1.5 text-sm"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-5">
          <button
            type="button"
            onClick={handleTestarErp}
            disabled={!erpUrl.trim() || !erpMapeamento.cod?.trim() || testandoErp || sincronizandoErp || salvandoErp}
            className="rounded-xl border border-line text-ink text-sm font-bold px-4 py-2.5 hover:bg-surface disabled:opacity-60"
          >
            {testandoErp ? 'Testando...' : 'Testar conexão'}
          </button>
          <button
            type="button"
            onClick={handleSincronizarErp}
            disabled={!erpUrl.trim() || !erpMapeamento.cod?.trim() || sincronizandoErp || testandoErp || salvandoErp}
            className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-4 py-2.5 hover:opacity-90 disabled:opacity-60"
          >
            {sincronizandoErp ? 'Sincronizando...' : 'Sincronizar agora'}
          </button>
        </div>
        {!erpMapeamento.cod?.trim() && (
          <p className="text-xs text-ink-soft mt-2">
            Preencha ao menos o mapeamento de "Código do cliente" pra habilitar os botões acima.
          </p>
        )}
        {erroErp && <p className="text-xs text-red-500 mt-3">{erroErp}</p>}

        {resultadoTesteErp && (
          <div className="mt-4 bg-teal-500/10 rounded-xl p-4 text-sm">
            <p className="font-bold text-ink mb-1">
              Teste ok — {resultadoTesteErp.totalRecebido} item(ns) recebido(s) do ERP.
            </p>
            {resultadoTesteErp.amostra && resultadoTesteErp.amostra.length > 0 && (
              <pre className="text-[11px] bg-ink text-white rounded-xl p-3 mt-2 overflow-x-auto">
                {JSON.stringify(resultadoTesteErp.amostra, null, 2)}
              </pre>
            )}
            <p className="text-ink-soft mt-2">Confira se os campos acima bateram certo antes de clicar em "Sincronizar agora".</p>
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
              <p className="text-ink-soft">{resultadoSyncErp.clientesIgnorados} item(ns) ignorado(s)</p>
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
          .csv no campo "Planilha preenchida" — funciona igual à planilha.
        </p>
      </div>
    </div>
  );
}
