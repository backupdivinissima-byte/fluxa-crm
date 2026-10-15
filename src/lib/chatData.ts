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
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import { acaoDaColuna } from './crmLogic';
import type { Cliente, ColunaCrm, ConexaoChat, ConversaChat, MensagemChat, TagChat } from '../types';

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
export async function solicitarConexaoWhatsapp(empresaId: string, telefoneParear = '') {
  await setDoc(
    doc(db, 'empresas', empresaId, 'chatConexoes', 'whatsapp'),
    { status: 'solicitado', qr: '', codigoPareamento: '', erro: '', telefoneParear, atualizadoEm: new Date().toISOString() },
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
  if (!agendarPara) {
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
    ...(agendarPara ? { agendadaPara: agendarPara } : {}),
  });
}

export interface MensagemAgendada {
  id: string;
  texto: string;
  agendadaPara: string;
}

export function ouvirAgendadas(empresaId: string, conversaId: string, cb: (m: MensagemAgendada[]) => void): Unsubscribe {
  const q = query(collection(db, 'empresas', empresaId, 'chatSaida'), where('conversaId', '==', conversaId), where('enviada', '==', false));
  return onSnapshot(q, (snap) => {
    const itens = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as { texto: string; agendadaPara?: string }) }))
      .filter((x): x is MensagemAgendada => !!x.agendadaPara)
      .sort((a, b) => a.agendadaPara.localeCompare(b.agendadaPara));
    cb(itens);
  });
}

export async function cancelarAgendada(empresaId: string, id: string) {
  await deleteDoc(doc(db, 'empresas', empresaId, 'chatSaida', id));
}

/** Encontra o cliente do CRM pelo telefone da conversa. */
export function acharClientePorTelefone(clientes: Cliente[], telefone?: string): Cliente | undefined {
  const k = chaveTelefone(telefone);
  if (k.length < 8) return undefined;
  return clientes.find((c) => chaveTelefone(c.telefone) === k);
}

export function ouvirTags(empresaId: string, cb: (t: TagChat[]) => void): Unsubscribe {
  return onSnapshot(collection(db, 'empresas', empresaId, 'chatTags'), (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TagChat, 'id'>) })).sort((a, b) => a.nome.localeCompare(b.nome)));
  });
}

export async function salvarTag(empresaId: string, nome: string, cor: string) {
  await addDoc(collection(db, 'empresas', empresaId, 'chatTags'), { nome, cor });
}

export async function excluirTag(empresaId: string, id: string) {
  await deleteDoc(doc(db, 'empresas', empresaId, 'chatTags', id));
}

export async function definirTagsConversa(empresaId: string, conversaId: string, tags: string[]) {
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
  await addDoc(collection(db, 'empresas', empresaId, 'chatLigacoes'), { ...l, em: new Date().toISOString() });
}

/** Ligações de hoje (a partir da meia-noite do navegador). */
export function ouvirLigacoesHoje(empresaId: string, cb: (l: LigacaoChat[]) => void): Unsubscribe {
  const inicio = new Date();
  inicio.setHours(0, 0, 0, 0);
  const q = query(collection(db, 'empresas', empresaId, 'chatLigacoes'), where('em', '>=', inicio.toISOString()));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LigacaoChat, 'id'>) }))));
}

/** Salva o contato na agenda do Fluxa Chat com o nome escolhido (o da agenda do celular ou outro). */
export async function salvarContatoChat(empresaId: string, conversaId: string, nome: string) {
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
  const emp = await getDoc(doc(db, 'empresas', empresaId));
  const colunas = (emp.data()?.crmColunas ?? []) as ColunaCrm[];
  const colAtend = colunas.find((c) => acaoDaColuna(c) === 'atendimento');
  if (!colAtend) return false;
  const agora = new Date().toISOString();
  await updateDoc(doc(db, 'empresas', empresaId, 'clientes', clienteId), {
    crmColunaId: colAtend.id,
    crmVendedorLogin: vendedor.login,
    crmColunaChangedAt: agora,
  });
  await assumirConversa(empresaId, conversa.id, vendedor.login, vendedor.nome, clienteId);
  return true;
}
