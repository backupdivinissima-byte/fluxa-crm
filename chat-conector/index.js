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
import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import QRCode from 'qrcode';
import pino from 'pino';

const EMPRESA_ID = process.env.EMPRESA_ID;
if (!EMPRESA_ID) throw new Error('Defina EMPRESA_ID.');
const PASTA_SESSAO = `./sessao-${EMPRESA_ID}`;

initializeApp({ credential: applicationDefault() });
const db = getFirestore();
const base = db.collection('empresas').doc(EMPRESA_ID);
const refConexao = base.collection('chatConexoes').doc('whatsapp');
const log = pino({ level: 'warn' });

let sock = null;
let aberto = false;
let iniciando = false;
const enviadasPorNos = new Set();
const processando = new Set();

const agora = () => new Date().toISOString();
const soDigitos = (jid) => String(jid).split('@')[0].split(':')[0];

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

async function guardarMensagem(msg) {
  const jid = msg.key.remoteJid;
  if (!jid || !jid.endsWith('@s.whatsapp.net')) return; // ignora grupos, status e listas
  if (msg.key.fromMe && enviadasPorNos.has(msg.key.id)) return;
  const numero = soDigitos(jid);
  const texto = textoDe(msg);
  const quando = new Date(Number(msg.messageTimestamp ?? Date.now() / 1000) * 1000).toISOString();
  const deCliente = !msg.key.fromMe;
  const conversaRef = base.collection('conversas').doc(`whatsapp_${numero}`);
  await conversaRef.set(
    {
      canal: 'whatsapp',
      contato: numero,
      telefone: numero,
      ...(deCliente && msg.pushName ? { nome: msg.pushName } : {}),
      ultimaMensagem: texto,
      ultimaEm: quando,
      ultimaDe: deCliente ? 'cliente' : 'equipe',
      ...(deCliente ? { naoLidas: FieldValue.increment(1) } : {}),
    },
    { merge: true }
  );
  const snap = await conversaRef.get();
  if (!snap.data()?.nome) await conversaRef.set({ nome: msg.pushName || numero }, { merge: true });
  await conversaRef.collection('mensagens').doc(msg.key.id).set({ de: deCliente ? 'cliente' : 'equipe', texto, em: quando });
}

async function iniciar() {
  if (iniciando) return;
  iniciando = true;
  try {
    const { state, saveCreds } = await useMultiFileAuthState(PASTA_SESSAO);
    const { version } = await fetchLatestBaileysVersion();
    sock = makeWASocket({ version, auth: state, logger: log, printQRInTerminal: false, browser: ['Fluxa Chat', 'Chrome', '1.0'] });
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        const imagem = await QRCode.toDataURL(qr, { width: 320, margin: 1 });
        await refConexao.set({ status: 'aguardando_qr', qr: imagem, atualizadoEm: agora() }, { merge: true });
      }
      if (connection === 'open') {
        aberto = true;
        await refConexao.set({ status: 'conectado', qr: '', telefone: soDigitos(sock.user?.id ?? ''), atualizadoEm: agora() }, { merge: true });
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

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
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
    try {
      sock?.end?.(undefined);
    } catch {
      /* já fechado */
    }
    fs.rmSync(PASTA_SESSAO, { recursive: true, force: true });
    await iniciar();
  }
});

// Fila de envio: respostas escritas pelos vendedores no Fluxa.
base
  .collection('chatSaida')
  .where('enviada', '==', false)
  .onSnapshot((snap) => {
    for (const mudanca of snap.docChanges()) {
      if (mudanca.type !== 'added') continue;
      const d = mudanca.doc;
      const dado = d.data();
      if (dado.canal !== 'whatsapp' || processando.has(d.id)) continue;
      processando.add(d.id);
      (async () => {
        try {
          if (!aberto || !sock) throw new Error('WhatsApp desconectado');
          const enviada = await sock.sendMessage(`${dado.para}@s.whatsapp.net`, { text: dado.texto });
          if (enviada?.key?.id) enviadasPorNos.add(enviada.key.id);
          await d.ref.update({ enviada: true, enviadaEm: agora() });
        } catch (e) {
          await d.ref.update({ enviada: true, erro: e.message });
        } finally {
          processando.delete(d.id);
        }
      })();
    }
  });

if (fs.existsSync(PASTA_SESSAO)) void iniciar();
else console.log('Sem sessão salva. No Fluxa, abra Chat e clique em "Gerar QR Code".');
