import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ouvirClientes, ouvirEmpresa, atualizarCampoCliente, salvarCliente } from '../lib/crmData';
import { acaoDaColuna } from '../lib/crmLogic';
import {
  acharClientePorTelefone,
  assumirConversa,
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
import type { Cliente, ColunaCrm, ConexaoChat, ConversaChat, MensagemChat } from '../types';

const EMOJIS = ['😀','😁','😂','🤣','😊','😍','😘','😉','🙂','😎','🤩','🥰','😇','🤗','🤔','😅','😢','😭','😡','🙏','👍','👏','🙌','💪','👌','✌️','🤝','🎉','🎁','❤️','💖','💕','🔥','✨','⭐','🌟','💎','💍','👑','🛍️','💰','✅','❌','📦','🚚','📞','📅','⏰','🌹','🌸','☀️','🙋‍♀️','😴','🥳','😋','🤭'];

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
    <div className="bg-white border border-line rounded-2xl p-4">
      <div className="text-[11px] font-bold text-ink-soft uppercase tracking-wide">{titulo}</div>
      <div className="text-3xl font-extrabold text-ink mt-1 tabular-nums">{valor}</div>
      <div className="text-[11px] text-ink-soft mt-1">{dica}</div>
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
  const [erro, setErro] = useState('');
  const fimRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!empresaId) return;
    const u1 = ouvirConversas(empresaId, setConversas);
    const u2 = ouvirClientes(empresaId, setClientes);
    const u4 = ouvirEmpresa(empresaId, (e) => setColunas(e?.crmColunas ?? []));
    const u5 = ouvirConexaoWhatsapp(empresaId, setConexao);
    return () => {
      u1();
      u2();
      u4();
      u5();
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Cartao titulo="Aguardando atendimento" valor={aguardando} dica="Clientes sem vendedor esperando resposta" />
        <Cartao titulo="Em atendimento" valor={emAtendimento} dica="Conversas com um vendedor responsável" />
        <Cartao titulo="Abertas sem resposta" valor={semResposta} dica="A última mensagem foi do cliente" />
        <Cartao titulo="Clientes novos" valor={novos} dica="Contatos sem cadastro no CRM" />
      </div>

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
          {conexao.qr ? <img src={conexao.qr} alt="QR Code do WhatsApp" className="mt-4 w-56 h-56 border border-line rounded-lg" /> : null}
        </div>
      )}

      {erro && <p className="text-xs text-red-500">{erro}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 items-start">
        <div className="bg-white border border-line rounded-2xl overflow-hidden">
          <div className="flex border-b border-line text-xs font-bold">
            {(['todas', 'novos', 'minhas'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFiltro(f)}
                className={`flex-1 py-2.5 ${filtro === f ? 'text-teal-500 border-b-2 border-teal-500' : 'text-ink-soft'}`}
              >
                {f === 'todas' ? 'Todas' : f === 'novos' ? `Novos clientes${novos ? ` (${novos})` : ''}` : 'Minhas'}
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
                    <span className="font-bold text-sm text-ink truncate">{c.nome || c.telefone || c.contato}</span>
                    <span className="text-[11px] text-ink-soft shrink-0">{hora(c.ultimaEm)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-xs text-ink-soft truncate">{c.ultimaMensagem}</span>
                    {c.ultimaDe === 'cliente' && <span className="w-2 h-2 rounded-full bg-teal-500 shrink-0" title="Sem resposta" />}
                  </div>
                  <div className="text-[10px] text-ink-soft mt-1">
                    {NOME_CANAL[c.canal]} · {c.vendedorNome ? `com ${c.vendedorNome}` : 'livre'}
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
                  <div className="font-bold text-sm text-ink">{aberta.nome || aberta.telefone || aberta.contato}</div>
                  <div className="text-[11px] text-ink-soft">
                    {NOME_CANAL[aberta.canal]}
                    {aberta.telefone ? ` · ${aberta.telefone}` : ''}
                    {aberta.vendedorNome ? ` · atendimento de ${aberta.vendedorNome}` : ' · livre'}
                  </div>
                </div>
                {aberta.canal === 'whatsapp' && aberta.telefone && (
                  <a
                    href={`https://wa.me/${aberta.telefone.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Abre o WhatsApp (celular ou WhatsApp Desktop) para ligar por voz"
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
              <div className="flex-1 overflow-y-auto p-4 space-y-2 max-h-[420px]">
                {mensagens.map((m) => (
                  <div key={m.id} className={`flex ${m.de === 'equipe' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                        m.de === 'equipe' ? 'bg-teal-500/10 text-ink' : 'bg-surface text-ink'
                      }`}
                    >
                      <div className="whitespace-pre-wrap break-words">{m.texto}</div>
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
