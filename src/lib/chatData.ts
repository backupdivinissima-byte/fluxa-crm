// Fluxa Chat — Firestore: conversas, mensagens, fila de envio e estado da
// conexão do WhatsApp (o conector fica fora do navegador e lê/grava aqui).
import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Cliente, ConexaoChat, ConversaChat, MensagemChat } from '../types';

const conversasCol = (e: string) => collection(db, 'empresas', e, 'conversas');

/** Chave de comparação de telefone: só dígitos, últimos 11 (DDD + número). */
export function chaveTelefone(t?: string): string {
  const d = (t ?? '').replace(/\D/g, '');
  return d.length > 11 ? d.slice(-11) : d;
}

export function ouvirConversas(empresaId: string, cb: (c: ConversaChat[]) => void): Unsubscribe {
  const q = query(conversasCol(empresaId), orderBy('ultimaEm', 'desc'), limit(300));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ConversaChat)));
}

export function ouvirMensagens(empresaId: string, conversaId: string, cb: (m: MensagemChat[]) => void): Unsubscribe {
  const q = query(collection(db, 'empresas', empresaId, 'conversas', conversaId, 'mensagens'), orderBy('em', 'asc'), limit(300));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as MensagemChat)));
}

export function ouvirConexaoWhatsapp(empresaId: string, cb: (c: ConexaoChat) => void): Unsubscribe {
  return onSnapshot(doc(db, 'empresas', empresaId, 'chatConexoes', 'whatsapp'), (snap) => {
    cb(snap.exists() ? (snap.data() as ConexaoChat) : { status: 'desconectado' });
  });
}

/** Pede ao conector que gere um QR Code novo. */
export async function solicitarConexaoWhatsapp(empresaId: string) {
  await setDoc(
    doc(db, 'empresas', empresaId, 'chatConexoes', 'whatsapp'),
    { status: 'solicitado', qr: '', atualizadoEm: new Date().toISOString() },
    { merge: true }
  );
}

/** Pega o atendimento da conversa para o vendedor. */
export async function assumirConversa(empresaId: string, conversaId: string, login: string, nome: string, clienteId?: string) {
  await updateDoc(doc(db, 'empresas', empresaId, 'conversas', conversaId), {
    vendedorLogin: login,
    vendedorNome: nome,
    atendimentoEm: new Date().toISOString(),
    naoLidas: 0,
    ...(clienteId ? { clienteId } : {}),
  });
}

export async function liberarConversa(empresaId: string, conversaId: string) {
  await updateDoc(doc(db, 'empresas', empresaId, 'conversas', conversaId), {
    vendedorLogin: null,
    vendedorNome: null,
    atendimentoEm: null,
  });
}

/** Registra a mensagem da equipe e coloca na fila de envio do canal. */
export async function enviarMensagemChat(empresaId: string, conversa: ConversaChat, texto: string, autor: string) {
  const agora = new Date().toISOString();
  await addDoc(collection(db, 'empresas', empresaId, 'conversas', conversa.id, 'mensagens'), {
    de: 'equipe',
    texto,
    em: agora,
    autor,
  });
  await updateDoc(doc(db, 'empresas', empresaId, 'conversas', conversa.id), {
    ultimaMensagem: texto,
    ultimaEm: agora,
    ultimaDe: 'equipe',
  });
  await addDoc(collection(db, 'empresas', empresaId, 'chatSaida'), {
    conversaId: conversa.id,
    canal: conversa.canal,
    para: conversa.contato,
    texto,
    criadoEm: agora,
    enviada: false,
  });
}

/** Encontra o cliente do CRM pelo telefone da conversa. */
export function acharClientePorTelefone(clientes: Cliente[], telefone?: string): Cliente | undefined {
  const k = chaveTelefone(telefone);
  if (k.length < 8) return undefined;
  return clientes.find((c) => chaveTelefone(c.telefone) === k);
}
