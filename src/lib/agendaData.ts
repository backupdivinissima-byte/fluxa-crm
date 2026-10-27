// Agenda de contatos: o vendedor (ou o admin) agenda o retorno a um cliente; na hora marcada abre o lembrete.
import { collection, deleteDoc, doc, onSnapshot, query, updateDoc, where, writeBatch, type Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';
import type { Cliente, Vendedor } from '../types';
import { diasSemAtend } from './crmLogic';

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
  origem: 'vendedor' | 'admin' | 'rodizio' | 'acompanhamento';
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
export function ouvirAgenda(empresaId: string, vendedorLogin: string | undefined, cb: (a: Agendamento[]) => void, aoErro?: (msg: string) => void): Unsubscribe {
  const q = vendedorLogin ? query(col(empresaId), where('vendedorLogin', '==', vendedorLogin)) : col(empresaId);
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Agendamento)),
    (e) => {
      aoErro?.(e.message);
      cb([]);
    }
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
  /** Agendamentos pendentes e vencidos (vendedor não fez o contato) que saem da carteira antiga ao criar o novo. */
  remover: string[];
  /** Clientes que voltaram ao rodízio para OUTRO vendedor (o anterior não efetivou venda). */
  reatribuidos: number;
}

/** Distribui os clientes inativos (do que comprou mais recentemente para o mais antigo) entre os vendedores ativos,
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
  const hojeISO0 = isoLocal(agora);
  const mesAtual = hojeISO0.slice(0, 7);
  // Pendente ainda no prazo = cliente já está na carteira de alguém. Pendente VENCIDO = o vendedor não fez o contato: sai da carteira dele.
  const vencidos = agenda.filter((a) => a.status === 'pendente' && a.data < hojeISO0);
  const idsVencidos = new Set(vencidos.map((a) => a.id));
  const bloqueados = new Set(agenda.filter((a) => a.status === 'pendente' && !idsVencidos.has(a.id)).map((a) => a.clienteId));
  // Contato já feito neste mês: o cliente descansa até o mês seguinte (se continuar sem comprar, volta ao rodízio).
  for (const a of agenda) if (a.status === 'feito' && a.data.startsWith(mesAtual)) bloqueados.add(a.clienteId);
  // Quem já tentou esse cliente (últimos 90 dias) — o rodízio entrega o cliente a OUTRO vendedor.
  const limite = isoLocal(new Date(agora.getTime() - 90 * 86400000));
  const tentou = new Map<string, Set<string>>();
  for (const a of agenda) {
    if (a.origem !== 'rodizio' || a.data < limite) continue;
    const st = tentou.get(a.clienteId) ?? new Set<string>();
    st.add(a.vendedorLogin);
    tentou.set(a.clienteId, st);
  }
  const fila = clientes
    .filter((c) => diasSemAtend(c) > diasInatividade && !(c.prospect && !((c.totalGeral ?? 0) > 0)) && !bloqueados.has(c.id) && (c.telefone ?? '').replace(/\D/g, '').length >= 8)
    .sort((a, b) => (b.dtUltCompra ?? '').localeCompare(a.dtUltCompra ?? '')); // do cliente mais recente para o mais antigo
  const removerIds = new Set<string>();
  let reatribuidos = 0;
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
  for (const iso of dias) {
    const slots = slotsDe(iso);
    for (const v of ativos) {
      const ocupados = new Set(agenda.filter((a) => a.vendedorLogin === v.login && a.data === iso && a.status === 'pendente').map((a) => a.hora));
      const livres = slots.filter((h) => !ocupados.has(h));
      const qtd = Math.min(INATIVOS_POR_DIA, livres.length);
      for (let k = 0; k < qtd && fila.length > 0; k++) {
        // primeiro cliente da fila que ESTE vendedor ainda não tentou (se todos já tentou, pega o primeiro mesmo)
        let idx = fila.findIndex((x) => !tentou.get(x.id)?.has(v.login));
        if (idx < 0) idx = 0;
        const c = fila.splice(idx, 1)[0];
        if (tentou.get(c.id) && tentou.get(c.id)!.size > 0) reatribuidos++;
        for (const vv of vencidos) if (vv.clienteId === c.id) removerIds.add(vv.id);
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
  return { itens, inativosDisponiveis, porVendedor, dias, remover: [...removerIds], reatribuidos };
}
