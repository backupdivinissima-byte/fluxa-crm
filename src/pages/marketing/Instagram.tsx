import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { ouvirInstagramLives, salvarInstagramConexao, salvarInstagramLive } from '../../lib/marketingData';
import * as igApi from '../../lib/instagramApi';
import { buscarLivesAgora, guardarTokenInstagram, lerTokenInstagram } from '../../lib/instagramApi';
import type { ArrobaLive, InstagramLive, MensagemLive } from '../../types';

const INTERVALO_MS = 20_000;

function dataHora(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function baixarComentariosCsv(live: InstagramLive) {
  const linhas = (live.mensagens ?? []).map((m) => [dataHora(m.quando), `@${m.arroba}`, m.texto.replace(/[\r\n;]+/g, ' ')]);
  const csv = ['quando;arroba;comentario', ...linhas.map((l) => l.join(';'))].join('\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `comentarios-live-${live.iniciadaEm.slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function baixarCsv(live: InstagramLive) {
  const linhas = Object.entries(live.arrobas)
    .sort((a, b) => b[1].comentarios - a[1].comentarios)
    .map(([nome, a]) => [`@${nome}`, a.comentarios, dataHora(a.primeiraVez), dataHora(a.ultimaVez), (a.ultimoTexto ?? '').replace(/[\r\n;]+/g, ' ')]);
  const csv = ['arroba;comentarios;primeira_vez;ultima_vez;ultimo_comentario', ...linhas.map((l) => l.join(';'))].join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `arrobas-live-${live.iniciadaEm.slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Aba "Instagram": conecta a conta comercial (API oficial, sem senha) e,
 * enquanto uma live está no ar, vai captando os @ de quem comenta nela. */
export default function InstagramLives() {
  const { empresa, papel } = useAuth();
  const empresaId = empresa?.id;
  const conexao = empresa?.instagramConexao;

  const [contaId, setContaId] = useState(conexao?.contaInstagramId ?? '');
  const [token, setToken] = useState('');
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  const [lives, setLives] = useState<InstagramLive[]>([]);
  const [escolhidaId, setEscolhidaId] = useState<string | null>(null);
  const [monitorando, setMonitorando] = useState(false);
  const [status, setStatus] = useState('');
  const livesRef = useRef<InstagramLive[]>([]);
  livesRef.current = lives;

  useEffect(() => {
    if (!empresaId) return;
    return ouvirInstagramLives(empresaId, setLives);
  }, [empresaId]);

  function tokenEmUso() {
    return token.trim() || lerTokenInstagram(empresaId ?? '');
  }

  async function salvarConexao() {
    if (!empresaId || !contaId.trim()) return;
    setSalvando(true);
    setErro('');
    try {
      const t = tokenEmUso();
      if (t) guardarTokenInstagram(empresaId, t);
      await salvarInstagramConexao(empresaId, {
        contaInstagramId: contaId.trim(),
        configuradoEm: conexao?.configuradoEm ?? new Date().toISOString(),
      });
      setToken('');
      setAviso('Conexão salva.');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar a conexão.');
    } finally {
      setSalvando(false);
    }
  }

  // Monitoramento: a cada 20 s consulta a live no ar e grava os @ novos.
  useEffect(() => {
    if (!monitorando || !empresaId) return;
    let cancelado = false;

    async function ciclo() {
      try {
        const agora = await buscarLivesAgora(contaId, tokenEmUso());
        if (cancelado) return;
        if (agora.length === 0) {
          setStatus(`Nenhuma live no ar agora (verificado às ${new Date().toLocaleTimeString('pt-BR')}). Resposta: ${igApi.ultimaConsulta}.`);
          return;
        }
        for (const live of agora) {
          const antiga = livesRef.current.find((l) => l.id === live.id);
          const arrobas: Record<string, ArrobaLive> = { ...(antiga?.arrobas ?? {}) };
          for (const [nome, novo] of Object.entries(live.arrobas)) {
            const velho = arrobas[nome];
            arrobas[nome] = velho
              ? {
                  comentarios: Math.max(velho.comentarios, novo.comentarios),
                  primeiraVez: velho.primeiraVez < novo.primeiraVez ? velho.primeiraVez : novo.primeiraVez,
                  ultimaVez: velho.ultimaVez > novo.ultimaVez ? velho.ultimaVez : novo.ultimaVez,
                  ultimoTexto: novo.ultimaVez >= velho.ultimaVez ? novo.ultimoTexto : velho.ultimoTexto,
                }
              : novo;
          }
          const porId = new Map<string, MensagemLive>();
          for (const m of antiga?.mensagens ?? []) porId.set(m.id, m);
          for (const m of live.mensagens) porId.set(m.id, m);
          const mensagens = [...porId.values()].sort((a, b) => a.quando.localeCompare(b.quando)).slice(-3000);
          await salvarInstagramLive(empresaId!, {
            mensagens,
            id: live.id,
            iniciadaEm: antiga?.iniciadaEm ?? live.iniciadaEm,
            atualizadoEm: new Date().toISOString(),
            encerrada: false,
            arrobas,
          });
          setEscolhidaId((atual) => atual ?? live.id);
          setStatus(`Live no ar — ${Object.keys(arrobas).length} @ captados (atualizado às ${new Date().toLocaleTimeString('pt-BR')}). Resposta: ${igApi.ultimaConsulta}.`);
        }
        setErro('');
      } catch (e) {
        if (!cancelado) setErro(e instanceof Error ? e.message : 'Erro ao consultar o Instagram.');
      }
    }

    void ciclo();
    const timer = setInterval(() => void ciclo(), INTERVALO_MS);
    return () => {
      cancelado = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monitorando, empresaId]);

  const live = useMemo(() => lives.find((l) => l.id === (escolhidaId ?? lives[0]?.id)) ?? null, [lives, escolhidaId]);
  const ordenados = useMemo(
    () => (live ? Object.entries(live.arrobas).sort((a, b) => b[1].comentarios - a[1].comentarios) : []),
    [live]
  );

  if (papel !== 'admin' || !empresaId) {
    return (
      <div className="p-6 w-full">
        <p className="text-sm text-ink-soft">Somente administradores acessam essa tela.</p>
      </div>
    );
  }

  const temToken = !!lerTokenInstagram(empresaId);

  return (
    <div className="p-6 w-full space-y-4">
      <div>
        <h1 className="text-base font-extrabold text-ink mb-1">Instagram — @ das lives</h1>
        <p className="text-sm text-ink-soft">
          Conecte a conta comercial do Instagram e, durante a live, o sistema capta os @ de quem comenta. O Instagram não
          informa quem apenas assiste: só quem comenta aparece.
        </p>
      </div>

      <div className="bg-white border border-line rounded-2xl p-6">
        <h2 className="text-sm font-extrabold text-ink mb-1">Conexão com o Instagram</h2>
        <p className="text-sm text-ink-soft mb-4">
          A conexão é feita pela API oficial do Meta, com token (o mesmo tipo de acesso do Business Manager). Não é
          preciso e não devemos informar a senha do Instagram. O token fica guardado só neste navegador.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
          <div>
            <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
              ID da conta comercial do Instagram
            </label>
            <input
              value={contaId}
              onChange={(e) => setContaId(e.target.value)}
              placeholder="Ex.: 17841400000000000"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
              Token de acesso
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={temToken ? '•••• (salvo — deixe em branco pra manter)' : 'Cole o token aqui'}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm"
            />
          </div>
        </div>
        <p className="text-[11px] text-ink-soft mt-3 max-w-3xl">
          Aceita o token gerado no app pelo login do Instagram (permissões{' '}
          <code className="bg-surface rounded px-1">instagram_business_basic</code> e{' '}
          <code className="bg-surface rounded px-1">instagram_business_manage_comments</code>) ou o token do Business
          Manager (<code className="bg-surface rounded px-1">instagram_basic</code> e{' '}
          <code className="bg-surface rounded px-1">pages_read_engagement</code>). A conta precisa ser comercial.
        </p>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <button
            onClick={salvarConexao}
            disabled={!contaId.trim() || salvando}
            className="rounded-xl border border-line text-ink text-sm font-bold px-4 py-2.5 hover:bg-surface disabled:opacity-60"
          >
            {salvando ? 'Salvando...' : 'Salvar conexão'}
          </button>
          <button
            onClick={() => {
              if (!monitorando && empresaId && tokenEmUso()) guardarTokenInstagram(empresaId, tokenEmUso());
              setErro('');
              setMonitorando((m) => !m);
            }}
            disabled={!contaId.trim() || (!monitorando && !tokenEmUso())}
            className={`rounded-xl text-sm font-bold px-4 py-2.5 disabled:opacity-60 ${
              monitorando ? 'bg-red-500 text-white hover:opacity-90' : 'bg-gradient-to-br from-teal-500 to-blue-600 text-white hover:opacity-90'
            }`}
          >
            {monitorando ? 'Parar monitoramento' : 'Iniciar monitoramento da live'}
          </button>
        </div>
        {monitorando && (
          <p className="text-xs text-ink-soft mt-3">
            {status || 'Consultando o Instagram...'} Mantenha esta aba aberta durante a live: o monitoramento só roda enquanto ela estiver aberta.
          </p>
        )}
        {erro && <p className="text-xs text-red-500 mt-3">{erro}</p>}
        {aviso && !erro && <p className="text-xs text-ink-soft mt-3">{aviso}</p>}
      </div>

      <div className="bg-white border border-line rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-sm font-extrabold text-ink">@ captados</h2>
          {lives.length > 0 && (
            <div className="flex items-center gap-2">
              <select
                value={live?.id ?? ''}
                onChange={(e) => setEscolhidaId(e.target.value)}
                className="rounded-lg border border-line px-3 py-1.5 text-sm"
              >
                {lives.map((l) => (
                  <option key={l.id} value={l.id}>
                    Live de {dataHora(l.iniciadaEm)} — {Object.keys(l.arrobas).length} @
                  </option>
                ))}
              </select>
              {live && (
                <button
                  onClick={() => baixarCsv(live)}
                  className="rounded-xl border border-line text-ink text-xs font-bold px-3 py-2 hover:bg-surface"
                >
                  Baixar lista (CSV)
                </button>
              )}
            </div>
          )}
        </div>
        {!live ? (
          <p className="text-sm text-ink-soft">
            Nenhuma live captada ainda. Quando começar a transmissão, clique em "Iniciar monitoramento da live".
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-soft uppercase tracking-wide">
                <tr>
                  <th className="text-left pb-2">Arroba</th>
                  <th className="text-right pb-2">Comentários</th>
                  <th className="text-left pb-2 pl-6">Primeira vez</th>
                  <th className="text-left pb-2">Último comentário</th>
                </tr>
              </thead>
              <tbody>
                {ordenados.map(([nome, a]) => (
                  <tr key={nome} className="border-t border-line">
                    <td className="py-2 font-bold text-ink">
                      <a href={`https://instagram.com/${nome}`} target="_blank" rel="noreferrer" className="hover:underline">
                        @{nome}
                      </a>
                    </td>
                    <td className="py-2 text-right tabular-nums">{a.comentarios}</td>
                    <td className="py-2 pl-6 text-ink-soft whitespace-nowrap">{dataHora(a.primeiraVez)}</td>
                    <td className="py-2 text-ink-soft truncate max-w-md">{a.ultimoTexto ?? '—'}</td>
                  </tr>
                ))}
                {ordenados.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-ink-soft">
                      Ainda sem comentários nesta live.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="bg-white border border-line rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-extrabold text-ink">
            Comentários da live{live?.mensagens?.length ? ` (${live.mensagens.length})` : ''}
          </h2>
          {live?.mensagens?.length ? (
            <button
              onClick={() => baixarComentariosCsv(live)}
              className="rounded-xl border border-line text-ink text-xs font-bold px-3 py-2 hover:bg-surface"
            >
              Baixar comentários (CSV)
            </button>
          ) : null}
        </div>
        {!live || !live.mensagens?.length ? (
          <p className="text-sm text-ink-soft">Os comentários aparecem aqui assim que alguém comentar na live.</p>
        ) : (
          <ul className="max-h-[520px] overflow-y-auto divide-y divide-line">
            {[...live.mensagens].reverse().map((m) => (
              <li key={m.id} className="py-2 flex gap-3 text-sm">
                <span className="text-ink-soft whitespace-nowrap tabular-nums">
                  {new Date(m.quando).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span>
                  <a href={`https://instagram.com/${m.arroba}`} target="_blank" rel="noreferrer" className="font-bold text-ink hover:underline">
                    @{m.arroba}
                  </a>{' '}
                  <span className="text-ink">{m.texto}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
