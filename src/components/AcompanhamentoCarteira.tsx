import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ouvirClientes, ouvirEmpresa } from '../lib/crmData';
import { corrigirNonoDigito, ouvirTodasConversas } from '../lib/chatData';
import { criarAgendamentos, isoLocal, lembreteDe, ouvirAgenda, type Agendamento } from '../lib/agendaData';
import { DIAS_INATIVIDADE_PADRAO, diasEmAtendimento, faixaPorDias } from '../lib/crmLogic';
import type { Cliente, ConversaChat } from '../types';

const DIAS_SEM_CONTATO = 3;
const ult11 = (t?: string) => (t ?? '').replace(/\D/g, '').slice(-11);

/** Tela que "explode" para o vendedor: cliente ATIVO ou em RISCO da carteira dele há 3 dias (ou mais) sem contato.
 * Inativos não entram aqui — ficam no rodízio. Contato = conversa no chat, contato registrado aqui/na agenda ou compra. */
export default function AcompanhamentoCarteira() {
  const { empresa, sessaoVendedor } = useAuth();
  const navigate = useNavigate();
  const empresaId = empresa?.id;
  const login = sessaoVendedor?.vendedor.login;
  const nomeVend = sessaoVendedor?.vendedor.nome ?? '';
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [conversas, setConversas] = useState<ConversaChat[]>([]);
  const [agenda, setAgenda] = useState<Agendamento[]>([]);
  const [diasInat, setDiasInat] = useState<number>(empresa?.diasInatividade ?? DIAS_INATIVIDADE_PADRAO);
  const [agora, setAgora] = useState(() => Date.now());
  const [obs, setObs] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [recolhido, setRecolhido] = useState(false);
  const [, forcar] = useState(0);
  const chaveAdiar = `fluxa_acomp_${empresaId}_${login}`;

  useEffect(() => {
    if (!empresaId || !login) return;
    const offs = [
      ouvirClientes(empresaId, setClientes),
      ouvirTodasConversas(empresaId, setConversas),
      ouvirAgenda(empresaId, login, setAgenda),
      ouvirEmpresa(empresaId, (e) => setDiasInat(e?.diasInatividade ?? DIAS_INATIVIDADE_PADRAO)),
    ];
    return () => offs.forEach((o) => o && o());
  }, [empresaId, login]);

  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  const adiados = useMemo((): Record<string, string> => {
    try {
      return JSON.parse(localStorage.getItem(chaveAdiar) ?? '{}');
    } catch {
      return {};
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveAdiar, agora]);

  const devidos = useMemo(() => {
    if (!login) return [];
    const d = new Date(agora);
    const dow = d.getDay();
    const min = d.getHours() * 60 + d.getMinutes();
    const fim = dow === 5 ? 17 * 60 : 18 * 60;
    // só em dia/horário comercial (seg–qui 9–18, sex 9–17), fora do almoço
    if (dow < 1 || dow > 5 || min < 9 * 60 || min >= fim || (min >= 12 * 60 && min < 13 * 60)) return [];
    const hoje = isoLocal(d);
    const ultConversa = new Map<string, number>();
    for (const c of conversas) {
      const k = ult11(c.telefone ?? c.contato);
      const t = new Date(c.ultimaEm).getTime();
      if (k && !Number.isNaN(t) && t > (ultConversa.get(k) ?? 0)) ultConversa.set(k, t);
    }
    const ultAgenda = new Map<string, number>();
    const comPendente = new Set<string>();
    for (const a of agenda) {
      if (a.status === 'pendente') comPendente.add(a.clienteId);
      else {
        const t = new Date(a.feitoEm ?? a.criadoEm).getTime();
        if (t > (ultAgenda.get(a.clienteId) ?? 0)) ultAgenda.set(a.clienteId, t);
      }
    }
    const r: Array<{ c: Cliente; dias: number; ult: number }> = [];
    for (const c of clientes) {
      if (c.cod_vendedor !== login || !c.telefone) continue;
      if (faixaPorDias(diasEmAtendimento(c), diasInat) === 'inativo') continue; // inativo = rodízio
      if (comPendente.has(c.id) || adiados[c.id] === hoje) continue;
      const compra = c.dtUltCompra ? new Date(c.dtUltCompra).getTime() : 0;
      const ult = Math.max(ultConversa.get(ult11(c.telefone)) ?? 0, ultAgenda.get(c.id) ?? 0, Number.isNaN(compra) ? 0 : compra);
      const dias = ult ? Math.floor((agora - ult) / 86400000) : 9999;
      if (dias >= DIAS_SEM_CONTATO) r.push({ c, dias, ult });
    }
    return r.sort((a, b) => b.ult - a.ult); // do contato mais recente para o mais antigo
  }, [clientes, conversas, agenda, login, diasInat, agora, adiados]);

  const atual = devidos[0];
  useEffect(() => {
    if (!atual) return;
    setRecolhido(false);
    setObs('');
    try {
      const ctx = new AudioContext();
      const o = ctx.createOscillator();
      o.frequency.value = 660;
      o.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.35);
    } catch {
      /* sem áudio */
    }
  }, [atual?.c.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!atual || !empresaId || !login) return null;
  const { c, dias } = atual;
  const nome = c.razao || c.nome || c.cod;
  const faixa = faixaPorDias(diasEmAtendimento(c), diasInat);

  function adiarHoje() {
    const m = { ...adiados, [c.id]: isoLocal(new Date()) };
    try {
      localStorage.setItem(chaveAdiar, JSON.stringify(m));
    } catch {
      /* ignora */
    }
    forcar((n) => n + 1);
    setAgora(Date.now());
  }
  async function registrar() {
    if (!obs.trim() || !empresaId || !login) return;
    setSalvando(true);
    try {
      const agoraD = new Date();
      const hoje = isoLocal(agoraD);
      const hora = `${String(agoraD.getHours()).padStart(2, '0')}:${String(agoraD.getMinutes()).padStart(2, '0')}`;
      await criarAgendamentos(empresaId, [
        {
          data: hoje, hora, clienteId: c.id, clienteCod: c.cod, clienteNome: nome, telefone: c.telefone,
          vendedorLogin: login, vendedorNome: nomeVend, obs: `Acompanhamento de carteira (${dias >= 9999 ? 'sem contato registrado' : dias + ' dias sem contato'}).`,
          status: 'feito', origem: 'acompanhamento', criadoEm: agoraD.toISOString(), criadoPor: nomeVend,
          lembreteEm: lembreteDe(hoje, hora), resultado: obs.trim(), feitoEm: agoraD.toISOString(),
        },
      ]);
      setObs('');
    } finally {
      setSalvando(false);
    }
  }

  if (recolhido) {
    return (
      <div className="fixed bottom-4 left-4 z-[65] bg-white border-2 border-orange-400 rounded-2xl shadow-2xl p-3 max-w-xs">
        <div className="text-xs font-extrabold text-orange-600">📞 {devidos.length} cliente(s) sem contato</div>
        <div className="text-sm font-bold text-ink truncate">{nome}</div>
        <button onClick={() => setRecolhido(false)} className="mt-2 w-full rounded-lg bg-orange-500 text-white text-xs font-bold py-1.5">Voltar (registrar contato)</button>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-[65] bg-ink/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-br from-orange-500 to-red-500 text-white px-5 py-3 font-extrabold flex justify-between">
          <span>📞 Cliente da sua carteira sem contato</span>
          <span className="text-xs font-bold opacity-90">1 de {devidos.length}</span>
        </div>
        <div className="p-5 space-y-2">
          <div className="text-lg font-extrabold text-ink">{nome}</div>
          <div className="text-sm text-ink-soft">Cód. {c.cod} · {c.telefone}</div>
          <div className="text-sm">
            <span className={`font-bold ${faixa === 'risco' ? 'text-orange-600' : 'text-green-600'}`}>{faixa === 'risco' ? 'Em risco' : 'Ativo'}</span>
            {' · '}
            <b>{dias >= 9999 ? 'sem contato registrado' : `${dias} dias sem contato`}</b>
          </div>
          <label className="text-xs font-bold text-ink-soft block pt-1">O que foi conversado? (obrigatório para registrar)</label>
          <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={3} className="w-full rounded-lg border border-line px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <button
              onClick={() => { setRecolhido(true); navigate(`/chat?tel=${encodeURIComponent(corrigirNonoDigito(c.telefone!))}&nome=${encodeURIComponent(nome)}`); }}
              className="flex-1 rounded-xl border border-orange-500 text-orange-600 text-sm font-bold py-2"
            >
              Abrir no chat
            </button>
            <button disabled={!obs.trim() || salvando} onClick={() => void registrar()} className="flex-1 rounded-xl bg-gradient-to-br from-orange-500 to-red-500 text-white text-sm font-bold py-2 disabled:opacity-50">
              {salvando ? 'Salvando…' : 'Registrar contato'}
            </button>
          </div>
          <button onClick={adiarHoje} className="w-full text-xs font-bold text-ink-soft hover:text-ink pt-1">Lembrar amanhã</button>
        </div>
      </div>
    </div>
  );
}
