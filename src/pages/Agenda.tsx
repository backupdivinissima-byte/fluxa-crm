import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ouvirClientes, ouvirEmpresa, ouvirVendedores } from '../lib/crmData';
import { ouvirTodasConversas } from '../lib/chatData';
import {
  atualizarAgendamento,
  criarAgendamentos,
  dataDeISO,
  ehDiaUtil,
  formatarDataCurta,
  horariosDoDia,
  isoLocal,
  lembreteDe,
  nomeDoDia,
  ouvirAgenda,
  planejarRodizio,
  removerAgendamento,
  INATIVOS_POR_DIA,
  type Agendamento,
  type PlanoRodizio,
} from '../lib/agendaData';
import { DIAS_INATIVIDADE_PADRAO, diasSemAtend } from '../lib/crmLogic';
import type { Cliente, ConversaChat, Vendedor } from '../types';

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const fim8 = (s?: string) => {
  const d = (s ?? '').replace(/\D/g, '');
  return d.length >= 8 ? d.slice(-8) : '';
};
const norm = (s?: string) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Agenda de contatos: o vendedor agenda o retorno ao cliente; o admin enxerga tudo, agenda para qualquer vendedor e gera o rodízio de inativos. */
export default function Agenda() {
  const { empresa, perfil, sessaoVendedor, papel } = useAuth();
  const navigate = useNavigate();
  const empresaId = empresa?.id;
  const ehAdmin = papel === 'admin';
  const loginAtual = ehAdmin ? undefined : sessaoVendedor?.vendedor.login;
  const nomeAtual = (ehAdmin ? perfil?.nome : sessaoVendedor?.vendedor.nome) ?? '';

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [conversas, setConversas] = useState<ConversaChat[]>([]);
  const [agenda, setAgenda] = useState<Agendamento[]>([]);
  const [diasInatividade, setDiasInatividade] = useState<number>(empresa?.diasInatividade ?? DIAS_INATIVIDADE_PADRAO);

  const hoje = isoLocal(new Date());
  const [mes, setMes] = useState(() => dataDeISO(hoje));
  const [dia, setDia] = useState(hoje);
  const [filtroVend, setFiltroVend] = useState('');

  // formulário
  const [busca, setBusca] = useState('');
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [hora, setHora] = useState('');
  const [vendDestino, setVendDestino] = useState('');
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [concluindo, setConcluindo] = useState<Agendamento | null>(null);
  const [resultado, setResultado] = useState('');
  const [plano, setPlano] = useState<PlanoRodizio | null>(null);
  const [diasRodizio, setDiasRodizio] = useState(5);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    if (!empresaId) return;
    const u = [
      ouvirClientes(empresaId, setClientes),
      ouvirVendedores(empresaId, setVendedores),
      ouvirTodasConversas(empresaId, setConversas),
      ouvirAgenda(empresaId, loginAtual, setAgenda, (m) => setAviso({ ok: false, texto: '❌ Não consegui ler a agenda: ' + m })),
      ouvirEmpresa(empresaId, (e) => setDiasInatividade(e?.diasInatividade ?? DIAS_INATIVIDADE_PADRAO)),
    ];
    return () => u.forEach((f) => f());
  }, [empresaId, loginAtual]);

  const vendedoresAtivos = useMemo(() => vendedores.filter((v) => v.ativo), [vendedores]);
  const visiveis = useMemo(() => (filtroVend ? agenda.filter((a) => a.vendedorLogin === filtroVend) : agenda), [agenda, filtroVend]);

  const porDia = useMemo(() => {
    const m = new Map<string, Agendamento[]>();
    for (const a of visiveis) {
      const l = m.get(a.data) ?? [];
      l.push(a);
      m.set(a.data, l);
    }
    for (const l of m.values()) l.sort((x, y) => x.hora.localeCompare(y.hora));
    return m;
  }, [visiveis]);

  const doDia = porDia.get(dia) ?? [];
  const horariosDia = horariosDoDia(dia);
  const vendDoForm = ehAdmin ? vendDestino : (loginAtual ?? '');
  const ocupados = new Set(agenda.filter((a) => a.data === dia && a.vendedorLogin === vendDoForm && a.status === 'pendente').map((a) => a.hora));

  // Conversa do chat de um cliente (vínculo direto, telefone ou nome).
  function conversaDe(c: Cliente): ConversaChat | undefined {
    const t = fim8(c.telefone);
    const cands = conversas.filter((cv) => cv.clienteId === c.id || (t && fim8(cv.telefone ?? cv.contato) === t) || (norm(cv.nome) && (norm(cv.nome) === norm(c.razao) || norm(cv.nome) === norm(c.nome))));
    return cands.sort((a, b) => (b.ultimaEm ?? '').localeCompare(a.ultimaEm ?? ''))[0];
  }
  function abrirChat(telefone?: string) {
    navigate(`/chat?tel=${encodeURIComponent((telefone ?? '').replace(/\D/g, ''))}`);
  }

  const resultados = useMemo(() => {
    const q = norm(busca);
    if (q.length < 1 || cliente) return [];
    const dig = q.replace(/\D/g, '');
    return clientes
      .filter((c) => c.cod === busca.trim() || norm(c.cod).startsWith(q) || norm(c.razao).includes(q) || norm(c.nome).includes(q) || (dig.length >= 4 && (c.telefone ?? '').replace(/\D/g, '').includes(dig)))
      .slice(0, 8);
  }, [busca, clientes, cliente]);

  const conversaCliente = cliente ? conversaDe(cliente) : undefined;

  async function salvar() {
    setErro('');
    if (!empresaId) return;
    if (!cliente) return setErro('Busque e selecione o cliente.');
    if (!ehDiaUtil(dia)) return setErro('Escolha um dia útil (segunda a sexta).');
    if (!hora) return setErro('Escolha o horário.');
    if (!vendDoForm) return setErro('Escolha o vendedor responsável.');
    if (!obs.trim()) return setErro('Registre uma observação (o que foi conversado / motivo do retorno).');
    if (ocupados.has(hora)) return setErro('Esse horário já está ocupado para este vendedor.');
    if (new Date(lembreteDe(dia, hora)).getTime() < Date.now() - 60_000) return setErro('Esse horário já passou.');
    const v = vendedores.find((x) => x.login === vendDoForm);
    setSalvando(true);
    try {
      await criarAgendamentos(empresaId, [
        {
          data: dia,
          hora,
          clienteId: cliente.id,
          clienteCod: cliente.cod,
          clienteNome: cliente.razao || cliente.nome || cliente.cod,
          telefone: cliente.telefone || conversaCliente?.telefone,
          vendedorLogin: vendDoForm,
          vendedorNome: v?.nome ?? nomeAtual,
          obs: obs.trim(),
          status: 'pendente',
          origem: ehAdmin ? 'admin' : 'vendedor',
          criadoEm: new Date().toISOString(),
          criadoPor: nomeAtual,
          lembreteEm: lembreteDe(dia, hora),
        },
      ]);
      setCliente(null);
      setBusca('');
      setObs('');
      setHora('');
    } catch (e) {
      setErro('Não consegui salvar: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSalvando(false);
    }
  }

  async function concluir() {
    if (!empresaId || !concluindo) return;
    if (!resultado.trim()) return;
    await atualizarAgendamento(empresaId, concluindo.id, { status: 'feito', resultado: resultado.trim(), feitoEm: new Date().toISOString() });
    setConcluindo(null);
    setResultado('');
  }

  function prepararRodizio() {
    setPlano(planejarRodizio(clientes, vendedores, agenda, diasInatividade, diasRodizio, nomeAtual));
  }
  async function confirmarRodizio() {
    if (!empresaId || !plano || plano.itens.length === 0) return;
    const p = plano;
    setPlano(null); // fecha a tela na hora; o resultado aparece na faixa de aviso
    setAviso({ ok: true, texto: `⏳ Criando ${p.itens.length} agendamentos…` });
    const primeiroDia = p.itens[0].data;
    setDia(primeiroDia);
    setMes(dataDeISO(primeiroDia));
    try {
      await criarAgendamentos(empresaId, p.itens);
      const resumo = Object.entries(p.porVendedor).map(([n, q]) => `${n}: ${q}`).join(' · ');
      setAviso({ ok: true, texto: `✅ Rodízio criado: ${p.itens.length} agendamentos de ${formatarDataCurta(p.dias[0])} a ${formatarDataCurta(p.dias[p.dias.length - 1])} (${resumo}).` });
    } catch (e) {
      setAviso({ ok: false, texto: '❌ Não consegui criar o rodízio: ' + (e instanceof Error ? e.message : String(e)) + ' (se disser "permission", as regras do banco precisam liberar a coleção agenda).' });
    }
  }

  // ----- dash -----
  const mesISO = `${mes.getFullYear()}-${String(mes.getMonth() + 1).padStart(2, '0')}`;
  const doMes = visiveis.filter((a) => a.data.startsWith(mesISO));
  const hojeLista = visiveis.filter((a) => a.data === hoje);
  const atrasados = visiveis.filter((a) => a.status === 'pendente' && a.data < hoje).length;
  const porVendNoDia = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of doDia) m.set(a.vendedorNome, (m.get(a.vendedorNome) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [doDia]);

  // grade do calendário
  const primeiro = new Date(mes.getFullYear(), mes.getMonth(), 1);
  const diasNoMes = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate();
  const celulas: Array<string | null> = [...Array(primeiro.getDay()).fill(null), ...Array.from({ length: diasNoMes }, (_, i) => `${mesISO}-${String(i + 1).padStart(2, '0')}`)];
  const maxDia = Math.max(1, ...celulas.map((d) => (d ? (porDia.get(d)?.length ?? 0) : 0)));

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <h1 className="text-xl font-extrabold text-ink">Agenda</h1>
        <span className="text-xs text-ink-soft">Seg–Qui 09h–18h · Sex 09h–17h · almoço 12h–13h</span>
        {ehAdmin && (
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <select value={filtroVend} onChange={(e) => setFiltroVend(e.target.value)} className="h-9 rounded-lg border border-line px-2 text-sm bg-white">
              <option value="">Todos os vendedores</option>
              {vendedoresAtivos.map((v) => (
                <option key={v.id} value={v.login}>{v.nome}</option>
              ))}
            </select>
            <select value={diasRodizio} onChange={(e) => setDiasRodizio(Number(e.target.value))} className="h-9 rounded-lg border border-line px-2 text-sm bg-white">
              {[1, 5, 10, 20].map((n) => (
                <option key={n} value={n}>{n} dia(s) útil(eis)</option>
              ))}
            </select>
            <button onClick={prepararRodizio} className="h-9 rounded-lg bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-3">
              Gerar rodízio de inativos
            </button>
          </div>
        )}
      </div>

      {aviso && (
        <div className={`mb-3 rounded-xl border px-4 py-3 text-sm font-semibold flex items-start gap-3 ${aviso.ok ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-red-50 border-red-300 text-red-700'}`}>
          <span className="flex-1">{aviso.texto}</span>
          <button onClick={() => setAviso(null)} className="font-bold">×</button>
        </div>
      )}

      {/* Dash */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { t: 'Hoje', v: hojeLista.length, s: `${hojeLista.filter((a) => a.status === 'feito').length} feitos` },
          { t: `${MESES[mes.getMonth()]}`, v: doMes.length, s: `${doMes.filter((a) => a.status === 'feito').length} feitos` },
          { t: 'Pendentes', v: visiveis.filter((a) => a.status === 'pendente').length, s: 'no total' },
          { t: 'Atrasados', v: atrasados, s: 'pendentes de dias anteriores' },
        ].map((c) => (
          <div key={c.t} className="bg-white border border-line rounded-xl p-3">
            <div className="text-xs font-bold text-ink-soft uppercase">{c.t}</div>
            <div className="text-2xl font-extrabold text-ink">{c.v}</div>
            <div className="text-xs text-ink-soft">{c.s}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-[420px_1fr] gap-4">
        {/* Calendário */}
        <div className="bg-white border border-line rounded-xl p-3 self-start">
          <div className="flex items-center justify-between mb-2">
            <button onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))} className="w-8 h-8 rounded-lg border border-line font-bold">‹</button>
            <div className="font-extrabold text-ink">{MESES[mes.getMonth()]} {mes.getFullYear()}</div>
            <button onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))} className="w-8 h-8 rounded-lg border border-line font-bold">›</button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-ink-soft mb-1">
            {SEMANA.map((s) => <div key={s}>{s}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {celulas.map((d, i) => {
              if (!d) return <div key={i} />;
              const n = porDia.get(d)?.length ?? 0;
              const util = ehDiaUtil(d);
              const sel = d === dia;
              return (
                <button
                  key={d}
                  onClick={() => { setDia(d); setHora(''); }}
                  className={`h-14 rounded-lg border text-sm font-bold flex flex-col items-center justify-center ${sel ? 'border-teal-500 bg-teal-500/10 text-teal-600' : 'border-line'} ${util ? 'text-ink' : 'text-slate-300 bg-slate-50'} ${d === hoje ? 'ring-2 ring-blue-400' : ''}`}
                >
                  <span>{Number(d.slice(8))}</span>
                  {n > 0 && (
                    <span className="mt-0.5 text-[10px] font-extrabold text-white rounded-full px-1.5" style={{ background: `hsl(${200 - Math.round((n / maxDia) * 60)} 80% 45%)` }}>{n}</span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-ink-soft mt-2">O número em cada dia é a quantidade de contatos agendados.</p>
        </div>

        {/* Dia */}
        <div className="space-y-4">
          <div className="bg-white border border-line rounded-xl p-4">
            <div className="flex items-baseline gap-2 flex-wrap mb-3">
              <h2 className="text-base font-extrabold text-ink">{nomeDoDia(dia)}, {formatarDataCurta(dia)}</h2>
              <span className="text-xs text-ink-soft">{doDia.length} agendamento(s)</span>
              {ehAdmin && porVendNoDia.length > 0 && (
                <span className="text-xs text-ink-soft">· {porVendNoDia.map(([n, q]) => `${n}: ${q}`).join(' · ')}</span>
              )}
            </div>

            {!ehDiaUtil(dia) ? (
              <p className="text-sm text-ink-soft">Fim de semana — sem expediente. Escolha um dia útil.</p>
            ) : (
              <div className="grid md:grid-cols-2 gap-3">
                <div className="relative">
                  <label className="text-xs font-bold text-ink-soft">Cliente (código, nome ou telefone)</label>
                  <input
                    value={busca}
                    onChange={(e) => { setBusca(e.target.value); setCliente(null); }}
                    placeholder="Ex.: 4816 ou Maria"
                    className="w-full h-10 rounded-lg border border-line px-3 text-sm"
                  />
                  {resultados.length > 0 && (
                    <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-line rounded-lg shadow-lg max-h-64 overflow-auto">
                      {resultados.map((c) => (
                        <button key={c.id} onClick={() => { setCliente(c); setBusca(`${c.cod} - ${c.razao || c.nome || ''}`); }} className="w-full text-left px-3 py-2 text-sm hover:bg-surface border-b border-line last:border-0">
                          <b>{c.cod}</b> — {c.razao || c.nome} <span className="text-ink-soft text-xs">{c.telefone ?? 'sem telefone'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {cliente && (
                    <div className="mt-2 text-xs rounded-lg bg-surface p-2 space-y-0.5">
                      <div><b>{cliente.razao || cliente.nome}</b> · cód. {cliente.cod}</div>
                      <div>Telefone: {cliente.telefone || conversaCliente?.telefone || '—'} · {diasSemAtend(cliente) >= 9999 ? 'sem compra' : `${diasSemAtend(cliente)} dias sem compra`}</div>
                      <div>
                        {conversaCliente ? (
                          <>Chat: encontrado ({conversaCliente.nome}) · última conversa {new Date(conversaCliente.ultimaEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}{' '}
                            <button onClick={() => abrirChat(conversaCliente.telefone ?? conversaCliente.contato)} className="text-teal-600 font-bold underline">abrir no chat</button></>
                        ) : 'Chat: nenhuma conversa encontrada para este contato.'}
                      </div>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-ink-soft">Horário</label>
                    <select value={hora} onChange={(e) => setHora(e.target.value)} className="w-full h-10 rounded-lg border border-line px-2 text-sm bg-white">
                      <option value="">Selecione</option>
                      {horariosDia.map((h) => (
                        <option key={h} value={h} disabled={ocupados.has(h) || (dia === hoje && new Date(lembreteDe(dia, h)).getTime() < Date.now())}>
                          {h}{ocupados.has(h) ? ' (ocupado)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  {ehAdmin && (
                    <div>
                      <label className="text-xs font-bold text-ink-soft">Vendedor responsável</label>
                      <select value={vendDestino} onChange={(e) => setVendDestino(e.target.value)} className="w-full h-10 rounded-lg border border-line px-2 text-sm bg-white">
                        <option value="">Selecione</option>
                        {vendedoresAtivos.map((v) => (
                          <option key={v.id} value={v.login}>{v.nome}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs font-bold text-ink-soft">Observação (obrigatória) — o que foi conversado / motivo do retorno</label>
                  <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={3} className="w-full rounded-lg border border-line px-3 py-2 text-sm" />
                </div>
                <div className="md:col-span-2 flex items-center gap-3">
                  <button disabled={salvando} onClick={() => void salvar()} className="h-10 rounded-lg bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-4 disabled:opacity-60">
                    {salvando ? 'Salvando…' : 'Agendar contato'}
                  </button>
                  {erro && <span className="text-sm text-red-600 font-semibold">{erro}</span>}
                </div>
              </div>
            )}
          </div>

          <div className="bg-white border border-line rounded-xl p-4">
            <h3 className="text-sm font-extrabold text-ink mb-2">Contatos do dia</h3>
            {doDia.length === 0 ? (
              <p className="text-sm text-ink-soft">Nenhum agendamento neste dia.</p>
            ) : (
              <div className="divide-y divide-line">
                {doDia.map((a) => (
                  <div key={a.id} className="py-2 flex items-start gap-3 flex-wrap">
                    <div className="w-14 font-extrabold text-ink">{a.hora}</div>
                    <div className="flex-1 min-w-[220px]">
                      <div className="text-sm font-bold text-ink">{a.clienteNome} <span className="text-xs text-ink-soft font-normal">cód. {a.clienteCod}</span></div>
                      <div className="text-xs text-ink-soft">Vendedor: <b>{a.vendedorNome}</b> · {a.origem === 'rodizio' ? 'rodízio de inativos' : a.origem === 'admin' ? 'agendado pelo admin' : 'agendado pelo vendedor'}</div>
                      {a.obs && <div className="text-xs mt-0.5">📝 {a.obs}</div>}
                      {a.resultado && <div className="text-xs mt-0.5 text-emerald-700">✅ {a.resultado}</div>}
                    </div>
                    <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${a.status === 'feito' ? 'bg-emerald-100 text-emerald-700' : a.data < hoje ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                      {a.status === 'feito' ? 'Feito' : a.data < hoje ? 'Atrasado' : 'Pendente'}
                    </span>
                    <div className="flex gap-1">
                      {a.telefone && <button onClick={() => abrirChat(a.telefone)} className="text-xs font-bold border border-line rounded-lg px-2 py-1">Chat</button>}
                      {a.status === 'pendente' && <button onClick={() => { setConcluindo(a); setResultado(''); }} className="text-xs font-bold border border-emerald-300 text-emerald-700 rounded-lg px-2 py-1">Concluir</button>}
                      {(ehAdmin || a.status === 'pendente') && (
                        <button onClick={() => { if (empresaId && window.confirm('Excluir este agendamento?')) void removerAgendamento(empresaId, a.id); }} className="text-xs font-bold border border-line text-ink-soft rounded-lg px-2 py-1">Excluir</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {concluindo && (
        <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-5 shadow-xl">
            <h3 className="font-extrabold text-ink">Concluir contato — {concluindo.clienteNome}</h3>
            <label className="text-xs font-bold text-ink-soft mt-3 block">O que foi conversado?</label>
            <textarea value={resultado} onChange={(e) => setResultado(e.target.value)} rows={4} className="w-full rounded-lg border border-line px-3 py-2 text-sm" />
            <div className="flex gap-2 mt-3">
              <button disabled={!resultado.trim()} onClick={() => void concluir()} className="flex-1 rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold py-2 disabled:opacity-50">Salvar</button>
              <button onClick={() => setConcluindo(null)} className="flex-1 rounded-xl border border-line text-sm font-bold py-2">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {plano && (
        <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-5 shadow-xl">
            <h3 className="font-extrabold text-ink">Rodízio de clientes inativos</h3>
            <p className="text-sm text-ink-soft mt-2">
              Inativos disponíveis (mais de {diasInatividade} dias sem compra, com telefone, sem agendamento pendente): <b>{plano.inativosDisponiveis}</b>.
              São {INATIVOS_POR_DIA} por vendedor por dia útil, começando pelos de maior valor histórico.
            </p>
            {plano.itens.length === 0 ? (
              <p className="text-sm mt-3 text-red-600 font-semibold">Nada para agendar (sem inativos disponíveis ou sem vendedores ativos).</p>
            ) : (
              <>
                <p className="text-sm mt-3">Serão criados <b>{plano.itens.length}</b> agendamentos em {plano.dias.length} dia(s) útil(eis) ({formatarDataCurta(plano.dias[0])} a {formatarDataCurta(plano.dias[plano.dias.length - 1])}):</p>
                <ul className="text-sm mt-1 list-disc pl-5">
                  {Object.entries(plano.porVendedor).map(([n, q]) => <li key={n}>{n}: {q} clientes</li>)}
                </ul>
              </>
            )}
            <div className="flex gap-2 mt-4">
              <button disabled={plano.itens.length === 0} onClick={() => void confirmarRodizio()} className="flex-1 rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold py-2 disabled:opacity-50">Confirmar</button>
              <button onClick={() => setPlano(null)} className="flex-1 rounded-xl border border-line text-sm font-bold py-2">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
