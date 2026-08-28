import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { ouvirCampanhasMeta, importarCampanhasMeta, salvarMetaAdsConexao } from '../../lib/marketingData';
import { lerCampanhasMetaDoArquivo } from '../../lib/importarMarketing';
import { formatarMoeda } from '../../lib/crmLogic';
import type { CampanhaMeta } from '../../types';

const API_BASE_URL = 'https://us-central1-fluxa-crm.cloudfunctions.net/api';

function mesAtualISO() {
  return new Date().toISOString().slice(0, 7);
}

function rotuloMes(mesRef: string) {
  const [ano, mes] = mesRef.split('-').map(Number);
  return new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

const ROTULO_STATUS: Record<CampanhaMeta['status'], { texto: string; cor: string }> = {
  ativa: { texto: 'Ativa', cor: 'text-teal-700 bg-teal-500/10' },
  pausada: { texto: 'Pausada', cor: 'text-amber-700 bg-amber-500/10' },
  removida: { texto: 'Removida', cor: 'text-red-700 bg-red-500/10' },
  em_revisao: { texto: 'Em revisão', cor: 'text-blue-700 bg-blue-500/10' },
};

/** Aba "Meta" do módulo Marketing: tabela das campanhas do Gerenciador de
 * Anúncios do mês, importadas por planilha (funciona hoje) ou — quando a
 * conta do Meta Ads estiver conectada — sincronizadas automaticamente
 * (Fase 2, botão abaixo fica pronto mas depende do backend implantado). */
export default function MetaAds() {
  const { empresa, papel, usuario } = useAuth();
  const empresaId = empresa?.id;

  const [campanhas, setCampanhas] = useState<CampanhaMeta[]>([]);
  const [mesRef, setMesRef] = useState(mesAtualISO());

  const [arquivo, setArquivo] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [importando, setImportando] = useState(false);
  const [resultadoImport, setResultadoImport] = useState<{ total: number; ignoradas: number; mes: string } | null>(null);
  const [erroImport, setErroImport] = useState('');

  const conexaoSalva = empresa?.metaAdsConexao;
  const [contaAnuncioId, setContaAnuncioId] = useState(conexaoSalva?.contaAnuncioId ?? '');
  const [token, setToken] = useState('');
  const [salvandoConexao, setSalvandoConexao] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [erroConexao, setErroConexao] = useState('');
  const [avisoSync, setAvisoSync] = useState('');

  useEffect(() => {
    if (!empresaId) return;
    return ouvirCampanhasMeta(empresaId, setCampanhas);
  }, [empresaId]);

  const campanhasDoMes = useMemo(() => campanhas.filter((c) => (c.atualizadoEm ?? '').slice(0, 7) === mesRef), [campanhas, mesRef]);

  const totais = useMemo(
    () => ({
      valorGasto: campanhasDoMes.reduce((s, c) => s + (c.valorGasto ?? 0), 0),
      alcance: campanhasDoMes.reduce((s, c) => s + (c.alcance ?? 0), 0),
      impressoes: campanhasDoMes.reduce((s, c) => s + (c.impressoes ?? 0), 0),
      resultado: campanhasDoMes.reduce((s, c) => s + (c.resultado ?? 0), 0),
    }),
    [campanhasDoMes]
  );

  if (papel !== 'admin' || !empresaId) {
    return (
      <div className="p-6 w-full">
        <p className="text-sm text-ink-soft">Somente administradores acessam essa tela.</p>
      </div>
    );
  }

  async function rodarImportacao() {
    if (!arquivo || !empresaId) return;
    setImportando(true);
    setErroImport('');
    setResultadoImport(null);
    try {
      const { campanhas: lidas, mesReferencia, ignoradas } = await lerCampanhasMetaDoArquivo(arquivo);
      if (lidas.length === 0) {
        setErroImport(
          'Não encontrei nenhuma campanha nesse arquivo. Confira se ele tem colunas como "Nome da campanha" e "Valor usado" (exportação padrão do Gerenciador de Anúncios).'
        );
        return;
      }
      const total = await importarCampanhasMeta(empresaId, lidas, mesReferencia);
      setResultadoImport({ total, ignoradas, mes: mesReferencia });
      setMesRef(mesReferencia);
      setArquivo(null);
      if (inputRef.current) inputRef.current.value = '';
    } catch (e) {
      setErroImport(e instanceof Error ? e.message : 'Erro ao ler o arquivo.');
    } finally {
      setImportando(false);
    }
  }

  async function salvarConexao() {
    if (!empresaId || !contaAnuncioId.trim()) return;
    setSalvandoConexao(true);
    setErroConexao('');
    try {
      await salvarMetaAdsConexao(empresaId, {
        contaAnuncioId: contaAnuncioId.trim(),
        tokenAcesso: token.trim() || conexaoSalva?.tokenAcesso,
        configuradoEm: conexaoSalva?.configuradoEm ?? new Date().toISOString(),
        ultimaSincronizacao: conexaoSalva?.ultimaSincronizacao,
      });
      setToken('');
    } catch (e) {
      setErroConexao(e instanceof Error ? e.message : 'Erro ao salvar a conexão.');
    } finally {
      setSalvandoConexao(false);
    }
  }

  async function sincronizarAgora() {
    if (!usuario || !empresaId) return;
    setSincronizando(true);
    setErroConexao('');
    setAvisoSync('');
    try {
      await salvarConexao();
      const idToken = await usuario.getIdToken();
      const resp = await fetch(`${API_BASE_URL}/v1/meta/sincronizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      });
      const dados = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setAvisoSync(
          dados?.erro ??
            'Sincronização automática ainda não está disponível (endpoint precisa ser implantado no backend). Por enquanto, importe a planilha exportada do Gerenciador de Anúncios acima.'
        );
        return;
      }
      setAvisoSync(`Sincronizado! ${dados?.campanhasImportadas ?? 0} campanha(s) atualizada(s).`);
    } catch {
      setAvisoSync(
        'Não consegui falar com o servidor de sincronização agora. Por enquanto, importe a planilha exportada do Gerenciador de Anúncios acima.'
      );
    } finally {
      setSincronizando(false);
    }
  }

  return (
    <div className="p-6 w-full max-w-5xl">
      <h1 className="text-base font-extrabold text-ink mb-1">Meta — Gerenciador de Anúncios</h1>
      <p className="text-sm text-ink-soft mb-6">
        Todas as campanhas do mês, num só lugar: nome, resultado, alcance, custo por resultado, orçamento, valor
        gasto, impressões e status.
      </p>

      <div className="bg-white border border-line rounded-2xl p-6 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <h2 className="text-sm font-extrabold text-ink">Campanhas do mês</h2>
          <input
            type="month"
            value={mesRef}
            onChange={(e) => setMesRef(e.target.value)}
            className="rounded-lg border border-line px-3 py-1.5 text-sm"
          />
        </div>

        {campanhasDoMes.length === 0 ? (
          <p className="text-sm text-ink-soft">
            Nenhuma campanha importada pra {rotuloMes(mesRef)} ainda — importe a planilha do Gerenciador de Anúncios
            abaixo.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <div className="bg-surface rounded-xl p-3">
                <div className="text-xs text-ink-soft font-bold uppercase tracking-wide">Valor gasto</div>
                <div className="text-lg font-extrabold text-ink">{formatarMoeda(totais.valorGasto)}</div>
              </div>
              <div className="bg-surface rounded-xl p-3">
                <div className="text-xs text-ink-soft font-bold uppercase tracking-wide">Resultados</div>
                <div className="text-lg font-extrabold text-ink">{totais.resultado.toLocaleString('pt-BR')}</div>
              </div>
              <div className="bg-surface rounded-xl p-3">
                <div className="text-xs text-ink-soft font-bold uppercase tracking-wide">Alcance</div>
                <div className="text-lg font-extrabold text-ink">{totais.alcance.toLocaleString('pt-BR')}</div>
              </div>
              <div className="bg-surface rounded-xl p-3">
                <div className="text-xs text-ink-soft font-bold uppercase tracking-wide">Impressões</div>
                <div className="text-lg font-extrabold text-ink">{totais.impressoes.toLocaleString('pt-BR')}</div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-bold text-ink-soft uppercase tracking-wide border-b border-line">
                    <th className="py-2 pr-3">Campanha</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3 text-right">Resultado</th>
                    <th className="py-2 pr-3 text-right">Alcance</th>
                    <th className="py-2 pr-3 text-right">Impressões</th>
                    <th className="py-2 pr-3 text-right">Custo/resultado</th>
                    <th className="py-2 pr-3 text-right">Orçamento</th>
                    <th className="py-2 pr-3 text-right">Valor gasto</th>
                  </tr>
                </thead>
                <tbody>
                  {campanhasDoMes.map((c) => (
                    <tr key={c.id} className="border-b border-line/60">
                      <td className="py-2 pr-3 font-semibold text-ink">{c.nome}</td>
                      <td className="py-2 pr-3">
                        <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full ${ROTULO_STATUS[c.status].cor}`}>
                          {ROTULO_STATUS[c.status].texto}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {c.resultado?.toLocaleString('pt-BR') ?? '—'}
                        {c.tipoResultado && <div className="text-xs text-ink-soft">{c.tipoResultado}</div>}
                      </td>
                      <td className="py-2 pr-3 text-right">{c.alcance?.toLocaleString('pt-BR') ?? '—'}</td>
                      <td className="py-2 pr-3 text-right">{c.impressoes?.toLocaleString('pt-BR') ?? '—'}</td>
                      <td className="py-2 pr-3 text-right">{c.custoPorResultado !== undefined ? formatarMoeda(c.custoPorResultado) : '—'}</td>
                      <td className="py-2 pr-3 text-right">{c.orcamento !== undefined ? formatarMoeda(c.orcamento) : '—'}</td>
                      <td className="py-2 pr-3 text-right font-semibold text-ink">{c.valorGasto !== undefined ? formatarMoeda(c.valorGasto) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="bg-white border border-line rounded-2xl p-6 mb-4">
        <h2 className="text-sm font-extrabold text-ink mb-1">Importar planilha do Gerenciador de Anúncios</h2>
        <p className="text-sm text-ink-soft mb-5">
          No Gerenciador de Anúncios: selecione as campanhas do período, clique em "Exportar" → "Exportar dados da
          tabela" (.csv ou .xlsx) e envie o arquivo aqui. É seguro reimportar o mesmo mês — os dados são
          substituídos, não duplicam.
        </p>
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
            disabled={!arquivo || importando}
            className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-5 py-2.5 hover:opacity-90 disabled:opacity-60"
          >
            {importando ? 'Importando...' : 'Importar campanhas'}
          </button>
        </div>
        {erroImport && <p className="text-xs text-red-500 mt-4">{erroImport}</p>}
        {resultadoImport && (
          <div className="mt-4 bg-teal-500/10 rounded-xl p-4 text-sm">
            <p className="font-bold text-ink">
              {resultadoImport.total} campanha(s) importada(s) pra {rotuloMes(resultadoImport.mes)}.
            </p>
            {resultadoImport.ignoradas > 0 && (
              <p className="text-ink-soft">{resultadoImport.ignoradas} linha(s) ignorada(s) (sem nome de campanha).</p>
            )}
          </div>
        )}
      </div>

      <div className="bg-white border border-line rounded-2xl p-6">
        <span className="inline-block text-xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-700 mb-3">
          Em preparação
        </span>
        <h2 className="text-sm font-extrabold text-ink mb-1">Conectar direto com o Meta Ads (sincronização automática)</h2>
        <p className="text-sm text-ink-soft mb-5">
          Pra puxar as campanhas automaticamente (sem precisar exportar planilha), é preciso um token de acesso do
          Business Manager com permissão de leitura de anúncios (<code className="bg-surface rounded px-1">ads_read</code>).
          Informe abaixo o ID da conta de anúncios e o token — o botão "Sincronizar agora" já está pronto, mas só
          funciona depois que essa conexão for implantada no servidor.
        </p>
        <div className="space-y-4 max-w-md">
          <div>
            <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
              ID da conta de anúncios
            </label>
            <input
              value={contaAnuncioId}
              onChange={(e) => setContaAnuncioId(e.target.value)}
              placeholder="act_1234567890"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
              Token de acesso (System User)
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={conexaoSalva?.tokenAcesso ? '•••• (salvo — deixe em branco pra manter)' : ''}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-5">
          <button
            onClick={salvarConexao}
            disabled={!contaAnuncioId.trim() || salvandoConexao}
            className="rounded-xl border border-line text-ink text-sm font-bold px-4 py-2.5 hover:bg-surface disabled:opacity-60"
          >
            {salvandoConexao ? 'Salvando...' : 'Salvar conexão'}
          </button>
          <button
            onClick={sincronizarAgora}
            disabled={!contaAnuncioId.trim() || sincronizando}
            className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-4 py-2.5 hover:opacity-90 disabled:opacity-60"
          >
            {sincronizando ? 'Sincronizando...' : 'Sincronizar agora'}
          </button>
        </div>
        {erroConexao && <p className="text-xs text-red-500 mt-3">{erroConexao}</p>}
        {avisoSync && <p className="text-xs text-ink-soft mt-3">{avisoSync}</p>}
      </div>
    </div>
  );
}
