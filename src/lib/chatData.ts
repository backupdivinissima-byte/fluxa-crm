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
  orderBy,
  query,
  setDoc,
  updateDoc,
  deleteDoc,
  where,
  Bytes,
  type Unsubscribe,
} from 'firebase/firestore';
import { db as dbCrm, dbChat as db, chatPronto, aposChatPronto } from './firebase';
import { acaoDaColuna } from './crmLogic';
import { atualizarCampoCliente } from './crmData';
import type { Cliente, ColunaCrm, ConexaoChat, ConversaChat, MensagemChat, TagChat } from '../types';

const conversasCol = (e: string) => collection(db, 'empresas', e, 'conversas');

/** Chave de comparação de telefone: só dígitos, últimos 11 (DDD + número). */
export function chaveTelefone(t?: string): string {
  const d = (t ?? '').replace(/\D/g, '');
  return d.length > 11 ? d.slice(-11) : d;
}

export function ouvirConversas(empresaId: string, cb: (c: ConversaChat[]) => void): Unsubscribe {
  const q = query(conversasCol(empresaId), orderBy('ultimaEm', 'desc'), limit(300));
  return aposChatPronto(() => onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ConversaChat))));
}

export function ouvirMensagens(empresaId: string, conversaId: string, cb: (m: MensagemChat[]) => void): Unsubscribe {
  const q = query(collection(db, 'empresas', empresaId, 'conversas', conversaId, 'mensagens'), orderBy('em', 'asc'), limit(300));
  return aposChatPronto(() => onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as MensagemChat))));
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
export async function assumirConversa(empresaId: string, conversaId: string, login: string, nome: string, clienteId?: string) {
  await chatPronto;
  await updateDoc(doc(db, 'empresas', empresaId, 'conversas', conversaId), {
    vendedorLogin: login,
    vendedorNome: nome,
    atendimentoEm: new Date().toISOString(),
    naoLidas: 0,
    ...(clienteId ? { clienteId } : {}),
  });
}

export async function liberarConversa(empresaId: string, conversaId: string) {
  await chatPronto;
  await updateDoc(doc(db, 'empresas', empresaId, 'conversas', conversaId), {
    vendedorLogin: null,
    vendedorNome: null,
    atendimentoEm: null,
  });
}

/** Envia a mensagem agora, ou a deixa agendada (agendarPara = ISO) na fila.
 * Mensagem agendada só entra na conversa quando o conector a envia. */
export async function enviarMensagemChat(
  empresaId: string,
  conversa: ConversaChat,
  texto: string,
  autor: string,
  agendarPara?: string
) {
  const agora = new Date().toISOString();
  let msgId: string | undefined;
  if (!agendarPara) {
    const ref = await addDoc(collection(db, 'empresas', empresaId, 'conversas', conversa.id, 'mensagens'), {
      de: 'equipe',
      texto,
      em: agora,
      autor,
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
    ...(agendarPara ? { agendadaPara: agendarPara } : {}),
  });
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

/** Cria (ou reabre) um contato dentro do Fluxa Chat, já salvo na agenda e no nome de quem cadastrou. */
export async function criarContatoChat(empresaId: string, nome: string, telefone: string): Promise<ConversaChat> {
  await chatPronto;
  let d = telefone.replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`; // DDD + número → inclui o país
  if (d.length < 12) throw new Error('Telefone inválido. Informe DDD + número.');
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
export async function editarContatoChat(empresaId: string, conversaId: string, dados: { nome: string; telefone?: string }) {
  await chatPronto;
  await updateDoc(doc(db, 'empresas', empresaId, 'conversas', conversaId), {
    nome: dados.nome,
    salvo: true,
    ...(dados.telefone ? { telefone: dados.telefone } : {}),
  });
}

export async function salvarContatoChat(empresaId: string, conversaId: string, nome: string) {
  await chatPronto;
  await updateDoc(doc(db, 'empresas', empresaId, 'conversas', conversaId), { nome, salvo: true });
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
  const colunas = (emp.data()?.crmColunas ?? []) as ColunaCrm[];
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
