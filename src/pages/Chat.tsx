import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ouvirClientes, ouvirEmpresa, atualizarCampoCliente, salvarCliente } from '../lib/crmData';
import { acaoDaColuna } from '../lib/crmLogic';
import {
  acharClientePorTelefone,
  assumirConversa,
  definirTagsConversa,
  excluirTag,
  ouvirTags,
  ouvirLigacoesHoje,
  registrarLigacao,
  type LigacaoChat,
  salvarTag,
  salvarContatoChat,
  cancelarAgendada,
  ouvirAgendadas,
  type MensagemAgendada,
  chaveTelefone,
  enviarMensagemChat,
  liberarConversa,
  ouvirConexaoWhatsapp,
  ouvirConversas,
  ouvirMensagens,
  solicitarConexaoWhatsapp,
} from '../lib/chatData';
import type { Cliente, ColunaCrm, ConexaoChat, ConversaChat, MensagemChat, TagChat } from '../types';

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

function Cartao({ titulo, valor, dica }: { titulo: string; valor: number; dica: string }) {
  return (
    <div className="bg-white border border-line rounded-xl px-3 py-2" title={dica}>
      <div className="text-[10px] font-bold text-ink-soft uppercase tracking-wide truncate">{titulo}</div>
      <div className="text-xl font-extrabold text-ink tabular-nums">{valor}</div>
    </div>
  );
}

/** Fluxa Chat: caixa única de atendimento (WhatsApp por QR Code; Instagram
 * Direct e Messenger entram na fase seguinte). O vendedor que abre a conversa
 * e clica em "Assumir" fica responsável por ela e pelo cliente no CRM. */
export default function Chat() {
  const { empresa, papel, sessaoVendedor, perfil } = useAuth();
  const empresaId = empresa?.id;
  const souAdmin = papel === 'admin';
  const meuLogin = souAdmin ? '__admin__' : (sessaoVendedor?.vendedor.login ?? '');
  const meuNome = souAdmin ? (perfil?.nome ?? 'Administrador') : (sessaoVendedor?.vendedor.nome ?? '');

  const [conversas, setConversas] = useState<ConversaChat[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [colunas, setColunas] = useState<ColunaCrm[]>([]);
  const [conexao, setConexao] = useState<ConexaoChat>({ status: 'desconectado' });
  const [filtro, setFiltro] = useState<'todas' | 'novos' | 'minhas'>('todas');
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<MensagemChat[]>([]);
  const [texto, setTexto] = useState('');
  const [agendadas, setAgendadas] = useState<MensagemAgendada[]>([]);
  const [mostrarEmojis, setMostrarEmojis] = useState(false);
  const [mostrarRelogio, setMostrarRelogio] = useState(false);
  const [quando, setQuando] = useState(''); // datetime-local
  const campoRef = useRef<HTMLInputElement>(null);
  const [tags, setTags] = useState<TagChat[]>([]);
  const [ligacoes, setLigacoes] = useState<LigacaoChat[]>([]);
  const [gerenciarTags, setGerenciarTags] = useState(false);
  const [novaTag, setNovaTag] = useState('');
  const [telParear, setTelParear] = useState('');
  const [nomeContato, setNomeContato] = useState('');
  const [novaCor, setNovaCor] = useState(PALETA[5]);
  const [erro, setErro] = useState('');
  const fimRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!empresaId) return;
    const u1 = ouvirConversas(empresaId, setConversas);
    const u2 = ouvirClientes(empresaId, setClientes);
    const u4 = ouvirEmpresa(empresaId, (e) => setColunas(e?.crmColunas ?? []));
    const u5 = ouvirConexaoWhatsapp(empresaId, setConexao);
    const u6 = ouvirTags(empresaId, setTags);
    const u7 = ouvirLigacoesHoje(empresaId, setLigacoes);
    return () => {
      u1();
      u2();
      u4();
      u5();
      u6();
      u7();
    };
  }, [empresaId]);

  useEffect(() => {
    if (!empresaId || !abertaId) return;
    return ouvirMensagens(empresaId, abertaId, setMensagens);
  }, [empresaId, abertaId]);

  useEffect(() => {
    if (!empresaId || !abertaId) return;
    return ouvirAgendadas(empresaId, abertaId, setAgendadas);
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
  const ehNovo = (c: ConversaChat) => !c.vendedorLogin && !c.clienteId && !acharClientePorTelefone(clientes, c.telefone);
  const lista = useMemo(
    () =>
      visiveis.filter((c) =>
        filtro === 'novos' ? ehNovo(c) : filtro === 'minhas' ? c.vendedorLogin === meuLogin : true
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visiveis, filtro, meuLogin, clientes]
  );

  const aguardando = visiveis.filter((c) => !c.vendedorLogin && c.ultimaDe === 'cliente').length;
  const emAtendimento = visiveis.filter((c) => !!c.vendedorLogin).length;
  const semResposta = visiveis.filter((c) => c.ultimaDe === 'cliente').length;
  const novos = visiveis.filter(ehNovo).length;
  const porOrigem = (Object.keys(ORIGENS) as (keyof typeof ORIGENS)[]).map((k) => ({
    chave: k,
    ...ORIGENS[k],
    total: visiveis.filter((c) => origemDe(c) === k).length,
  }));
  const porTag = tags.map((t) => ({ ...t, total: visiveis.filter((c) => c.tags?.includes(t.id)).length }));

  // Admin vê todas as ligações; vendedor, só as dele.
  const minhasLig = souAdmin ? ligacoes : ligacoes.filter((l) => l.vendedorLogin === meuLogin);
  const ligPorUsuario = Object.values(
    ligacoes.reduce<Record<string, { nome: string; feitas: number; recebidas: number }>>((acc, l) => {
      const nome = l.vendedorNome || 'Sem vendedor';
      acc[nome] ??= { nome, feitas: 0, recebidas: 0 };
      if (l.tipo === 'feita') acc[nome].feitas++;
      else acc[nome].recebidas++;
      return acc;
    }, {})
  );

  // Ao abrir outra conversa, o campo de nome começa com o nome que chegou pronto.
  useEffect(() => {
    setNomeContato(aberta?.nome ?? aberta?.nomeSugerido ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abertaId]);

  async function salvarContato() {
    if (!empresaId || !aberta || !nomeContato.trim()) return;
    setErro('');
    try {
      const nome = nomeContato.trim();
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

  async function enviar() {
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
      await enviarMensagemChat(empresaId, aberta, t, meuNome, agendarPara);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível enviar.');
    }
  }

  if (!empresaId) return null;

  return (
    <div className="p-6 w-full space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-base font-extrabold text-ink mb-1">Fluxa Chat</h1>
          <p className="text-sm text-ink-soft">Atendimento de WhatsApp, Instagram Direct e Messenger em um só lugar.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`rounded-full px-3 py-1 font-bold ${
              conexao.status === 'conectado' ? 'bg-emerald-100 text-emerald-700' : 'bg-surface text-ink-soft border border-line'
            }`}
          >
            WhatsApp: {conexao.status === 'conectado' ? `conectado${conexao.telefone ? ` (${conexao.telefone})` : ''}` : conexao.status === 'aguardando_qr' ? 'aguardando leitura do QR' : conexao.status === 'solicitado' ? 'gerando QR…' : 'desconectado'}
          </span>
          <span className="rounded-full px-3 py-1 bg-surface text-ink-soft border border-line">Instagram Direct: pelo servidor (Cloudflare)</span>
          <span className="rounded-full px-3 py-1 bg-surface text-ink-soft border border-line">Messenger: pelo servidor (Cloudflare)</span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-3 items-stretch">
        <div className="space-y-2">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Cartao titulo="Aguardando atendimento" valor={aguardando} dica="Clientes sem vendedor esperando resposta" />
        <Cartao titulo="Em atendimento" valor={emAtendimento} dica="Conversas com um vendedor responsável" />
        <Cartao titulo="Abertas sem resposta" valor={semResposta} dica="A última mensagem foi do cliente" />
        <Cartao titulo="Clientes novos" valor={novos} dica="Contatos sem cadastro no CRM" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {porOrigem.map((o) => (
          <Cartao key={o.chave} titulo={`Tag ${o.nome}`} valor={o.total} dica="Clientes com esta origem" />
        ))}
        {porTag.map((t) => (
          <Cartao key={t.id} titulo={`Tag ${t.nome}`} valor={t.total} dica="Clientes com esta tag" />
        ))}
      </div>
        </div>
        <div className="bg-white border border-line rounded-xl p-3 flex flex-col">
          <div className="text-[10px] font-bold text-ink-soft uppercase tracking-wide mb-2">Ligações pelo WhatsApp — hoje</div>
          <div className="grid grid-cols-2 gap-2 mb-2 flex-1">
            <div className="rounded-lg bg-surface px-3 py-2 flex flex-col justify-center">
              <div className="text-[10px] text-ink-soft font-bold">Feitas</div>
              <div className="text-3xl font-extrabold text-ink tabular-nums">{minhasLig.filter((l) => l.tipo === 'feita').length}</div>
            </div>
            <div className="rounded-lg bg-surface px-3 py-2 flex flex-col justify-center">
              <div className="text-[10px] text-ink-soft font-bold">Recebidas</div>
              <div className="text-3xl font-extrabold text-ink tabular-nums">{minhasLig.filter((l) => l.tipo === 'recebida').length}</div>
            </div>
          </div>
          {souAdmin && (
            <ul className="space-y-1 max-h-28 overflow-y-auto">
              {ligPorUsuario.length === 0 && <li className="text-[11px] text-ink-soft">Nenhuma ligação hoje.</li>}
              {ligPorUsuario.map((u) => (
                <li key={u.nome} className="flex justify-between text-[11px] text-ink">
                  <span className="truncate">{u.nome}</span>
                  <span className="tabular-nums shrink-0">{u.feitas} feitas · {u.recebidas} recebidas</span>
                </li>
              ))}
            </ul>
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

      {souAdmin && conexao.status !== 'conectado' && (
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

      <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,600px)] lg:justify-center gap-4 items-start">
        <div className="bg-white border border-line rounded-2xl overflow-hidden">
          <div className="flex border-b border-line text-xs font-bold">
            {(['todas', 'novos', 'minhas'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFiltro(f)}
                className={`flex-1 py-2.5 ${filtro === f ? 'text-teal-500 border-b-2 border-teal-500' : 'text-ink-soft'}`}
              >
                {f === 'todas' ? 'Todas' : f === 'novos' ? `Novo Contato${novos ? ` (${novos})` : ''}` : 'Minhas'}
              </button>
            ))}
          </div>
          <ul className="max-h-[560px] overflow-y-auto divide-y divide-line">
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
                  </div>
                  <div className="text-[10px] text-ink-soft mt-1">
                    {NOME_CANAL[c.canal]} · {c.vendedorNome ? `com ${c.vendedorNome}` : 'livre'}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <Etiqueta nome={ORIGENS[origemDe(c)].nome} cor={ORIGENS[origemDe(c)].cor} />
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

        <div className="bg-white border border-line rounded-2xl flex flex-col min-h-[420px]">
          {!aberta ? (
            <div className="m-auto text-sm text-ink-soft p-6">Escolha uma conversa na lista.</div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line">
                <div>
                  <div className="font-bold text-sm text-ink">
                    {aberta.nome || aberta.telefone || aberta.contato}
                    {aberta.salvoNaAgenda && <span className="ml-2 text-[10px] font-bold text-emerald-600">📒 Salvo na agenda do celular</span>}
                  </div>
                  {aberta.telefone && <div className="text-[11px] text-ink-soft">{aberta.telefone}</div>}
                  <div className="text-[11px] text-ink-soft">
                    {NOME_CANAL[aberta.canal]}
                    {aberta.vendedorNome ? ` · em atendimento por ${aberta.vendedorNome}` : ' · livre'}
                  </div>
                </div>
                {aberta.canal === 'whatsapp' && aberta.telefone && (
                  <a
                    href={`https://wa.me/${aberta.telefone.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Abre o WhatsApp (celular ou WhatsApp Desktop) para ligar por voz"
                    onClick={() =>
                      void registrarLigacao(empresaId, { tipo: 'feita', conversaId: aberta.id, vendedorLogin: meuLogin, vendedorNome: meuNome }).catch(() => {})
                    }
                    className="rounded-xl border border-line text-ink text-xs font-bold px-3 py-2 hover:bg-surface"
                  >
                    Ligar pelo WhatsApp
                  </a>
                )}
                {!aberta.vendedorLogin && !souAdmin && (
                  <button
                    onClick={() => void assumir(aberta)}
                    className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-xs font-bold px-3 py-2 hover:opacity-90"
                  >
                    Assumir atendimento
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
              {!aberta.salvo && (
                <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-line bg-amber-50 text-xs">
                  <span className="font-bold text-ink">Pré-cadastro — salvar contato:</span>
                  <input
                    value={nomeContato}
                    onChange={(e) => setNomeContato(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void salvarContato()}
                    placeholder="Nome do contato"
                    className="rounded-lg border border-line px-2 py-1.5 text-sm bg-white"
                  />
                  {aberta.nomeSugerido && nomeContato.trim() !== aberta.nomeSugerido && (
                    <button onClick={() => setNomeContato(aberta.nomeSugerido ?? '')} className="text-ink-soft underline">
                      usar “{aberta.nomeSugerido}”
                    </button>
                  )}
                  <button
                    onClick={() => void salvarContato()}
                    disabled={!nomeContato.trim()}
                    className="rounded-lg bg-gradient-to-br from-teal-500 to-blue-600 text-white font-bold px-3 py-1.5 disabled:opacity-60"
                  >
                    Salvar contato
                  </button>
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
              <div className="flex-1 overflow-y-auto p-4 space-y-2 max-h-[420px]">
                {mensagens.map((m) => (
                  <div key={m.id} className={`flex ${m.de === 'equipe' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                        m.de === 'equipe' ? 'bg-teal-500/10 text-ink' : 'bg-surface text-ink'
                      }`}
                    >
                      {m.midiaUrl && (
                        <img src={m.midiaUrl} alt={m.midiaTipo === 'video' ? 'Miniatura do vídeo' : 'Foto'} className="rounded-lg mb-1 max-h-64 max-w-full" />
                      )}
                      {m.midiaLink ? (
                        <a href={m.midiaLink} target="_blank" rel="noreferrer" className="block text-[11px] font-bold underline mb-1">
                          Abrir {m.midiaTipo === 'video' ? 'vídeo' : m.midiaTipo === 'audio' ? 'áudio' : m.midiaTipo === 'documento' ? 'documento' : 'foto'} completo no Drive
                        </a>
                      ) : (
                        m.midiaTipo === 'video' && <div className="text-[11px] italic mb-1">🎥 Vídeo (veja o original no celular)</div>
                      )}
                      {m.de === 'equipe' && m.autor && m.autor !== 'Celular' && (
                        <div className="text-[11px] font-bold text-teal-700 mb-0.5">{m.autor}</div>
                      )}
                      {(!m.midiaTipo || (m.texto && !m.texto.startsWith('['))) && <div className="whitespace-pre-wrap break-words">{m.texto}</div>}
                      <div className="text-[10px] text-ink-soft mt-1">
                        {m.autor ? `${m.autor} · ` : ''}
                        {hora(m.em)}
                      </div>
                    </div>
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
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setMostrarEmojis((v) => !v)}
                        title="Emojis"
                        className={`w-9 h-9 rounded-lg text-xl hover:bg-surface ${mostrarEmojis ? 'bg-surface' : ''}`}
                      >
                        😊
                      </button>
                      <input
                        ref={campoRef}
                        value={texto}
                        onChange={(e) => setTexto(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && void enviar()}
                        placeholder={mostrarRelogio ? 'Mensagem a agendar…' : 'Escreva sua resposta…'}
                        className="flex-1 rounded-lg border border-line px-3 py-2 text-sm"
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
                        disabled={!texto.trim() || (mostrarRelogio && !quando)}
                        title={mostrarRelogio ? 'Agendar envio' : 'Enviar'}
                        className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white w-11 h-9 flex items-center justify-center disabled:opacity-60"
                      >
                        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 2 11 13" />
                          <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
