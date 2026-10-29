// Fluxa Chat — Firestore: conversas, mensagens, fila de envio e estado da
// conexão do WhatsApp (o conector fica fora do navegador e lê/grava aqui).
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  type Query,
  type QuerySnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  deleteDoc,
  where,
  Bytes,
  type Unsubscribe,
} from 'firebase/firestore';
import { db as dbCrm, dbChat as db, chatPronto, aposChatPronto, garantirLoginChat } from './firebase';
import { acaoDaColuna } from './crmLogic';
import { atualizarCampoCliente } from './crmData';
import { CRM_COLUNAS_PADRAO } from '../types';
import type { Cliente, ColunaCrm, ConexaoChat, ConversaChat, MensagemChat, TagChat } from '../types';

const conversasCol = (e: string) => collection(db, 'empresas', e, 'conversas');

/** Chave de comparação de telefone: só dígitos, últimos 11 (DDD + número). */
export function chaveTelefone(t?: string): string {
  const d = (t ?? '').replace(/\D/g, '');
  return d.length > 11 ? d.slice(-11) : d;
}

/** onSnapshot que se recupera sozinho: se o listener cair (erro de rede/quota/token), reconecta com espera crescente;
 * ao voltar o foco da aba ou a internet, reconecta na hora — mensagem nunca fica "presa" sem o usuário perceber. */
function ouvirResiliente<T>(q: Query, mapear: (snap: QuerySnapshot) => T, cb: (v: T) => void, aoErro?: () => void): Unsubscribe {
  let cancelado = false;
  let unsub: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let tentativa = 0;
  const parar = () => { if (unsub) { unsub(); unsub = null; } };
  const iniciar = () => {
    if (cancelado) return;
    parar();
    unsub = aposChatPronto(() => onSnapshot(q, (snap) => { tentativa = 0; cb(mapear(snap)); }, (err) => {
      console.warn('[chat] listener caiu, reconectando', err?.code ?? err);
      aoErro?.();
      parar();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void garantirLoginChat().then(iniciar); }, Math.min(30000, 2000 * 2 ** tentativa++));
    }));
  };
  const reviver = () => { if (!cancelado && document.visibilityState !== 'hidden') iniciar(); };
  window.addEventListener('online', reviver);
  document.addEventListener('visibilitychange', reviver);
  iniciar();
  return () => {
    cancelado = true;
    if (timer) clearTimeout(timer);
    window.removeEventListener('online', reviver);
    document.removeEventListener('visibilitychange', reviver);
    parar();
  };
}

/** Todas as conversas (até 5000) — usada para mostrar a data da última conversa de cada cliente. */
export function ouvirTodasConversas(empresaId: string, cb: (c: ConversaChat[]) => void): Unsubscribe {
  const q = query(conversasCol(empresaId), orderBy('ultimaEm', 'desc'), limit(5000));
  return ouvirResiliente(q, (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ConversaChat), cb);
}

export function ouvirConversas(empresaId: string, cb: (c: ConversaChat[]) => void): Unsubscribe {
  const q = query(conversasCol(empresaId), orderBy('ultimaEm', 'desc'), limit(300));
  return ouvirResiliente(q, (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ConversaChat), cb);
}

export function ouvirMensagens(empresaId: string, conversaId: string, cb: (m: MensagemChat[]) => void): Unsubscribe {
  const q = query(collection(db, 'empresas', empresaId, 'conversas', conversaId, 'mensagens'), orderBy('em', 'desc'), limit(300));
  // As 300 mais NOVAS (antes eram as 300 mais antigas: conversa longa parava de mostrar mensagem nova), já em ordem cronológica.
  return ouvirResiliente(q, (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }) as MensagemChat).reverse(), cb);
}

export interface SugestaoSupervisora {
  estagio?: string;
  leitura?: string;
  tecnica?: string;
  sugestao?: string;
  alternativa?: string;
  atencao?: string;
  dica?: string;
  paraMensagem?: string;
  geradoEm?: string;
  erro?: string;
}

/** A supervisora só escreve aqui; o navegador só lê. */
export function ouvirSupervisora(empresaId: string, conversaId: string, cb: (s: SugestaoSupervisora | null) => void): Unsubscribe {
  return aposChatPronto(() =>
    onSnapshot(doc(db, 'empresas', empresaId, 'conversas', conversaId, 'supervisora', 'atual'), (snap) => cb(snap.exists() ? (snap.data() as SugestaoSupervisora) : null))
  );
}

export function ouvirConexaoWhatsapp(empresaId: string, cb: (c: ConexaoChat) => void): Unsubscribe {
  return aposChatPronto(() => onSnapshot(doc(db, 'empresas', empresaId, 'chatConexoes', 'whatsapp'), (snap) => {
    cb(snap.exists() ? (snap.data() as ConexaoChat) : { status: 'desconectado' });
  }));
}

/** Pede ao conector que gere um QR Code novo. */
export async function solicitarConexaoWhatsapp(empresaId: string, telefoneParear = '') {
  await chatPronto;
  await setDoc(
    doc(db, 'empresas', empresaId, 'chatConexoes', 'whatsapp'),
    { status: 'solicitado', qr: '', codigoPareamento: '', erro: '', telefoneParear, atualizadoEm: new Date().toISOString() },
    { merge: true }
  );
}

/** Pega o atendimento da conversa para o vendedor. */

/** "Cofre" de contatos salvos: cópia do que a equipe definiu (nome salvo, vendedor, cliente do CRM, etiquetas), guardada por
 * telefone. Se a conversa for recriada (reconexão do WhatsApp, troca de identificador), o conector restaura daqui. */
export async function espelharNoCofre(empresaId: string, conversaId: string): Promise<void> {
  try {
    const snap = await getDoc(doc(db, 'empresas', empresaId, 'conversas', conversaId));
    const c = snap.data() as Partial<ConversaChat> | undefined;
    const tel = (c?.telefone ?? c?.contato ?? '').replace(/\D/g, '');
    if (!c || tel.length < 10) return;
    const dados: Record<string, unknown> = { telefone: tel, atualizadoEm: new Date().toISOString() };
    if (c.salvo) { dados.salvo = true; dados.nome = c.nome ?? ''; }
    if (c.vendedorLogin) { dados.vendedorLogin = c.vendedorLogin; dados.vendedorNome = c.vendedorNome ?? ''; dados.atendimentoEm = c.atendimentoEm ?? ''; }
    else dados.vendedorLogin = '';
    if (c.clienteId) dados.clienteId = c.clienteId;
    if (c.tags && c.tags.length > 0) dados.tags = c.tags;
    await setDoc(doc(db, 'empresas', empresaId, 'contatosSalvos', tel.slice(-11)), dados, { merge: true });
  } catch (e) {
    console.warn('[cofre] não consegui guardar o contato', e);
  }
}

export async function assumirConversa(empresaId: string, conversaId: string, login: string, nome: string, clienteId?: string) {
  await chatPronto;
  await updateDoc(doc(db, 'empresas', empresaId, 'conversas', conversaId), {
    vendedorLogin: login,
    vendedorNome: nome,
    atendimentoEm: new Date().toISOString(),
    naoLidas: 0,
    ...(clienteId ? { clienteId } : {}),
  });
  void espelharNoCofre(empresaId, conversaId);
}

export async function liberarConversa(empresaId: string, conversaId: string) {
  await chatPronto;
  await updateDoc(doc(db, 'empresas', empresaId, 'conversas', conversaId), {
    vendedorLogin: null,
    vendedorNome: null,
    atendimentoEm: null,
  });
  void espelharNoCofre(empresaId, conversaId);
}

/** Envia a mensagem agora, ou a deixa agendada (agendarPara = ISO) na fila.
 * Mensagem agendada só entra na conversa quando o conector a envia. */
export async function enviarMensagemChat(
  empresaId: string,
  conversa: ConversaChat,
  texto: string,
  autor: string,
  agendarPara?: string,
  citada?: { id: string; texto: string; de: 'cliente' | 'equipe'; autor?: string }
) {
  const agora = new Date().toISOString();
  let msgId: string | undefined;
  if (!agendarPara) {
    const ref = await addDoc(collection(db, 'empresas', empresaId, 'conversas', conversa.id, 'mensagens'), {
      de: 'equipe',
      texto,
      em: agora,
      autor,
      ...(citada ? { citada: { id: citada.id, texto: citada.texto.slice(0, 200), de: citada.de, ...(citada.autor ? { autor: citada.autor } : {}) } } : {}),
    });
    msgId = ref.id;
    await updateDoc(doc(db, 'empresas', empresaId, 'conversas', conversa.id), {
      ultimaMensagem: texto,
      ultimaEm: agora,
      ultimaDe: 'equipe',
      teveResposta: true,
    });
  }
  await addDoc(collection(db, 'empresas', empresaId, 'chatSaida'), {
    conversaId: conversa.id,
    canal: conversa.canal,
    para: conversa.contato,
    ...(conversa.contatoJid ? { paraJid: conversa.contatoJid } : {}),
    texto,
    autor,
    criadoEm: agora,
    enviada: false,
    jaRegistrada: !agendarPara, // imediata: o app já gravou a mensagem na conversa
    ...(msgId ? { msgId } : {}),
    ...(citada ? { citadaId: citada.id, citadaTexto: citada.texto.slice(0, 200), citadaDe: citada.de } : {}),
    ...(agendarPara ? { agendadaPara: agendarPara } : {}),
  });
}

/** Encaminha uma mensagem para outra conversa: texto, foto e áudio seguem como estão; vídeo/arquivo seguem como link do Drive. */
export async function encaminharMensagem(empresaId: string, msg: MensagemChat, destino: ConversaChat, autor: string): Promise<void> {
  const ehRotulo = !!msg.texto && msg.texto.startsWith('[');
  const legenda = ehRotulo ? '' : msg.texto;
  if (msg.midiaUrl && !msg.midiaPartes && msg.midiaTipo === 'imagem') {
    const blob = await (await fetch(msg.midiaUrl)).blob();
    await enviarAnexoChat(empresaId, destino, blob, msg.midiaNome || 'foto.jpg', legenda, autor);
    return;
  }
  if (msg.midiaUrl && !msg.midiaPartes && msg.midiaTipo === 'audio') {
    await enviarAudioChat(empresaId, destino, msg.midiaUrl, autor);
    return;
  }
  if (msg.midiaTipo) {
    if (msg.midiaLink) {
      await enviarMensagemChat(empresaId, destino, `${legenda ? legenda + '\n' : ''}${msg.midiaLink}`, autor);
      return;
    }
    throw new Error('Esta mídia não pode ser encaminhada (só existe no celular). Reenvie o arquivo pelo celular.');
  }
  await enviarMensagemChat(empresaId, destino, msg.texto, autor);
}

/** Envia um áudio (data URL gravado no navegador) pelo WhatsApp. O conector converte
 * para o formato de mensagem de voz do WhatsApp e envia. */
export async function enviarAudioChat(empresaId: string, conversa: ConversaChat, audioUrl: string, autor: string) {
  await chatPronto;
  const agora = new Date().toISOString();
  const ref = await addDoc(collection(db, 'empresas', empresaId, 'conversas', conversa.id, 'mensagens'), {
    de: 'equipe',
    texto: '[áudio]',
    em: agora,
    autor,
    midiaTipo: 'audio',
    midiaUrl: audioUrl,
  });
  await updateDoc(doc(db, 'empresas', empresaId, 'conversas', conversa.id), {
    ultimaMensagem: '🎤 Áudio',
    ultimaEm: agora,
    ultimaDe: 'equipe',
      teveResposta: true,
  });
  await addDoc(collection(db, 'empresas', empresaId, 'chatSaida'), {
    conversaId: conversa.id,
    canal: conversa.canal,
    para: conversa.contato,
    ...(conversa.contatoJid ? { paraJid: conversa.contatoJid } : {}),
    tipo: 'audio',
    msgId: ref.id,
    audioUrl,
    texto: '[áudio]',
    autor,
    criadoEm: agora,
    enviada: false,
    jaRegistrada: true,
  });
}

const MAX_INLINE = 700_000; // cabe dentro do documento da mensagem
const TAM_PARTE = 800_000;
const MAX_ANEXO = 20_000_000;

function lerDataUrl(blob: Blob): Promise<string> {
  return new Promise((ok, erro) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => erro(new Error('Não consegui ler o arquivo.'));
    r.readAsDataURL(blob);
  });
}

/** Reduz foto/print (JPEG, até 1600 px) para caber na mensagem. */
async function comprimirImagem(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const escala = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * escala);
  c.height = Math.round(bmp.height * escala);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  let q = 0.85;
  let out: Blob | null = null;
  while (q >= 0.4) {
    out = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', q));
    if (out && out.size <= MAX_INLINE) return out;
    q -= 0.15;
  }
  if (!out) throw new Error('Não consegui preparar a imagem.');
  return out;
}

/** Anexa foto, vídeo ou documento (ou print colado) e envia pelo WhatsApp. */
export async function enviarAnexoChat(empresaId: string, conversa: ConversaChat, arquivo: File | Blob, nomeArq: string, legenda: string, autor: string) {
  await chatPronto;
  let blob: Blob = arquivo;
  let mime = arquivo.type || 'application/octet-stream';
  const tipo: 'imagem' | 'video' | 'documento' = mime.startsWith('image/') ? 'imagem' : mime.startsWith('video/') ? 'video' : 'documento';
  if (tipo === 'imagem') {
    blob = await comprimirImagem(blob);
    mime = 'image/jpeg';
  }
  if (blob.size > MAX_ANEXO) throw new Error('Arquivo grande demais (limite de 20 MB).');
  const agora = new Date().toISOString();
  const rotulo = tipo === 'imagem' ? '[imagem]' : tipo === 'video' ? '[vídeo]' : '[documento]';
  const msgCol = collection(db, 'empresas', empresaId, 'conversas', conversa.id, 'mensagens');
  const base = { de: 'equipe', texto: legenda || rotulo, em: agora, autor, midiaTipo: tipo, midiaNome: nomeArq, midiaMime: mime };
  let ref;
  if (blob.size <= MAX_INLINE && tipo === 'imagem') {
    ref = await addDoc(msgCol, { ...base, midiaUrl: await lerDataUrl(blob) });
  } else {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const n = Math.ceil(bytes.length / TAM_PARTE);
    ref = await addDoc(msgCol, { ...base, midiaPartes: n });
    for (let i = 0; i < n; i++) {
      await setDoc(doc(db, 'empresas', empresaId, 'conversas', conversa.id, 'mensagens', ref.id, 'partes', String(i).padStart(4, '0')), {
        n: i,
        dados: Bytes.fromUint8Array(bytes.subarray(i * TAM_PARTE, (i + 1) * TAM_PARTE)),
      });
    }
  }
  await updateDoc(doc(db, 'empresas', empresaId, 'conversas', conversa.id), {
    ultimaMensagem: legenda || (tipo === 'imagem' ? '📷 Foto' : tipo === 'video' ? '🎥 Vídeo' : `📎 ${nomeArq}`),
    ultimaEm: agora,
    ultimaDe: 'equipe',
      teveResposta: true,
  });
  await addDoc(collection(db, 'empresas', empresaId, 'chatSaida'), {
    conversaId: conversa.id,
    canal: conversa.canal,
    para: conversa.contato,
    ...(conversa.contatoJid ? { paraJid: conversa.contatoJid } : {}),
    tipo: 'midia',
    msgId: ref.id,
    midiaTipo: tipo,
    mime,
    nomeArquivo: nomeArq,
    legenda,
    texto: legenda || rotulo,
    autor,
    criadoEm: agora,
    enviada: false,
    jaRegistrada: true,
  });
}

/** Passa o atendimento para outro vendedor (e o cliente do CRM vinculado, se houver). */
export async function transferirConversa(
  empresaId: string,
  conversa: ConversaChat,
  de: string,
  para: { login: string; nome: string }
) {
  await chatPronto;
  const agora = new Date().toISOString();
  await updateDoc(doc(db, 'empresas', empresaId, 'conversas', conversa.id), {
    vendedorLogin: para.login,
    vendedorNome: para.nome,
    atendimentoEm: agora,
  });
  void espelharNoCofre(empresaId, conversa.id);
  await addDoc(collection(db, 'empresas', empresaId, 'conversas', conversa.id, 'mensagens'), {
    de: 'equipe',
    texto: `🔁 Atendimento transferido de ${de} para ${para.nome}`,
    em: agora,
    autor: 'Sistema',
    interna: true,
  });
  if (conversa.clienteId) {
    try {
      await atualizarCampoCliente(empresaId, conversa.clienteId, { crmVendedorLogin: para.login });
    } catch (e) {
      console.error('Transferência no CRM:', e);
    }
  }
}

/** Telefone só com dígitos. Com "+" na frente (ou 11 dígitos que não são celular brasileiro) é número internacional e não leva o 55. */
export function normalizarTelefone(telefone: string): string {
  const t = telefone.trim();
  const d = t.replace(/\D/g, '');
  if (t.startsWith('+') || t.startsWith('00')) return t.startsWith('00') ? d.slice(2) : d;
  if (d.length === 11 && d[2] !== '9') return d; // ex.: 1 508 309 5403 (EUA): celular brasileiro tem 9 depois do DDD
  if (d.length === 10 || d.length === 11) return `55${d}`; // DDD + número → inclui o país
  return d;
}

const DDDS_BR = new Set(['11','12','13','14','15','16','17','18','19','21','22','24','27','28','31','32','33','34','35','37','38','41','42','43','44','45','46','47','48','49','51','53','54','55','61','62','63','64','65','66','67','68','69','71','73','74','75','77','79','81','82','83','84','85','86','87','88','89','91','92','93','94','95','96','97','98','99']);

/** Telefone antigo de celular (DDD + 8 dígitos começando em 6–9) ganha o 9 na frente, como o WhatsApp exige. */
export function corrigirNonoDigito(telefone: string): string {
  const bruto = telefone.trim();
  let d = bruto.replace(/\D/g, '');
  if (bruto.startsWith('+')) return d;
  const tinha55 = d.startsWith('55') && (d.length === 12 || d.length === 13);
  if (tinha55) d = d.slice(2);
  if (d.length === 10 && DDDS_BR.has(d.slice(0, 2)) && /^[6-9]/.test(d.slice(2))) d = d.slice(0, 2) + '9' + d.slice(2);
  return tinha55 ? '55' + d : d;
}

/** Confere se o telefone parece um número de WhatsApp de verdade. Devolve a mensagem de erro, ou null se estiver certo. */
export function validarTelefoneWhatsApp(telefone: string): string | null {
  const d = normalizarTelefone(telefone);
  if (!d) return 'Número inválido. Informe o telefone com DDD.';
  if (/^(\d)\1+$/.test(d)) return 'Número inválido. Adicione o número correto.';
  const bruto = telefone.trim();
  const soDig = bruto.replace(/\D/g, '');
  const comPais = bruto.startsWith('+') || bruto.startsWith('00');
  if (!comPais && !soDig.startsWith('55')) {
    // Sem "+" é número do Brasil: DDD + 8 ou 9 dígitos. Dígito a mais ou a menos costuma ser erro de digitação.
    if (soDig.length > 11) return 'Número inválido: tem dígitos a mais. Para número de fora do Brasil comece com + e o código do país. Adicione o número correto.';
    if (soDig.length === 11 && soDig[0] !== '1' && DDDS_BR.has(soDig.slice(0, 2)) && soDig[2] !== '9') return 'Número inválido: celular com DDD precisa do 9 na frente (DDD + 9 + 8 dígitos). Adicione o número correto.';
  }
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const num = d.slice(4);
    if (!DDDS_BR.has(ddd)) return `Número inválido: o DDD ${ddd} não existe. Adicione o número correto.`;
    if (num.length === 9 && num[0] !== '9') return 'Número inválido: celular com 9 dígitos precisa começar com 9 depois do DDD. Adicione o número correto.';
    if (num.length === 8 && /^[6-9]/.test(num)) return 'Número inválido: celular precisa do 9 na frente (DDD + 9 + número). Adicione o número correto.';
    return null;
  }
  if (d.startsWith('55')) return 'Número inválido: telefone do Brasil tem DDD + 8 ou 9 dígitos. Adicione o número correto.';
  if (d.length < 8 || d.length > 15) return 'Número inválido. Informe DDD + número (ou +país para número de fora do Brasil). Adicione o número correto.';
  if (d.startsWith('0')) return 'Número inválido. Adicione o número correto.';
  return null;
}

/** Cria (ou reabre) um contato dentro do Fluxa Chat, já salvo na agenda e no nome de quem cadastrou. */
export async function criarContatoChat(empresaId: string, nome: string, telefone: string): Promise<ConversaChat> {
  await chatPronto;
  const d = normalizarTelefone(telefone);
  const erroTel = validarTelefoneWhatsApp(telefone);
  if (erroTel) throw new Error(erroTel);
  const id = `whatsapp_${d}`;
  const ref = doc(db, 'empresas', empresaId, 'conversas', id);
  const atual = await getDoc(ref);
  const agora = new Date().toISOString();
  if (atual.exists()) {
    await updateDoc(ref, { nome, salvo: true });
    return { id, ...(atual.data() as Omit<ConversaChat, 'id'>), nome, salvo: true };
  }
  const nova = {
    canal: 'whatsapp' as const,
    contato: d,
    telefone: d,
    contatoJid: `${d}@s.whatsapp.net`,
    nome,
    salvo: true,
    ultimaMensagem: '',
    ultimaEm: agora,
    ultimaDe: 'equipe' as const,
    teveResposta: true,
  };
  await setDoc(ref, nova);
  return { id, ...nova };
}

/** Acompanha UMA conversa pelo id (para abrir conversas que não estão entre as 300 mais recentes da lista). */
export function ouvirConversaUnica(empresaId: string, conversaId: string, cb: (c: ConversaChat | null) => void): Unsubscribe {
  return aposChatPronto(() =>
    onSnapshot(doc(db, 'empresas', empresaId, 'conversas', conversaId), (snap) => cb(snap.exists() ? ({ id: snap.id, ...(snap.data() as Omit<ConversaChat, 'id'>) }) : null), () => cb(null))
  );
}

/** Abre a conversa de um telefone: se já existe (mesmo fora da lista das 300 mais recentes), devolve como está,
 * sem trocar o nome salvo; se não existe, cria o contato. */
export async function abrirContatoChat(empresaId: string, nome: string, telefone: string): Promise<ConversaChat> {
  await chatPronto;
  const d = normalizarTelefone(telefone);
  if (!validarTelefoneWhatsApp(telefone)) {
    const atual = await getDoc(doc(db, 'empresas', empresaId, 'conversas', `whatsapp_${d}`));
    if (atual.exists()) return { id: atual.id, ...(atual.data() as Omit<ConversaChat, 'id'>) };
  }
  return criarContatoChat(empresaId, nome, telefone);
}

export interface MensagemAgendada {
  id: string;
  texto: string;
  agendadaPara: string;
}

export function ouvirAgendadas(empresaId: string, conversaId: string, cb: (m: MensagemAgendada[]) => void): Unsubscribe {
  const q = query(collection(db, 'empresas', empresaId, 'chatSaida'), where('conversaId', '==', conversaId), where('enviada', '==', false));
  return aposChatPronto(() => onSnapshot(q, (snap) => {
    const itens = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as { texto: string; agendadaPara?: string }) }))
      .filter((x): x is MensagemAgendada => !!x.agendadaPara)
      .sort((a, b) => a.agendadaPara.localeCompare(b.agendadaPara));
    cb(itens);
  }));
}

export async function cancelarAgendada(empresaId: string, id: string) {
  await chatPronto;
  await deleteDoc(doc(db, 'empresas', empresaId, 'chatSaida', id));
}

/** Encontra o cliente do CRM pelo telefone da conversa. */
export function acharClientePorTelefone(clientes: Cliente[], telefone?: string): Cliente | undefined {
  const k = chaveTelefone(telefone);
  if (k.length < 8) return undefined;
  return clientes.find((c) => chaveTelefone(c.telefone) === k);
}

export function ouvirTags(empresaId: string, cb: (t: TagChat[]) => void): Unsubscribe {
  return aposChatPronto(() => onSnapshot(collection(db, 'empresas', empresaId, 'chatTags'), (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TagChat, 'id'>) })).sort((a, b) => a.nome.localeCompare(b.nome)));
  }));
}

export async function salvarTag(empresaId: string, nome: string, cor: string) {
  await chatPronto;
  await addDoc(collection(db, 'empresas', empresaId, 'chatTags'), { nome, cor });
}

export async function excluirTag(empresaId: string, id: string) {
  await chatPronto;
  await deleteDoc(doc(db, 'empresas', empresaId, 'chatTags', id));
}

export async function definirTagsConversa(empresaId: string, conversaId: string, tags: string[]) {
  await chatPronto;
  await updateDoc(doc(db, 'empresas', empresaId, 'conversas', conversaId), { tags });
  void espelharNoCofre(empresaId, conversaId);
}

export interface LigacaoChat {
  id: string;
  tipo: 'feita' | 'recebida';
  em: string; // ISO
  vendedorLogin: string;
  vendedorNome: string;
  conversaId?: string;
}

export async function registrarLigacao(empresaId: string, l: Omit<LigacaoChat, 'id' | 'em'>) {
  await chatPronto;
  await addDoc(collection(db, 'empresas', empresaId, 'chatLigacoes'), { ...l, em: new Date().toISOString() });
}

/** Ligações de hoje (a partir da meia-noite do navegador). */
export function ouvirLigacoesHoje(empresaId: string, cb: (l: LigacaoChat[]) => void): Unsubscribe {
  const inicio = new Date();
  inicio.setHours(0, 0, 0, 0);
  const q = query(collection(db, 'empresas', empresaId, 'chatLigacoes'), where('em', '>=', inicio.toISOString()));
  return aposChatPronto(() => onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LigacaoChat, 'id'>) })))));
}

/** Salva o contato na agenda do Fluxa Chat com o nome escolhido (o da agenda do celular ou outro). */
/** Edita um contato já salvo: nome e (opcional) telefone. */
/** Edita o contato. Se o telefone mudou, a conversa inteira (com o histórico) passa para o número certo,
 * e as próximas mensagens já saem para ele. Devolve o id da conversa (que muda quando o telefone muda). */
export async function editarContatoChat(empresaId: string, conversaId: string, dados: { nome: string; telefone?: string }): Promise<string> {
  await chatPronto;
  const ref = doc(db, 'empresas', empresaId, 'conversas', conversaId);
  const atual = await getDoc(ref);
  const dadosAtuais = (atual.data() ?? {}) as Partial<ConversaChat>;
  const novo = dados.telefone ? normalizarTelefone(dados.telefone) : '';
  if (dados.telefone) {
    const erroTel = validarTelefoneWhatsApp(dados.telefone);
    if (erroTel) throw new Error(erroTel);
  }
  const mudou = !!novo && dadosAtuais.canal === 'whatsapp' && novo !== dadosAtuais.contato && `whatsapp_${novo}` !== conversaId;
  if (!mudou) {
    await updateDoc(ref, { nome: dados.nome, salvo: true, ...(novo ? { telefone: novo } : {}) });
    void espelharNoCofre(empresaId, conversaId);
    return conversaId;
  }
  if (novo.length < 10) throw new Error('Telefone inválido. Informe DDD + número (ou +país para número de fora do Brasil).');
  const novoId = `whatsapp_${novo}`;
  const novaRef = doc(db, 'empresas', empresaId, 'conversas', novoId);
  const existente = await getDoc(novaRef);
  const msgs = await getDocs(collection(ref, 'mensagens'));
  for (const m of msgs.docs) await setDoc(doc(novaRef, 'mensagens', m.id), m.data()); // copia o histórico
  const campos = { ...(atual.data() ?? {}), contato: novo, telefone: novo, contatoJid: `${novo}@s.whatsapp.net`, nome: dados.nome, salvo: true };
  if (existente.exists()) {
    const e = existente.data() as Partial<ConversaChat>;
    const maisRecente = (e.ultimaEm ?? '') > (dadosAtuais.ultimaEm ?? '');
    await setDoc(novaRef, maisRecente ? { ...campos, ultimaMensagem: e.ultimaMensagem, ultimaEm: e.ultimaEm, ultimaDe: e.ultimaDe } : campos, { merge: true });
  } else {
    await setDoc(novaRef, campos);
  }
  for (const m of msgs.docs) await deleteDoc(m.ref); // só depois de copiar tudo
  await deleteDoc(ref);
  return novoId;
}

export async function salvarContatoChat(empresaId: string, conversaId: string, nome: string) {
  await chatPronto;
  await updateDoc(doc(db, 'empresas', empresaId, 'conversas', conversaId), { nome, salvo: true });
  void espelharNoCofre(empresaId, conversaId);
}

/** Quando o telefone salvo no cadastro do cliente bate com uma conversa do Chat,
 * o cliente vai para a coluna "em atendimento" do CRM com o vendedor e a conversa
 * fica vinculada a ele. Devolve true se vinculou. */
export async function vincularPorTelefone(
  empresaId: string,
  clienteId: string,
  telefone: string,
  vendedor: { login: string; nome: string }
): Promise<boolean> {
  const k = chaveTelefone(telefone);
  if (k.length < 10) return false;
  const snap = await getDocs(query(conversasCol(empresaId), orderBy('ultimaEm', 'desc'), limit(300)));
  const conversa = snap.docs.find((d) => chaveTelefone((d.data() as ConversaChat).telefone) === k);
  if (!conversa) return false;
  const dados = conversa.data() as ConversaChat;
  // Atendimento de outro vendedor não é tomado.
  if (dados.vendedorLogin && dados.vendedorLogin !== vendedor.login) return false;
  const emp = await getDoc(doc(dbCrm, 'empresas', empresaId));
  const salvas = (emp.data()?.crmColunas ?? []) as ColunaCrm[];
  const colunas = salvas.length > 0 ? salvas : CRM_COLUNAS_PADRAO; // empresa nova usa o funil padrão
  const colAtend = colunas.find((c) => acaoDaColuna(c) === 'atendimento');
  if (!colAtend) return false;
  const agora = new Date().toISOString();
  await updateDoc(doc(dbCrm, 'empresas', empresaId, 'clientes', clienteId), {
    crmColunaId: colAtend.id,
    crmVendedorLogin: vendedor.login,
    crmColunaChangedAt: agora,
  });
  await assumirConversa(empresaId, conversa.id, vendedor.login, vendedor.nome, clienteId);
  return true;
}

/** Junta as partes de um vídeo/áudio longo guardado no banco e devolve uma URL tocável. */
export async function carregarMidiaPartes(empresaId: string, conversaId: string, msgId: string, mime: string): Promise<string> {
  await chatPronto;
  const snap = await getDocs(query(collection(db, 'empresas', empresaId, 'conversas', conversaId, 'mensagens', msgId, 'partes'), orderBy('n', 'asc')));
  const pedacos = snap.docs.map((d) => (d.data().dados as { toUint8Array(): Uint8Array }).toUint8Array() as BlobPart);
  if (pedacos.length === 0) throw new Error('Vídeo ainda não terminou de chegar. Tente de novo em instantes.');
  return URL.createObjectURL(new Blob(pedacos, { type: mime }));
}

/** A equipe desistiu do contato: o robô para de reenviar e o aviso de entrega some. */
export async function desistirDoContato(empresaId: string, conversaId: string) {
  await chatPronto;
  await updateDoc(doc(db, 'empresas', empresaId, 'conversas', conversaId), { roboDesistiu: true, alertaEntrega: false, alertaMotivo: null });
}

/** A equipe (um vendedor, não o robô) mandou mensagem a este telefone no Chat desde o momento dado?
 * É o que vale como "contato feito": só anotar no histórico do cliente não conta. */
export async function houveContatoNoChat(empresaId: string, telefone: string | undefined, desdeISO: string): Promise<boolean> {
  const k = chaveTelefone(telefone);
  if (k.length < 10) return false;
  await chatPronto;
  const snap = await getDocs(query(conversasCol(empresaId), orderBy('ultimaEm', 'desc'), limit(1000)));
  const conversas = snap.docs.filter((d) => chaveTelefone((d.data() as ConversaChat).telefone ?? (d.data() as ConversaChat).contato) === k);
  for (const c of conversas) {
    const ms = await getDocs(query(collection(db, 'empresas', empresaId, 'conversas', c.id, 'mensagens'), orderBy('em', 'desc'), limit(60)));
    if (ms.docs.some((m) => {
      const d = m.data() as MensagemChat;
      return d.de === 'equipe' && d.autor !== 'Robô' && d.em >= desdeISO;
    })) return true;
  }
  return false;
}

/** Pede ao conector a foto de perfil em alta qualidade (se ainda não existir) e entrega assim que ela estiver disponível. */
export function ouvirFotoGrande(empresaId: string, conversaId: string, pedir: boolean, cb: (grande: string) => void): Unsubscribe {
  if (pedir) {
    void chatPronto.then(() => setDoc(doc(db, 'empresas', empresaId, 'chatConexoes', 'pedirFoto'), { conversaId, em: new Date().toISOString() })).catch(() => {});
  }
  return aposChatPronto(() => onSnapshot(doc(db, 'empresas', empresaId, 'chatConexoes', `foto_${conversaId}`), (sn) => {
    const g = sn.data()?.grande as string | undefined;
    if (g) cb(g);
  }, () => {}));
}

// ---------- telefones internos (diretoria, financeiro, setores): ninguém "assume" esses atendimentos ----------
export interface TelefoneInterno { id: string; numero: string; nome: string; setor?: string }

const refInternos = (empresaId: string) => doc(db, 'empresas', empresaId, 'chatConexoes', 'telefonesInternos');

export function ouvirTelefonesInternos(empresaId: string, cb: (l: TelefoneInterno[]) => void): Unsubscribe {
  return aposChatPronto(() => onSnapshot(refInternos(empresaId), (sn) => cb(((sn.data()?.lista ?? []) as TelefoneInterno[])), () => cb([])));
}

export async function salvarTelefonesInternos(empresaId: string, lista: TelefoneInterno[]) {
  await chatPronto;
  await setDoc(refInternos(empresaId), { lista, atualizadoEm: new Date().toISOString() });
}

/** Últimos 9 dígitos: compara o telefone com ou sem DDI/DDD/nono dígito. */
export const fim9 = (t?: string) => (t ?? '').replace(/\D/g, '').slice(-9);
