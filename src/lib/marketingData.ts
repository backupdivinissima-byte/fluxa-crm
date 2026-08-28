// Acesso ao Firestore para o módulo Marketing (abas Meta, Live e Análise
// Marketing) — mesmo padrão de src/lib/crmData.ts: subcoleções por empresa,
// listeners em tempo real (onSnapshot) e `semUndefined` antes de gravar
// (Firestore recusa valor `undefined`).
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type { CampanhaMeta, InstagramConexao, Live, MetaAdsConexao, ReservaLive } from '../types';

function campanhasMetaCol(empresaId: string) {
  return collection(db, 'empresas', empresaId, 'campanhasMeta');
}

function livesCol(empresaId: string) {
  return collection(db, 'empresas', empresaId, 'lives');
}

function reservasLiveCol(empresaId: string) {
  return collection(db, 'empresas', empresaId, 'reservasLive');
}

// Mesma função de src/lib/crmData.ts — remove chaves `undefined` antes de
// qualquer escrita, pra campo opcional não derrubar o salvamento inteiro.
function semUndefined<T extends Record<string, unknown>>(obj: T): T {
  const limpo = { ...obj };
  for (const k of Object.keys(limpo)) {
    if (limpo[k] === undefined) delete limpo[k];
  }
  return limpo;
}

// ===== Campanhas Meta Ads =====

export function ouvirCampanhasMeta(empresaId: string, cb: (campanhas: CampanhaMeta[]) => void): Unsubscribe {
  const q = query(campanhasMetaCol(empresaId), orderBy('atualizadoEm', 'desc'));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as CampanhaMeta));
  });
}

export async function salvarCampanhaMeta(empresaId: string, campanha: Omit<CampanhaMeta, 'id'> & { id?: string }) {
  if (campanha.id) {
    const { id, ...dados } = campanha;
    await setDoc(doc(db, 'empresas', empresaId, 'campanhasMeta', id), semUndefined(dados), { merge: true });
  } else {
    const { id: _id, ...dados } = campanha;
    await addDoc(campanhasMetaCol(empresaId), semUndefined(dados));
  }
}

export async function removerCampanhaMeta(empresaId: string, campanhaId: string) {
  await deleteDoc(doc(db, 'empresas', empresaId, 'campanhasMeta', campanhaId));
}

/** Importa uma lista de campanhas (vinda da planilha exportada do
 * Gerenciador de Anúncios) — cada linha vira um documento novo. Diferente
 * de Clientes/Vendedores, campanha não tem um código único estável entre
 * exportações, então cada importação some com o snapshot anterior daquele
 * mesmo mês (ver `mesReferencia`) antes de gravar os novos, pra não
 * duplicar/acumular campanhas antigas ao reimportar. */
export async function importarCampanhasMeta(
  empresaId: string,
  campanhas: Omit<CampanhaMeta, 'id' | 'origem'>[],
  mesReferencia: string
): Promise<number> {
  const antigasSnap = await getDocs(campanhasMetaCol(empresaId));
  const paraApagar = antigasSnap.docs.filter((d) => (d.data().atualizadoEm as string | undefined)?.slice(0, 7) === mesReferencia);
  if (paraApagar.length > 0) {
    const lote = writeBatch(db);
    for (const d of paraApagar) lote.delete(d.ref);
    await lote.commit();
  }
  for (const c of campanhas) {
    await addDoc(campanhasMetaCol(empresaId), semUndefined({ ...c, origem: 'manual' as const }));
  }
  return campanhas.length;
}

// ===== Lives =====

export function ouvirLives(empresaId: string, cb: (lives: Live[]) => void): Unsubscribe {
  const q = query(livesCol(empresaId), orderBy('data', 'desc'));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Live));
  });
}

export async function salvarLive(empresaId: string, live: Omit<Live, 'id'> & { id?: string }) {
  if (live.id) {
    const { id, ...dados } = live;
    await setDoc(doc(db, 'empresas', empresaId, 'lives', id), semUndefined(dados), { merge: true });
  } else {
    const { id: _id, ...dados } = live;
    await addDoc(livesCol(empresaId), semUndefined(dados));
  }
}

export async function removerLive(empresaId: string, liveId: string) {
  await deleteDoc(doc(db, 'empresas', empresaId, 'lives', liveId));
}

/** Encerra uma live: grava as métricas (manuais ou vindas da API do
 * Instagram) e marca status "encerrada". */
export async function encerrarLive(
  empresaId: string,
  liveId: string,
  metricas: { visualizacoes?: number; picoPessoasOnline?: number; origemMetricas: 'manual' | 'instagram_api' }
) {
  await updateDoc(
    doc(db, 'empresas', empresaId, 'lives', liveId),
    semUndefined({
      status: 'encerrada' as const,
      encerradaEm: new Date().toISOString(),
      visualizacoes: metricas.visualizacoes,
      picoPessoasOnline: metricas.picoPessoasOnline,
      origemMetricas: metricas.origemMetricas,
    })
  );
}

// ===== Reservas de Live =====

export function ouvirReservasLive(empresaId: string, cb: (reservas: ReservaLive[]) => void): Unsubscribe {
  const q = query(reservasLiveCol(empresaId), orderBy('data', 'desc'));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ReservaLive));
  });
}

export async function removerReservaLive(empresaId: string, reservaId: string) {
  await deleteDoc(doc(db, 'empresas', empresaId, 'reservasLive', reservaId));
}

/** Importa a planilha de reserva da live (data, código do cliente, nome,
 * valor da reserva). É seguro importar a mesma planilha mais de uma vez —
 * linhas com o mesmo cliente+data substituem a reserva anterior daquele
 * cliente naquela data em vez de duplicar (usa um ID determinístico, mesmo
 * princípio de `idSeguro` em crmLogic.ts). */
export async function importarReservasLive(
  empresaId: string,
  reservas: Omit<ReservaLive, 'id' | 'importadoEm'>[],
  arquivoOrigem: string
): Promise<number> {
  const agora = new Date().toISOString();
  const lote = writeBatch(db);
  let count = 0;
  for (const r of reservas) {
    const idDoc = idReservaDeterministico(r.cod, r.data);
    const ref = doc(db, 'empresas', empresaId, 'reservasLive', idDoc);
    lote.set(ref, semUndefined({ ...r, importadoEm: agora, arquivoOrigem }), { merge: true });
    count++;
  }
  await lote.commit();
  return count;
}

function idReservaDeterministico(cod: string, data: string): string {
  const base = `${cod}__${data}`
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || `reserva-${Math.random().toString(36).slice(2, 10)}`;
}

// ===== Conexões (Fase 2) =====

/** Salva a conexão com o Meta Ads. `tokenAcesso` só é reenviado quando o
 * usuário digita um novo (campo vazio = mantém o token já salvo) — mesmo
 * padrão de `salvarConexaoErp` em erpConexao.ts. */
export async function salvarMetaAdsConexao(empresaId: string, conexao: MetaAdsConexao) {
  await updateDoc(doc(db, 'empresas', empresaId), { metaAdsConexao: semUndefined(conexao as unknown as Record<string, unknown>) });
}

export async function salvarInstagramConexao(empresaId: string, conexao: InstagramConexao) {
  await updateDoc(doc(db, 'empresas', empresaId), { instagramConexao: semUndefined(conexao as unknown as Record<string, unknown>) });
}
