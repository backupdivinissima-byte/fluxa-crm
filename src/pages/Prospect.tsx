import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { criarContatoChat, enviarMensagemChat, ouvirConexaoWhatsapp, solicitarConexaoWhatsapp } from '../lib/chatData';
import { modulosDaEmpresa } from '../lib/modulos';
import type { ConexaoChat } from '../types';
import { ouvirClientes } from '../lib/crmData';
import {
  atualizarLead,
  buscarLugares,
  consultarCnpj,
  googleConfigurado,
  notaDoLead,
  ouvirLeads,
  removerLead,
  salvarLead,
  type Lead,
  type StatusLead,
} from '../lib/prospectData';
import type { Cliente } from '../types';

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
const STATUS: Array<{ id: StatusLead; nome: string; cor: string }> = [
  { id: 'novo', nome: 'Novo', cor: 'bg-blue-100 text-blue-700' },
  { id: 'contatado', nome: 'Contatado', cor: 'bg-amber-100 text-amber-700' },
  { id: 'interessado', nome: 'Interessado', cor: 'bg-emerald-100 text-emerald-700' },
  { id: 'descartado', nome: 'Descartado', cor: 'bg-slate-100 text-slate-500' },
];
const fim9 = (s?: string) => (s ?? '').replace(/\D/g, '').slice(-9);
const corNota = (n: number) => (n >= 70 ? '#27AE60' : n >= 45 ? '#E67E22' : '#C0392B');

function Nota({ lead }: { lead: Lead }) {
  return (
    <span title={lead.motivos.join('\n')} className="inline-flex items-center justify-center min-w-[44px] h-7 rounded-full text-white text-xs font-extrabold px-2 cursor-help" style={{ background: corNota(lead.nota) }}>
      {lead.nota}
    </span>
  );
}

function erroDeSalvar(e: unknown): string {
  const t = e instanceof Error ? e.message : String(e);
  if (/permission|insufficient/i.test(t)) return 'Sem permissão para salvar: falta publicar a regra "prospectLeads" no Firestore (Firebase → Firestore Database → Regras). Veja as instruções que o Claude passou.';
  return 'Não consegui salvar o lead: ' + t;
}

export default function Prospect() {
  const { empresa, perfil } = useAuth();
  const navigate = useNavigate();
  const empresaId = empresa?.id;
  const temChat = !!empresa && modulosDaEmpresa(empresa).includes('chat');
  const [conexao, setConexao] = useState<ConexaoChat>({ status: 'desconectado' });
  const [pedindoQr, setPedindoQr] = useState<number | null>(null);
  const [mensagem, setMensagem] = useState<{ lead: Lead; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [aba, setAba] = useState<'buscar' | 'leads'>('buscar');
  const [termo, setTermo] = useState('loja de semijoias');
  const [cidade, setCidade] = useState('');
  const [uf, setUf] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState('');
  const [resultados, setResultados] = useState<Lead[]>([]);
  const [proxima, setProxima] = useState<string | undefined>();
  const [salvos, setSalvos] = useState<Lead[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);
  const [cnpjTxt, setCnpjTxt] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!empresaId) return;
    const a = ouvirLeads(empresaId, setSalvos, (m) => setErro('Não consegui ler os leads salvos: ' + m));
    const b = ouvirClientes(empresaId, setClientes);
    const c = ouvirConexaoWhatsapp(empresaId, setConexao);
    return () => {
      a();
      b();
      c();
    };
  }, [empresaId]);

  const telefonesClientes = useMemo(() => new Set(clientes.map((c) => fim9(c.telefone)).filter((t) => t.length === 9)), [clientes]);
  const idsSalvos = useMemo(() => new Set(salvos.map((l) => l.id)), [salvos]);
  const jaCliente = (l: Lead) => !!l.telefone && telefonesClientes.has(fim9(l.telefone));

  async function buscar(mais = false) {
    if (!termo.trim() || (!cidade.trim() && !uf)) {
      setErro('Diga o que procura e escolha a cidade, o estado (UF) ou "Todo o Brasil".');
      return;
    }
    setErro('');
    setBuscando(true);
    try {
      const r = await buscarLugares(termo.trim(), cidade.trim(), uf, mais ? proxima : undefined);
      setResultados((atual) => (mais ? [...atual, ...r.leads] : r.leads).sort((a, b) => b.nota - a.nota));
      setProxima(r.proxima);
      if (!mais && r.leads.length === 0) setErro('O Google não achou nada com essa busca. Tente outro termo ou cidade.');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui buscar agora.');
    } finally {
      setBuscando(false);
    }
  }

  async function guardar(l: Lead) {
    if (!empresaId) return;
    try {
      await salvarLead(empresaId, l);
      setMsg(`"${l.nome}" salvo em Meus leads.`);
    } catch (e) {
      setErro(erroDeSalvar(e));
    }
  }
  async function guardarTodos() {
    if (!empresaId) return;
    const novos = resultados.filter((l) => !idsSalvos.has(l.id) && !jaCliente(l));
    try {
      for (const l of novos) await salvarLead(empresaId, l);
      setMsg(`${novos.length} leads salvos (quem já é cliente ficou de fora).`);
    } catch (e) {
      setErro(erroDeSalvar(e));
    }
  }
  async function mudarStatus(l: Lead, status: StatusLead) {
    if (empresaId) await atualizarLead(empresaId, l.id, { status });
  }
  async function consultarReceita(l: Lead) {
    if (!empresaId) return;
    setErro('');
    try {
      const receita = await consultarCnpj(cnpjTxt);
      const { nota, motivos } = notaDoLead({ ...l, receita });
      await atualizarLead(empresaId, l.id, { cnpj: cnpjTxt.replace(/\D/g, ''), receita, nota, motivos });
      setMsg('Dados da Receita adicionados e nota recalculada.');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao consultar o CNPJ.');
    }
  }

  const [, tic] = useState(0);
  useEffect(() => {
    if (pedindoQr === null) return;
    const t = setInterval(() => tic((n) => n + 1), 3000);
    return () => clearInterval(t);
  }, [pedindoQr]);
  const qrDemora = pedindoQr !== null && !conexao.qr && conexao.status !== 'conectado' && Date.now() - pedindoQr > 25000;

  async function gerarQr() {
    if (!empresaId) return;
    setErro('');
    setPedindoQr(Date.now());
    try {
      await solicitarConexaoWhatsapp(empresaId);
    } catch (e) {
      setErro('Não foi possível pedir o QR Code: ' + (e instanceof Error ? e.message : 'erro'));
    }
  }
  function abrirNoChat(l: Lead) {
    navigate(`/chat?tel=${encodeURIComponent(l.whatsapp ?? '')}&nome=${encodeURIComponent(l.nome)}`);
  }
  function abrirMensagem(l: Lead) {
    setMensagem({
      lead: l,
      texto: `Olá! Aqui é ${perfil?.nome ?? 'a equipe'} da ${empresa?.nome ?? 'nossa empresa'}. Vi a ${l.nome} e queria te apresentar nossos produtos. Posso te enviar o catálogo?`,
    });
  }
  async function enviarPrimeira() {
    if (!empresaId || !mensagem || !mensagem.texto.trim()) return;
    setEnviando(true);
    try {
      const conversa = await criarContatoChat(empresaId, mensagem.lead.nome, mensagem.lead.whatsapp ?? '');
      await enviarMensagemChat(empresaId, conversa, mensagem.texto.trim(), perfil?.nome ?? 'Fluxa Prospect');
      await atualizarLead(empresaId, mensagem.lead.id, { status: 'contatado' }).catch(() => {});
      setMsg(`Mensagem enviada para ${mensagem.lead.nome}. As respostas chegam no seu WhatsApp.`);
      setMensagem(null);
    } catch (e) {
      setErro('Não consegui enviar: ' + (e instanceof Error ? e.message : 'erro'));
    } finally {
      setEnviando(false);
    }
  }


  function renderLinha(l: Lead, salvo: boolean, card = false) {
    const cli = jaCliente(l);
    const st = STATUS.find((s) => s.id === l.status)!;
    return (
      <div
        key={l.id}
        draggable={card}
        onDragStart={card ? (e) => e.dataTransfer.setData('text/plain', l.id) : undefined}
        className={card ? `bg-white border border-line rounded-xl p-3 flex flex-col gap-2 shadow-sm cursor-grab active:cursor-grabbing ${cli ? 'opacity-60' : ''}` : `py-3 flex gap-3 items-start ${cli ? 'opacity-60' : ''}`}
      >
        <Nota lead={l} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-extrabold text-ink">{l.nome}</span>
            {cli && <span className="text-[10px] font-bold uppercase rounded-full px-2 py-0.5 bg-violet-100 text-violet-700">Já é cliente</span>}
            {salvo && <span className={`text-[10px] font-bold uppercase rounded-full px-2 py-0.5 ${st.cor}`}>{st.nome}</span>}
          </div>
          <div className="text-xs text-ink-soft">{l.endereco}</div>
          <div className="text-xs mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {l.telefone && <span>📞 {l.telefone}{l.whatsapp ? ' (WhatsApp)' : ' (fixo)'}</span>}
            {l.site && <a href={l.site} target="_blank" rel="noreferrer" className="text-blue-600 underline">site</a>}
            {l.mapaUrl && <a href={l.mapaUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline">mapa</a>}
            {l.avaliacao && <span>⭐ {l.avaliacao} ({l.avaliacoes})</span>}
            {l.aberto === false && <span className="text-red-600 font-bold">fechada no Google</span>}
          </div>
          {l.receita && (
            <div className="text-[11px] text-ink-soft mt-0.5">
              Receita: {l.receita.razao} · {l.receita.situacao} · {l.receita.cnae} · {l.receita.porte}
            </div>
          )}
          {salvo && aberto === l.id && (
            <div className="mt-2 space-y-2 bg-surface rounded-lg p-2">
              <div className="flex gap-2 flex-wrap items-center">
                <input value={cnpjTxt} onChange={(e) => setCnpjTxt(e.target.value)} placeholder="CNPJ (14 números)" className="h-8 rounded-lg border border-line px-2 text-xs w-48" />
                <button onClick={() => void consultarReceita(l)} className="h-8 rounded-lg border border-line text-xs font-bold px-3 bg-white">Consultar na Receita</button>
              </div>
              <textarea
                defaultValue={l.obs ?? ''}
                onBlur={(e) => empresaId && e.target.value !== (l.obs ?? '') && void atualizarLead(empresaId, l.id, { obs: e.target.value })}
                rows={2}
                placeholder="Anotações sobre este lead…"
                className="w-full rounded-lg border border-line px-2 py-1 text-xs"
              />
              <div className="text-[11px] text-ink-soft">Nota: {l.motivos.join(' · ')}</div>
            </div>
          )}
        </div>
        <div className={card ? 'flex flex-wrap gap-1.5 items-center' : 'flex flex-col gap-1.5 shrink-0 items-end'}>
          {l.whatsapp && !cli && (
            temChat ? (
              <button onClick={() => abrirNoChat(l)} className="text-xs font-bold border border-emerald-300 text-emerald-700 rounded-lg px-3 py-1.5">Abrir no Chat</button>
            ) : conexao.status === 'conectado' ? (
              <button onClick={() => abrirMensagem(l)} className="text-xs font-bold border border-emerald-300 text-emerald-700 rounded-lg px-3 py-1.5">Enviar WhatsApp</button>
            ) : (
              <button onClick={() => document.getElementById('conectar-whatsapp')?.scrollIntoView({ behavior: 'smooth' })} className="text-xs font-bold border border-line text-ink-soft rounded-lg px-3 py-1.5" title="Conecte o seu WhatsApp para falar com os leads">Conectar WhatsApp</button>
            )
          )}
          {!salvo ? (
            !cli && !idsSalvos.has(l.id) ? (
              <button onClick={() => void guardar(l)} className="text-xs font-bold rounded-lg px-3 py-1.5 bg-gradient-to-br from-teal-500 to-blue-600 text-white">Salvar lead</button>
            ) : (
              idsSalvos.has(l.id) && <span className="text-[11px] text-ink-soft">salvo</span>
            )
          ) : (
            <>
              <select value={l.status} onChange={(e) => void mudarStatus(l, e.target.value as StatusLead)} className="h-8 rounded-lg border border-line px-1 text-xs bg-white">
                {STATUS.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
              <div className="flex gap-1">
                <button onClick={() => { setAberto(aberto === l.id ? null : l.id); setCnpjTxt(l.cnpj ?? ''); }} className="text-xs font-bold border border-line rounded-lg px-2 py-1">Detalhes</button>
                <button onClick={() => { if (empresaId && window.confirm('Remover este lead?')) void removerLead(empresaId, l.id); }} className="text-xs font-bold border border-line text-ink-soft rounded-lg px-2 py-1">Remover</button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 w-full">
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <h1 className="text-xl font-extrabold text-ink">Prospecção</h1>
        <span className="text-xs text-ink-soft">Encontre lojas, veja a nota de cada uma e salve as melhores como leads.</span>
        <div className="ml-auto flex bg-slate-100 rounded-lg p-0.5">
          {(['buscar', 'leads'] as const).map((a) => (
            <button key={a} onClick={() => setAba(a)} className={`px-3 h-8 rounded-md text-xs font-bold uppercase ${aba === a ? 'bg-white text-ink shadow-sm' : 'text-ink-soft'}`}>
              {a === 'buscar' ? 'Buscar' : `Meus leads (${salvos.length})`}
            </button>
          ))}
        </div>
      </div>

      {/* Dash */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 mb-3">
        {[
          { t: 'Leads salvos', v: salvos.length, s: 'no total' },
          { t: 'Novos', v: salvos.filter((l) => l.status === 'novo').length, s: 'ainda sem contato' },
          { t: 'Contatados', v: salvos.filter((l) => l.status === 'contatado').length, s: 'aguardando resposta' },
          { t: 'Interessados', v: salvos.filter((l) => l.status === 'interessado').length, s: 'quentes' },
          { t: 'Nota média', v: salvos.length ? Math.round(salvos.reduce((a, l) => a + l.nota, 0) / salvos.length) : 0, s: 'de 0 a 100' },
          { t: 'Com WhatsApp', v: salvos.filter((l) => !!l.whatsapp).length, s: `${salvos.filter((l) => l.nota >= 70).length} com nota 70+` },
        ].map((c) => (
          <div key={c.t} className="bg-white border border-line rounded-xl px-3 py-2">
            <div className="text-[11px] font-bold text-ink-soft uppercase">{c.t}</div>
            <div className="text-xl font-extrabold text-ink leading-tight">{c.v}</div>
            <div className="text-[11px] text-ink-soft">{c.s}</div>
          </div>
        ))}
      </div>

      {!googleConfigurado && (
        <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-800 text-sm px-4 py-3">
          A busca no Google ainda não foi ativada neste sistema (falta a chave do Google Places). Os leads já salvos continuam disponíveis.
        </div>
      )}
      {!temChat && conexao.status !== 'conectado' && (
        <div id="conectar-whatsapp" className="mb-3 bg-white border border-line rounded-xl p-4">
          <h2 className="text-sm font-extrabold text-ink mb-1">Conecte o seu WhatsApp para falar com os leads</h2>
          <p className="text-sm text-ink-soft mb-3 max-w-3xl">
            Clique em "Gerar QR Code" e, no celular, abra o WhatsApp → Aparelhos conectados → Conectar um aparelho e leia o código. Funciona como o WhatsApp Web.
          </p>
          <button onClick={() => void gerarQr()} className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-4 py-2.5">Gerar QR Code</button>
          {pedindoQr !== null && !conexao.qr && !qrDemora && <p className="text-xs text-ink-soft mt-2">Gerando o QR Code…</p>}
          {qrDemora && <p className="text-xs text-red-600 mt-2">O QR Code não apareceu: o conector de WhatsApp desta empresa ainda não foi ativado no servidor. Fale com o suporte do Fluxa para ativar.</p>}
          {conexao.erro && <p className="text-xs text-red-500 mt-2">{conexao.erro}</p>}
          {conexao.qr && <img src={conexao.qr} alt="QR Code do WhatsApp" className="mt-3 w-64 h-64 bg-white border border-line rounded-lg" />}
        </div>
      )}
      {!temChat && conexao.status === 'conectado' && (
        <div className="mb-3 text-xs font-bold rounded-full inline-block px-3 py-1 bg-emerald-100 text-emerald-700">WhatsApp conectado{conexao.telefone ? ` (${conexao.telefone})` : ''}</div>
      )}
      {mensagem && (
        <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-5 shadow-xl">
            <h3 className="font-extrabold text-ink">Primeira mensagem para {mensagem.lead.nome}</h3>
            <textarea value={mensagem.texto} onChange={(e) => setMensagem({ ...mensagem, texto: e.target.value })} rows={5} className="w-full mt-3 rounded-lg border border-line px-3 py-2 text-sm" />
            <div className="flex gap-2 mt-3">
              <button disabled={enviando || !mensagem.texto.trim()} onClick={() => void enviarPrimeira()} className="flex-1 rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold py-2 disabled:opacity-50">{enviando ? 'Enviando…' : 'Enviar'}</button>
              <button onClick={() => setMensagem(null)} className="flex-1 rounded-xl border border-line text-sm font-bold py-2">Cancelar</button>
            </div>
          </div>
        </div>
      )}
      {msg && <div className="mb-3 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-800 text-sm px-4 py-2 flex"><span className="flex-1">{msg}</span><button onClick={() => setMsg('')} className="font-bold">×</button></div>}
      {erro && <div className="mb-3 rounded-xl border border-red-300 bg-red-50 text-red-700 text-sm px-4 py-2 flex"><span className="flex-1">{erro}</span><button onClick={() => setErro('')} className="font-bold">×</button></div>}

      {aba === 'buscar' ? (
        <>
          <div className="bg-white border border-line rounded-xl p-4 mb-4 grid md:grid-cols-[2fr_2fr_150px_auto] gap-3 items-end">
            <div>
              <label className="text-xs font-bold text-ink-soft">O que procurar</label>
              <input value={termo} onChange={(e) => setTermo(e.target.value)} className="w-full h-10 rounded-lg border border-line px-3 text-sm" placeholder="Ex.: loja de semijoias" />
            </div>
            <div>
              <label className="text-xs font-bold text-ink-soft">Cidade (opcional se escolher o estado ou o Brasil)</label>
              <input value={cidade} onChange={(e) => setCidade(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void buscar()} className="w-full h-10 rounded-lg border border-line px-3 text-sm" placeholder="Ex.: Belo Horizonte — ou deixe vazio e escolha só o estado" />
            </div>
            <div>
              <label className="text-xs font-bold text-ink-soft">UF</label>
              <select value={uf} onChange={(e) => setUf(e.target.value)} className="w-full h-10 rounded-lg border border-line px-2 text-sm bg-white">
                <option value="">—</option>
                <option value="BR">Todo o Brasil</option>
                {UFS.map((u) => <option key={u}>{u}</option>)}
              </select>
            </div>
            <button disabled={buscando || !googleConfigurado} onClick={() => void buscar()} className="h-10 rounded-lg bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-5 disabled:opacity-50">
              {buscando ? 'Buscando…' : 'Buscar'}
            </button>
          </div>
          {resultados.length > 0 && (
            <div className="bg-white border border-line rounded-xl p-4">
              <div className="flex items-center gap-3 mb-1 flex-wrap">
                <h2 className="text-sm font-extrabold text-ink">{resultados.length} resultados (da maior para a menor nota)</h2>
                <button onClick={() => void guardarTodos()} className="ml-auto text-xs font-bold border border-teal-500 text-teal-600 rounded-lg px-3 py-1.5">Salvar todos</button>
              </div>
              <div className="divide-y divide-line">{resultados.map((l) => renderLinha(idsSalvos.has(l.id) ? salvos.find((s) => s.id === l.id) ?? l : l, false))}</div>
              {proxima && (
                <button disabled={buscando} onClick={() => void buscar(true)} className="mt-3 w-full h-10 rounded-lg border border-line text-sm font-bold">{buscando ? 'Buscando…' : 'Carregar mais 20'}</button>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 items-start">
          {STATUS.map((col) => {
            const itens = salvos.filter((l) => l.status === col.id).sort((x, y) => y.nota - x.nota);
            return (
              <div
                key={col.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const lead = salvos.find((x) => x.id === e.dataTransfer.getData('text/plain'));
                  if (lead && lead.status !== col.id) void mudarStatus(lead, col.id);
                }}
                className="bg-slate-50 border border-line rounded-xl p-2 min-h-[240px]"
              >
                <div className="flex items-center justify-between px-1 pb-2">
                  <span className={`text-xs font-extrabold uppercase rounded-full px-2.5 py-1 ${col.cor}`}>{col.nome}</span>
                  <span className="text-xs font-bold text-ink-soft">{itens.length}</span>
                </div>
                <div className="space-y-2 max-h-[75vh] overflow-y-auto">
                  {itens.length === 0 ? <p className="text-xs text-ink-soft px-1 py-4 text-center">Arraste leads para cá.</p> : itens.map((l) => renderLinha(l, true, true))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
