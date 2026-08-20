// Chave de API da empresa, usada pela integração "Importar via API" (tela
// Importar / Sincronização). Só o hash SHA-256 da chave é salvo no
// Firestore — a chave em texto puro é gerada no navegador e devolvida uma
// única vez pra quem gerou; depois disso não tem como recuperá-la de novo
// (mesma lógica de qualquer chave de API séria: se perder, gera outra).
import { deleteField, doc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';

function bytesParaHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(texto: string): Promise<string> {
  const dados = new TextEncoder().encode(texto);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dados);
  return bytesParaHex(new Uint8Array(hashBuffer));
}

function chaveAleatoria(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `flx_${bytesParaHex(bytes)}`;
}

/** Gera uma nova chave de API pra empresa (substitui a anterior, se houver
 * — qualquer integração usando a chave antiga para de funcionar). Retorna
 * a chave em texto puro, que só existe nesse retorno: guarde/copie agora. */
export async function gerarChaveApi(empresaId: string): Promise<string> {
  const chave = chaveAleatoria();
  const hash = await sha256Hex(chave);
  await updateDoc(doc(db, 'empresas', empresaId), {
    apiKeyHash: hash,
    apiKeyGeradaEm: new Date().toISOString(),
  });
  return chave;
}

/** Revoga a chave de API atual (nenhuma integração externa consegue mais
 * sincronizar dados até que uma nova chave seja gerada). */
export async function revogarChaveApi(empresaId: string): Promise<void> {
  await updateDoc(doc(db, 'empresas', empresaId), {
    apiKeyHash: deleteField(),
    apiKeyGeradaEm: deleteField(),
  });
}
