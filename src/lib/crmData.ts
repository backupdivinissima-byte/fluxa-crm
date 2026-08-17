// Acesso ao Firestore para os dados de CRM de uma empresa — cada empresa
// tem suas próprias subcoleções, isolando os dados entre clientes do Fluxa.
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Cliente, Empresa, MetaTier, Vendedor } from '../types';

function clientesCol(empresaId: string) {
  return collection(db, 'empresas', empresaId, 'clientes');
}

function vendedoresCol(empresaId: string) {
  return collection(db, 'empresas', empresaId, 'vendedores');
}

export function ouvirClientes(empresaId: string, cb: (clientes: Cliente[]) => void): Unsubscribe {
  const q = query(clientesCol(empresaId), orderBy('dtUltCompra', 'desc'));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Cliente));
  });
}

export function ouvirVendedores(empresaId: string, cb: (vendedores: Vendedor[]) => void): Unsubscribe {
  return onSnapshot(vendedoresCol(empresaId), (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Vendedor));
  });
}

export async function salvarCliente(empresaId: string, cliente: Cliente) {
  const { id, ...dados } = cliente;
  await setDoc(doc(db, 'empresas', empresaId, 'clientes', id), dados, { merge: true });
}

export async function atualizarCampoCliente(empresaId: string, clienteId: string, patch: Partial<Cliente>) {
  // Remove chaves com valor undefined (Firestore não aceita undefined em updateDoc).
  const limpo: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    limpo[k] = v === undefined ? null : v;
  }
  await updateDoc(doc(db, 'empresas', empresaId, 'clientes', clienteId), limpo);
}

export async function criarCliente(empresaId: string, cliente: Omit<Cliente, 'id'>) {
  await addDoc(clientesCol(empresaId), cliente);
}

export async function removerCliente(empresaId: string, clienteId: string) {
  await deleteDoc(doc(db, 'empresas', empresaId, 'clientes', clienteId));
}

export async function salvarVendedor(empresaId: string, vendedor: Omit<Vendedor, 'id'> & { id?: string }) {
  if (vendedor.id) {
    const { id, ...dados } = vendedor;
    await setDoc(doc(db, 'empresas', empresaId, 'vendedores', id), dados, { merge: true });
  } else {
    await addDoc(vendedoresCol(empresaId), vendedor);
  }
}

export async function removerVendedor(empresaId: string, vendedorId: string) {
  await deleteDoc(doc(db, 'empresas', empresaId, 'vendedores', vendedorId));
}

export async function salvarMetasEmpresa(empresaId: string, metas: MetaTier[]) {
  await updateDoc(doc(db, 'empresas', empresaId), { metas });
}

export function ouvirEmpresa(empresaId: string, cb: (empresa: Empresa | null) => void): Unsubscribe {
  return onSnapshot(doc(db, 'empresas', empresaId), (snap) => {
    cb(snap.exists() ? ({ id: snap.id, ...snap.data() } as Empresa) : null);
  });
}
