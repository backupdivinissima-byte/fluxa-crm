import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { ouvirClientes } from '../../lib/crmData';
import { ouvirLives, salvarLive, encerrarLive, ouvirReservasLive, importarReservasLive } from '../../lib/marketingData';
import { lerReservasLiveDoArquivo } from '../../lib/importarMarketing';
import { resultadoClientesLive } from '../../lib/marketingLogic';
import { formatarMoeda } from '../../lib/crmLogic';
import type { Cliente, Live as LiveEvento, ReservaLive } from '../../types';

const API_BASE_URL = 'https://us-central1-fluxa-crm.cloudfunctions.net/api';
const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function mesAtualISO() {
  return new Date().toISOString().slice(0, 7);
}

function rotuloMes(mesRef: string) {
  const [ano, mes] = mesRef.split('-').map(Number);
  return new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

/** Grade de dias do mês (6 semanas x 7 dias), incluindo dias do mês
 * anterior/seguinte pra completar a grade — sem depender de biblioteca de
 * datas. */
function gradeDoMes(mesRef: string): { data: string; noMes: boolean }[] {
  const [ano, mes] = mesRef.split('-').map(Number);
  const primeiroDia = new Date(ano, mes - 1, 1);
  const offset = primeiroDia.getDay();
  const inicio = new Date(ano, mes - 1, 1 - offset);
  const dias: { data: string; noMes: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(inicio);
    d.setDate(inicio.getDate() + i);
    dias.push({
      data: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      noMes: d.getMonth() === mes - 1,
    });
  }
  return dias;
}

export default function Live() {
  const { empresa, papel, usuario } = useAuth();
  const empresaId = empresa?.id;

  const [lives, setLives] = useState<LiveEvento[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [reservas, setReservas] = useState<ReservaLive[]>([]);
  const [mesRef, setMesRef] = useState(mesAtualISO());

  const [diaSelecionado, setDiaSelecionado] = useState<string | null>(null);
  const [horaInicio, setHoraInicio] = useState('18:00');
  const [horaFim, setHoraFim] = useState('22:00');
  const [titulo, setTitulo] = useState('');
  const [agendando, setAgendando] = useState(false);
  const [erroAgenda, setErroAgenda] = useState('');

  const [liveEncerrando, setLiveEncerrando] = useState<string | null>(null);
  const [visualizacoes, setVisualizacoes] = useState('');
  const [picoOnline, setPicoOnline] = useState('');
  const [encerrando, setEncerrando] = useState(false);
  const [buscandoInstagram, setBuscandoInstagram] = useState(false);
  const [avisoInstagram, setAvisoInstagram] = useState('');

  const [arquivoReservas, setArquivoReservas] = useState<File | null>(null);
  const inputReservasRef = useRef<HTMLInputElement>(null);
  const [importandoReservas, setImportandoReservas] = useState(false);
  const [resultadoImportReservas, setResultadoImportReservas] = useState<{ total: number; ignoradas: number } | null>(null);
  const [erroImportReservas, setErroImportReservas] = useState('');
  const [mostrarCatalogo, setMostrarCatalogo] = useState(false);

  useEffect(() => {
    if (!empresaId) return;
    const unsubL = ouvirLives(empresaId, setLives);
    const unsubC = ouvirClientes(empresaId, setClientes);
    const unsubR = ouvirReservasLive(empresaId, setReservas);
    return () => {
      unsubL();
      unsubC();
      unsubR();
    };
  }, [empresaId]);

  const grade = useMemo(() => gradeDoMes(mesRef), [mesRef]);
  const livesPorDia = useMemo(() => {
    const mapa = new Map<string, LiveEvento[]>();
    for (const l of lives) {
      const lista = mapa.get(l.data) ?? [];
      lista.push(l);
      mapa.set(l.data, lista);
    }
    return mapa;
  }, [lives]);

  const reservasDoMes = useMemo(() => reservas.filter((r) => (r.data ?? '').slice(0, 7) === mesRef), [reservas, mesRef]);
  const resultado = useMemo(() => resultadoClientesLive(clientes, reservasDoMes), [clientes, reservasDoMes]);
  const resultadoFiltrado = useMemo(
    () => (mostrarCatalogo ? resultado : resultado.filter((r) => r.origem === 'live')),
    [resultado, mostrarCatalogo]
  );
  const totalReservado = useMemo(() => resultado.filter((r) => r.origem === 'live').reduce((s, r) => s + (r.valorReservado ?? 0), 0), [resultado]);
  const totalAcrescimo = useMemo(() => resultado.filter((r) => r.origem === 'live').reduce((s, r) => s + (r.acrescimo ?? 0), 0), [resultado]);

  if (papel !== 'admin' || !empresaId) {
    return (
      <div className="p-6 w-full">
        <p className="text-sm text-ink-soft">Somente administradores acessam essa tela.</p>
      </div>
    );
  }

  async function agendarLive(e: React.FormEvent) {
    e.preventDefault();
    if (!diaSelecionado || !empresaId) return;
    if (horaFim <= horaInicio) {
      setErroAgenda('O horário final precisa ser depois do horário inicial.');
      return;
    }
    setAgendando(true);
    setErroAgenda('');
    try {
      await salvarLive(empresaId, {
        data: diaSelecionado,
        horaInicio,
        horaFim,
        titulo: titulo.trim() || undefined,
        status: 'agendada',
      });
      setTitulo('');
    } catch (err) {
      setErroAgenda(err instanceof Error ? err.message : 'Erro ao agendar a live.');
    } finally {
      setAgendando(false);
    }
  }

  async function confirmarEncerramento(liveId: string) {
    if (!empresaId) return;
    setEncerrando(true);
    try {
      await encerrarLive(empresaId, liveId, {
        visualizacoes: visualizacoes.trim() ? Number(visualizacoes) : undefined,
        picoPessoasOnline: picoOnline.trim() ? Number(picoOnline) : undefined,
        origemMetricas: 'manual',
      });
      setLiveEncerrando(null);
      setVisualizacoes('');
      setPicoOnline('');
      setAvisoInstagram('');
    } finally {
      setEncerrando(false);
    }
  }

  async function buscarDoInstagram(liveId: string) {
    if (!usuario) return;
    setBuscandoInstagram(true);
    setAvisoInstagram('');
    try {
      const idToken = await usuario.getIdToken();
      const resp = await fetch(`${API_BASE_URL}/v1/instagram/live-insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ liveId }),
      });
      const dados = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setAvisoInstagram(
          dados?.erro ?? 'Busca automática ainda não está disponível — preencha os números manualmente abaixo.'
        );
        return;
      }
      if (dados?.visualizacoes !== undefined) setVisualizacoes(String(dados.visualizacoes));
      if (dados?.picoPessoasOnline !== undefined) setPicoOnline(String(dados.picoPessoasOnline));
      setAvisoInstagram('Números preenchidos a partir do Instagram — confira antes de salvar.');
    } catch {
      setAvisoInstagram('Não consegui falar com o Instagram agora — preencha os números manualmente abaixo.');
    } finally {
      setBuscandoInstagram(false);
    }
  }

  async function rodarImportacaoReservas() {
    if (!arquivoReservas || !empresaId) return;
    setImportandoReservas(true);
    setErroImportReservas('');
    setResultadoImportReservas(null);
    try {
      const { reservas: lidas, ignoradas } = await lerReservasLiveDoArquivo(arquivoReservas);
      if (lidas.length === 0) {
        setErroImportReservas(
          'Não encontrei nenhuma reserva nesse arquivo. Confira se ele tem colunas de data, código do cliente, nome e valor da reserva.'
        );
        return;
      }
      const total = await importarReservasLive(empresaId, lidas, arquivoReservas.name);
      setResultadoImportReservas({ total, ignoradas });
      setArquivoReservas(null);
      if (inputReservasRef.current) inputReservasRef.current.value = '';
    } catch (e) {
      setErroImportReservas(e instanceof Error ? e.message : 'Erro ao ler o arquivo.');
    } finally {
      setImportandoReservas(false);
    }
  }

  return (
    <div className="p-6 w-full max-w-5xl">
      <h1 className="text-base font-extrabold text-ink mb-1">Live</h1>
      <p className="text-sm text-ink-soft mb-6">
        Agende as lives do mês, encerre com as métricas de audiência e importe a reserva de cada live pra ver quem
        comprou pela live e quem é cliente catálogo.
      </p>

      <div className="bg-white border border-line rounded-2xl p-6 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <h2 className="text-sm font-extrabold text-ink capitalize">{rotuloMes(mesRef)}</h2>
          <input
            type="month"
            value={mesRef}
            onChange={(e) => setMesRef(e.target.value)}
            className="rounded-lg border border-line px-3 py-1.5 text-sm"
          />
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-ink-soft uppercase tracking-wide mb-1">
          {DIAS_SEMANA.map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {grade.map(({ data, noMes }) => {
            const eventosDoDia = livesPorDia.get(data) ?? [];
            const dia = Number(data.slice(8, 10));
            return (
              <button
                key={data}
                type="button"
                onClick={() => {
                  setDiaSelecionado(data);
                  setErroAgenda('');
                }}
                className={`min-h-[64px] rounded-lg border p-1.5 text-left align-top transition-colors ${
                  diaSelecionado === data ? 'border-teal-500 bg-teal-500/5' : 'border-line hover:bg-surface'
                } ${noMes ? '' : 'opacity-40'}`}
              >
                <div className="text-xs font-bold text-ink">{dia}</div>
                {eventosDoDia.map((ev) => (
                  <div
                    key={ev.id}
                    className={`mt-1 text-[10px] font-bold px-1 py-0.5 rounded truncate ${
                      ev.status === 'encerrada' ? 'bg-ink-soft/10 text-ink-soft' : 'bg-teal-500/15 text-teal-700'
                    }`}
                  >
                    {ev.horaInicio} {ev.titulo ?? 'Live'}
                  </div>
                ))}
              </button>
            );
          })}
        </div>
      </div>

      {diaSelecionado && (
        <div className="bg-white border border-line rounded-2xl p-6 mb-4">
          <h2 className="text-sm font-extrabold text-ink mb-4">
            {new Date(`${diaSelecionado}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
          </h2>

          {(livesPorDia.get(diaSelecionado) ?? []).map((ev) => (
            <div key={ev.id} className="border border-line rounded-xl p-4 mb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-ink">{ev.titulo ?? 'Live'}</p>
                  <p className="text-xs text-ink-soft">
                    {ev.horaInicio} às {ev.horaFim} · {ev.status === 'encerrada' ? 'Encerrada' : 'Agendada'}
                  </p>
                </div>
                {ev.status === 'agendada' ? (
                  <button
                    onClick={() => {
                      setLiveEncerrando(ev.id);
                      setVisualizacoes('');
                      setPicoOnline('');
                      setAvisoInstagram('');
                    }}
                    className="rounded-lg border border-line text-ink text-xs font-bold px-3 py-1.5 hover:bg-surface"
                  >
                    Encerrar live
                  </button>
                ) : (
                  <div className="text-xs text-ink-soft text-right">
                    <div>{ev.visualizacoes?.toLocaleString('pt-BR') ?? '—'} visualizações</div>
                    <div>{ev.picoPessoasOnline?.toLocaleString('pt-BR') ?? '—'} pico online</div>
                  </div>
                )}
              </div>

              {liveEncerrando === ev.id && (
                <div className="mt-4 bg-surface rounded-xl p-4">
                  <div className="flex flex-wrap items-center gap-3 mb-3">
                    <button
                      type="button"
                      onClick={() => buscarDoInstagram(ev.id)}
                      disabled={buscandoInstagram}
                      className="rounded-lg border border-line text-ink text-xs font-bold px-3 py-1.5 hover:bg-white disabled:opacity-60"
                    >
                      {buscandoInstagram ? 'Buscando...' : 'Buscar do Instagram (em preparação)'}
                    </button>
                  </div>
                  {avisoInstagram && <p className="text-xs text-ink-soft mb-3">{avisoInstagram}</p>}
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
                        Visualizações
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={visualizacoes}
                        onChange={(e) => setVisualizacoes(e.target.value)}
                        className="w-full rounded-lg border border-line px-3 py-2 text-sm bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
                        Pico de pessoas online
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={picoOnline}
                        onChange={(e) => setPicoOnline(e.target.value)}
                        className="w-full rounded-lg border border-line px-3 py-2 text-sm bg-white"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => confirmarEncerramento(ev.id)}
                      disabled={encerrando}
                      className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-4 py-2 hover:opacity-90 disabled:opacity-60"
                    >
                      {encerrando ? 'Salvando...' : 'Confirmar encerramento'}
                    </button>
                    <button onClick={() => setLiveEncerrando(null)} className="text-xs font-bold text-ink-soft hover:text-ink">
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          <form onSubmit={agendarLive} className="border-t border-line pt-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">Título (opcional)</label>
              <input
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Live de sexta"
                className="rounded-lg border border-line px-3 py-2 text-sm w-40"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">Início</label>
              <input
                type="time"
                value={horaInicio}
                onChange={(e) => setHoraInicio(e.target.value)}
                className="rounded-lg border border-line px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">Fim</label>
              <input
                type="time"
                value={horaFim}
                onChange={(e) => setHoraFim(e.target.value)}
                className="rounded-lg border border-line px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={agendando}
              className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-4 py-2.5 hover:opacity-90 disabled:opacity-60"
            >
              {agendando ? 'Agendando...' : '+ Agendar live'}
            </button>
          </form>
          {erroAgenda && <p className="text-xs text-red-500 mt-3">{erroAgenda}</p>}
        </div>
      )}

      <div className="bg-white border border-line rounded-2xl p-6 mb-4">
        <h2 className="text-sm font-extrabold text-ink mb-1">Importar reserva da live</h2>
        <p className="text-sm text-ink-soft mb-5">
          Planilha com data, código do cliente, nome do cliente e valor da reserva (orçamento das peças reservadas
          na live). Cliente com reserva conta como vindo da live; sem reserva é cliente catálogo (fora live). Seguro
          reimportar — mesma data + código atualiza em vez de duplicar.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={inputReservasRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => setArquivoReservas(e.target.files?.[0] ?? null)}
            className="text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-surface file:px-3 file:py-2 file:text-sm file:font-bold file:text-ink hover:file:bg-line/50"
          />
          <button
            onClick={rodarImportacaoReservas}
            disabled={!arquivoReservas || importandoReservas}
            className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-5 py-2.5 hover:opacity-90 disabled:opacity-60"
          >
            {importandoReservas ? 'Importando...' : 'Importar reservas'}
          </button>
        </div>
        {erroImportReservas && <p className="text-xs text-red-500 mt-4">{erroImportReservas}</p>}
        {resultadoImportReservas && (
          <div className="mt-4 bg-teal-500/10 rounded-xl p-4 text-sm">
            <p className="font-bold text-ink">{resultadoImportReservas.total} reserva(s) importada(s).</p>
            {resultadoImportReservas.ignoradas > 0 && (
              <p className="text-ink-soft">{resultadoImportReservas.ignoradas} linha(s) ignorada(s) (sem código ou valor).</p>
            )}
          </div>
        )}
      </div>

      <div className="bg-white border border-line rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <h2 className="text-sm font-extrabold text-ink">Resultado da live — {rotuloMes(mesRef)}</h2>
          <label className="flex items-center gap-2 text-xs font-bold text-ink-soft">
            <input type="checkbox" checked={mostrarCatalogo} onChange={(e) => setMostrarCatalogo(e.target.checked)} />
            Mostrar também clientes catálogo
          </label>
        </div>
        <p className="text-sm text-ink-soft mb-5">
          Cruza a reserva importada com o quadro CRM: quanto cada cliente reservou na live e quanto acrescentou de
          catálogo (comprou além do que reservou).
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
          <div className="bg-surface rounded-xl p-3">
            <div className="text-xs text-ink-soft font-bold uppercase tracking-wide">Clientes vindos da live</div>
            <div className="text-lg font-extrabold text-ink">{resultado.filter((r) => r.origem === 'live').length}</div>
          </div>
          <div className="bg-surface rounded-xl p-3">
            <div className="text-xs text-ink-soft font-bold uppercase tracking-wide">Total reservado</div>
            <div className="text-lg font-extrabold text-ink">{formatarMoeda(totalReservado)}</div>
          </div>
          <div className="bg-surface rounded-xl p-3">
            <div className="text-xs text-ink-soft font-bold uppercase tracking-wide">Acréscimo de catálogo</div>
            <div className="text-lg font-extrabold text-ink">{formatarMoeda(totalAcrescimo)}</div>
          </div>
        </div>

        {resultadoFiltrado.length === 0 ? (
          <p className="text-sm text-ink-soft">Nenhum resultado pra {rotuloMes(mesRef)} ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-bold text-ink-soft uppercase tracking-wide border-b border-line">
                  <th className="py-2 pr-3">Cliente</th>
                  <th className="py-2 pr-3">Origem</th>
                  <th className="py-2 pr-3 text-right">Reservado (live)</th>
                  <th className="py-2 pr-3 text-right">Valor final</th>
                  <th className="py-2 pr-3 text-right">Acréscimo catálogo</th>
                </tr>
              </thead>
              <tbody>
                {resultadoFiltrado.map((r) => (
                  <tr key={r.cliente.id} className="border-b border-line/60">
                    <td className="py-2 pr-3 font-semibold text-ink">{r.cliente.razao ?? r.cliente.nome ?? r.cliente.cod}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full ${
                          r.origem === 'live' ? 'text-teal-700 bg-teal-500/10' : 'text-ink-soft bg-surface'
                        }`}
                      >
                        {r.origem === 'live' ? 'Live' : 'Catálogo'}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right">{r.valorReservado !== undefined ? formatarMoeda(r.valorReservado) : '—'}</td>
                    <td className="py-2 pr-3 text-right">{formatarMoeda(r.valorFinal)}</td>
                    <td className="py-2 pr-3 text-right">{r.acrescimo !== undefined ? formatarMoeda(r.acrescimo) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
