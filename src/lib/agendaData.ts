// Agenda de contatos: o vendedor (ou o admin) agenda o retorno a um cliente; na hora marcada abre o lembrete.
import { collection, deleteDoc, doc, onSnapshot, query, updateDoc, where, writeBatch, type Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';
import type { Cliente, Vendedor } from '../types';
import { diasSemAtend, totalGeralReal } from './crmLogic';

export interface Agendamento {
  id: string;
  data: string; // AAAA-MM-DD
  hora: string; // HH:MM
  clienteId: string;
  clienteCod: string;
  clienteNome: string;
  telefone?: string;
  vendedorLogin: string;
  vendedorNome: string;
  obs: string; // observação de quem agendou (o que foi conversado / motivo)
  status: 'pendente' | 'feito';
  origem: 'vendedor' | 'admin' | 'rodizio';
  criadoEm: string;
  criadoPor?: string;
  lembreteEm: string; // ISO: quando o lembrete deve abrir
  adiado?: boolean; // só pode adiar uma vez
  resultado?: string; // o que foi conversado no contato
  feitoEm?: string;
}

function col(empresaId: string) {
  return collection(db, 'empresas', empresaId, 'agenda');
}

/** vendedorLogin vazio = tudo (admin). */
export function ouvirAgenda(empresaId: string, vendedorLogin: string | undefined, cb: (a: Agendamento[]) => void): Unsubscribe {
  const q = vendedorLogin ? query(col(empresaId), where('vendedorLogin', '==', vendedorLogin)) : col(empresaId);
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Agendamento)),
    () => cb([])
  );
}

function semUndef<T extends Record<string, unknown>>(o: T): T {
  const r = { ...o };
  for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k];
  return r;
}

export async function criarAgendamentos(empresaId: string, itens: Array<Omit<Agendamento, 'id'>>) {
  for (let i = 0; i < itens.length; i += 400) {
    const lote = writeBatch(db);
    for (const it of itens.slice(i, i + 400)) lote.set(doc(col(empresaId)), semUndef(it as unknown as Record<string, unknown>));
    await lote.commit();
  }
}

export async function atualizarAgendamento(empresaId: string, id: string, patch: Partial<Agendamento>) {
  await updateDoc(doc(col(empresaId), id), semUndef(patch as Record<string, unknown>));
}

export async function removerAgendamento(empresaId: string, id: string) {
  await deleteDoc(doc(col(empresaId), id));
}

// ---------- datas e horário comercial ----------
export function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function dataDeISO(iso: string): Date {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(a, m - 1, d);
}
export function ehDiaUtil(iso: string): boolean {
  const dow = dataDeISO(iso).getDay();
  return dow >= 1 && dow <= 5;
}
/** Segunda a quinta 09h–18h, sexta 09h–17h, almoço 12h–13h; horários de 30 em 30 min (o último termina no fechamento). */
export function horariosDoDia(iso: string): string[] {
  const dow = dataDeISO(iso).getDay();
  if (dow < 1 || dow > 5) return [];
  const fim = dow === 5 ? 17 : 18;
  const r: string[] = [];
  for (let min = 9 * 60; min < fim * 60; min += 30) {
    if (min >= 12 * 60 && min < 13 * 60) continue;
    r.push(`${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`);
  }
  return r;
}
export function lembreteDe(data: string, hora: string): string {
  const [a, m, d] = data.split('-').map(Number);
  const [h, mi] = hora.split(':').map(Number);
  return new Date(a, m - 1, d, h, mi).toISOString();
}
export function formatarDataCurta(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}
const NOMES_DIA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export function nomeDoDia(iso: string): string {
  return NOMES_DIA[dataDeISO(iso).getDay()];
}

// ---------- rodízio de inativos ----------
export const INATIVOS_POR_DIA = 10;

export interface PlanoRodizio {
  itens: Array<Omit<Agendamento, 'id'>>;
  inativosDisponiveis: number;
  porVendedor: Record<string, number>;
  dias: string[];
}

/** Distribui os clientes inativos (maior valor histórico primeiro) entre os vendedores ativos,
 * `INATIVOS_POR_DIA` por vendedor por dia útil, em horários livres do expediente. */
export function planejarRodizio(
  clientes: Cliente[],
  vendedores: Vendedor[],
  agenda: Agendamento[],
  diasInatividade: number,
  nDiasUteis: number,
  autor: string,
  agora: Date = new Date()
): PlanoRodizio {
  const ativos = vendedores.filter((v) => v.ativo);
  const jaAgendados = new Set(agenda.filter((a) => a.status === 'pendente').map((a) => a.clienteId));
  const fila = clientes
    .filter((c) => diasSemAtend(c) > diasInatividade && !jaAgendados.has(c.id) && (c.telefone ?? '').replace(/\D/g, '').length >= 8)
    .sort((a, b) => (totalGeralReal(b) ?? 0) - (totalGeralReal(a) ?? 0));
  const inativosDisponiveis = fila.length;

  const minDe = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));
  const hojeISO = isoLocal(agora);
  const minAgora = agora.getHours() * 60 + agora.getMinutes();
  const slotsDe = (iso: string) => horariosDoDia(iso).filter((h) => iso !== hojeISO || minDe(h) > minAgora);

  const dias: string[] = [];
  const cursor = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  while (dias.length < nDiasUteis) {
    const iso = isoLocal(cursor);
    if (ehDiaUtil(iso) && slotsDe(iso).length > 0) dias.push(iso);
    cursor.setDate(cursor.getDate() + 1);
  }

  const itens: PlanoRodizio['itens'] = [];
  const porVendedor: Record<string, number> = {};
  let i = 0;
  for (const iso of dias) {
    const slots = slotsDe(iso);
    for (const v of ativos) {
      const ocupados = new Set(agenda.filter((a) => a.vendedorLogin === v.login && a.data === iso && a.status === 'pendente').map((a) => a.hora));
      const livres = slots.filter((h) => !ocupados.has(h));
      const qtd = Math.min(INATIVOS_POR_DIA, livres.length);
      for (let k = 0; k < qtd && i < fila.length; k++, i++) {
        const c = fila[i];
        const dias_ = diasSemAtend(c);
        itens.push({
          data: iso,
          hora: livres[k],
          clienteId: c.id,
          clienteCod: c.cod,
          clienteNome: c.razao || c.nome || c.cod,
          telefone: c.telefone,
          vendedorLogin: v.login,
          vendedorNome: v.nome,
          obs: `Rodízio de inativos — ${dias_ >= 9999 ? 'sem compra registrada' : `${dias_} dias sem compra`}.`,
          status: 'pendente',
          origem: 'rodizio',
          criadoEm: new Date().toISOString(),
          criadoPor: autor,
          lembreteEm: lembreteDe(iso, livres[k]),
        });
        porVendedor[v.nome] = (porVendedor[v.nome] ?? 0) + 1;
      }
    }
  }
  return { itens, inativosDisponiveis, porVendedor, dias };
}
