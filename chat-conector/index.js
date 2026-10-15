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
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, downloadMediaMessage, normalizeMessageContent } from '@whiskeysockets/baileys';
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

// Desembrulha mensagens temporárias, "ver uma vez", editadas etc.
function conteudoDe(msg) {
  try {
    return normalizeMessageContent(msg.message) ?? {};
  } catch {
    return msg.message ?? {};
  }
}

// Devolve o texto, ou null quando a mensagem não é conteúdo de conversa
// (protocolo, reação, chave de criptografia, falha de decifragem...). Essas
// mensagens NÃO devem aparecer no Chat.
function textoDe(msg) {
  const m = conteudoDe(msg);
  const t =
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    m.templateButtonReplyMessage?.selectedDisplayText ||
    '';
  if (t) return t;
  if (m.imageMessage) return '[imagem]';
  if (m.audioMessage) return '[áudio]';
  if (m.videoMessage) return '[vídeo]';
  if (m.documentMessage) return '[documento]';
  if (m.stickerMessage) return '[figurinha]';
  if (m.contactMessage || m.contactsArrayMessage) return '[contato]';
  if (m.locationMessage || m.liveLocationMessage) return '[localização]';
  return null;
}

// Mídia: foto até ~600 KB vai dentro da própria mensagem; qualquer foto, vídeo,
// áudio ou documento também vai para o Google Drive (se estiver autorizado),
// e a conversa mostra o link. Sem Drive, vídeo fica só com a miniatura.
const TAM_PARTE = 800_000;
const partesPendentes = new Map();
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'audio/ogg; codecs=opus': 'ogg', 'audio/mpeg': 'mp3', 'application/pdf': 'pdf' };
async function midiaDe(msg, numero) {
  const m = conteudoDe(msg);
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
    if (img || aud || vid || doc || driveLigado()) buf = await downloadMediaMessage(msg, 'buffer', {}, { logger: log, reuploadRequest: sock.updateMediaMessage });
  } catch (e) {
    console.error('Mídia:', e.message);
  }
  if (buf) {
    if (img && buf.length <= 600_000) out.midiaUrl = `data:${img.mimetype || 'image/jpeg'};base64,${buf.toString('base64')}`;
    // Áudio curto vai dentro da mensagem para tocar direto no Chat.
    if (aud && buf.length <= 600_000) out.midiaUrl = `data:${(aud.mimetype || 'audio/ogg').split(';')[0]};base64,${buf.toString('base64')}`;
    // Vídeo (e áudio longo): vai picado em partes de ~800 KB no próprio banco, para tocar no Chat
    // sem precisar de servidor. Limite de 20 MB por arquivo.
    if ((vid || doc || (aud && buf.length > 600_000)) && buf.length <= 20_000_000) {
      out.midiaPartes = Math.ceil(buf.length / TAM_PARTE);
      out.midiaMime = (alvo.mimetype || (vid ? 'video/mp4' : doc ? 'application/octet-stream' : 'audio/ogg')).split(';')[0];
      if (doc?.fileName) out.midiaNome = doc.fileName;
      partesPendentes.set(msg.key.id, buf);
    }
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
    // Só guarda em memória: o nome entra na conversa quando uma mensagem é gravada (sem consultar o banco por contato).
  }
}

// Histórico: o WhatsApp envia as conversas antigas uma vez, ao conectar o aparelho.
// Importa os últimos 7 dias (no máx. 800 mensagens; ajustável por DIAS_HISTORICO e MAX_HISTORICO), sem mexer nas "não lidas".
const DIAS_HISTORICO = Number(process.env.DIAS_HISTORICO || 7);
const MAX_HISTORICO = Number(process.env.MAX_HISTORICO || 800);
async function importarHistorico(lista) {
  if (MODO_TESTE || !base || !lista?.length) return;
  const corte = Date.now() / 1000 - DIAS_HISTORICO * 86400;
  const porConversa = new Map();
  const jidsHist = new Map();
  let total = 0;
  for (const msg of lista) {
    const jid = jidDe(msg);
    const ts = Number(msg.messageTimestamp ?? 0);
    if (!jid || ts < corte || !msg.message || textoDe(msg) === null) continue;
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
          ...(msgs.some((m) => m.key.fromMe) ? { teveResposta: true } : {}),
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
  if (texto === null) return; // não é mensagem de conversa
  const quando = new Date(Number(msg.messageTimestamp ?? Date.now() / 1000) * 1000).toISOString();
  const deCliente = !msg.key.fromMe;
  if (MODO_TESTE) {
    console.log(`[${deCliente ? 'RECEBIDA' : 'ENVIADA'}] ${msg.pushName || numero} (${numero}): ${texto}`);
    return;
  }
  const midia = await midiaDe(msg, numero);
  const conversaRef = base.collection('conversas').doc(`whatsapp_${numero}`);
  const conversaAntes = await conversaRef.get();
  const jaSalvo = !!conversaAntes.data()?.salvo; // nome confirmado pela equipe
  // Primeiro contato: conversa que ainda não existia e a primeira mensagem veio do cliente.
  const primeiroContato = !conversaAntes.exists && deCliente;
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
      ...(deCliente ? {} : { teveResposta: true }),
      ...(primeiroContato ? { primeiroContato: true } : {}),
      ...(deCliente ? { naoLidas: FieldValue.increment(1) } : {}),
    },
    { merge: true }
  );
  const snap = await conversaRef.get();
  if (!snap.data()?.nome) await conversaRef.set({ nome: msg.pushName || numero }, { merge: true });
  const msgRef = conversaRef.collection('mensagens').doc(msg.key.id);
  await msgRef.set({ de: deCliente ? 'cliente' : 'equipe', texto, em: quando, ...(deCliente ? {} : { autor: 'Celular' }), ...(midia ?? {}) });
  const bufPartes = partesPendentes.get(msg.key.id);
  if (bufPartes) {
    partesPendentes.delete(msg.key.id);
    for (let i = 0; i * TAM_PARTE < bufPartes.length; i++) {
      await msgRef.collection('partes').doc(String(i).padStart(4, '0')).set({ n: i, dados: bufPartes.subarray(i * TAM_PARTE, (i + 1) * TAM_PARTE) });
    }
  }
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
// Converte o áudio gravado no navegador (webm/opus, mp4...) para ogg/opus,
// o formato das mensagens de voz do WhatsApp.
function paraOggOpus(buf) {
  return new Promise((resolve, reject) => {
    const base = path.join(os.tmpdir(), `fluxa-audio-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.writeFileSync(`${base}.in`, buf);
    execFile(ffmpegPath, ['-y', '-i', `${base}.in`, '-vn', '-map_metadata', '-1', '-c:a', 'libopus', '-application', 'voip', '-b:a', '32k', '-ar', '48000', '-ac', '1', '-f', 'ogg', `${base}.ogg`], (err, _o, stderr) => {
      try {
        if (err) return reject(new Error('Falha ao converter o áudio: ' + err.message));
        const out = fs.readFileSync(`${base}.ogg`);
        if (out.length < 200 || out.slice(0, 4).toString() !== 'OggS') return reject(new Error('Áudio convertido inválido.'));
        // duração real (a última linha "time=" do ffmpeg) — o WhatsApp precisa dela para reproduzir
        const t = [...String(stderr).matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].pop();
        const seconds = t ? Math.max(1, Math.round(+t[1] * 3600 + +t[2] * 60 + +t[3])) : 1;
        resolve({ buf: out, seconds });
      } finally {
        for (const e of ['.in', '.ogg']) fs.rmSync(base + e, { force: true });
      }
    });
  });
}

// Lê o anexo gravado pelo Fluxa: dentro da mensagem (foto pequena) ou em partes.
async function lerAnexo(dado) {
  const msgRef = base.collection('conversas').doc(dado.conversaId).collection('mensagens').doc(dado.msgId);
  const m = (await msgRef.get()).data() ?? {};
  if (m.midiaPartes) {
    const ps = await msgRef.collection('partes').orderBy('n').get();
    if (ps.size < m.midiaPartes) throw new Error('Anexo incompleto, tente enviar de novo.');
    return Buffer.concat(ps.docs.map((x) => Buffer.from(x.data().dados)));
  }
  if (m.midiaUrl) return Buffer.from(String(m.midiaUrl).split(',')[1] ?? '', 'base64');
  throw new Error('Anexo não encontrado.');
}

async function enviarSaida(d) {
  const dado = d.data();
  if (dado.canal !== 'whatsapp' || processando.has(d.id)) return;
  if (dado.agendadaPara && new Date(dado.agendadaPara).getTime() > Date.now()) return; // stand-by
  processando.add(d.id);
  try {
    if (!aberto || !sock) throw new Error('WhatsApp desconectado');
    const destino = dado.paraJid || `${dado.para}@s.whatsapp.net`;
    let enviada;
    if (dado.tipo === 'audio') {
      const bruto = Buffer.from(String(dado.audioUrl).split(',')[1] ?? '', 'base64');
      const ogg = await paraOggOpus(bruto);
      console.log(`Enviando áudio de voz: ${ogg.buf.length} bytes, ${ogg.seconds}s`);
      enviada = await sock.sendMessage(destino, { audio: ogg.buf, mimetype: 'audio/ogg; codecs=opus', ptt: true, seconds: ogg.seconds });
    } else if (dado.tipo === 'midia') {
      const buf = await lerAnexo(dado);
      const legenda = dado.legenda || undefined;
      if (dado.midiaTipo === 'imagem') enviada = await sock.sendMessage(destino, { image: buf, caption: legenda });
      else if (dado.midiaTipo === 'video') enviada = await sock.sendMessage(destino, { video: buf, caption: legenda, mimetype: dado.mime || 'video/mp4' });
      else enviada = await sock.sendMessage(destino, { document: buf, mimetype: dado.mime || 'application/octet-stream', fileName: dado.nomeArquivo || 'arquivo', caption: legenda });
    } else {
      enviada = await sock.sendMessage(destino, { text: dado.texto });
    }
    if (enviada?.key?.id) enviadasPorNos.add(enviada.key.id);
    await d.ref.update({ enviada: true, enviadaEm: agora() });
    if (dado.jaRegistrada === false) {
      const em = new Date().toISOString();
      await base.collection('conversas').doc(dado.conversaId).collection('mensagens').add({ de: 'equipe', texto: dado.texto, em, autor: dado.autor ?? '' });
      await base.collection('conversas').doc(dado.conversaId).set({ ultimaMensagem: dado.texto, ultimaEm: em, ultimaDe: 'equipe', teveResposta: true }, { merge: true });
    }
  } catch (e) {
    console.error('Falha ao enviar:', e.message);
    await d.ref.update({ enviada: true, erro: e.message });
    if (dado.msgId) {
      await base.collection('conversas').doc(dado.conversaId).collection('mensagens').doc(dado.msgId).set({ erroEnvio: e.message }, { merge: true }).catch(() => {});
    }
  } finally {
    processando.delete(d.id);
  }
}

if (!MODO_TESTE) {
  // Mensagens agendadas ficam numa lista em memória (sem reler o banco a cada 30 s).
  const agendadasPendentes = new Map();
  base
    .collection('chatSaida')
    .where('enviada', '==', false)
    .onSnapshot((snap) => {
      for (const mudanca of snap.docChanges()) {
        const d = mudanca.doc;
        if (mudanca.type === 'removed') {
          agendadasPendentes.delete(d.id);
        } else if (d.data().agendadaPara) {
          agendadasPendentes.set(d.id, d);
        }
        if (mudanca.type === 'added') void enviarSaida(d);
      }
    });
  setInterval(() => {
    for (const [id, d] of agendadasPendentes) {
      const quando = d.data().agendadaPara;
      if (quando && new Date(quando).getTime() <= Date.now() && !processando.has(id)) {
        agendadasPendentes.delete(id);
        void enviarSaida(d);
      }
    }
  }, 15000);
}

if (MODO_TESTE || fs.existsSync(PASTA_SESSAO)) void iniciar();
else {
  console.log('Sem sessão salva. No Fluxa, abra Chat e clique em "Gerar QR Code".');
  refConexao.set({ status: 'desconectado', qr: '', atualizadoEm: agora() }, { merge: true }).catch(() => {});
}
