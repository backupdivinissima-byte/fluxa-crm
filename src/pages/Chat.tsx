import { IconChat } from '../components/NavIcons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ouvirClientes, ouvirEmpresa, ouvirVendedores, atualizarCampoCliente, salvarCliente } from '../lib/crmData';
import { acaoDaColuna, tagAutomaticaCliente } from '../lib/crmLogic';
import { ouvirLeads, type Lead } from '../lib/prospectData';
import {
  acharClientePorTelefone,
  assumirConversa,
  definirTagsConversa,
  excluirTag,
  ouvirTags,
  registrarLigacao,
  salvarTag,
  salvarContatoChat,
  normalizarTelefone,
  editarContatoChat,
  cancelarAgendada,
  ouvirAgendadas,
  type MensagemAgendada,
  chaveTelefone,
  enviarMensagemChat,
  encaminharMensagem,
  enviarAudioChat,
  carregarMidiaPartes,
  enviarAnexoChat,
  transferirConversa,
  criarContatoChat,
  validarTelefoneWhatsApp,
  liberarConversa,
  ouvirConexaoWhatsapp,
  ouvirConversas,
  ouvirMensagens,
  ouvirSupervisora,
  type SugestaoSupervisora,
  solicitarConexaoWhatsapp,
} from '../lib/chatData';
import { CRM_COLUNAS_PADRAO } from '../types';
import type { Cliente, ColunaCrm, Vendedor, ConexaoChat, ConversaChat, MensagemChat, TagChat } from '../types';

const EMOJIS = ['😀','😁','😂','🤣','😊','😍','😘','😉','🙂','😎','🤩','🥰','😇','🤗','🤔','😅','😢','😭','😡','🙏','👍','👏','🙌','💪','👌','✌️','🤝','🎉','🎁','❤️','💖','💕','🔥','✨','⭐','🌟','💎','💍','👑','🛍️','💰','✅','❌','📦','🚚','📞','📅','⏰','🌹','🌸','☀️','🙋‍♀️','😴','🥳','😋','🤭'];

const PALETA = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899', '#64748b', '#78350f'];

// Tags de origem: entram sozinhas, conforme de onde o contato veio.
const ORIGENS = {
  whatsapp: { nome: 'WhatsApp', cor: '#22c55e' },
  instagram: { nome: 'Instagram', cor: '#d946ef' },
  facebook: { nome: 'Facebook', cor: '#3b82f6' },
  trafego: { nome: 'Tráfego', cor: '#f97316' },
} as const;
const origemDe = (c: ConversaChat): keyof typeof ORIGENS => c.origem ?? c.canal;

function Etiqueta({ nome, cor }: { nome: string; cor: string }) {
  return (
    <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: cor }}>
      {nome}
    </span>
  );
}

const NOME_CANAL = { whatsapp: 'WhatsApp', instagram: 'Instagram', facebook: 'Messenger' } as const;

function hora(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hoje = new Date();
  return d.toDateString() === hoje.toDateString()
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function Cartao({ titulo, valor, dica, cor, ativo, onClick }: { titulo: string; valor: number; dica: string; cor?: 'verde' | 'laranja' | 'azul'; ativo?: boolean; onClick?: () => void }) {
  const corValor = cor === 'verde' ? 'text-emerald-600' : cor === 'laranja' ? 'text-orange-500' : cor === 'azul' ? 'text-blue-600' : 'text-ink';
  return (
    <div
      className={`bg-white border rounded-xl px-3 py-2 ${onClick ? 'cursor-pointer hover:border-teal-400 select-none' : ''} ${ativo ? 'border-teal-500 ring-2 ring-teal-200' : 'border-line'}`}
      title={onClick ? `${dica} — clique para ver as conversas` : dica}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="text-[10px] font-bold text-ink-soft uppercase tracking-wide truncate">{titulo}</div>
      <div className={`text-xl font-extrabold tabular-nums ${corValor}`}>{valor}</div>
    </div>
  );
}

const ESTAGIOS: Record<string, string> = {
  descoberta: 'Descoberta',
  interesse: 'Interesse',
  objecao: 'Objeção',
  decisao: 'Decisão',
  pos_venda: 'Pós-venda',
  suporte: 'Suporte',
};

/** Painel da IA supervisora: só sugere. Quem edita e envia é a atendente. */
function PainelSupervisora({ sug, ultimaMsgId, aoUsar }: { sug: SugestaoSupervisora | null; ultimaMsgId?: string; aoUsar: (t: string) => void }) {
  const [copiado, setCopiado] = useState('');
  const atual = !!sug?.sugestao && (!ultimaMsgId || sug.paraMensagem === ultimaMsgId);
  const copiar = (t: string) => {
    void navigator.clipboard?.writeText(t).then(() => {
      setCopiado(t);
      setTimeout(() => setCopiado(''), 1500);
    });
  };
  const Bloco = ({ titulo, texto }: { titulo: string; texto: string }) => (
    <div className="rounded-xl border border-line bg-white p-3">
      <div className="text-[10px] font-bold text-ink-soft uppercase tracking-wide mb-1">{titulo}</div>
      <p className="text-sm text-ink whitespace-pre-wrap">{texto}</p>
      <div className="flex gap-3 mt-2 text-[11px] font-bold">
        <button onClick={() => aoUsar(texto)} className="text-teal-600 hover:underline">Usar na resposta</button>
        <button onClick={() => copiar(texto)} className="text-ink-soft hover:underline">{copiado === texto ? 'Copiado!' : 'Copiar'}</button>
      </div>
    </div>
  );
  return (
    <aside className="bg-violet-50/60 border border-violet-200 rounded-2xl flex flex-col min-h-[240px] lg:h-[var(--ph)] lg:min-h-[320px] overflow-hidden">
      <div className="px-4 py-3 border-b border-violet-200">
        <div className="font-bold text-sm text-violet-800">🧠 Supervisora de vendas</div>
        <div className="text-[11px] text-violet-700">Só sugere. Você decide o que enviar.</div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {!sug ? (
          <p className="text-xs text-ink-soft p-2">Quando a cliente escrever, a supervisora lê a conversa e a sugestão aparece aqui.</p>
        ) : sug.erro && !sug.sugestao ? (
          <p className="text-xs text-red-600 p-2">A supervisora não conseguiu analisar agora: {sug.erro}</p>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              {sug.estagio && <span className="text-[11px] font-bold bg-violet-600 text-white rounded-full px-2 py-0.5">{ESTAGIOS[sug.estagio] ?? sug.estagio}</span>}
              {sug.tecnica && <span className="text-[11px] font-bold text-violet-800 bg-violet-100 rounded-full px-2 py-0.5">{sug.tecnica}</span>}
              {!atual && <span className="text-[10px] text-ink-soft">sugestão anterior</span>}
            </div>
            {sug.leitura && <p className="text-xs text-ink-soft italic">{sug.leitura}</p>}
            {sug.atencao && <div className="rounded-xl bg-amber-50 border border-amber-200 p-2 text-xs text-amber-800">⚠️ {sug.atencao}</div>}
            {sug.sugestao && <Bloco titulo="Sugestão de resposta" texto={sug.sugestao} />}
            {sug.alternativa && <Bloco titulo="Outra opção" texto={sug.alternativa} />}
            {sug.dica && <p className="text-[11px] text-violet-800">💡 {sug.dica}</p>}
          </>
        )}
      </div>
    </aside>
  );
}

function IconeWhatsApp() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#25D366" />
      <path fill="#fff" d="M12 4.6a7.4 7.4 0 0 0-6.4 11.1L4.6 19.4l3.8-1a7.4 7.4 0 1 0 3.6-13.8Zm0 13.5a6.1 6.1 0 0 1-3.1-.9l-.2-.1-2.2.6.6-2.1-.1-.2A6.1 6.1 0 1 1 12 18.1Zm3.4-4.5c-.2-.1-1.1-.5-1.3-.6s-.3-.1-.4.1l-.6.7c-.1.1-.2.1-.4 0a5 5 0 0 1-2.5-2.2c-.2-.3.2-.3.5-1 .1-.1 0-.2 0-.3l-.6-1.4c-.1-.4-.3-.3-.4-.3h-.4a.7.7 0 0 0-.5.2 2.100 2.100 0 0 0-.7 1.600c0 .9.7 1.900.8 2a7.900 7.900 0 0 0 3 2.600c1.100.5 1.600.5 2.200.4.600-.1 1.300-.5 1.500-1 .2-.5.2-.9.1-1l-.4-.2Z" />
    </svg>
  );
}
/** Só os dois primeiros nomes (ex.: MIRIAM RODRIGUES DOS SANTOS → MIRIAM RODRIGUES). */
function doisNomes(nome?: string): string {
  return (nome ?? '').trim().split(/\s+/).slice(0, 2).join(' ');
}

/** Fluxa Chat: caixa única de atendimento (WhatsApp por QR Code; Instagram
 * Direct e Messenger entram na fase seguinte). O vendedor que abre a conversa
 * e clica em "Assumir" fica responsável por ela e pelo cliente no CRM. */
function baixar(url: string, nome: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const EXT_MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'video/mp4': 'mp4', 'audio/ogg': 'ogg', 'application/pdf': 'pdf' };
function nomeDoArquivo(m: MensagemChat): string {
  if (m.midiaNome) return m.midiaNome;
  const ext = EXT_MIME[m.midiaMime ?? ''] ?? (m.midiaTipo === 'imagem' ? 'jpg' : m.midiaTipo === 'video' ? 'mp4' : m.midiaTipo === 'audio' ? 'ogg' : 'bin');
  return `${m.midiaTipo ?? 'arquivo'}-${m.id.slice(0, 8)}.${ext}`;
}

/** Vídeo, documento ou áudio longo: só baixa as partes quando a pessoa clica. */
function MidiaPartes({ empresaId, conversaId, msg }: { empresaId: string; conversaId: string; msg: MensagemChat }) {
  const [url, setUrl] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [falha, setFalha] = useState('');
  const ehVideo = msg.midiaTipo === 'video';
  const ehDoc = msg.midiaTipo === 'documento';
  async function carregar(baixarDepois = false) {
    setCarregando(true);
    setFalha('');
    try {
      const u = url || (await carregarMidiaPartes(empresaId, conversaId, msg.id, msg.midiaMime || (ehVideo ? 'video/mp4' : ehDoc ? 'application/octet-stream' : 'audio/ogg')));
      setUrl(u);
      if (baixarDepois) baixar(u, nomeDoArquivo(msg));
    } catch (e) {
      setFalha(e instanceof Error ? e.message : 'Não foi possível carregar.');
    } finally {
      setCarregando(false);
    }
  }
  const botaoBaixar = (
    <button type="button" onClick={() => void carregar(true)} className="text-[11px] font-bold underline mt-0.5">
      {carregando ? 'Carregando…' : '⬇ Baixar'}
    </button>
  );
  if (ehDoc) {
    return (
      <div className="mb-1">
        <div className="text-sm">📄 {nomeDoArquivo(msg)}</div>
        {botaoBaixar}
        {falha && <span className="block text-[11px] text-red-500">{falha}</span>}
      </div>
    );
  }
  if (url) {
    return (
      <div className="mb-1">
        {ehVideo ? <video controls autoPlay src={url} className="rounded-lg max-h-72 max-w-full" /> : <audio controls autoPlay src={url} className="max-w-full" />}
        <button type="button" onClick={() => baixar(url, nomeDoArquivo(msg))} className="block text-[11px] font-bold underline mt-0.5">
          ⬇ Baixar
        </button>
      </div>
    );
  }
  return (
    <div className="mb-1">
      <button type="button" onClick={() => void carregar()} className="relative block text-left">
        {msg.midiaUrl && ehVideo && <img src={msg.midiaUrl} alt="Miniatura do vídeo" className="rounded-lg max-h-64 max-w-full" />}
        <span className={`${msg.midiaUrl && ehVideo ? 'absolute inset-0 flex items-center justify-center' : 'inline-flex'}`}>
          <span className="rounded-full bg-black/60 text-white text-xs font-bold px-3 py-2">
            {carregando ? 'Carregando…' : ehVideo ? '▶ Reproduzir vídeo' : '▶ Ouvir áudio'}
          </span>
        </span>
      </button>
      {botaoBaixar}
      {falha && <span className="block text-[11px] text-red-500 mt-1">{falha}</span>}
    </div>
  );
}

let ctxAudio: AudioContext | null = null;
function destravarAudio() {
  try {
    ctxAudio ??= new AudioContext();
    if (ctxAudio.state === 'suspended') void ctxAudio.resume();
  } catch {
    /* sem áudio */
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', destravarAudio);
  window.addEventListener('keydown', destravarAudio);
}
/** Toca uma campainha curta (dois tons) — o navegador só libera o som depois do primeiro clique na página. */
function tocarCampainha() {
  try {
    destravarAudio();
    const ctx = ctxAudio;
    if (!ctx || ctx.state !== 'running') return;
    [880, 1318].forEach((freq, i) => {
      const t0 = ctx.currentTime + i * 0.18;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.65);
    });
  } catch {
    /* sem áudio */
  }
}

export default function Chat() {
  // Altura dos painéis = o que sobra da tela abaixo do topo deles (sem rolar a página).
  const gradeRef = useRef<HTMLDivElement>(null);
  const [forcarQr, setForcarQr] = useState(false);
  const [alturaPainel, setAlturaPainel] = useState(560);
  useEffect(() => {
    const medir = () => {
      const el = gradeRef.current;
      if (!el) return;
      const topo = el.getBoundingClientRect().top + window.scrollY;
      setAlturaPainel(Math.max(320, Math.floor(window.innerHeight - topo - 16)));
    };
    medir();
    window.addEventListener('resize', medir);
    const t = window.setInterval(medir, 1500);
    return () => {
      window.removeEventListener('resize', medir);
      window.clearInterval(t);
    };
  }, []);
  const { empresa, papel, sessaoVendedor, perfil } = useAuth();
  const empresaId = empresa?.id;
  const souAdmin = papel === 'admin';
  const meuLogin = souAdmin ? '__admin__' : (sessaoVendedor?.vendedor.login ?? '');
  const meuNome = souAdmin ? (perfil?.nome ?? 'Administrador') : (sessaoVendedor?.vendedor.nome ?? '');

  const [conversas, setConversas] = useState<ConversaChat[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [leadsProspect, setLeadsProspect] = useState<Lead[]>([]);
  const [colunas, setColunas] = useState<ColunaCrm[]>([]);
  const [conexao, setConexao] = useState<ConexaoChat>({ status: 'desconectado' });
  const [filtroTag, setFiltroTag] = useState<string | null>(null); // 'origem:instagram' ou 'tag:<id>'
  const [filtro, setFiltro] = useState<'todas' | 'novos' | 'minhas' | 'aguardando' | 'atendimento' | 'semresposta' | 'alerta'>('todas');
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const [respondendo, setRespondendo] = useState<MensagemChat | null>(null);
  const [encaminhando, setEncaminhando] = useState<MensagemChat | null>(null);
  const [buscaEnc, setBuscaEnc] = useState('');
  const [avisoEnc, setAvisoEnc] = useState<{ ok: boolean; texto: string } | null>(null);
  // Vindo da Agenda: /chat?tel=NÚMERO abre a conversa desse telefone.
  const [params] = useSearchParams();
  const telParam = params.get('tel');
  const telAbertoRef = useRef<string | null>(null);
  const [erroAbrir, setErroAbrir] = useState('');
  const [mensagens, setMensagens] = useState<MensagemChat[]>([]);
  const [texto, setTexto] = useState('');
  const [sugSup, setSugSup] = useState<SugestaoSupervisora | null>(null);
  const [agendadas, setAgendadas] = useState<MensagemAgendada[]>([]);
  const [mostrarEmojis, setMostrarEmojis] = useState(false);
  const [mostrarRelogio, setMostrarRelogio] = useState(false);
  const [quando, setQuando] = useState(''); // datetime-local
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const [tags, setTags] = useState<TagChat[]>([]);
  const [gerenciarTags, setGerenciarTags] = useState(false);
  const [novaTag, setNovaTag] = useState('');
  const [telParear, setTelParear] = useState('');
  const [nomeContato, setNomeContato] = useState('');
  const [codigoCliente, setCodigoCliente] = useState('');
  const [editando, setEditando] = useState(false);
  const [vendedoresCrm, setVendedoresCrm] = useState<Vendedor[]>([]);
  const [transferindo, setTransferindo] = useState(false);
  const [novoContato, setNovoContato] = useState<{ nome: string; telefone: string } | null>(null);
  const [anexo, setAnexo] = useState<{ arquivo: File | Blob; nome: string; previa?: string } | null>(null);
  const [maisAnexos, setMaisAnexos] = useState<Array<{ arquivo: File | Blob; nome: string; previa?: string }>>([]);
  const [enviandoAnexo, setEnviandoAnexo] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [telContato, setTelContato] = useState('');
  const [novaCor, setNovaCor] = useState(PALETA[5]);
  const [erro, setErro] = useState('');
  const fimRef = useRef<HTMLDivElement>(null);
  const [fotoGrande, setFotoGrande] = useState<{ url: string; link?: string } | null>(null);
  const [gravando, setGravando] = useState(false);
  const [segGravacao, setSegGravacao] = useState(0);
  const gravadorRef = useRef<MediaRecorder | null>(null);
  const pedacosRef = useRef<Blob[]>([]);
  const enviarAoParar = useRef(true);

  useEffect(() => {
    if (!empresaId) return;
    const u1 = ouvirConversas(empresaId, setConversas);
    const u2 = ouvirClientes(empresaId, setClientes);
    const uV = ouvirVendedores(empresaId, setVendedoresCrm);
    const u4 = ouvirEmpresa(empresaId, (e) => setColunas(e?.crmColunas && e.crmColunas.length > 0 ? e.crmColunas : CRM_COLUNAS_PADRAO));
    const u5 = ouvirConexaoWhatsapp(empresaId, setConexao);
    const u6 = ouvirTags(empresaId, setTags);
    const uL = ouvirLeads(empresaId, setLeadsProspect);
    return () => {
      uL();
      u1();
      u2();
      uV();
      u4();
      u5();
      u6();
    };
  }, [empresaId]);

  useEffect(() => {
    if (!telParam || !empresaId) return;
    if (telAbertoRef.current === telParam) return;
    const fim = telParam.replace(/\D/g, '').slice(-8);
    const achada = fim.length >= 8 ? conversas.find((c) => (c.telefone ?? c.contato ?? '').replace(/\D/g, '').slice(-8) === fim) : undefined;
    if (achada) {
      telAbertoRef.current = telParam;
      setAbertaId(achada.id);
      return;
    }
    // Sem conversa na lista (cliente que nunca falou no chat): espera a lista carregar e abre/cria o contato.
    const t = setTimeout(async () => {
      if (telAbertoRef.current === telParam) return;
      telAbertoRef.current = telParam;
      try {
        const conv = await criarContatoChat(empresaId, params.get('nome') || telParam, telParam);
        setAbertaId(conv.id);
      } catch (e) {
        const msg = 'Não consegui abrir a conversa deste cliente: ' + (e instanceof Error ? e.message : String(e));
        setErro(msg);
        setErroAbrir(msg);
      }
    }, 3000);
    return () => clearTimeout(t);
  }, [telParam, conversas, empresaId, params]);

  useEffect(() => {
    if (!texto && campoRef.current) campoRef.current.style.height = 'auto';
  }, [texto]);

  useEffect(() => {
    setRespondendo(null); // resposta com citação vale só para a conversa em que foi iniciada
  }, [abertaId]);

  useEffect(() => {
    if (!empresaId || !abertaId) return;
    return ouvirMensagens(empresaId, abertaId, setMensagens);
  }, [empresaId, abertaId]);

  useEffect(() => {
    if (!empresaId || !abertaId) return;
    return ouvirAgendadas(empresaId, abertaId, setAgendadas);
  }, [empresaId, abertaId]);

  useEffect(() => {
    setSugSup(null);
    if (!empresaId || !abertaId) return;
    return ouvirSupervisora(empresaId, abertaId, setSugSup);
  }, [empresaId, abertaId]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: 'end' });
  }, [mensagens]);

  // O vendedor só enxerga as conversas livres e as dele; o admin vê todas.
  const visiveis = useMemo(
    () => (souAdmin ? conversas : conversas.filter((c) => !c.vendedorLogin || c.vendedorLogin === meuLogin)),
    [conversas, souAdmin, meuLogin]
  );
  // Novos = primeiro contato: ninguém assumiu e o telefone ainda não existe no CRM.
  // Novo contato = cliente que chamou pela PRIMEIRA vez (passivo, conversa criada por ele): ninguém atende, nunca foi
  // respondido, não está salvo e não tem cadastro no CRM.
  const ehNovo = (c: ConversaChat) =>
    (c.primeiroContato === true || c.origem === 'trafego') && !c.vendedorLogin && !c.clienteId && !c.salvo && !c.teveResposta && !acharClientePorTelefone(clientes, c.telefone);
  const lista = useMemo(
    () =>
      visiveis.filter((c) =>
        (filtroTag === null ||
          (filtroTag.startsWith('origem:') ? origemDe(c) === filtroTag.slice(7) : !!c.tags?.includes(filtroTag.slice(4)))) &&
        (filtro === 'novos'
          ? ehNovo(c)
          : filtro === 'minhas'
            ? (souAdmin ? !!c.vendedorLogin : c.vendedorLogin === meuLogin) // admin: soma as "Minhas" de todos os vendedores
            : filtro === 'aguardando'
              ? !c.vendedorLogin && c.ultimaDe === 'cliente'
              : filtro === 'atendimento'
                ? !!c.vendedorLogin
                : filtro === 'semresposta'
                  ? c.ultimaDe === 'cliente'
                  : filtro === 'alerta'
                    ? c.alertaEntrega === true
                    : true)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visiveis, filtro, filtroTag, meuLogin, clientes]
  );

  // Campainha: toca quando chega mensagem de um NOVO contato (conversa nova ou
  // nova mensagem de quem ainda é "novo contato"). A primeira carga da lista
  // só memoriza o que já existia, sem tocar.
  const novosVistosRef = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const atual = new Map<string, string>();
    for (const c of visiveis) if (ehNovo(c)) atual.set(c.id, c.ultimaEm);
    const antes = novosVistosRef.current;
    novosVistosRef.current = atual;
    if (antes === null || conversas.length === 0) return;
    for (const [id, em] of atual) {
      const c = visiveis.find((x) => x.id === id);
      if (c?.ultimaDe === 'cliente' && antes.get(id) !== em) {
        tocarCampainha();
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiveis, clientes]);

  const aguardando = visiveis.filter((c) => !c.vendedorLogin && c.ultimaDe === 'cliente').length;
  const emAtendimento = visiveis.filter((c) => !!c.vendedorLogin).length;
  const semResposta = visiveis.filter((c) => c.ultimaDe === 'cliente').length;
  const novos = visiveis.filter(ehNovo).length;
  // Mensagem que falhou e foi reenviada depois (pelo robô ou pela equipe) e chegou: o aviso vermelho deixa de valer.
  const reenviadaDepois = (m: MensagemChat) =>
    mensagens.some((n) => n.id !== m.id && n.de === 'equipe' && n.texto === m.texto && n.em > m.em && !n.erroEnvio && (n.entrega === 'entregue' || n.entrega === 'lida'));
  const comAlerta = visiveis.filter((c) => c.alertaEntrega === true).length;
  // Toca a campainha quando surge um novo alerta de entrega (a equipe percebe na hora).
  const alertasAntesRef = useRef(0);
  useEffect(() => {
    if (comAlerta > alertasAntesRef.current) tocarCampainha();
    alertasAntesRef.current = comAlerta;
  }, [comAlerta]);
  const minhasN = visiveis.filter((c) => (souAdmin ? !!c.vendedorLogin : c.vendedorLogin === meuLogin)).length;
  const porOrigem = (Object.keys(ORIGENS) as (keyof typeof ORIGENS)[]).map((k) => ({
    chave: k,
    ...ORIGENS[k],
    total: visiveis.filter((c) => origemDe(c) === k).length,
  }));
  const porTag = tags.map((t) => ({ ...t, total: visiveis.filter((c) => c.tags?.includes(t.id)).length }));

  // Ao abrir outra conversa, o campo de nome começa com o nome que chegou pronto.
  useEffect(() => {
    setNomeContato(aberta?.nome ?? aberta?.nomeSugerido ?? '');
    setTelContato(aberta?.telefone ?? '');
    setEditando(false);
    setAnexo(null);
    setMaisAnexos([]);
    setTransferindo(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abertaId]);

  useEffect(() => {
    setCodigoCliente('');
  }, [abertaId]);

  async function salvarContato() {
    if (!empresaId || !aberta) return;
    const cod = codigoCliente.trim().toLowerCase();
    if (!cod && !nomeContato.trim()) return;
    setErro('');
    try {
      if (cod) {
        // Com o código do cliente: puxa o cadastro do CRM e coloca em atendimento.
        const cli = clientes.find((c) => String(c.cod ?? '').trim().toLowerCase() === cod);
        if (!cli) {
          setErro('Código não encontrado no CRM.');
          return;
        }
        const colAtend = colunas.find((x) => acaoDaColuna(x) === 'atendimento');
        if (!colAtend) {
          setErro('Não há coluna "Em atendimento" configurada no CRM.');
          return;
        }
        if (aberta.vendedorLogin && aberta.vendedorLogin !== meuLogin && !souAdmin) {
          setErro(`Este atendimento é de ${aberta.vendedorNome}.`);
          return;
        }
        const login = souAdmin ? aberta.vendedorLogin || cli.crmVendedorLogin || cli.cod_vendedor : meuLogin;
        if (!login) {
          setErro('Assuma o atendimento ou atribua um vendedor ao cliente antes de salvar.');
          return;
        }
        const nomeVend = login === meuLogin ? meuNome : aberta.vendedorNome || cli.vend_nome || login;
        await atualizarCampoCliente(empresaId, cli.id, {
          ...(aberta.telefone ? { telefone: aberta.telefone } : {}),
          crmColunaId: colAtend.id,
          crmVendedorLogin: login,
          crmColunaChangedAt: new Date().toISOString(),
        });
        await salvarContatoChat(empresaId, aberta.id, cli.razao ?? cli.nome ?? nomeContato.trim());
        await assumirConversa(empresaId, aberta.id, login, nomeVend, cli.id);
        setCodigoCliente('');
        setEditando(false);
        return;
      }
      const nome = nomeContato.trim();
      if (editando) {
        const novoId = await editarContatoChat(empresaId, aberta.id, { nome, telefone: telContato.trim() || undefined });
        if (novoId !== aberta.id) setAbertaId(novoId);
        setEditando(false);
        return;
      }
      await salvarContatoChat(empresaId, aberta.id, nome);
      // Ao salvar o contato, ele passa a pertencer a quem salvou (se ainda não tiver dono).
      if (!aberta.vendedorLogin) await assumir({ ...aberta, nome });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar o contato.');
    }
  }

  async function criarTag() {
    const nome = novaTag.trim();
    if (!empresaId || !nome) return;
    setErro('');
    try {
      await salvarTag(empresaId, nome, novaCor);
      setNovaTag('');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar a tag.');
    }
  }

  async function alternarTag(c: ConversaChat, id: string) {
    if (!empresaId) return;
    const atuais = c.tags ?? [];
    const novas = atuais.includes(id) ? atuais.filter((x) => x !== id) : [...atuais, id];
    try {
      await definirTagsConversa(empresaId, c.id, novas);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível marcar a tag.');
    }
  }

  const aberta = conversas.find((c) => c.id === abertaId) ?? null;
  // Nome no cadastro do CRM (cliente ligado à conversa ou com o mesmo telefone) e nome salvo na agenda.
  const clienteCrm = aberta
    ? clientes.find((c) => c.id === aberta.clienteId) ?? (aberta.telefone ? acharClientePorTelefone(clientes, aberta.telefone) : undefined)
    : undefined;
  // Contato salvo no Fluxa Chat: o nome salvo manda (antes o nome sugerido da agenda/perfil do celular passava na frente e o nome "voltava").
  const nomeAgenda = aberta ? (aberta.salvo ? aberta.nome || aberta.nomeSugerido : aberta.nomeSugerido || aberta.nome) || '' : '';
  const donaDoAtendimento = aberta?.vendedorLogin && aberta.vendedorLogin !== meuLogin ? aberta.vendedorNome : '';

  async function assumir(c: ConversaChat) {
    if (!empresaId) return;
    setErro('');
    try {
      let clienteId = c.clienteId;
      const colAtend = colunas.find((x) => acaoDaColuna(x) === 'atendimento');
      if (c.telefone && colAtend && !souAdmin) {
        const existente = acharClientePorTelefone(clientes, c.telefone);
        const agora = new Date().toISOString();
        if (existente) {
          clienteId = existente.id;
          await atualizarCampoCliente(empresaId, existente.id, {
            crmColunaId: colAtend.id,
            crmVendedorLogin: meuLogin,
            crmColunaChangedAt: agora,
          });
        } else {
          // Contato novo: salva no CRM já em atendimento pelo vendedor.
          const k = chaveTelefone(c.telefone);
          clienteId = `chat-${k}`;
          await salvarCliente(empresaId, {
            id: clienteId,
            cod: clienteId,
            nome: c.nome,
            telefone: c.telefone,
            crmColunaId: colAtend.id,
            crmVendedorLogin: meuLogin,
            crmColunaChangedAt: agora,
          });
        }
      }
      await assumirConversa(empresaId, c.id, meuLogin, meuNome, clienteId);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível assumir o atendimento.');
    }
  }

  useEffect(() => {
    if (!gravando) return;
    const t = setInterval(() => {
      setSegGravacao((x) => {
        if (x + 1 >= 150) pararGravacao(true); // limite de 2min30 por áudio
        return x + 1;
      });
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gravando]);
  useEffect(() => {
    if (!fotoGrande) return;
    const f = (e: KeyboardEvent) => e.key === 'Escape' && setFotoGrande(null);
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [fotoGrande]);
  useEffect(() => () => pararGravacao(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  async function iniciarGravacao() {
    setErro('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { audioBitsPerSecond: 32000 });
      pedacosRef.current = [];
      enviarAoParar.current = true;
      rec.ondataavailable = (e) => e.data.size && pedacosRef.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setGravando(false);
        if (!enviarAoParar.current || !aberta || !empresaId) return;
        const blob = new Blob(pedacosRef.current, { type: rec.mimeType || 'audio/webm' });
        if (blob.size < 1500) return;
        if (blob.size > 650_000) {
          setErro('Áudio muito longo. Grave até 2 minutos.');
          return;
        }
        const leitor = new FileReader();
        leitor.onload = () => {
          void enviarAudioChat(empresaId, aberta, String(leitor.result), meuNome).catch((e) =>
            setErro(e instanceof Error ? e.message : 'Não foi possível enviar o áudio.')
          );
        };
        leitor.readAsDataURL(blob);
      };
      gravadorRef.current = rec;
      setSegGravacao(0);
      setGravando(true);
      rec.start();
    } catch {
      setErro('Não consegui usar o microfone. Permita o microfone no cadeado ao lado do endereço do site.');
    }
  }

  function pararGravacao(enviarAgora: boolean) {
    enviarAoParar.current = enviarAgora;
    const rec = gravadorRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
    gravadorRef.current = null;
  }

  function escolherAnexo(arquivo: File | Blob, nome: string) {
    setErro('');
    if (arquivo.size > 20_000_000) {
      setErro('Arquivo grande demais (limite de 20 MB).');
      return;
    }
    const novo = { arquivo, nome, previa: arquivo.type.startsWith('image/') ? URL.createObjectURL(arquivo) : undefined };
    // Já tem um anexo escolhido: os próximos entram na fila (vários de uma vez).
    if (anexo) setMaisAnexos((l) => (l.length < 19 ? [...l, novo] : l));
    else setAnexo(novo);
  }

  // Print colado (Ctrl+V) ou imagem copiada: vira anexo para confirmar.
  function aoColar(e: React.ClipboardEvent) {
    const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.kind === 'file');
    const arq = item?.getAsFile();
    if (arq && aberta && aberta.canal === 'whatsapp') {
      e.preventDefault();
      escolherAnexo(arq, arq.name && arq.name !== 'image.png' ? arq.name : `print-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`);
    }
  }

  async function enviarComAnexo() {
    if (!empresaId || !aberta || !anexo) return;
    setErro('');
    setEnviandoAnexo(true);
    try {
      // O primeiro leva a legenda; os demais seguem em sequência, na ordem escolhida.
      await enviarAnexoChat(empresaId, aberta, anexo.arquivo, anexo.nome, texto.trim(), meuNome);
      for (const extra of maisAnexos) await enviarAnexoChat(empresaId, aberta, extra.arquivo, extra.nome, '', meuNome);
      setAnexo(null);
      setMaisAnexos([]);
      setTexto('');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível enviar o anexo.');
    } finally {
      setEnviandoAnexo(false);
    }
  }

  async function cadastrarContato() {
    if (!empresaId || !novoContato) return;
    const nome = novoContato.nome.trim();
    if (!nome) {
      setErro('Informe o nome do contato.');
      return;
    }
    setErro('');
    try {
      const conversa = await criarContatoChat(empresaId, nome, novoContato.telefone);
      // Fica com quem cadastrou: assume o atendimento e (vendedor) entra no CRM em atendimento.
      if (!conversa.vendedorLogin) await assumir(conversa);
      setNovoContato(null);
      setFiltro('minhas');
      setAbertaId(conversa.id);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível cadastrar o contato.');
    }
  }

  async function transferir(v: Vendedor) {
    if (!empresaId || !aberta) return;
    setErro('');
    try {
      await transferirConversa(empresaId, aberta, aberta.vendedorNome || meuNome, { login: v.login, nome: v.nome });
      setTransferindo(false);
      if (!souAdmin) setAbertaId(null); // deixou de ser dele
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível transferir.');
    }
  }

  async function enviar() {
    if (anexo) return void enviarComAnexo();
    if (!empresaId || !aberta || !texto.trim()) return;
    setErro('');
    const t = texto.trim();
    let agendarPara: string | undefined;
    if (mostrarRelogio && quando) {
      const d = new Date(quando);
      if (Number.isNaN(d.getTime()) || d.getTime() < Date.now() + 30_000) {
        setErro('Escolha uma data e hora no futuro para agendar.');
        return;
      }
      agendarPara = d.toISOString();
    }
    setTexto('');
    setMostrarRelogio(false);
    setQuando('');
    setMostrarEmojis(false);
    try {
      const cit = respondendo ? { id: respondendo.id, texto: respondendo.texto && !respondendo.texto.startsWith('[') ? respondendo.texto : respondendo.midiaTipo === 'imagem' ? '📷 Foto' : respondendo.midiaTipo === 'audio' ? '🎤 Áudio' : respondendo.midiaTipo === 'video' ? '🎥 Vídeo' : respondendo.midiaTipo ? '📄 Arquivo' : respondendo.texto, de: respondendo.de, autor: respondendo.autor } : undefined;
      setRespondendo(null);
      await enviarMensagemChat(empresaId, aberta, t, meuNome, agendarPara, cit);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível enviar.');
    }
  }

  if (!empresaId) return null;

  return (
    <div className={`${souAdmin ? 'py-6' : 'py-3'} pr-6 pl-2 w-full space-y-3`}>
      {encaminhando && (
        <div className="fixed inset-0 z-[60] bg-ink/40 flex items-center justify-center p-4" onClick={() => setEncaminhando(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-extrabold text-ink">Encaminhar mensagem</h3>
            <div className="mt-2 rounded-lg bg-surface px-3 py-2 text-xs text-ink-soft line-clamp-3 whitespace-pre-wrap">{encaminhando.texto && !encaminhando.texto.startsWith('[') ? encaminhando.texto : encaminhando.midiaTipo ? `(${encaminhando.midiaTipo})` : encaminhando.texto}</div>
            <input value={buscaEnc} onChange={(e) => setBuscaEnc(e.target.value)} placeholder="Buscar conversa por nome ou telefone" className="mt-3 w-full h-10 rounded-lg border border-line px-3 text-sm" autoFocus />
            {avisoEnc && <div className={`mt-2 text-xs font-bold ${avisoEnc.ok ? 'text-emerald-700' : 'text-red-600'}`}>{avisoEnc.texto}</div>}
            <div className="mt-2 max-h-72 overflow-auto divide-y divide-line">
              {visiveis
                .filter((c) => c.id !== aberta?.id)
                .filter((c) => {
                  const q = buscaEnc.trim().toLowerCase();
                  const dig = q.replace(/\D/g, '');
                  return !q || (c.nome ?? '').toLowerCase().includes(q) || (dig.length >= 3 && (c.telefone ?? c.contato ?? '').replace(/\D/g, '').includes(dig));
                })
                .slice(0, 30)
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={async () => {
                      if (!empresaId || !encaminhando) return;
                      try {
                        await encaminharMensagem(empresaId, encaminhando, c, meuNome);
                        setAvisoEnc({ ok: true, texto: `✅ Encaminhada para ${c.nome || c.contato}.` });
                        setTimeout(() => setEncaminhando(null), 900);
                      } catch (e) {
                        setAvisoEnc({ ok: false, texto: e instanceof Error ? e.message : 'Não consegui encaminhar.' });
                      }
                    }}
                    className="w-full text-left py-2 px-1 hover:bg-surface text-sm"
                  >
                    <b>{c.nome || c.contato}</b> <span className="text-xs text-ink-soft">{c.telefone ?? c.contato}</span>
                  </button>
                ))}
            </div>
            <button onClick={() => setEncaminhando(null)} className="mt-3 w-full rounded-xl border border-line text-sm font-bold py-2">Fechar</button>
          </div>
        </div>
      )}
      {erroAbrir && (
        <div className="rounded-xl border border-red-300 bg-red-50 text-red-700 text-sm font-semibold px-4 py-3 flex items-start gap-3">
          <span className="flex-1">❌ {erroAbrir}</span>
          <button onClick={() => setErroAbrir('')} className="font-bold">×</button>
        </div>
      )}
      {!souAdmin && (
        <h1 className="text-base font-extrabold text-ink flex items-center gap-2">
          <IconChat /> Fluxa Chat
        </h1>
      )}
      {souAdmin && (
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-base font-extrabold text-ink mb-1">Fluxa Chat</h1>
          <p className="text-sm text-ink-soft">Atendimento de WhatsApp, Instagram Direct e Messenger em um só lugar — cada conversa traz a etiqueta do canal.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`rounded-full px-3 py-1 font-bold ${
              conexao.status === 'conectado' ? 'bg-emerald-100 text-emerald-700' : 'bg-surface text-ink-soft border border-line'
            }`}
          >
            WhatsApp: {conexao.status === 'conectado' ? `conectado${conexao.telefone ? ` (${conexao.telefone})` : ''}` : conexao.status === 'aguardando_qr' ? 'aguardando leitura do QR' : conexao.status === 'solicitado' ? 'gerando QR…' : 'desconectado'}
          </span>
          {conexao.saude && (
            <span
              title={`${conexao.saude.mensagem}\nRecebidas em 24 h: ${conexao.saude.recebidas24h ?? 0} · Enviadas: ${conexao.saude.enviadas24h ?? 0} · Quedas: ${conexao.saude.quedas24h ?? 0}${
                conexao.saude.verificadoEm ? `\nVerificado às ${new Date(conexao.saude.verificadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''
              }`}
              className={`rounded-full px-3 py-1 font-bold border ${
                conexao.saude.nivel === 'ok'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : conexao.saude.nivel === 'atencao'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-red-50 text-red-700 border-red-200'
              }`}
            >
              🤖 Robô: {conexao.saude.nivel === 'ok' ? 'tudo certo' : conexao.saude.nivel === 'atencao' ? 'atenção' : 'problema'}
              {conexao.saude.nivel !== 'ok' && ` — ${conexao.saude.mensagem}`}
            </span>
          )}
          {souAdmin && (
            <button onClick={() => setForcarQr((v) => !v)} className="rounded-full px-3 py-1 font-bold border border-line text-ink hover:bg-surface">
              {forcarQr ? 'Fechar conexão' : 'Reconectar WhatsApp'}
            </button>
          )}
          <span className="rounded-full px-3 py-1 bg-surface text-ink-soft border border-line">Instagram Direct: pelo servidor (Cloudflare)</span>
          <span className="rounded-full px-3 py-1 bg-surface text-ink-soft border border-line">Messenger: pelo servidor (Cloudflare)</span>
        </div>
      </div>
      )}

      {comAlerta > 0 && (
        <div className="rounded-xl border-2 border-red-400 bg-red-50 px-4 py-3 flex items-center justify-between gap-3 flex-wrap" role="alert">
          <div className="text-sm font-bold text-red-700">
            ⚠ {comAlerta} conversa{comAlerta > 1 ? 's' : ''} com mensagem que pode NÃO ter chegado ao cliente. O robô já está tentando reenviar.
          </div>
          <button onClick={() => setFiltro(filtro === 'alerta' ? 'todas' : 'alerta')} className="rounded-lg bg-red-600 text-white text-xs font-bold px-3 py-1.5 hover:bg-red-700">
            {filtro === 'alerta' ? 'Ver todas' : 'Ver quais'}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 items-stretch">
        <div className="space-y-2">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Cartao ativo={filtro === 'aguardando'} onClick={() => setFiltro(filtro === 'aguardando' ? 'todas' : 'aguardando')} titulo="Aguardando atendimento" valor={aguardando} dica="Clientes sem vendedor esperando resposta" />
        <Cartao ativo={filtro === 'atendimento'} onClick={() => setFiltro(filtro === 'atendimento' ? 'todas' : 'atendimento')} titulo="Em atendimento" valor={emAtendimento} dica="Conversas com um vendedor responsável" cor="verde" />
        <Cartao ativo={filtro === 'semresposta'} onClick={() => setFiltro(filtro === 'semresposta' ? 'todas' : 'semresposta')} titulo="Abertas sem resposta" valor={semResposta} dica="A última mensagem foi do cliente" cor="laranja" />
        <Cartao ativo={filtro === 'novos'} onClick={() => setFiltro(filtro === 'novos' ? 'todas' : 'novos')} titulo="Clientes novos" valor={novos} dica="Contatos sem cadastro no CRM" cor="azul" />
      </div>

      {souAdmin && (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {porOrigem.map((o) => (
          <Cartao key={o.chave} ativo={filtroTag === `origem:${o.chave}`} onClick={() => setFiltroTag(filtroTag === `origem:${o.chave}` ? null : `origem:${o.chave}`)} titulo={`Tag ${o.nome}`} valor={o.total} dica="Clientes com esta origem" />
        ))}
        {porTag.map((t) => (
          <Cartao key={t.id} ativo={filtroTag === `tag:${t.id}`} onClick={() => setFiltroTag(filtroTag === `tag:${t.id}` ? null : `tag:${t.id}`)} titulo={`Tag ${t.nome}`} valor={t.total} dica="Clientes com esta tag" />
        ))}
      </div>
      )}
        </div>
      </div>

      {souAdmin && (
        <div className="bg-white border border-line rounded-2xl p-4">
          <button onClick={() => setGerenciarTags((v) => !v)} className="text-sm font-extrabold text-ink">
            {gerenciarTags ? '▾' : '▸'} Cadastrar tags
          </button>
          {gerenciarTags && (
            <div className="mt-3 space-y-3">
              <p className="text-xs text-ink-soft">
                WhatsApp, Instagram, Facebook e Tráfego entram sozinhas conforme a origem do contato. As tags abaixo são as que a equipe escolhe ao atender (ex.: Novo cliente, Já é cliente, VIP).
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={novaTag}
                  onChange={(e) => setNovaTag(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void criarTag()}
                  placeholder="Nome da tag"
                  className="rounded-lg border border-line px-3 py-2 text-sm"
                />
                <div className="flex flex-wrap gap-1.5">
                  {PALETA.map((cor) => (
                    <button
                      key={cor}
                      type="button"
                      onClick={() => setNovaCor(cor)}
                      title={cor}
                      className={`w-6 h-6 rounded-full border-2 ${novaCor === cor ? 'border-ink' : 'border-transparent'}`}
                      style={{ background: cor }}
                    />
                  ))}
                </div>
                <button
                  onClick={() => void criarTag()}
                  disabled={!novaTag.trim()}
                  className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-4 py-2 disabled:opacity-60"
                >
                  Adicionar
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {tags.length === 0 && <span className="text-xs text-ink-soft">Nenhuma tag cadastrada ainda.</span>}
                {tags.map((t) => (
                  <span key={t.id} className="inline-flex items-center gap-1">
                    <Etiqueta nome={t.nome} cor={t.cor} />
                    <button
                      onClick={() => empresaId && void excluirTag(empresaId, t.id)}
                      className="text-[11px] text-red-500 font-bold"
                      title="Excluir tag"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {souAdmin && (conexao.status !== 'conectado' || forcarQr) && (
        <div className="bg-white border border-line rounded-2xl p-6">
          <h2 className="text-sm font-extrabold text-ink mb-1">Conectar o WhatsApp</h2>
          <p className="text-sm text-ink-soft mb-3 max-w-3xl">
            Clique em "Gerar QR Code" e, no celular, abra o WhatsApp → Aparelhos conectados → Conectar um aparelho e
            leia o código. Funciona como o WhatsApp Web. O conector precisa estar ligado no computador e conectado ao banco (veja chat-conector/LEIA-ME.md). Para um teste rápido sem banco, o QR aparece no terminal do conector.
          </p>
          <button
            onClick={() => {
              setErro('');
              solicitarConexaoWhatsapp(empresaId).catch((e) =>
                setErro(
                  `Não foi possível pedir o QR Code (${e instanceof Error ? e.message : 'erro'}). Se o banco estiver bloqueado pela cota diária, tente depois das 4h da manhã.`
                )
              );
            }}
            className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-4 py-2.5 hover:opacity-90"
          >
            Gerar QR Code
          </button>
          <div className="mt-5 pt-4 border-t border-line max-w-3xl">
            <p className="text-sm text-ink-soft mb-2">
              Não conseguiu ler o QR? Conecte pelo número: digite o número do WhatsApp com DDD, gere o código e, no celular, vá em Aparelhos conectados → Conectar um aparelho → <b>Conectar com número de telefone</b> e digite o código.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={telParear}
                onChange={(e) => setTelParear(e.target.value)}
                placeholder="DDD + número, ex.: 37 99999-9999"
                className="rounded-lg border border-line px-3 py-2 text-sm"
              />
              <button
                disabled={telParear.replace(/\D/g, '').length < 10}
                onClick={() => {
                  setErro('');
                  const d = telParear.replace(/\D/g, '');
                  solicitarConexaoWhatsapp(empresaId, d.startsWith('55') ? d : `55${d}`).catch((e) => setErro(e instanceof Error ? e.message : 'Erro ao pedir o código.'));
                }}
                className="rounded-xl border border-line text-ink text-sm font-bold px-4 py-2 hover:bg-surface disabled:opacity-60"
              >
                Gerar código
              </button>
            </div>
            {conexao.codigoPareamento ? (
              <div className="mt-3 text-3xl font-extrabold tracking-[0.3em] text-ink">{conexao.codigoPareamento}</div>
            ) : null}
            {conexao.erro ? <p className="mt-2 text-xs text-red-500">{conexao.erro}</p> : null}
          </div>
          {conexao.qr ? <img src={conexao.qr} alt="QR Code do WhatsApp" className="mt-4 w-80 h-80 bg-white border border-line rounded-lg" /> : null}
        </div>
      )}

      {erro && <p className="text-xs text-red-500">{erro}</p>}


      <div ref={gradeRef} style={{ ["--ph" as string]: `${alturaPainel}px` }} className="grid grid-cols-1 lg:grid-cols-[minmax(320px,440px)_minmax(0,1fr)] xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)_minmax(280px,340px)] gap-4 items-stretch">
        <div className="bg-white border border-line rounded-2xl overflow-hidden flex flex-col lg:h-[var(--ph)] lg:min-h-[320px]">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-line">
            <span className="text-xs font-bold text-ink flex items-center gap-1.5"><IconeWhatsApp />Conversas</span>
            <button
              onClick={() => setNovoContato({ nome: '', telefone: '' })}
              title="Cadastrar um cliente novo que ainda não chamou no WhatsApp"
              className="rounded-lg bg-gradient-to-br from-teal-500 to-blue-600 text-white text-xs font-bold px-3 py-1.5"
            >
              ➕ Novo contato
            </button>
          </div>
          <div className="flex border-b border-line text-xs font-bold">
            {(['todas', 'novos', 'minhas'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFiltro(f)}
                className={`flex-1 py-2.5 ${filtro === f ? 'text-teal-500 border-b-2 border-teal-500' : 'text-ink-soft'}`}
              >
                {f === 'todas' ? `Todas (${visiveis.length})` : f === 'novos' ? `Novo Contato (${novos})` : `Minhas (${minhasN})`}
              </button>
            ))}
          </div>
          {(filtro === 'aguardando' || filtro === 'atendimento' || filtro === 'semresposta' || filtro === 'alerta' || filtroTag !== null) && (
            <div className="flex items-center justify-between px-4 py-1.5 bg-teal-50 text-[11px] font-bold text-teal-700">
              <span>
                Mostrando: {[
                  filtro === 'aguardando' ? 'Aguardando atendimento' : filtro === 'atendimento' ? 'Em atendimento' : filtro === 'alerta' ? 'Com alerta de entrega' : filtro === 'semresposta' ? 'Abertas sem resposta' : '',
                  filtroTag === null ? '' : `Tag ${filtroTag.startsWith('origem:') ? ORIGENS[filtroTag.slice(7) as keyof typeof ORIGENS]?.nome ?? filtroTag.slice(7) : tags.find((t) => t.id === filtroTag.slice(4))?.nome ?? ''}`,
                ].filter(Boolean).join(' + ')} ({lista.length})
              </span>
              <button onClick={() => { setFiltro('todas'); setFiltroTag(null); }} className="underline">Limpar</button>
            </div>
          )}
          <ul className="flex-1 min-h-0 overflow-y-auto divide-y divide-line">
            {lista.length === 0 && <li className="p-6 text-sm text-ink-soft text-center">Nenhuma conversa por aqui.</li>}
            {lista.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => setAbertaId(c.id)}
                  className={`w-full text-left px-4 py-3 hover:bg-surface ${abertaId === c.id ? 'bg-surface' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-sm text-ink truncate">
                      {c.nome || c.telefone || c.contato}
                      {c.salvoNaAgenda && <span title="Salvo na agenda do celular"> 📒</span>}
                    </span>
                    <span className="text-[11px] text-ink-soft shrink-0">{hora(c.ultimaEm)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-xs text-ink-soft truncate">{c.ultimaMensagem}</span>
                    {c.ultimaDe === 'cliente' && <span className="w-2 h-2 rounded-full bg-teal-500 shrink-0" title="Sem resposta" />}
                    {c.alertaEntrega && <span className="text-[10px] font-bold text-red-600 shrink-0" title={c.alertaMotivo}>⚠ entrega</span>}
                  </div>
                  <div className="text-[10px] text-ink-soft mt-1">
                    {NOME_CANAL[c.canal]} · {c.vendedorNome ? `com ${doisNomes(c.vendedorNome)}` : 'livre'}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <Etiqueta nome={ORIGENS[origemDe(c)].nome} cor={ORIGENS[origemDe(c)].cor} />
                    {(() => {
                      const k = (c.telefone ?? '').replace(/\D/g, '').slice(-9);
                      const cli = (c.clienteId ? clientes.find((x) => x.id === c.clienteId) : undefined) ?? (k.length === 9 ? clientes.find((x) => (x.telefone ?? '').replace(/\D/g, '').slice(-9) === k) : undefined);
                      const auto = cli ? tagAutomaticaCliente(cli) : null;
                      const lead = !cli && k.length === 9 ? leadsProspect.find((l) => l.status !== 'descartado' && (l.whatsapp ?? '').slice(-9) === k) : undefined;
                      if (auto === 'prospect' || lead) return <Etiqueta nome="Prospect" cor="#F97316" />;
                      if (auto === 'novo') return <Etiqueta nome="Novo" cor="#16A34A" />;
                      return null;
                    })()}
                    {(c.tags ?? []).map((id) => {
                      const t = tags.find((x) => x.id === id);
                      return t ? <Etiqueta key={id} nome={t.nome} cor={t.cor} /> : null;
                    })}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-white border border-line rounded-2xl flex flex-col min-h-[420px] lg:h-[var(--ph)] lg:min-h-[320px]">
          {!aberta ? (
            <div className="m-auto text-sm text-ink-soft p-6">Escolha uma conversa na lista.</div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line">
                <div>
                  <div className="font-bold text-sm text-ink">
                    {nomeAgenda || (clienteCrm ? clienteCrm.razao ?? clienteCrm.nome : aberta.telefone || aberta.contato)}
                    {aberta.salvoNaAgenda && <span className="ml-2 text-[10px] font-bold text-emerald-600">📒 Salvo na agenda do celular</span>}
                  </div>
                  {clienteCrm && (clienteCrm.razao ?? clienteCrm.nome) && (clienteCrm.razao ?? clienteCrm.nome) !== nomeAgenda && <div className="text-[11px] text-ink-soft">Razão: {clienteCrm.razao ?? clienteCrm.nome}</div>}
                  {(aberta.telefone || clienteCrm?.telefone) && <div className="text-[11px] text-ink-soft">{aberta.telefone || clienteCrm?.telefone}</div>}
                  <div className="text-[11px] text-ink-soft">
                    {NOME_CANAL[aberta.canal]}
                    {aberta.vendedorNome ? ` · em atendimento por ${doisNomes(aberta.vendedorNome)}` : ' · livre'}
                  </div>
                </div>
                {aberta.canal === 'whatsapp' && (() => {
                  let num = (aberta.telefone || clienteCrm?.telefone || (aberta.contatoJid?.endsWith('@lid') ? '' : aberta.contato) || '').replace(/\D/g, '');
                  if (num && num.length <= 11) num = normalizarTelefone(num);
                  if (!num) {
                    return (
                      <button
                        onClick={() => setErro('Este contato ainda não tem telefone. Clique em "Editar contato", informe o número e salve para poder ligar.')}
                        title="Falta o telefone deste contato"
                        className="rounded-xl border border-line text-ink-soft text-xs font-bold px-3 py-2 hover:bg-surface"
                      >
                        Ligar pelo WhatsApp
                      </button>
                    );
                  }
                  return (
                    <a
                      href={`whatsapp://send?phone=${num}`}
                      title="Abre o aplicativo WhatsApp do computador nesta conversa; toque no ícone de telefone para ligar"
                      onClick={() =>
                        void registrarLigacao(empresaId, { tipo: 'feita', conversaId: aberta.id, vendedorLogin: meuLogin, vendedorNome: meuNome }).catch(() => {})
                      }
                      className="rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-700 text-xs font-bold px-3 py-2 hover:bg-emerald-100"
                    >
                      📞 Ligar pelo WhatsApp
                    </a>
                  );
                })()}
                {!aberta.vendedorLogin && !souAdmin && (
                  <button
                    onClick={() => void assumir(aberta)}
                    className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-xs font-bold px-3 py-2 hover:opacity-90"
                  >
                    Assumir atendimento
                  </button>
                )}
                {aberta.vendedorLogin && (souAdmin || aberta.vendedorLogin === meuLogin) && (
                  <button
                    onClick={() => setTransferindo(true)}
                    title="Passar este atendimento para outro vendedor"
                    className="rounded-xl border border-line text-ink text-xs font-bold px-3 py-2 hover:bg-surface"
                  >
                    🔁 Transferir
                  </button>
                )}
                {aberta.salvo && !editando && (
                  <button
                    onClick={() => {
                      setNomeContato(aberta.nome ?? '');
                      setTelContato(aberta.telefone ?? clienteCrm?.telefone ?? '');
                      setEditando(true);
                    }}
                    className="rounded-xl border border-line text-ink text-xs font-bold px-3 py-2 hover:bg-surface"
                  >
                    ✏️ Editar contato
                  </button>
                )}
                {aberta.vendedorLogin === meuLogin && (
                  <button
                    onClick={() => void liberarConversa(empresaId, aberta.id)}
                    className="rounded-xl border border-line text-ink text-xs font-bold px-3 py-2 hover:bg-surface"
                  >
                    Liberar
                  </button>
                )}
              </div>
              {(!aberta.salvo || !aberta.clienteId || editando) && (
                <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-line bg-amber-50 text-xs">
                  <input
                    value={codigoCliente}
                    onChange={(e) => setCodigoCliente(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void salvarContato()}
                    placeholder="Código do cliente"
                    title="Digite o código do cliente e clique em Salvar contato: ele entra no CRM em Em atendimento"
                    className="w-36 rounded-lg border border-line px-2 py-1.5 text-sm bg-white"
                  />
                  <span className="font-bold text-ink">{editando ? 'Editar contato:' : 'Pré-cadastro — salvar contato:'}</span>
                  <input
                    value={nomeContato}
                    onChange={(e) => setNomeContato(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void salvarContato()}
                    placeholder="Nome do contato"
                    className="rounded-lg border border-line px-2 py-1.5 text-sm bg-white"
                  />
                  <button
                    onClick={() => void salvarContato()}
                    disabled={!nomeContato.trim() && !codigoCliente.trim()}
                    className="rounded-lg bg-gradient-to-br from-teal-500 to-blue-600 text-white font-bold px-3 py-1.5 disabled:opacity-60"
                  >
                    {editando ? 'Salvar alterações' : 'Salvar contato'}
                  </button>
                  {editando && (
                    <input
                      value={telContato}
                      onChange={(e) => setTelContato(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && void salvarContato()}
                      placeholder="Telefone (DDD + número; exterior: +país)"
                      className="w-44 rounded-lg border border-line px-2 py-1.5 text-sm bg-white"
                    />
                  )}
                  {editando && telContato.trim() && validarTelefoneWhatsApp(telContato) && (
                    <span className="text-xs font-bold text-red-600">⚠ {validarTelefoneWhatsApp(telContato)}</span>
                  )}
                  {aberta.nomeSugerido && nomeContato.trim() !== aberta.nomeSugerido && (
                    <button onClick={() => setNomeContato(aberta.nomeSugerido ?? '')} className="text-ink-soft underline">
                      usar “{aberta.nomeSugerido}”
                    </button>
                  )}
                  {editando && (
                    <button onClick={() => setEditando(false)} className="text-ink-soft underline">
                      Cancelar
                    </button>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-line">
                <Etiqueta nome={ORIGENS[origemDe(aberta)].nome} cor={ORIGENS[origemDe(aberta)].cor} />
                <span className="text-[11px] text-ink-soft mx-1">Tags:</span>
                {tags.length === 0 && <span className="text-[11px] text-ink-soft">nenhuma cadastrada (o gerencial cadastra em "Cadastrar tags")</span>}
                {tags.map((t) => {
                  const marcada = aberta.tags?.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      onClick={() => void alternarTag(aberta, t.id)}
                      className="rounded-full px-2.5 py-0.5 text-[11px] font-bold border-2"
                      style={marcada ? { background: t.cor, borderColor: t.cor, color: '#fff' } : { borderColor: t.cor, color: t.cor }}
                    >
                      {t.nome}
                    </button>
                  );
                })}
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
                {mensagens.map((m) => (
                  <div key={m.id} className={`group flex items-start gap-1 ${m.de === 'equipe' ? 'justify-end' : 'justify-start'}`}>
                    {m.de === 'equipe' && (
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity pt-1 shrink-0">
                        <button type="button" title="Responder esta mensagem" onClick={() => { setRespondendo(m); campoRef.current?.focus(); }} className="text-[11px] font-bold border border-line rounded-lg px-1.5 py-0.5 bg-white">↩ Responder</button>
                        <button type="button" title="Encaminhar para outra conversa" onClick={() => { setEncaminhando(m); setBuscaEnc(''); setAvisoEnc(null); }} className="text-[11px] font-bold border border-line rounded-lg px-1.5 py-0.5 bg-white">➡ Encaminhar</button>
                      </div>
                    )}
                    <div
                      className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                        m.de === 'equipe' ? 'bg-teal-500/10 text-ink' : 'bg-surface text-ink'
                      }`}
                    >
                      {m.citada && (
                        <div className="mb-1 rounded-lg border-l-4 border-teal-500 bg-white/70 px-2 py-1 text-[11px] text-ink-soft">
                          <div className="font-bold text-teal-700">{m.citada.de === 'equipe' ? (m.citada.autor || 'Equipe') : 'Cliente'}</div>
                          <div className="line-clamp-2 whitespace-pre-wrap break-words">{m.citada.texto}</div>
                        </div>
                      )}
                      {m.midiaPartes && empresaId && aberta ? (
                        <MidiaPartes empresaId={empresaId} conversaId={aberta.id} msg={m} />
                      ) : null}
                      {!m.midiaPartes && m.midiaUrl && (
                        m.midiaTipo === 'audio' ? (
                          <audio controls src={m.midiaUrl} className="max-w-full mb-1" />
                        ) : (
                          <img
                            src={m.midiaUrl}
                            alt={m.midiaTipo === 'video' ? 'Miniatura do vídeo' : 'Foto'}
                            onClick={() => setFotoGrande({ url: m.midiaUrl as string, link: m.midiaLink })}
                            title="Clique para ampliar"
                            className="rounded-lg mb-1 max-h-64 max-w-full cursor-zoom-in"
                          />
                        )
                      )}
                      {!m.midiaPartes && m.midiaUrl && (m.midiaTipo === 'imagem' || m.midiaTipo === 'audio') && (
                        <button type="button" onClick={() => baixar(m.midiaUrl as string, nomeDoArquivo(m))} className="block text-[11px] font-bold underline mb-1">
                          ⬇ Baixar
                        </button>
                      )}
                      {m.midiaLink ? (
                        <a href={m.midiaLink} target="_blank" rel="noreferrer" className="block text-[11px] font-bold underline mb-1">
                          Abrir {m.midiaTipo === 'video' ? 'vídeo' : m.midiaTipo === 'audio' ? 'áudio' : m.midiaTipo === 'documento' ? 'documento' : 'foto'} completo no Drive
                        </a>
                      ) : (
                        m.midiaTipo === 'video' && !m.midiaPartes && <div className="text-[11px] italic mb-1">🎥 Vídeo (veja o original no celular)</div>
                      )}
                      {m.de === 'equipe' && m.autor && m.autor !== 'Celular' && (
                        <div className="text-[11px] font-bold text-teal-700 mb-0.5">{m.autor}</div>
                      )}
                      {(!m.midiaTipo || (m.texto && !m.texto.startsWith('['))) && <div className="whitespace-pre-wrap break-words">{m.texto}</div>}
                      {m.erroEnvio && (reenviadaDepois(m)
                        ? <div className="text-[11px] font-bold text-emerald-600 mt-1">✓✓ Reenviada e entregue</div>
                        : <div className="text-[11px] font-bold text-red-500 mt-1">⚠ Não chegou ao cliente: {m.erroEnvio}</div>)}
                      <div className="text-[10px] text-ink-soft mt-1">
                        {m.autor ? `${m.autor} · ` : ''}
                        {hora(m.em)}
                        {m.de === 'equipe' && m.autor !== 'Celular' && !m.erroEnvio && (
                          <span
                            className={`ml-1.5 font-bold ${m.entrega === 'lida' ? 'text-sky-500' : m.entrega === 'sem_confirmacao' ? 'text-orange-500' : (m.entrega === 'entregue' || m.entrega === 'reenviada_entregue') ? 'text-emerald-600' : 'text-ink-soft'}`}
                            title={
                              m.entrega === 'lida' ? 'Lida pelo cliente' : m.entrega === 'entregue' ? 'Entregue no WhatsApp do cliente'
                              : m.entrega === 'enviada' ? 'Enviada ao WhatsApp, aguardando chegar ao cliente'
                              : m.entrega === 'sem_confirmacao' ? 'O WhatsApp não confirmou — o robô está tentando de novo'
                              : m.entrega === 'reenviada_entregue' ? 'O robô reenviou e a mensagem foi entregue' : m.entrega === 'reenviada_pelo_robo' ? 'O robô reenviou esta mensagem' : 'Enviando…'
                            }
                          >
                            {m.entrega === 'lida' ? '✓✓ lida' : m.entrega === 'entregue' ? '✓✓ entregue' : m.entrega === 'reenviada_entregue' ? '🤖 ✓✓ reenviada e entregue' : m.entrega === 'enviada' ? '✓ enviada'
                              : m.entrega === 'sem_confirmacao' ? '⚠ sem confirmação' : m.entrega === 'reenviada_pelo_robo' ? '🤖 reenviada' : '⏳'}
                          </span>
                        )}
                      </div>
                    </div>
                    {m.de !== 'equipe' && (
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity pt-1 shrink-0">
                        <button type="button" title="Responder esta mensagem" onClick={() => { setRespondendo(m); campoRef.current?.focus(); }} className="text-[11px] font-bold border border-line rounded-lg px-1.5 py-0.5 bg-white">↩ Responder</button>
                        <button type="button" title="Encaminhar para outra conversa" onClick={() => { setEncaminhando(m); setBuscaEnc(''); setAvisoEnc(null); }} className="text-[11px] font-bold border border-line rounded-lg px-1.5 py-0.5 bg-white">➡ Encaminhar</button>
                      </div>
                    )}
                  </div>
                ))}
                <div ref={fimRef} />
              </div>
              <div className="border-t border-line p-3">
                {!aberta.vendedorLogin && !souAdmin ? (
                  <p className="text-xs text-ink-soft">Clique em "Assumir atendimento" para responder. O cliente entra no seu CRM em "Em Atendimento".</p>
                ) : donaDoAtendimento && !souAdmin ? (
                  <p className="text-xs text-ink-soft">Este atendimento é de {donaDoAtendimento}.</p>
                ) : (
                  <div className="space-y-2">
                    {texto.trim() && (
                      <div className="text-[11px] text-teal-700 font-bold">✍️ {meuNome} está respondendo este cliente…</div>
                    )}
                    {respondendo && (
                      <div className="flex items-start gap-2 rounded-lg border-l-4 border-teal-500 bg-surface px-3 py-1.5 text-[11px]">
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-teal-700">Respondendo a {respondendo.de === 'equipe' ? (respondendo.autor || 'equipe') : 'cliente'}</div>
                          <div className="truncate text-ink-soft">{respondendo.texto && !respondendo.texto.startsWith('[') ? respondendo.texto : respondendo.midiaTipo ? `(${respondendo.midiaTipo})` : respondendo.texto}</div>
                        </div>
                        <button type="button" onClick={() => setRespondendo(null)} className="font-bold text-ink-soft" title="Cancelar resposta">×</button>
                      </div>
                    )}
                    {agendadas.length > 0 && (
                      <ul className="space-y-1">
                        {agendadas.map((a) => (
                          <li key={a.id} className="flex items-center justify-between gap-2 text-[11px] bg-surface rounded-lg px-3 py-1.5">
                            <span className="truncate">
                              <b>Agendada para {new Date(a.agendadaPara).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}:</b> {a.texto}
                            </span>
                            <button
                              onClick={() => void cancelarAgendada(empresaId, a.id)}
                              className="text-red-500 font-bold shrink-0"
                              title="Cancelar o envio agendado"
                            >
                              Cancelar
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {mostrarEmojis && (
                      <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto border border-line rounded-lg p-2 bg-white">
                        {EMOJIS.map((e) => (
                          <button
                            key={e}
                            type="button"
                            onClick={() => {
                              setTexto((t) => t + e);
                              campoRef.current?.focus();
                            }}
                            className="text-xl w-8 h-8 rounded hover:bg-surface"
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                    )}
                    {mostrarRelogio && (
                      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                        <span className="font-bold text-ink">Enviar em:</span>
                        <input
                          type="datetime-local"
                          value={quando}
                          onChange={(e) => setQuando(e.target.value)}
                          className="rounded-lg border border-line px-2 py-1.5 text-sm"
                        />
                        <span>{quando ? 'Clique no avião para agendar.' : 'Escolha a data e a hora.'}</span>
                      </div>
                    )}
                    {anexo && (
                      <div className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
                        {anexo.previa ? (
                          <img src={anexo.previa} alt="Prévia" className="h-16 w-16 rounded object-cover" />
                        ) : (
                          <span className="text-2xl">📎</span>
                        )}
                        <div className="min-w-0 flex-1 text-xs">
                          <div className="font-bold text-ink truncate">{anexo.nome}</div>
                          <div className="text-ink-soft">Escreva uma legenda (opcional) e clique em enviar.</div>
                        </div>
                        <button type="button" onClick={() => { setAnexo(null); setMaisAnexos([]); }} className="text-xs font-bold text-ink-soft hover:text-red-600">
                          {maisAnexos.length > 0 ? 'Remover todos' : 'Remover'}
                        </button>
                      </div>
                    )}
                    {anexo && maisAnexos.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
                        <span className="text-xs font-bold text-ink">+{maisAnexos.length} arquivo(s) — {maisAnexos.length + 1} no total:</span>
                        {maisAnexos.map((x, i) => (
                          <span key={i} className="relative">
                            {x.previa ? <img src={x.previa} alt={x.nome} className="h-12 w-12 rounded object-cover" /> : <span className="inline-flex h-12 w-12 items-center justify-center rounded bg-white text-xl" title={x.nome}>📎</span>}
                            <button type="button" onClick={() => setMaisAnexos((l) => l.filter((_, j) => j !== i))} className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-white text-[10px] leading-4 font-bold" title="Tirar este arquivo">×</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <input
                      ref={arquivoRef}
                      type="file"
                      accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const lista = Array.from(e.target.files ?? []);
                        // escolherAnexo usa o estado atual: o 1º vira o anexo principal, os demais entram na fila.
                        lista.forEach((f, i) => {
                          if (i === 0) escolherAnexo(f, f.name);
                          else if (f.size <= 20_000_000) setMaisAnexos((l) => (l.length < 19 ? [...l, { arquivo: f, nome: f.name, previa: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined }] : l));
                        });
                        e.target.value = '';
                      }}
                    />
                    {gravando ? (
                      <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                        <span className="text-sm font-bold text-red-600 tabular-nums">
                          Gravando {Math.floor(segGravacao / 60)}:{String(segGravacao % 60).padStart(2, '0')}
                        </span>
                        <span className="flex-1" />
                        <button type="button" onClick={() => pararGravacao(false)} className="text-xs font-bold text-ink-soft hover:text-red-600">
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={() => pararGravacao(true)}
                          className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-xs font-bold px-4 py-2"
                        >
                          Enviar áudio
                        </button>
                      </div>
                    ) : (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setMostrarEmojis((v) => !v)}
                        title="Emojis"
                        className={`w-9 h-9 rounded-lg text-xl hover:bg-surface ${mostrarEmojis ? 'bg-surface' : ''}`}
                      >
                        😊
                      </button>
                      {aberta.canal === 'whatsapp' && (
                        <button
                          type="button"
                          onClick={() => arquivoRef.current?.click()}
                          title="Anexar foto, vídeo ou documento (ou cole um print com Ctrl+V)"
                          className="w-9 h-9 rounded-lg text-xl hover:bg-surface"
                        >
                          📎
                        </button>
                      )}
                      <textarea
                        ref={campoRef}
                        rows={1}
                        value={texto}
                        onChange={(e) => {
                          setTexto(e.target.value);
                          e.target.style.height = 'auto';
                          e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
                        }}
                        onKeyDown={(e) => {
                          // Enter envia; Shift+Enter pula linha na mesma mensagem.
                          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            void enviar();
                          }
                        }}
                        onPaste={aoColar}
                        placeholder={anexo ? 'Legenda (opcional)…' : mostrarRelogio ? 'Mensagem a agendar…' : 'Escreva sua resposta…  (Shift+Enter pula linha)'}
                        className="flex-1 rounded-lg border border-line px-3 py-2 text-sm resize-none max-h-40 leading-5"
                      />
                      <button
                        type="button"
                        onClick={() => setMostrarRelogio((v) => !v)}
                        title="Agendar mensagem"
                        className={`w-9 h-9 rounded-lg hover:bg-surface text-lg ${mostrarRelogio ? 'bg-teal-500/10 text-teal-500' : 'text-ink-soft'}`}
                      >
                        🕒
                      </button>
                      <button
                        onClick={() => void enviar()}
                        disabled={enviandoAnexo || (!anexo && !texto.trim()) || (mostrarRelogio && !quando)}
                        title={mostrarRelogio ? 'Agendar envio' : 'Enviar'}
                        className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white w-11 h-9 flex items-center justify-center disabled:opacity-60"
                      >
                        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 2 11 13" />
                          <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
                        </svg>
                      </button>
                      {aberta.canal === 'whatsapp' && !texto.trim() && !anexo && (
                        <button
                          type="button"
                          onClick={() => void iniciarGravacao()}
                          title="Gravar áudio"
                          className="w-9 h-9 rounded-lg text-xl hover:bg-surface"
                        >
                          🎤
                        </button>
                      )}
                    </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {aberta && (
          <div className="hidden xl:block">
            <PainelSupervisora
              sug={sugSup}
              ultimaMsgId={mensagens[mensagens.length - 1]?.id}
              aoUsar={(t) => setTexto(t)}
            />
          </div>
        )}
      </div>
      {novoContato && (
        <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4" onClick={() => setNovoContato(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-extrabold text-ink">Novo contato</h3>
            <p className="text-xs text-ink-soft mt-1 mb-3">
              Cadastre um cliente que ainda não chamou. Ele entra na agenda do Fluxa Chat e fica no seu nome.
            </p>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-ink-soft mb-1">Nome</label>
            <input
              autoFocus
              value={novoContato.nome}
              onChange={(e) => setNovoContato({ ...novoContato, nome: e.target.value })}
              placeholder="Nome do cliente"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm mb-3"
            />
            <label className="block text-[11px] font-bold uppercase tracking-wide text-ink-soft mb-1">Telefone (WhatsApp)</label>
            <input
              value={novoContato.telefone}
              onChange={(e) => setNovoContato({ ...novoContato, telefone: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && void cadastrarContato()}
              placeholder="DDD + número (exterior: +1 508 309 5403)"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm"
            />
            {novoContato.telefone.trim() && validarTelefoneWhatsApp(novoContato.telefone) && (
              <p className="mt-1 text-xs font-bold text-red-600">⚠ {validarTelefoneWhatsApp(novoContato.telefone)}</p>
            )}
            <div className="flex gap-2 mt-4">
              <button onClick={() => setNovoContato(null)} className="flex-1 rounded-xl border border-line text-sm font-bold py-2 hover:bg-surface">
                Cancelar
              </button>
              <button
                onClick={() => void cadastrarContato()}
                disabled={!novoContato.nome.trim() || !!validarTelefoneWhatsApp(novoContato.telefone)}
                className="flex-1 rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold py-2 disabled:opacity-60"
              >
                Cadastrar
              </button>
            </div>
          </div>
        </div>
      )}
      {transferindo && aberta && (
        <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4" onClick={() => setTransferindo(false)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-extrabold text-ink">Transferir atendimento</h3>
            <p className="text-xs text-ink-soft mt-1 mb-3">
              Escolha quem vai continuar a conversa com {clienteCrm?.razao ?? clienteCrm?.nome ?? aberta.nome}.
            </p>
            <ul className="max-h-72 overflow-y-auto divide-y divide-line border border-line rounded-xl">
              {vendedoresCrm
                .filter((v) => v.ativo !== false && v.login !== aberta.vendedorLogin)
                .sort((a, b) => a.nome.localeCompare(b.nome))
                .map((v) => (
                  <li key={v.id}>
                    <button
                      onClick={() => {
                        if (confirm(`Transferir este atendimento para ${v.nome}?`)) void transferir(v);
                      }}
                      className="w-full text-left px-4 py-2.5 text-sm font-bold text-ink hover:bg-surface"
                    >
                      {v.nome}
                    </button>
                  </li>
                ))}
              {vendedoresCrm.filter((v) => v.ativo !== false && v.login !== aberta.vendedorLogin).length === 0 && (
                <li className="px-4 py-3 text-sm text-ink-soft">Nenhum outro vendedor cadastrado.</li>
              )}
            </ul>
            <button onClick={() => setTransferindo(false)} className="mt-3 w-full rounded-xl border border-line text-sm font-bold py-2 hover:bg-surface">
              Cancelar
            </button>
          </div>
        </div>
      )}
      {fotoGrande && (
        <div className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center p-4" onClick={() => setFotoGrande(null)}>
          <button className="absolute top-4 right-5 text-white text-3xl leading-none" onClick={() => setFotoGrande(null)} title="Fechar">
            ×
          </button>
          <img src={fotoGrande.url} alt="Foto ampliada" className="max-h-[88vh] max-w-[94vw] rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
          <button
            type="button"
            className="mt-3 rounded-lg bg-white/15 text-white text-xs font-bold px-3 py-1.5 hover:bg-white/25"
            onClick={(e) => {
              e.stopPropagation();
              baixar(fotoGrande.url, `foto-${Date.now()}.jpg`);
            }}
          >
            ⬇ Baixar foto
          </button>
          {fotoGrande.link && (
            <a href={fotoGrande.link} target="_blank" rel="noreferrer" className="mt-3 text-xs font-bold text-white underline" onClick={(e) => e.stopPropagation()}>
              Abrir original no Drive
            </a>
          )}
        </div>
      )}
    </div>
  );
}
