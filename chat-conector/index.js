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
import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, downloadMediaMessage, normalizeMessageContent, BufferJSON } from '@whiskeysockets/baileys';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import QRCode from 'qrcode';
import pino from 'pino';
import { guardarNoDrive, driveLigado } from './drive-midia.js';
import { criarRobo } from './robo.js';
import { criarSupervisora } from './supervisora.js';
import { iniciarBuscaInstagram } from './prospect-instagram.js';

// MODO TESTE: sem banco. Mostra o QR Code no terminal e escreve as mensagens
// recebidas na tela. Ativa com MODO_TESTE=1 ou quando não há credenciais.
const MODO_TESTE = process.env.MODO_TESTE === '1' || !process.env.GOOGLE_APPLICATION_CREDENTIALS;
const EMPRESA_ID = process.env.EMPRESA_ID || 'teste';
if (!MODO_TESTE && !process.env.EMPRESA_ID) throw new Error('Defina EMPRESA_ID.');
const PASTA_SESSAO = process.env.PASTA_SESSAO || `./sessao-${EMPRESA_ID}`;

let base = null;
let refConexao = { set: async () => {}, onSnapshot: () => {} };
if (!MODO_TESTE) {
  initializeApp({ credential: applicationDefault() });
  base = getFirestore().collection('empresas').doc(EMPRESA_ID);
  refConexao = base.collection('chatConexoes').doc('whatsapp');
} else {
  console.log('>>> MODO TESTE: sem banco de dados. As mensagens só aparecem aqui no terminal.');
}
// Falhas de criptografia (Bad MAC, PreKeyError...) enchem o log: o robô só conta
// (ver robo.js) e o resto do log fica limpo.
let robo = null;
let supervisora = null;
const ERRO_CRIPTO = /Session error|Bad MAC|MessageCounterError|No matching sessions|Invalid PreKey|PreKeyError|SessionError/;
const RUIDO_LIBSIGNAL = /Closing session|Removing old closed session|Session already (closed|open)|Opening session|Migrating session|Decrypted message with closed session|Closing open session|Failed to decrypt/;
for (const nivel of ['log', 'info', 'warn', 'error']) {
  const original = console[nivel].bind(console);
  console[nivel] = (...args) => {
    const primeiro = typeof args[0] === 'string' ? args[0] : '';
    if (ERRO_CRIPTO.test(primeiro) || args.some((a) => a instanceof Error && ERRO_CRIPTO.test(`${a.name} ${a.message}`))) {
      robo?.erroDecifrar();
      return;
    }
    if (RUIDO_LIBSIGNAL.test(primeiro)) return;
    original(...args);
  };
}
const log = pino(
  { level: 'warn' },
  {
    write(linha) {
      if (ERRO_CRIPTO.test(linha)) robo?.erroDecifrar();
      else process.stdout.write(linha);
    },
  }
);

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
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
function reconectarForcado() {
  try {
    sock?.end?.(new Error('Reconexão pedida pelo robô'));
  } catch {
    /* já fechado */
  }
}

// O WhatsApp novo identifica contatos por @lid; quando traz o número (Alt), usamos ele.
// Mapa @lid -> número de telefone, guardado em arquivo (sobrevive a reinícios).
const ARQ_LID = process.env.ARQ_LID || './lid-mapa.json';
const lidParaTel = new Map();
try {
  for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(ARQ_LID, 'utf8')))) lidParaTel.set(k, v);
} catch {
  /* ainda não existe */
}
function salvarMapaLid() {
  try {
    fs.writeFileSync(ARQ_LID, JSON.stringify(Object.fromEntries(lidParaTel)));
  } catch {
    /* ignora */
  }
}

function jidDe(msg) {
  const k = msg.key ?? {};
  const j = k.remoteJid ?? '';
  if (j.endsWith('@s.whatsapp.net')) return j;
  if (j.endsWith('@lid')) {
    const alt = [k.remoteJidAlt, k.senderPn, k.participantPn].find((x) => typeof x === 'string' && x.endsWith('@s.whatsapp.net'));
    if (alt) return alt;
    const tel = lidParaTel.get(soDigitos(j));
    return tel ? `${tel}@s.whatsapp.net` : j;
  }
  return null; // grupo, status, lista de transmissão...
}

// Aprende que um @lid é na verdade um telefone e junta conversas que ficaram separadas.
const mesclando = new Map();
async function aprenderLid(lid, pn) {
  if (!lid || !pn || !String(lid).endsWith('@lid') || !String(pn).endsWith('@s.whatsapp.net')) return;
  const l = soDigitos(lid);
  const t = soDigitos(pn);
  if (lidParaTel.get(l) !== t) {
    lidParaTel.set(l, t);
    salvarMapaLid();
  }
  void ensinarMapaBaileys([[l, t]]);
  if (MODO_TESTE || !base) return;
  if (!mesclando.has(l)) mesclando.set(l, mesclarConversas(l, t).catch((e) => console.error('Mesclar conversas:', e.message)));
  await mesclando.get(l);
}
// Baileys 7 precisa saber qual @lid é de qual telefone para enviar; sem isso o envio fica "sem confirmação".
async function ensinarMapaBaileys(pares) {
  const repo = sock?.signalRepository?.lidMapping;
  if (!repo?.storeLIDPNMappings || !pares.length) return;
  try {
    await repo.storeLIDPNMappings(pares.map(([l, t]) => ({ lid: `${l}@lid`, pn: `${t}@s.whatsapp.net` })));
  } catch (e) {
    console.warn('[lid] não consegui ensinar o mapa ao WhatsApp:', e.message);
  }
}
function aprenderDaMensagem(msg) {
  const k = msg.key ?? {};
  const alt = [k.remoteJidAlt, k.senderPn, k.participantPn].find((x) => typeof x === 'string' && x.endsWith('@s.whatsapp.net'));
  return k.remoteJid?.endsWith('@lid') && alt ? aprenderLid(k.remoteJid, alt) : Promise.resolve();
}


// ---------- Cofre de contatos salvos ----------
// Nome salvo, vendedor, cliente do CRM e etiquetas ficam copiados por telefone em `contatosSalvos`.
// Se a conversa for recriada (reconexão, troca de identificador), restauramos daqui — nada se perde.
const chaveCofre = (numero) => String(numero).replace(/\D/g, '').slice(-11);
async function restaurarDoCofre(numero) {
  try {
    if (chaveCofre(numero).length < 10) return;
    const c = await base.collection('contatosSalvos').doc(chaveCofre(numero)).get();
    if (!c.exists) return;
    const d = c.data() ?? {};
    const ref = base.collection('conversas').doc(`whatsapp_${numero}`);
    const atual = (await ref.get()).data() ?? {};
    const patch = {};
    if (d.salvo && !atual.salvo) { patch.salvo = true; if (d.nome) patch.nome = d.nome; }
    if (d.vendedorLogin && !atual.vendedorLogin) { patch.vendedorLogin = d.vendedorLogin; patch.vendedorNome = d.vendedorNome ?? ''; if (d.atendimentoEm) patch.atendimentoEm = d.atendimentoEm; }
    if (d.clienteId && !atual.clienteId) patch.clienteId = d.clienteId;
    if (d.tags?.length && !(atual.tags?.length)) patch.tags = d.tags;
    if (Object.keys(patch).length > 0) {
      await ref.set(patch, { merge: true });
      console.log(`[cofre] contato ${numero} restaurado (${Object.keys(patch).join(', ')}).`);
    }
  } catch (e) {
    console.warn('[cofre] restaurar:', e.message);
  }
}
// Uma vez por inicialização: copia para o cofre tudo o que a equipe já definiu nas conversas existentes.
async function semearCofre() {
  try {
    const todas = await base.collection('conversas').get();
    let n = 0;
    for (const d of todas.docs) {
      const c = d.data();
      const tel = String(c.telefone ?? '').replace(/\D/g, '');
      if (tel.length < 10 || !(c.salvo || c.vendedorLogin || c.clienteId || c.tags?.length)) continue;
      const dados = { telefone: tel, atualizadoEm: agora() };
      if (c.salvo) { dados.salvo = true; dados.nome = c.nome ?? ''; }
      if (c.vendedorLogin) { dados.vendedorLogin = c.vendedorLogin; dados.vendedorNome = c.vendedorNome ?? ''; dados.atendimentoEm = c.atendimentoEm ?? ''; }
      if (c.clienteId) dados.clienteId = c.clienteId;
      if (c.tags?.length) dados.tags = c.tags;
      await base.collection('contatosSalvos').doc(chaveCofre(tel)).set(dados, { merge: true });
      n++;
    }
    console.log(`[cofre] ${n} contatos salvos guardados no cofre.`);
  } catch (e) {
    console.warn('[cofre] semear:', e.message);
  }
}


// Mensagem respondida pelo cliente (citação): guardamos um resumo para mostrar no chat.
function extrairCitada(msg) {
  try {
    const m = normalizeMessageContent(msg.message) ?? {};
    const ci = (m.extendedTextMessage ?? m.imageMessage ?? m.videoMessage ?? m.audioMessage ?? m.documentMessage ?? m.stickerMessage)?.contextInfo;
    if (!ci?.quotedMessage) return undefined;
    const q = normalizeMessageContent(ci.quotedMessage) ?? {};
    const texto = q.conversation ?? q.extendedTextMessage?.text ?? q.imageMessage?.caption ?? q.videoMessage?.caption ?? q.documentMessage?.caption
      ?? (q.imageMessage ? '📷 Foto' : q.audioMessage ? '🎤 Áudio' : q.videoMessage ? '🎥 Vídeo' : q.documentMessage ? '📄 Documento' : 'Mensagem');
    return { id: ci.stanzaId ?? '', texto: String(texto).slice(0, 200) };
  } catch {
    return undefined;
  }
}

// Move mensagens da conversa antiga (chave @lid) para a conversa do telefone.
async function mesclarConversas(lid, tel) {
  if (lid === tel) return;
  const de = base.collection('conversas').doc(`whatsapp_${lid}`);
  const snapDe = await de.get();
  if (!snapDe.exists) return;
  const para = base.collection('conversas').doc(`whatsapp_${tel}`);
  const snapPara = await para.get();
  const a = snapDe.data() ?? {};
  const b = snapPara.data() ?? {};
  console.log(`Juntando conversa ${lid} (@lid) com ${tel}…`);
  const msgs = await de.collection('mensagens').get();
  for (const m of msgs.docs) {
    await para.collection('mensagens').doc(m.id).set(m.data(), { merge: true });
    const partes = await m.ref.collection('partes').get();
    for (const p of partes.docs) await para.collection('mensagens').doc(m.id).collection('partes').doc(p.id).set(p.data());
    for (const p of partes.docs) await p.ref.delete();
    await m.ref.delete();
  }
  const maisNovaA = (a.ultimaEm ?? '') > (b.ultimaEm ?? '');
  const ult = maisNovaA ? a : b;
  await para.set(
    {
      ...a,
      ...b,
      // Nome confirmado pela equipe nunca é trocado ao juntar conversas.
      ...((a.salvo || b.salvo) ? { salvo: true, nome: (b.salvo ? b.nome : a.nome) ?? b.nome ?? a.nome } : {}),
      canal: 'whatsapp',
      contato: tel,
      telefone: tel,
      contatoJid: `${tel}@s.whatsapp.net`,
      ultimaMensagem: ult.ultimaMensagem ?? '',
      ultimaEm: ult.ultimaEm ?? '',
      ultimaDe: ult.ultimaDe ?? 'cliente',
      naoLidas: (a.naoLidas ?? 0) + (b.naoLidas ?? 0),
      teveResposta: !!(a.teveResposta || b.teveResposta),
      ...(b.primeiroContato || a.primeiroContato ? { primeiroContato: true } : {}),
    },
    { merge: true }
  );
  await de.delete();
  await restaurarDoCofre(tel);
  console.log(`Conversa ${lid} juntada com ${tel}.`);
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
    m.buttonsMessage?.contentText ||
    m.listMessage?.description ||
    m.interactiveMessage?.body?.text ||
    m.templateMessage?.hydratedTemplate?.hydratedContentText ||
    m.interactiveResponseMessage?.body?.text ||
    m.pollCreationMessage?.name ||
    m.pollCreationMessageV3?.name ||
    m.productMessage?.product?.title ||
    m.orderMessage?.message ||
    m.eventMessage?.name ||
    '';
  if (t) return t;
  if (m.imageMessage) return '[imagem]';
  if (m.audioMessage) return '[áudio]';
  if (m.videoMessage) return '[vídeo]';
  if (m.documentMessage) return '[documento]';
  if (m.stickerMessage) return '[figurinha]';
  if (m.contactMessage || m.contactsArrayMessage) return '[contato]';
  if (m.locationMessage || m.liveLocationMessage) return '[localização]';
  if (m.ptvMessage) return '[vídeo]';
  if (m.productMessage) return '[produto]';
  if (m.orderMessage) return '[pedido]';
  if (m.interactiveMessage || m.buttonsMessage || m.listMessage || m.templateMessage || m.interactiveResponseMessage) return '[mensagem automática]';
  if (m.pollCreationMessage || m.pollCreationMessageV3) return '[enquete]';
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
  const img = m.imageMessage ?? m.stickerMessage; // figurinha (webp) aparece como imagem
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
    if (c.lid && c.id?.endsWith?.('@s.whatsapp.net')) void aprenderLid(c.lid, c.id);
    else if (c.id?.endsWith?.('@lid') && c.phoneNumber) void aprenderLid(c.id, c.phoneNumber);
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
  for (const msg of lista) await aprenderDaMensagem(msg);
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
      const snapAtual = await ref.get();
      const atual = snapAtual.data() ?? {};
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
          ...(agenda.has(numero) ? { ...(atual.salvo ? {} : { nome: agenda.get(numero) }), nomeSugerido: agenda.get(numero), salvoNaAgenda: true } : !atual.nome ? { nome: nomePush || numero, ...(nomePush ? { nomeSugerido: nomePush } : {}) } : {}),
          ...(novoUlt ? { ultimaMensagem: textoDe(mais), ultimaEm: quandoUlt, ultimaDe: mais.key.fromMe ? 'equipe' : 'cliente' } : {}),
          ...(msgs.some((m) => m.key.fromMe) ? { teveResposta: true } : {}),
        },
        { merge: true }
      );
      if (!snapAtual.exists) await restaurarDoCofre(numero);
    } catch (e) {
      console.error('Histórico:', numero, e.message);
    }
  }
  console.log('Histórico importado.');
}

// Quando o cliente diz de onde veio ("vim do Instagram", "vi no direct", "pelo Messenger", "do Face"), a conversa ganha a tag sozinha.
function origemPeloTexto(texto) {
  const t = String(texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const veio = '(?:vim|veio|vieram|vir|cheguei|chego|chamei|chamo|falei|vi |vi$|vindo|encontrei|achei|conheci|pelo|pela|atraves)';
  const perto = (nomes) => new RegExp(veio + '[^.!?\\n]{0,45}\\b(?:' + nomes + ')\\b').test(t);
  if (perto('instagram|insta|instagran|direct|diret')) return 'instagram';
  if (perto('facebook|face|fb|messenger|mensager|mensenger|messeger|mesenger')) return 'facebook';
  return null;
}


// ---------- foto de perfil do contato (como no WhatsApp Web) ----------
const FOTO_VALIDADE_MS = 3 * 86400000; // renova a foto a cada 3 dias
const FOTO_RETENTAR_MS = 1 * 86400000; // contato sem foto/privado: tenta de novo em 1 dia
const telefonesInternos = new Set(); // últimos 9 dígitos dos números cadastrados como internos (diretoria, financeiro…)
const fotoFila = [];
const fotoNaFila = new Set();
let fotoRodando = false;

function precisaFoto(dados) {
  if (!dados) return true;
  const quando = dados.fotoEm ? new Date(dados.fotoEm).getTime() : 0;
  const idade = Date.now() - quando;
  if (dados.foto && !dados.fotoGrande) return true; // ainda sem a versão grande
  return dados.foto ? idade > FOTO_VALIDADE_MS : idade > FOTO_RETENTAR_MS;
}

function pedirFoto(conversaId, jid, dados, urgente = false) {
  if (!sock || !jid || (!urgente && (fotoNaFila.has(conversaId) || !precisaFoto(dados)))) return;
  if (urgente) { const i = fotoFila.findIndex((x) => x.conversaId === conversaId); if (i >= 0) fotoFila.splice(i, 1); }
  fotoNaFila.add(conversaId);
  if (urgente) fotoFila.unshift({ conversaId, jid }); else fotoFila.push({ conversaId, jid });
  void processarFotos();
}

function dimJpeg(b) {
  try {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return `${b.readUInt16BE(i + 7)}x${b.readUInt16BE(i + 5)}`;
      i += 2 + b.readUInt16BE(i + 2);
    }
  } catch { /* ignora */ }
  return '?';
}

async function processarFotos() {
  if (fotoRodando) return;
  fotoRodando = true;
  try {
    while (fotoFila.length > 0) {
      const { conversaId, jid } = fotoFila.shift();
      fotoNaFila.delete(conversaId);
      try {
        if (!sock || !aberto) { fotoFila.length = 0; fotoNaFila.clear(); break; }
        let url = null;
        let erroPrev = '';
        try { url = await sock.profilePictureUrl(jid, 'preview'); } catch (e) { erroPrev = e?.message ?? String(e); } // sem foto ou privacidade
        let foto = '';
        if (url) {
          const r = await fetch(url);
          if (r.ok) {
            const buf = Buffer.from(await r.arrayBuffer());
            if (buf.length > 0 && buf.length < 120000) foto = `data:image/jpeg;base64,${buf.toString('base64')}`;
          }
        }
        let grande = '';
        if (url || !erroPrev) {
          try {
            const ug = await sock.profilePictureUrl(jid, 'image');
            const rg = ug ? await fetch(ug) : null;
            if (rg?.ok) {
              const bg = Buffer.from(await rg.arrayBuffer());
              console.log(`  (foto grande de ${conversaId}: ${dimJpeg(bg)}, ${bg.length} bytes)`);
              if (bg.length > 0 && bg.length < 700000) grande = `data:image/jpeg;base64,${bg.toString('base64')}`;
            } else {
              console.log(`  (foto grande de ${conversaId}: sem resposta ${rg?.status ?? 'sem url'})`);
            }
          } catch (e) { console.log(`  (foto grande de ${conversaId} falhou: ${e?.message ?? e})`); }
        } else {
          console.log(`  (foto de ${conversaId}: sem foto/privada — ${erroPrev})`);
        }
        // a versão grande fica fora da conversa (a lista de conversas continua leve) e é lida só ao clicar na foto
        if (grande) await base.collection('chatConexoes').doc(`foto_${conversaId}`).set({ grande, em: new Date().toISOString() });
        await base.collection('conversas').doc(conversaId).set(
          foto || grande ? { ...(foto ? { foto } : {}), fotoEm: new Date().toISOString(), fotoGrande: !!grande } : { fotoEm: new Date().toISOString() },
          { merge: true }
        );
      } catch (e) {
        console.log(`  (foto de ${conversaId}: ${e?.message ?? e})`);
      }
      await new Promise((r) => setTimeout(r, 1500)); // sem pressa: evita sobrecarregar o WhatsApp
    }
  } finally {
    fotoRodando = false;
  }
}

/** Passa pelas conversas recentes e busca a foto das que ainda não têm (ou estão velhas). */
async function preencherFotos() {
  try {
    const snap = await base.collection('conversas').orderBy('ultimaEm', 'desc').limit(300).get();
    for (const d of snap.docs) {
      const dados = d.data();
      if (dados.canal === 'whatsapp') pedirFoto(d.id, dados.contatoJid, dados);
    }
    console.log(`[fotos] ${fotoFila.length} contato(s) na fila para buscar foto.`);
  } catch (e) {
    console.log('  (preencher fotos:', e?.message ?? e, ')');
  }
}

// ---- Grupos de WhatsApp ---------------------------------------------------------------------
// Cada grupo vira uma conversa (whatsapp_grupo_<id>) marcada com grupo:true. Sem robô de boas-vindas,
// sem IA supervisora e sem dono: todos da equipe veem e respondem. Cada mensagem guarda quem escreveu.
const nomesGrupos = new Map(); // jid -> { nome, em }
async function nomeDoGrupo(jid) {
  const c = nomesGrupos.get(jid);
  if (c && Date.now() - c.em < 30 * 60 * 1000) return c.nome;
  try {
    const meta = await sock.groupMetadata(jid);
    const nome = String(meta?.subject ?? '').trim();
    if (nome) {
      nomesGrupos.set(jid, { nome, em: Date.now() });
      return nome;
    }
  } catch {
    /* usa o último nome conhecido */
  }
  return c?.nome ?? '';
}

async function guardarMensagemGrupo(msg) {
  const jid = msg.key.remoteJid;
  if (msg.key.fromMe && enviadasPorNos.has(msg.key.id)) return;
  if (robo?.ehTeste(msg.key.id)) return;
  const texto = textoDe(msg);
  if (texto === null) return;
  const quando = new Date(Number(msg.messageTimestamp ?? Date.now() / 1000) * 1000).toISOString();
  const deCliente = !msg.key.fromMe;
  const chave = `grupo_${jid.split('@')[0]}`;
  if (MODO_TESTE) {
    console.log(`[GRUPO ${chave}] ${msg.pushName || ''}: ${texto}`);
    return;
  }
  const conversaRef = base.collection('conversas').doc(`whatsapp_${chave}`);
  if ((await conversaRef.collection('mensagens').doc(msg.key.id).get()).exists) return;
  const antes = await conversaRef.get();
  const nomeGrupo = (await nomeDoGrupo(jid)) || antes.data()?.nome || 'Grupo';
  const k = msg.key;
  const quem = [k.participantPn, k.participant].find((x) => typeof x === 'string' && x.endsWith('@s.whatsapp.net')) ?? (typeof k.participant === 'string' && k.participant.endsWith('@lid') ? (lidParaTel.get(soDigitos(k.participant)) ? `${lidParaTel.get(soDigitos(k.participant))}@s.whatsapp.net` : k.participant) : '');
  const quemNumero = quem && quem.endsWith('@s.whatsapp.net') ? soDigitos(quem) : '';
  const quemNome = deCliente ? msg.pushName || agenda.get(quemNumero) || quemNumero || 'Participante' : '';
  const midia = await midiaDe(msg, chave);
  const resumo = deCliente ? `${quemNome}: ${texto}` : texto;
  await conversaRef.set(
    {
      canal: 'whatsapp',
      grupo: true,
      salvo: true,
      contato: chave,
      contatoJid: jid,
      nome: nomeGrupo,
      ultimaMensagem: resumo,
      ultimaEm: quando,
      ultimaDe: deCliente ? 'cliente' : 'equipe',
      ...(deCliente ? { naoLidas: FieldValue.increment(1) } : { teveResposta: true }),
    },
    { merge: true }
  );
  pedirFoto(`whatsapp_${chave}`, jid, antes.data());
  const msgRef = conversaRef.collection('mensagens').doc(msg.key.id);
  const citada = extrairCitada(msg);
  await msgRef.set({
    de: deCliente ? 'cliente' : 'equipe',
    texto,
    em: quando,
    ...(deCliente ? { participante: quemNome, ...(quemNumero ? { participanteNumero: quemNumero } : {}) } : { autor: 'Celular' }),
    ...(midia ?? {}),
    ...(citada ? { citada } : {}),
  });
  const bufPartes = partesPendentes.get(msg.key.id);
  if (bufPartes) {
    partesPendentes.delete(msg.key.id);
    for (let i = 0; i * TAM_PARTE < bufPartes.length; i++) {
      await msgRef.collection('partes').doc(String(i).padStart(4, '0')).set({ n: i, dados: bufPartes.subarray(i * TAM_PARTE, (i + 1) * TAM_PARTE) });
    }
  }
}

async function guardarMensagem(msg) {
  await aprenderDaMensagem(msg);
  if (msg.key?.remoteJid?.endsWith('@g.us')) return guardarMensagemGrupo(msg);
  const jid = jidDe(msg);
  if (!jid) return; // ignora grupos, status e listas
  if (msg.key.fromMe && enviadasPorNos.has(msg.key.id)) return;
  if (robo?.ehTeste(msg.key.id)) return; // mensagem de teste do robô
  const numero = soDigitos(jid);
  if (sock?.user?.id && numero === soDigitos(sock.user.id)) return; // conversa "Eu" (mensagens para si mesmo)
  const texto = textoDe(msg);
  if (texto === null) {
    console.log(`  (ignorada: ${msg.message ? Object.keys(conteudoDe(msg)).join(',') : 'sem conteúdo — falha ao decifrar, o WhatsApp reenvia'})`);
    return; // não é mensagem de conversa
  }
  const quando = new Date(Number(msg.messageTimestamp ?? Date.now() / 1000) * 1000).toISOString();
  const deCliente = !msg.key.fromMe;
  if (MODO_TESTE) {
    console.log(`[${deCliente ? 'RECEBIDA' : 'ENVIADA'}] ${msg.pushName || numero} (${numero}): ${texto}`);
    return;
  }
  const conversaRef = base.collection('conversas').doc(`whatsapp_${numero}`);
  // Mensagem já gravada (o WhatsApp reentrega o que chegou durante uma queda): não repete nem conta de novo como "não lida".
  if ((await conversaRef.collection('mensagens').doc(msg.key.id).get()).exists) return;
  const midia = await midiaDe(msg, numero);
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
      ...(deCliente && origemPeloTexto(texto) ? { origem: origemPeloTexto(texto) } : {}),
      ...(deCliente ? { naoLidas: FieldValue.increment(1) } : {}),
    },
    { merge: true }
  );
  pedirFoto(`whatsapp_${numero}`, jid, conversaAntes.data());
  if (!conversaAntes.exists) await restaurarDoCofre(numero);
  const snap = await conversaRef.get();
  if (!snap.data()?.nome) await conversaRef.set({ nome: msg.pushName || numero }, { merge: true });
  const msgRef = conversaRef.collection('mensagens').doc(msg.key.id);
  const citada = extrairCitada(msg);
  await msgRef.set({ de: deCliente ? 'cliente' : 'equipe', texto, em: quando, ...(deCliente ? {} : { autor: 'Celular' }), ...(midia ?? {}), ...(citada ? { citada } : {}) });
  const bufPartes = partesPendentes.get(msg.key.id);
  if (bufPartes) {
    partesPendentes.delete(msg.key.id);
    for (let i = 0; i * TAM_PARTE < bufPartes.length; i++) {
      await msgRef.collection('partes').doc(String(i).padStart(4, '0')).set({ n: i, dados: bufPartes.subarray(i * TAM_PARTE, (i + 1) * TAM_PARTE) });
    }
  }
  // Robô de boas-vindas: no 1º contato de um número novo pergunta se já é cliente.
  if (deCliente && Date.now() - new Date(quando).getTime() < 5 * 60 * 1000) {
    void botBoasVindas({ conversaRef, antes: conversaAntes.data(), depois: snap.data(), jid, texto, primeiroContato }).catch((e) => console.error('[bot] erro:', e.message));
  }
  // IA supervisora: só mensagens novas de cliente (nada de histórico antigo).
  if (deCliente && Date.now() - new Date(quando).getTime() < 10 * 60 * 1000) supervisora?.mensagemDoCliente(`whatsapp_${numero}`);
}


// ---- Robô de boas-vindas (1º contato de número novo) --------------------------------------
// Pergunta se já é cliente e, conforme a resposta, avisa que a vendedora/equipe já atende.
// Só fala com número NOVO que ninguém da equipe respondeu; nunca em conversas já existentes ou vinculadas.
// Desligar sem mexer no código: criar o documento empresas/{id}/chatBot/config com { ativo: false }.
const BOT_NOME = 'Robô';
// Os textos usam o nome da empresa cadastrado no Fluxa (Divinissima, Carla Fidelis, ...).
const BOT_TEXTOS = {
  pergunta: (n) => `Olá! Seja muito bem-vinda à *${n}* ✨\n\nPara te atender melhor, me conta:\n\n*1* - Já sou cliente\n*2* - Ainda não sou cliente\n\nÉ só responder com o número 😊`,
  lembrete: () => 'Para eu te direcionar certinho, responda *1* se você já é cliente ou *2* se ainda não é cliente 😊',
  cliente: () => 'Perfeito! 💛 Já vamos chamar a sua vendedora para continuar o seu atendimento. Só um momentinho, por favor!',
  novo: (n) => `Que bom ter você por aqui! 💎 Nossa equipe já vai te atender e te apresentar a ${n}. Só um momentinho, por favor!`,
};
let nomeEmpresaCache = { em: 0, nome: '' };
async function nomeDaEmpresa() {
  if (nomeEmpresaCache.nome && Date.now() - nomeEmpresaCache.em < 600000) return nomeEmpresaCache.nome;
  let nome = '';
  try {
    nome = String((await base.get()).data()?.nome ?? '').trim();
  } catch {
    /* usa o último nome conhecido */
  }
  if (!nome) return nomeEmpresaCache.nome || 'nossa loja';
  // Nome todo em maiúsculas vira "Nome Próprio" (DIVINISSIMA SEMIJOIAS -> Divinissima Semijoias).
  if (nome === nome.toUpperCase()) nome = nome.toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, e, c) => e + c.toUpperCase());
  nomeEmpresaCache = { em: Date.now(), nome };
  return nome;
}
let botLigado = { em: 0, ok: true };
async function botEstaLigado() {
  if (MODO_TESTE) return false;
  if (Date.now() - botLigado.em < 60000) return botLigado.ok;
  try {
    const c = await base.collection('chatBot').doc('config').get();
    botLigado = { em: Date.now(), ok: c.data()?.ativo !== false };
  } catch {
    botLigado = { em: Date.now(), ok: true };
  }
  return botLigado.ok;
}
function entenderResposta(texto) {
  const t = String(texto).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  if (/^\W*2\b/.test(t) || /\bnao\b[^.!?]{0,20}\b(sou|e|fui)\b|ainda nao|nunca (comprei|fui)|quero (ser|conhecer|comprar)|primeira vez|novo cliente|\bnova\b/.test(t)) return 'novo';
  if (/^\W*1\b/.test(t) || /\bja (sou|compro|comprei|fui)\b|\bsou cliente\b|\bcliente\b/.test(t)) return 'cliente';
  return null;
}
async function botEnviar(conversaRef, jid, texto) {
  try {
    await sock.sendPresenceUpdate('composing', jid);
  } catch {
    /* ignora */
  }
  await dormir(1500 + Math.min(2500, texto.length * 8));
  const enviada = await sock.sendMessage(jid, { text: texto });
  if (enviada?.key?.id) enviadasPorNos.add(enviada.key.id);
  lembrarEnviada(enviada?.key?.id, enviada?.message);
  const em = new Date().toISOString();
  await conversaRef.collection('mensagens').add({ de: 'equipe', texto, em, autor: BOT_NOME });
  // Não marca "teveResposta": a conversa continua como contato novo até um humano responder.
  await conversaRef.set({ ultimaMensagem: texto, ultimaEm: em, ultimaDe: 'equipe', botEm: em }, { merge: true });
}
async function botBoasVindas({ conversaRef, antes, depois, jid, texto, primeiroContato }) {
  if (telefonesInternos.has(soDigitos(jid).slice(-9))) return; // número interno: sem robô de boas-vindas
  if (!(await botEstaLigado()) || !jid || !sock || !aberto) return;
  const d = depois ?? {};
  if (d.teveResposta) return; // um humano já respondeu
  if (primeiroContato && !d.botEstado) {
    if (d.vendedorLogin || d.clienteId || d.salvo || d.salvoNaAgenda) return; // já é conhecido da equipe
    await conversaRef.set({ botEstado: 'perguntou', botTentativas: 0 }, { merge: true });
    console.log(`[bot] boas-vindas para ${jid}`);
    await botEnviar(conversaRef, jid, BOT_TEXTOS.pergunta(await nomeDaEmpresa()));
    return;
  }
  if (antes?.botEstado !== 'perguntou') return;
  const resp = entenderResposta(texto);
  if (resp) {
    await conversaRef.set({ botEstado: 'concluido', botResposta: resp }, { merge: true });
    console.log(`[bot] ${jid} respondeu: ${resp}`);
    await botEnviar(conversaRef, jid, BOT_TEXTOS[resp](await nomeDaEmpresa()));
    return;
  }
  // Não entendeu: lembra no máximo uma vez (e só se a última mensagem do robô foi há mais de 20 s); depois deixa para a equipe.
  const tent = antes.botTentativas ?? 0;
  if (tent >= 1) {
    await conversaRef.set({ botEstado: 'concluido', botResposta: 'sem_resposta' }, { merge: true });
    return;
  }
  if (antes.botEm && Date.now() - new Date(antes.botEm).getTime() < 20000) return;
  await conversaRef.set({ botTentativas: tent + 1 }, { merge: true });
  await botEnviar(conversaRef, jid, BOT_TEXTOS.lembrete());
}

// Se a gravação no banco falhar, tenta de novo (5 s, 30 s, 2 min) antes de desistir.
async function gravarComNovasTentativas(msg) {
  for (const espera of [5000, 30000, 120000]) {
    await dormir(espera);
    try {
      await guardarMensagem(msg);
      console.log(`Mensagem ${msg.key?.id} gravada na nova tentativa.`);
      return;
    } catch (e) {
      console.error('Nova tentativa de gravar a mensagem falhou:', e.message);
    }
  }
  robo?.erroGravacao();
}


// ---- Memória das mensagens enviadas (conserta o "Aguardando mensagem") ----------
// Quando o celular (ou o cliente) não consegue abrir uma mensagem, o WhatsApp pede
// o reenvio ("retry"). Para reenviar, o Baileys precisa receber o conteúdo de volta
// em getMessage(); sem isto a mensagem fica pendente ("Aguardando mensagem. Essa
// ação pode levar alguns instantes") para sempre. Guardamos as últimas enviadas,
// inclusive em disco, para o reenvio funcionar mesmo depois de reiniciar.
const ARQ_ENVIADAS = path.join(path.dirname(ARQ_LID), 'enviadas.json');
const MAX_ENVIADAS = 3000;
const enviadasMemoria = new Map(); // id -> conteúdo (proto)
try {
  const bruto = JSON.parse(fs.readFileSync(ARQ_ENVIADAS, 'utf8'), BufferJSON.reviver);
  for (const [k, v] of Object.entries(bruto)) enviadasMemoria.set(k, v);
  console.log(`[retry] ${enviadasMemoria.size} mensagens enviadas na memória.`);
} catch {
  /* primeira vez */
}
let salvarEnviadasAgendado = false;
function lembrarEnviada(id, message) {
  if (!id || !message) return;
  enviadasMemoria.set(id, message);
  while (enviadasMemoria.size > MAX_ENVIADAS) enviadasMemoria.delete(enviadasMemoria.keys().next().value);
  if (salvarEnviadasAgendado) return;
  salvarEnviadasAgendado = true;
  setTimeout(() => {
    salvarEnviadasAgendado = false;
    try {
      fs.writeFileSync(ARQ_ENVIADAS, JSON.stringify(Object.fromEntries(enviadasMemoria), BufferJSON.replacer));
    } catch (e) {
      console.error('[retry] Não consegui salvar as enviadas:', e.message);
    }
  }, 5000);
}
// Contador de tentativas de reenvio por mensagem (interface de cache do Baileys).
const tentativasRetry = new Map();
const msgRetryCounterCache = {
  get: (k) => tentativasRetry.get(k),
  set: (k, v) => {
    tentativasRetry.set(k, v);
    robo?.pediuReenvio(k);
    setTimeout(() => tentativasRetry.delete(k), 60 * 60 * 1000).unref?.();
  },
  del: (k) => tentativasRetry.delete(k),
  flushAll: () => tentativasRetry.clear(),
};

async function iniciar() {
  if (iniciando) return;
  iniciando = true;
  try {
    // Antes de a biblioteca nova mexer na sessão, guarda uma cópia (volta rápida, sem precisar de QR novo).
    try {
      const copia = `${PASTA_SESSAO}-copia-antes-da-v7`;
      if (fs.existsSync(PASTA_SESSAO) && !fs.existsSync(copia)) {
        fs.cpSync(PASTA_SESSAO, copia, { recursive: true });
        console.log(`[sessão] Cópia de segurança criada em ${copia}.`);
      }
    } catch (e) {
      console.warn('[sessão] Não consegui criar a cópia de segurança:', e.message);
    }
    const { state, saveCreds } = await useMultiFileAuthState(PASTA_SESSAO);
    const { version } = await fetchLatestBaileysVersion();
    sock = makeWASocket({
      version,
      auth: state,
      logger: log,
      printQRInTerminal: false,
      browser: ['Fluxa Chat', 'Chrome', '1.0'],
      msgRetryCounterCache,
      // Devolve o conteúdo de uma mensagem nossa quando o WhatsApp pede o reenvio.
      getMessage: async (key) => (key?.id ? enviadasMemoria.get(key.id) : undefined),
    });
    const esteSock = sock; // eventos de um socket antigo (já trocado) são ignorados
    sock.ev.on('creds.update', saveCreds);
    // Contatos salvos no celular chegam ao conectar e quando mudam.
    sock.ev.on('contacts.upsert', lembrarContatos);
    sock.ev.on('contacts.update', lembrarContatos);
    sock.ev.on('chats.phoneNumberShare', ({ lid, jid }) => void aprenderLid(lid, jid));
    sock.ev.on('messaging-history.set', ({ contacts, messages }) => {
      lembrarContatos(contacts);
      void importarHistorico(messages);
    });

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (esteSock !== sock) return;
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
        void ensinarMapaBaileys([...lidParaTel.entries()]).then(() => console.log(`[lid] ${lidParaTel.size} contatos ensinados ao WhatsApp.`));
        await refConexao.set({ status: 'conectado', qr: '', codigoPareamento: '', erro: '', telefone: soDigitos(sock.user?.id ?? ''), atualizadoEm: agora() }, { merge: true });
        console.log('WhatsApp conectado.');
        if (!global.__cofreSemeado) { global.__cofreSemeado = true; void semearCofre(); }
        robo?.conectou();
        setTimeout(() => void preencherFotos(), 30000);
        // Pedido do Chat: alguém clicou numa foto que ainda não tem a versão grande → busca na hora, na frente da fila.
        if (!global.__internosOuvindo) {
          global.__internosOuvindo = true;
          base.collection('chatConexoes').doc('telefonesInternos').onSnapshot((sn) => {
            telefonesInternos.clear();
            for (const t of sn.data()?.lista ?? []) { const k = String(t.numero ?? '').replace(/\D/g, '').slice(-9); if (k.length === 9) telefonesInternos.add(k); }
            console.log(`[internos] ${telefonesInternos.size} telefone(s) interno(s) cadastrado(s).`);
          }, () => {});
        }
        if (!global.__pedirFotoOuvindo) {
          global.__pedirFotoOuvindo = true;
          base.collection('chatConexoes').doc('pedirFoto').onSnapshot(async (sn) => {
            const id = sn.data()?.conversaId;
            if (!id || !aberto) return;
            const c = await base.collection('conversas').doc(id).get();
            if (c.exists) pedirFoto(id, c.data().contatoJid, c.data(), true);
          }, () => {});
        }
        if (!global.__fotosTimer) global.__fotosTimer = setInterval(() => { if (aberto) void preencherFotos(); }, 6 * 3600 * 1000);
      }
      if (connection === 'close') {
        aberto = false;
        robo?.caiu();
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
        // Mensagens novas (notify) valem por 6 h: depois de uma queda o WhatsApp reentrega o que chegou nesse meio tempo.
        const limite = type === 'notify' ? 6 * 3600 : 600;
        if (Date.now() / 1000 - Number(msg.messageTimestamp ?? 0) > limite) continue;
        if (!msg.key?.fromMe && !robo?.ehTeste(msg.key?.id)) robo?.recebida();
        try {
          await guardarMensagem(msg);
        } catch (e) {
          console.error('Erro ao guardar mensagem:', e.message);
          void gravarComNovasTentativas(msg);
        }
      }
    });
    sock.ev.on('messages.update', (atualizacoes) => robo?.status(atualizacoes));
  } finally {
    iniciando = false;
  }
}

// O botão "Gerar QR Code" do Fluxa marca o status como "solicitado".
refConexao.onSnapshot(async (snap) => {
  // Vale também com o conector "conectado": se a sessão estragou (erros Bad MAC),
  // o botão tem que conseguir apagá-la e gerar um QR novo.
  if (snap.data()?.status === 'solicitado' && !iniciando) {
    telefoneParear = String(snap.data()?.telefoneParear ?? '').replace(/\D/g, '');
    aberto = false;
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
// AUDIO_FORMATO=ogg volta ao formato Opus; o padrão (m4a/AAC) abre também no WhatsApp do iPhone.
const FORMATO_AUDIO = (process.env.AUDIO_FORMATO || 'm4a').toLowerCase();
function paraOggOpus(buf, formato = FORMATO_AUDIO) {
  return new Promise((resolve, reject) => {
    const base = path.join(os.tmpdir(), `fluxa-audio-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.writeFileSync(`${base}.in`, buf);
    const limpar = () => {
      for (const e of ['.in', '.ogg', '.m4a', '.pcm']) fs.rmSync(base + e, { force: true });
    };
    const saida = formato === 'ogg' ? `${base}.ogg` : `${base}.m4a`;
    const argsFmt =
      formato === 'ogg'
        ? ['-c:a', 'libopus', '-application', 'voip', '-b:a', '24k', '-ar', '16000', '-ac', '1', '-f', 'ogg']
        : ['-c:a', 'aac', '-b:a', '48k', '-ar', '44100', '-ac', '1', '-movflags', '+faststart', '-f', 'ipod'];
    // Mesmo formato da mensagem de voz do próprio WhatsApp: Opus, mono, 16 kHz, dentro de Ogg.
    execFile(
      ffmpegPath,
      ['-y', '-i', `${base}.in`, '-vn', '-map_metadata', '-1', '-avoid_negative_ts', 'make_zero', ...argsFmt, saida],
      (err, _o, stderr) => {
        try {
          if (err) return reject(new Error('Falha ao converter o áudio: ' + err.message));
          const out = fs.readFileSync(saida);
          if (out.length < 200 || (formato === 'ogg' && out.slice(0, 4).toString() !== 'OggS')) return reject(new Error('Áudio convertido inválido.'));
          const t = [...String(stderr).matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].pop();
          const seconds = t ? Math.max(1, Math.round(+t[1] * 3600 + +t[2] * 60 + +t[3])) : 1;
          // Onda do áudio (64 barras de 0 a 100), como o WhatsApp mostra na mensagem de voz.
          execFile(ffmpegPath, ['-y', '-i', saida, '-f', 's16le', '-ac', '1', '-ar', '8000', `${base}.pcm`], (e2) => {
            let waveform;
            try {
              if (!e2) {
                const pcm = fs.readFileSync(`${base}.pcm`);
                const n = Math.floor(pcm.length / 2);
                const barras = 64;
                const picos = [];
                for (let i = 0; i < barras; i++) {
                  const ini = Math.floor((i * n) / barras);
                  const fim = Math.max(ini + 1, Math.floor(((i + 1) * n) / barras));
                  let pico = 0;
                  for (let j = ini; j < fim && j < n; j++) pico = Math.max(pico, Math.abs(pcm.readInt16LE(j * 2)));
                  picos.push(pico);
                }
                const max = Math.max(...picos, 1);
                waveform = new Uint8Array(picos.map((p) => Math.round((p / max) * 100)));
              }
            } catch {
              waveform = undefined;
            }
            limpar();
            resolve({ buf: out, seconds, waveform });
          });
        } catch (e) {
          limpar();
          reject(e);
        }
      }
    );
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

const FORMATO_AUDIO_ALTERNATIVO = FORMATO_AUDIO === 'ogg' ? 'm4a' : 'ogg';
function conteudoDeAudio(conv, formato) {
  return { audio: conv.buf, mimetype: formato === 'ogg' ? 'audio/ogg; codecs=opus' : 'audio/mp4', ptt: true, seconds: conv.seconds, ...(conv.waveform ? { waveform: conv.waveform } : {}) };
}

// Reenvio pelo robô: a mesma coisa, de novo, com a sessão renovada. Uma segunda tentativa só (evita mensagem repetida para quem está com o celular desligado).
// Áudio: o reenvio troca o formato (ogg/opus <-> m4a/aac), porque o problema mais comum é o aparelho do contato não abrir o formato anterior.
function refazerEnvio(destino, conteudo, dado, tentativa, audioBruto) {
  return async () => {
    if (audioBruto && dado.tipo === 'audio') {
      const fmt = tentativa === 1 ? FORMATO_AUDIO_ALTERNATIVO : FORMATO_AUDIO;
      const conv = await paraOggOpus(audioBruto, fmt);
      conteudo = conteudoDeAudio(conv, fmt);
      console.log(`[robô] reenviando o áudio no formato ${fmt} (${conv.buf.length} bytes)`);
    }
    const r = await sock.sendMessage(destino, conteudo);
    if (r?.key?.id) {
      enviadasPorNos.add(r.key.id);
      lembrarEnviada(r.key.id, r.message);
      robo?.enviada(r.key.id, {
        conversaId: dado.conversaId,
        msgId: dado.msgId,
        jid: destino,
        tipo: dado.tipo === 'audio' ? 'audio' : dado.tipo === 'midia' ? 'midia' : 'texto',
        reenvio: true,
        ...(tentativa < 2 ? { refazer: refazerEnvio(destino, conteudo, dado, tentativa + 1, audioBruto) } : {}),
      });
    }
    return r;
  };
}

const existeNoWhatsApp = new Map(); // telefone -> { ok, em }

async function enviarSaida(d) {
  const dado = d.data();
  if (dado.canal !== 'whatsapp' || processando.has(d.id)) return;
  if (dado.agendadaPara && new Date(dado.agendadaPara).getTime() > Date.now()) return; // stand-by
  processando.add(d.id);
  try {
    if (!aberto || !sock) throw new Error('WhatsApp desconectado');
    let destino = dado.paraJid || `${dado.para}@s.whatsapp.net`;
    let enviada;
    let audioBruto; // áudio original gravado no navegador (o robô reconverte em outro formato se precisar)
    let conteudo; // o que foi enviado: o robô usa para reenviar sozinho (texto, áudio, foto, vídeo ou arquivo)
    if (dado.tipo === 'audio') {
      const bruto = Buffer.from(String(dado.audioUrl).split(',')[1] ?? '', 'base64');
      const ogg = await paraOggOpus(bruto);
      console.log(`Enviando áudio de voz: ${ogg.buf.length} bytes, ${ogg.seconds}s`);
      conteudo = conteudoDeAudio(ogg, FORMATO_AUDIO);
      audioBruto = bruto;
    } else if (dado.tipo === 'midia') {
      const buf = await lerAnexo(dado);
      const legenda = dado.legenda || undefined;
      if (dado.midiaTipo === 'imagem') conteudo = { image: buf, caption: legenda };
      else if (dado.midiaTipo === 'video') conteudo = { video: buf, caption: legenda, mimetype: dado.mime || 'video/mp4' };
      else conteudo = { document: buf, mimetype: dado.mime || 'application/octet-stream', fileName: dado.nomeArquivo || 'arquivo', caption: legenda };
    } else {
      conteudo = { text: dado.texto };
    }
    if (destino.endsWith('@s.whatsapp.net')) {
      // O número tem WhatsApp? Se o WhatsApp diz que não, avisa na hora (em vez de ficar "sem confirmação").
      const tel0 = destino.split('@')[0];
      const visto = existeNoWhatsApp.get(tel0);
      let existe = visto && Date.now() - visto.em < 10 * 60 * 1000 ? visto.ok : undefined;
      let jidReal = visto && Date.now() - visto.em < 10 * 60 * 1000 ? visto.jid : undefined;
      if (existe === undefined) {
        try {
          const r = await sock.onWhatsApp(destino);
          if (Array.isArray(r) && r.length) {
            existe = r[0]?.exists !== false;
            // O WhatsApp devolve o número REAL cadastrado (ex.: sem o 9 extra em vários DDDs): é para ele que se envia.
            if (existe && typeof r[0]?.jid === 'string' && r[0].jid.endsWith('@s.whatsapp.net')) jidReal = r[0].jid;
          } else if (Array.isArray(r)) existe = false;
          if (existe !== undefined) existeNoWhatsApp.set(tel0, { ok: existe, em: Date.now(), jid: jidReal });
        } catch (err) {
          console.warn('[envio] não consegui consultar o número:', err.message);
        }
      }
      if (jidReal && jidReal !== destino) {
        const tel1 = jidReal.split('@')[0];
        console.log(`[envio] número ${tel0} corrigido para o cadastrado no WhatsApp: ${tel1}.`);
        if (dado.conversaId === `whatsapp_${tel0}`) {
          try {
            await mesclarConversas(tel0, tel1);
            dado.conversaId = `whatsapp_${tel1}`;
          } catch (err) {
            console.warn('[envio] não consegui juntar a conversa com o número correto:', err.message);
          }
        }
        destino = jidReal;
      }
      console.log(`[envio] para ${tel0}: ${existe === undefined ? 'não consultado' : existe ? 'tem WhatsApp' : 'SEM WhatsApp'}`);
      if (existe === false) throw new Error(`O número +${tel0} não tem WhatsApp. Confira o telefone em "Editar contato".`);
      const tel = destino.split('@')[0];
      const par = [...lidParaTel.entries()].find(([, t]) => t === tel);
      if (par) await ensinarMapaBaileys([par]);
    }
    // Resposta com citação: o WhatsApp mostra a mensagem original acima da resposta.
    const opcoesEnvio = dado.citadaId
      ? { quoted: { key: { remoteJid: destino, fromMe: dado.citadaDe === 'equipe', id: dado.citadaId }, message: { conversation: dado.citadaTexto ?? '' } } }
      : undefined;
    enviada = await sock.sendMessage(destino, conteudo, opcoesEnvio);
    if (enviada?.key?.id) enviadasPorNos.add(enviada.key.id);
    lembrarEnviada(enviada?.key?.id, enviada?.message);
    robo?.enviada(
      enviada?.key?.id,
      dado.msgId
        ? {
            conversaId: dado.conversaId,
            msgId: dado.msgId,
            jid: destino,
            tipo: dado.tipo === 'audio' ? 'audio' : dado.tipo === 'midia' ? 'midia' : 'texto',
            texto: dado.texto,
            // Reenvio pelo robô: a mesma coisa, de novo, com a sessão renovada.
            refazer: refazerEnvio(destino, conteudo, dado, 1, audioBruto),
          }
        : null
    );
    // Diagnóstico: confere se o WhatsApp guardou o arquivo que acabamos de enviar.
    if (dado.tipo === 'audio' || dado.tipo === 'midia') {
      const m = enviada?.message ?? {};
      const alvo = m.audioMessage ?? m.imageMessage ?? m.videoMessage ?? m.documentMessage ?? {};
      console.log(`Envio feito (node ${process.version}): url ${alvo.url ? 'ok' : 'SEM URL'}, directPath ${alvo.directPath ? 'ok' : 'SEM'}, tamanho ${alvo.fileLength ?? '?'}.`);
      void (async () => {
        try {
          const volta = await Promise.race([
            downloadMediaMessage(enviada, 'buffer', {}, { logger: log, reuploadRequest: sock.updateMediaMessage }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('demorou mais de 20 s')), 20000)),
          ]);
          console.log(`Verificação do envio: baixou de volta ${volta.length} bytes. OK.`);
        } catch (e) {
          console.error('Verificação do envio FALHOU (o WhatsApp não guardou o arquivo):', e.message);
          if (dado.tipo === 'audio' && audioBruto) {
            console.warn('[robô] áudio não ficou guardado no WhatsApp: reenviando sozinho em outro formato.');
            try { await refazerEnvio(destino, conteudo, dado, 1, audioBruto)(); } catch (e2) { console.error('[robô] reenvio do áudio falhou:', e2.message); }
          }
        }
      })();
    }
    await d.ref.update({ enviada: true, enviadaEm: agora() });
    if (dado.jaRegistrada === false) {
      const em = new Date().toISOString();
      await base.collection('conversas').doc(dado.conversaId).collection('mensagens').add({ de: 'equipe', texto: dado.texto, em, autor: dado.autor ?? '' });
      await base.collection('conversas').doc(dado.conversaId).set({ ultimaMensagem: dado.texto, ultimaEm: em, ultimaDe: 'equipe', teveResposta: true }, { merge: true });
    }
  } catch (e) {
    console.error('Falha ao enviar:', e.message);
    // Falha de conexão: o robô tenta de novo sozinho (até 5 vezes), em vez de desistir na primeira.
    const tentativas = (dado.tentativas ?? 0) + 1;
    if (/desconectado|Connection Closed|Timed Out|timed out|Stream Errored|rate-overlimit|ECONN|socket/i.test(e.message) && tentativas < 5) {
      await d.ref.update({ tentativas, proximaTentativa: new Date(Date.now() + 60000 * tentativas).toISOString(), ultimoErro: e.message }).catch(() => {});
      processando.delete(d.id);
      return;
    }
    await d.ref.update({ enviada: true, erro: e.message });
    if (dado.msgId) {
      await base.collection('conversas').doc(dado.conversaId).collection('mensagens').doc(dado.msgId).set({ erroEnvio: e.message }, { merge: true }).catch(() => {});
      await base.collection('conversas').doc(dado.conversaId).set({ alertaEntrega: true, alertaMotivo: `Falha no envio: ${String(e.message).slice(0, 120)}`, alertaEm: agora() }, { merge: true }).catch(() => {});
    }
  } finally {
    processando.delete(d.id);
  }
}

if (!MODO_TESTE) {
  supervisora = criarSupervisora({ base, agora });
  iniciarBuscaInstagram({ base });
  robo = criarRobo({
    refConexao,
    base,
    getSock: () => sock,
    estaAberto: () => aberto,
    reconectar: reconectarForcado,
    reenviar: (d) => void enviarSaida(d),
    // Reenvio feito pelo robô (mensagem nova com o mesmo texto; não gera outra mensagem na plataforma).
    reenviarTexto: async ({ jid, texto }) => {
      const r = await sock.sendMessage(jid, { text: texto });
      if (r?.key?.id) {
        enviadasPorNos.add(r.key.id);
        lembrarEnviada(r.key.id, r.message);
      }
      return r;
    },
    soDigitos,
    agora,
  });
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
