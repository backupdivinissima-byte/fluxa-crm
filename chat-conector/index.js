// Fluxa Chat — conector do WhatsApp (QR Code, como o WhatsApp Web).
// Roda FORA do navegador (no seu computador ou num servidor) e fica ligado:
//  - mostra o QR Code no Fluxa (Chat → Gerar QR Code);
//  - grava no Firestore as mensagens recebidas;
//  - envia as respostas que os vendedores escrevem no Fluxa.
// ATENÇÃO: usa uma biblioteca NÃO oficial. O WhatsApp não permite isso nos
// termos de uso e o número pode ser bloqueado. Use por sua conta e risco.
//
// Variáveis de ambiente:
//   EMPRESA_ID                       id da empresa no Fluxa
//   GOOGLE_APPLICATION_CREDENTIALS   caminho do .json da conta de serviço do Firebase
import fs from 'node:fs';
import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, downloadMediaMessage } from '@whiskeysockets/baileys';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import QRCode from 'qrcode';
import pino from 'pino';
import { guardarNoDrive, driveLigado } from './drive-midia.js';

// MODO TESTE: sem banco. Mostra o QR Code no terminal e escreve as mensagens
// recebidas na tela. Ativa com MODO_TESTE=1 ou quando não há credenciais.
const MODO_TESTE = process.env.MODO_TESTE === '1' || !process.env.GOOGLE_APPLICATION_CREDENTIALS;
const EMPRESA_ID = process.env.EMPRESA_ID || 'teste';
if (!MODO_TESTE && !process.env.EMPRESA_ID) throw new Error('Defina EMPRESA_ID.');
const PASTA_SESSAO = `./sessao-${EMPRESA_ID}`;

let base = null;
let refConexao = { set: async () => {}, onSnapshot: () => {} };
if (!MODO_TESTE) {
  initializeApp({ credential: applicationDefault() });
  base = getFirestore().collection('empresas').doc(EMPRESA_ID);
  refConexao = base.collection('chatConexoes').doc('whatsapp');
} else {
  console.log('>>> MODO TESTE: sem banco de dados. As mensagens só aparecem aqui no terminal.');
}
const log = pino({ level: 'warn' });

let sock = null;
let aberto = false;
let iniciando = false;
let telefoneParear = ''; // se definido, conecta por código em vez de QR
const enviadasPorNos = new Set();
// Nomes da agenda do celular (contatos salvos), por número.
const agenda = new Map();
const processando = new Set();

const agora = () => new Date().toISOString();
const soDigitos = (jid) => String(jid).split('@')[0].split(':')[0];

// O WhatsApp novo identifica contatos por @lid; quando traz o número (Alt), usamos ele.
function jidDe(msg) {
  const k = msg.key ?? {};
  const j = k.remoteJid ?? '';
  if (j.endsWith('@s.whatsapp.net')) return j;
  if (j.endsWith('@lid')) return k.remoteJidAlt?.endsWith('@s.whatsapp.net') ? k.remoteJidAlt : j;
  return null; // grupo, status, lista de transmissão...
}

function textoDe(msg) {
  const m = msg.message ?? {};
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    (m.imageMessage ? '[imagem]' : m.audioMessage ? '[áudio]' : m.videoMessage ? '[vídeo]' : m.documentMessage ? '[documento]' : m.stickerMessage ? '[figurinha]' : '[mensagem]')
  );
}

// Mídia: foto até ~600 KB vai dentro da própria mensagem; qualquer foto, vídeo,
// áudio ou documento também vai para o Google Drive (se estiver autorizado),
// e a conversa mostra o link. Sem Drive, vídeo fica só com a miniatura.
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'audio/ogg; codecs=opus': 'ogg', 'audio/mpeg': 'mp3', 'application/pdf': 'pdf' };
async function midiaDe(msg, numero) {
  const m = msg.message ?? {};
  const img = m.imageMessage;
  const vid = m.videoMessage;
  const aud = m.audioMessage;
  const doc = m.documentMessage;
  const alvo = img ?? vid ?? aud ?? doc;
  if (!alvo) return null;
  const tipo = img ? 'imagem' : vid ? 'video' : aud ? 'audio' : 'documento';
  const out = { midiaTipo: tipo };
  let buf = null;
  try {
    if (img || driveLigado()) buf = await downloadMediaMessage(msg, 'buffer', {}, { logger: log, reuploadRequest: sock.updateMediaMessage });
  } catch (e) {
    console.error('Mídia:', e.message);
  }
  if (buf) {
    if (img && buf.length <= 600_000) out.midiaUrl = `data:${img.mimetype || 'image/jpeg'};base64,${buf.toString('base64')}`;
    const nome = doc?.fileName || `${tipo}-${msg.key.id}.${EXT[alvo.mimetype] ?? 'bin'}`;
    const link = await guardarNoDrive(buf, nome, alvo.mimetype, numero);
    if (link) out.midiaLink = link;
  }
  if (!out.midiaUrl) {
    const th = (img ?? vid)?.jpegThumbnail;
    if (th) out.midiaUrl = `data:image/jpeg;base64,${Buffer.from(th).toString('base64')}`;
  }
  return out;
}

function lembrarContatos(lista) {
  for (const c of lista ?? []) {
    const id = c.id ?? '';
    if (!id.endsWith('@s.whatsapp.net') || !c.name) continue; // `name` = nome salvo na agenda
    const numero = soDigitos(id);
    agenda.set(numero, c.name);
    if (MODO_TESTE || !base) continue;
    // Se já existe conversa com esse número, atualiza o nome para o da agenda.
    base.collection('conversas').doc(`whatsapp_${numero}`).get().then((snap) => {
      if (!snap.exists) return;
      // Contato já salvo pela equipe no Fluxa: só atualiza a sugestão, nunca o nome.
      return snap.ref.set(snap.data()?.salvo ? { nomeSugerido: c.name } : { nome: c.name, nomeSugerido: c.name, salvoNaAgenda: true }, { merge: true });
    }).catch(() => {});
  }
}

// Histórico: o WhatsApp envia as conversas antigas uma vez, ao conectar o aparelho.
// Importa os últimos 30 dias (no máx. 3000 mensagens), sem mexer nas "não lidas".
const DIAS_HISTORICO = 30;
const MAX_HISTORICO = 3000;
async function importarHistorico(lista) {
  if (MODO_TESTE || !base || !lista?.length) return;
  const corte = Date.now() / 1000 - DIAS_HISTORICO * 86400;
  const porConversa = new Map();
  const jidsHist = new Map();
  let total = 0;
  for (const msg of lista) {
    const jid = jidDe(msg);
    const ts = Number(msg.messageTimestamp ?? 0);
    if (!jid || ts < corte || !msg.message) continue;
    if (total >= MAX_HISTORICO) break;
    const numero = soDigitos(jid);
    if (!porConversa.has(numero)) porConversa.set(numero, []);
    porConversa.get(numero).push(msg);
    jidsHist.set(numero, jid);
    total++;
  }
  console.log(`Importando histórico: ${total} mensagens de ${porConversa.size} conversas…`);
  for (const [numero, msgs] of porConversa) {
    try {
      msgs.sort((a, b) => Number(a.messageTimestamp) - Number(b.messageTimestamp));
      const ref = base.collection('conversas').doc(`whatsapp_${numero}`);
      const atual = (await ref.get()).data() ?? {};
      const mais = msgs[msgs.length - 1];
      const quandoUlt = new Date(Number(mais.messageTimestamp) * 1000).toISOString();
      const nomePush = msgs.find((m) => !m.key.fromMe && m.pushName)?.pushName;
      for (let i = 0; i < msgs.length; i += 400) {
        const lote = getFirestore().batch();
        for (const m of msgs.slice(i, i + 400)) {
          const quando = new Date(Number(m.messageTimestamp) * 1000).toISOString();
          lote.set(
            ref.collection('mensagens').doc(m.key.id),
            { de: m.key.fromMe ? 'equipe' : 'cliente', texto: textoDe(m), em: quando, ...(m.key.fromMe ? { autor: 'Celular' } : {}) },
            { merge: true }
          );
        }
        await lote.commit();
      }
      const novoUlt = !atual.ultimaEm || quandoUlt > atual.ultimaEm;
      await ref.set(
        {
          canal: 'whatsapp',
          contato: numero,
          ...(jidsHist.get(numero)?.endsWith('@lid') ? {} : { telefone: numero }),
          contatoJid: jidsHist.get(numero),
          ...(agenda.has(numero) ? { nome: agenda.get(numero), nomeSugerido: agenda.get(numero), salvoNaAgenda: true } : !atual.nome ? { nome: nomePush || numero, ...(nomePush ? { nomeSugerido: nomePush } : {}) } : {}),
          ...(novoUlt ? { ultimaMensagem: textoDe(mais), ultimaEm: quandoUlt, ultimaDe: mais.key.fromMe ? 'equipe' : 'cliente' } : {}),
        },
        { merge: true }
      );
    } catch (e) {
      console.error('Histórico:', numero, e.message);
    }
  }
  console.log('Histórico importado.');
}

async function guardarMensagem(msg) {
  const jid = jidDe(msg);
  if (!jid) return; // ignora grupos, status e listas
  if (msg.key.fromMe && enviadasPorNos.has(msg.key.id)) return;
  const numero = soDigitos(jid);
  const texto = textoDe(msg);
  const quando = new Date(Number(msg.messageTimestamp ?? Date.now() / 1000) * 1000).toISOString();
  const deCliente = !msg.key.fromMe;
  if (MODO_TESTE) {
    console.log(`[${deCliente ? 'RECEBIDA' : 'ENVIADA'}] ${msg.pushName || numero} (${numero}): ${texto}`);
    return;
  }
  const midia = await midiaDe(msg, numero);
  const conversaRef = base.collection('conversas').doc(`whatsapp_${numero}`);
  const jaSalvo = !!(await conversaRef.get()).data()?.salvo; // nome confirmado pela equipe
  const sugestao = agenda.get(numero) ?? (deCliente ? msg.pushName : undefined);
  await conversaRef.set(
    {
      canal: 'whatsapp',
      contato: numero,
      ...(jid.endsWith('@lid') ? {} : { telefone: numero }),
      contatoJid: jid,
      ...(sugestao ? { nomeSugerido: sugestao } : {}),
      ...(!jaSalvo && sugestao ? { nome: sugestao } : {}),
      ...(agenda.has(numero) ? { salvoNaAgenda: true } : {}),
      ultimaMensagem: texto,
      ultimaEm: quando,
      ultimaDe: deCliente ? 'cliente' : 'equipe',
      ...(deCliente ? { naoLidas: FieldValue.increment(1) } : {}),
    },
    { merge: true }
  );
  const snap = await conversaRef.get();
  if (!snap.data()?.nome) await conversaRef.set({ nome: msg.pushName || numero }, { merge: true });
  await conversaRef.collection('mensagens').doc(msg.key.id).set({ de: deCliente ? 'cliente' : 'equipe', texto, em: quando, ...(deCliente ? {} : { autor: 'Celular' }), ...(midia ?? {}) });
}

async function iniciar() {
  if (iniciando) return;
  iniciando = true;
  try {
    const { state, saveCreds } = await useMultiFileAuthState(PASTA_SESSAO);
    const { version } = await fetchLatestBaileysVersion();
    sock = makeWASocket({ version, auth: state, logger: log, printQRInTerminal: false, browser: ['Fluxa Chat', 'Chrome', '1.0'] });
    sock.ev.on('creds.update', saveCreds);
    // Contatos salvos no celular chegam ao conectar e quando mudam.
    sock.ev.on('contacts.upsert', lembrarContatos);
    sock.ev.on('contacts.update', lembrarContatos);
    sock.ev.on('messaging-history.set', ({ contacts, messages }) => {
      lembrarContatos(contacts);
      void importarHistorico(messages);
    });

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr && telefoneParear && !state.creds.registered) {
        // Conexão por número: o WhatsApp mostra um código de 8 letras no celular.
        const numero = telefoneParear;
        telefoneParear = '';
        try {
          const codigo = await sock.requestPairingCode(numero);
          console.log(`Código de pareamento: ${codigo}`);
          await refConexao.set({ status: 'aguardando_qr', qr: '', codigoPareamento: codigo, atualizadoEm: agora() }, { merge: true });
        } catch (e) {
          console.error('Pareamento:', e.message);
          await refConexao.set({ status: 'desconectado', erro: `Pareamento: ${e.message}`, atualizadoEm: agora() }, { merge: true });
        }
        return;
      }
      if (qr) {
        if (MODO_TESTE) {
          console.log('\nLeia este QR Code no celular: WhatsApp > Aparelhos conectados > Conectar um aparelho\n');
          console.log(await QRCode.toString(qr, { type: 'terminal', small: true }));
        }
        const imagem = await QRCode.toDataURL(qr, { width: 640, margin: 4, errorCorrectionLevel: 'M' });
        await refConexao.set({ status: 'aguardando_qr', qr: imagem, atualizadoEm: agora() }, { merge: true });
      }
      if (connection === 'open') {
        aberto = true;
        await refConexao.set({ status: 'conectado', qr: '', codigoPareamento: '', erro: '', telefone: soDigitos(sock.user?.id ?? ''), atualizadoEm: agora() }, { merge: true });
        console.log('WhatsApp conectado.');
      }
      if (connection === 'close') {
        aberto = false;
        const codigo = lastDisconnect?.error?.output?.statusCode;
        if (codigo === DisconnectReason.loggedOut) {
          fs.rmSync(PASTA_SESSAO, { recursive: true, force: true });
          await refConexao.set({ status: 'desconectado', qr: '', atualizadoEm: agora() }, { merge: true });
          console.log('Sessão encerrada no celular. Gere um novo QR Code no Fluxa.');
        } else {
          console.log('Conexão caiu, tentando de novo…');
          iniciando = false;
          setTimeout(() => void iniciar(), 3000);
        }
      }
    });

    // Chamadas de voz: o conector NÃO atende nem faz ligações (a biblioteca não
    // transmite áudio); só registra a chamada na conversa.
    sock.ev.on('call', async (chamadas) => {
      for (const c of chamadas) {
        if (c.status !== 'offer') continue;
        const numero = soDigitos(c.from);
        const texto = c.isVideo ? '📞 Videochamada recebida (atenda pelo celular)' : '📞 Chamada de voz recebida (atenda pelo celular)';
        if (MODO_TESTE) {
          console.log(`[CHAMADA] ${numero}: ${texto}`);
          continue;
        }
        try {
          const quando = agora();
          const ref = base.collection('conversas').doc(`whatsapp_${numero}`);
          await ref.set({ canal: 'whatsapp', contato: numero, telefone: numero, ultimaMensagem: texto, ultimaEm: quando, ultimaDe: 'cliente' }, { merge: true });
          await ref.collection('mensagens').doc(`call-${c.id}`).set({ de: 'cliente', texto, em: quando });
          const dono = (await ref.get()).data() ?? {};
          await base.collection('chatLigacoes').doc(`call-${c.id}`).set({
            tipo: 'recebida',
            em: quando,
            conversaId: `whatsapp_${numero}`,
            vendedorLogin: dono.vendedorLogin ?? '',
            vendedorNome: dono.vendedorNome ?? 'Sem vendedor',
          });
        } catch (e) {
          console.error('Erro ao registrar chamada:', e.message);
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      // 'notify' = mensagens novas; 'append' também traz o que foi enviado pelo celular
      // (aparelhos vinculados). Só aceita o que for recente, para não reimportar histórico.
      console.log(`[upsert ${type}] ${messages.length} mensagem(ns)`);
      if (type !== 'notify' && type !== 'append') return;
      for (const msg of messages) {
        console.log(`  de ${msg.key?.remoteJid} (alt ${msg.key?.remoteJidAlt ?? '-'}) fromMe=${!!msg.key?.fromMe}`);
        if (Date.now() / 1000 - Number(msg.messageTimestamp ?? 0) > 600) continue;
        try {
          await guardarMensagem(msg);
        } catch (e) {
          console.error('Erro ao guardar mensagem:', e.message);
        }
      }
    });
  } finally {
    iniciando = false;
  }
}

// O botão "Gerar QR Code" do Fluxa marca o status como "solicitado".
refConexao.onSnapshot(async (snap) => {
  if (snap.data()?.status === 'solicitado' && !aberto && !iniciando) {
    telefoneParear = String(snap.data()?.telefoneParear ?? '').replace(/\D/g, '');
    try {
      sock?.end?.(undefined);
    } catch {
      /* já fechado */
    }
    fs.rmSync(PASTA_SESSAO, { recursive: true, force: true });
    await iniciar();
  }
});

// Fila de envio: respostas escritas pelos vendedores no Fluxa (imediatas ou agendadas).
async function enviarSaida(d) {
  const dado = d.data();
  if (dado.canal !== 'whatsapp' || processando.has(d.id)) return;
  if (dado.agendadaPara && new Date(dado.agendadaPara).getTime() > Date.now()) return; // stand-by
  processando.add(d.id);
  try {
    if (!aberto || !sock) throw new Error('WhatsApp desconectado');
    const enviada = await sock.sendMessage(dado.paraJid || `${dado.para}@s.whatsapp.net`, { text: dado.texto });
    if (enviada?.key?.id) enviadasPorNos.add(enviada.key.id);
    await d.ref.update({ enviada: true, enviadaEm: agora() });
    if (dado.jaRegistrada === false) {
      const em = new Date().toISOString();
      await base.collection('conversas').doc(dado.conversaId).collection('mensagens').add({ de: 'equipe', texto: dado.texto, em, autor: dado.autor ?? '' });
      await base.collection('conversas').doc(dado.conversaId).set({ ultimaMensagem: dado.texto, ultimaEm: em, ultimaDe: 'equipe' }, { merge: true });
    }
  } catch (e) {
    await d.ref.update({ enviada: true, erro: e.message });
  } finally {
    processando.delete(d.id);
  }
}

if (!MODO_TESTE) {
  base
    .collection('chatSaida')
    .where('enviada', '==', false)
    .onSnapshot((snap) => {
      for (const mudanca of snap.docChanges()) if (mudanca.type === 'added') void enviarSaida(mudanca.doc);
    });
  // Mensagens agendadas: confere a cada 30 s se já chegou a hora.
  setInterval(async () => {
    try {
      const snap = await base.collection('chatSaida').where('enviada', '==', false).get();
      for (const d of snap.docs) if (d.data().agendadaPara) void enviarSaida(d);
    } catch (e) {
      console.error('Agendadas:', e.message);
    }
  }, 30000);
}

if (MODO_TESTE || fs.existsSync(PASTA_SESSAO)) void iniciar();
else console.log('Sem sessão salva. No Fluxa, abra Chat e clique em "Gerar QR Code".');
