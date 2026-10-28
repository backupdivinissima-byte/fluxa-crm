import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { corrigirNonoDigito } from '../lib/chatData';
import { ouvirEmpresa } from '../lib/crmData';
import { descartarLead } from '../lib/prospectData';
import { atualizarAgendamento, ouvirAgenda, type Agendamento } from '../lib/agendaData';

/** Lembrete estilo Outlook: abre na hora marcada. O vendedor pode adiar UMA vez (5, 10 ou 15 min, no máximo 15). */
export default function AgendaLembrete() {
  const { empresa, sessaoVendedor, papel } = useAuth();
  const navigate = useNavigate();
  const empresaId = empresa?.id;
  const login = papel === 'admin' ? undefined : sessaoVendedor?.vendedor.login;
  const [lista, setLista] = useState<Agendamento[]>([]);
  const [rodizioProspect, setRodizioProspect] = useState<string>('ativo');
  const [agora, setAgora] = useState(() => Date.now());
  const [minutos, setMinutos] = useState(10);
  const [resultado, setResultado] = useState('');
  const [concluindo, setConcluindo] = useState(false);
  const tocado = useRef<string>('');
  // Lembrete recolhido (ao abrir o chat) — vira uma barrinha no canto até o vendedor concluir ou voltar a ele.
  const [recolhidos, setRecolhidos] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!empresaId || !login) return;
    return ouvirAgenda(empresaId, login, setLista, undefined, sessaoVendedor?.vendedor.nome);
  }, [empresaId, login, sessaoVendedor?.vendedor.nome]);

  useEffect(() => {
    if (!empresaId) return;
    return ouvirEmpresa(empresaId, (e) => setRodizioProspect(e?.prospectRodizio ?? 'ativo'));
  }, [empresaId]);

  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  const devido = lista
    .filter((a) => a.status === 'pendente' && new Date(a.lembreteEm).getTime() <= agora && !(a.prospect && rodizioProspect !== 'ativo'))
    .sort((a, b) => a.lembreteEm.localeCompare(b.lembreteEm))[0];

  useEffect(() => {
    if (!devido || tocado.current === devido.id + devido.lembreteEm) return;
    tocado.current = devido.id + devido.lembreteEm;
    try {
      const ctx = new AudioContext();
      const o = ctx.createOscillator();
      o.frequency.value = 880;
      o.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.4);
    } catch {
      /* sem áudio */
    }
    const titulo = document.title;
    document.title = '⏰ Contato agendado — ' + devido.clienteNome;
    return () => {
      document.title = titulo;
    };
  }, [devido]);

  if (!devido || !empresaId) return null;
  const chaveRec = devido.id + devido.lembreteEm;
  if (recolhidos.has(chaveRec)) {
    return (
      <div className="fixed bottom-4 right-4 z-[70] bg-white border-2 border-teal-500 rounded-2xl shadow-2xl p-3 max-w-xs">
        <div className="text-xs font-extrabold text-teal-600">⏰ Contato pendente</div>
        <div className="text-sm font-bold text-ink truncate">{devido.clienteNome}</div>
        <button
          onClick={() => setRecolhidos((r) => { const n = new Set(r); n.delete(chaveRec); return n; })}
          className="mt-2 w-full rounded-lg bg-gradient-to-br from-teal-500 to-blue-600 text-white text-xs font-bold py-1.5"
        >
          Voltar ao lembrete (concluir / adiar)
        </button>
      </div>
    );
  }

  async function adiar() {
    if (!devido || !empresaId) return;
    const m = Math.min(15, Math.max(1, minutos));
    await atualizarAgendamento(empresaId, devido.id, { adiado: true, lembreteEm: new Date(Date.now() + m * 60000).toISOString() });
  }
  async function descartarContato() {
    if (!devido || !empresaId || !devido.leadId) return;
    if (!window.confirm('Descartar este contato? Ele sai da sua tela e vai para Descartados no Prospect.')) return;
    try {
      await descartarLead(empresaId, devido.leadId);
      await atualizarAgendamento(empresaId, devido.id, { status: 'feito', resultado: 'Lead descartado: sem interesse.', feitoEm: new Date().toISOString() });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Não consegui descartar o contato.');
    }
  }
  async function concluir() {
    if (!devido || !empresaId || !resultado.trim()) return;
    await atualizarAgendamento(empresaId, devido.id, { status: 'feito', resultado: resultado.trim(), feitoEm: new Date().toISOString() });
    setResultado('');
    setConcluindo(false);
  }

  return (
    <div className="fixed inset-0 z-[70] bg-ink/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-br from-teal-500 to-blue-600 text-white px-5 py-3 font-extrabold">⏰ Hora de falar com o cliente</div>
        <div className="p-5 space-y-2">
          <div className="text-lg font-extrabold text-ink">{devido.clienteNome}</div>
          <div className="text-sm text-ink-soft">Cód. {devido.clienteCod} · {devido.telefone ?? 'sem telefone'}</div>
          <div className="text-sm text-ink-soft">Agendado para {devido.hora} ({devido.data.split('-').reverse().join('/')})</div>
          {devido.obs && <div className="text-sm bg-surface rounded-lg p-2">📝 {devido.obs}</div>}

          {concluindo ? (
            <>
              <label className="text-xs font-bold text-ink-soft block">O que foi conversado?</label>
              <textarea value={resultado} onChange={(e) => setResultado(e.target.value)} rows={3} className="w-full rounded-lg border border-line px-3 py-2 text-sm" />
              <div className="flex gap-2">
                <button disabled={!resultado.trim()} onClick={() => void concluir()} className="flex-1 rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold py-2 disabled:opacity-50">Salvar e concluir</button>
                <button onClick={() => setConcluindo(false)} className="flex-1 rounded-xl border border-line text-sm font-bold py-2">Voltar</button>
              </div>
            </>
          ) : (
            <div className="space-y-2 pt-2">
              <div className="flex gap-2">
                {devido.telefone && (
                  <button onClick={() => { setRecolhidos((r) => new Set(r).add(chaveRec)); navigate(`/chat?tel=${encodeURIComponent(corrigirNonoDigito(devido.telefone!))}&nome=${encodeURIComponent(devido.clienteNome)}`); }} className="flex-1 rounded-xl border border-teal-500 text-teal-600 text-sm font-bold py-2">Abrir no chat</button>
                )}
                <button onClick={() => setConcluindo(true)} className="flex-1 rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold py-2">Concluir</button>
              </div>
              {devido.leadId && (
                <button onClick={() => void descartarContato()} className="w-full rounded-xl border border-red-300 bg-red-50 text-red-700 text-sm font-bold py-2">🚫 Descartar contato (sem interesse)</button>
              )}
              {devido.adiado ? (
                <p className="text-xs text-ink-soft">Este lembrete já foi adiado uma vez — conclua o contato.</p>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">Adiar por</span>
                  <select value={minutos} onChange={(e) => setMinutos(Number(e.target.value))} className="h-9 rounded-lg border border-line px-2 text-sm bg-white">
                    {[5, 10, 15].map((m) => <option key={m} value={m}>{m} min</option>)}
                  </select>
                  <button onClick={() => void adiar()} className="h-9 rounded-lg border border-line text-sm font-bold px-3">Adiar (1 vez, máx. 15 min)</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
