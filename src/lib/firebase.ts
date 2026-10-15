import { initializeApp } from 'firebase/app';
import { initializeAuth, browserSessionPersistence, getAuth, signInAnonymously } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';

// Projeto Firebase próprio do Fluxa CRM (fluxa-crm) — os dados foram
// migrados do projeto antigo (divinissima-crm), que segue existindo
// como backup, mas não é mais usado por este app.
const firebaseConfig = {
  apiKey: 'AIzaSyD1eHmhqqOtPfGl6HptMBEvOejgS-ekXo8',
  authDomain: 'fluxa-crm.firebaseapp.com',
  projectId: 'fluxa-crm',
  storageBucket: 'fluxa-crm.firebasestorage.app',
  messagingSenderId: '54224309265',
  appId: '1:54224309265:web:b3f3e0cbdb60b6d4ed75b0',
};

export const isFirebaseConfigured = true;

const app = initializeApp(firebaseConfig);
// Sessão por aba (sessionStorage): cada aba/janela tem o próprio login, então
// dá pra deixar o administrador e vários vendedores abertos ao mesmo tempo no
// mesmo computador, cada um independente (todos lendo os mesmos dados em
// tempo real do Firestore).
export const auth = initializeAuth(app, { persistence: browserSessionPersistence });
// ignoreUndefinedProperties: várias telas (ex.: conexão com ERP) montam
// objetos com campos opcionais que ficam `undefined` quando não usados
// (ex.: nome do cabeçalho só se autenticação = header). Sem essa opção, o
// Firestore rejeita a escrita inteira com "Unsupported field value:
// undefined" em vez de simplesmente ignorar esses campos.
//
// Cache local (IndexedDB, compartilhado entre abas): ao trocar de tela ou
// recarregar, o Firestore só lê do servidor o que MUDOU desde a última vez,
// em vez de reler a base de clientes inteira. Isso corta quase todo o
// consumo de leituras da cota diária.
export const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// ---------------------------------------------------------------------------
// Projeto Firebase separado SÓ para o Fluxa Chat (fluxa-chat-a052d). O chat
// gera muitas leituras/gravações; num projeto próprio ele tem cota própria e
// não derruba o CRM. O CRM continua 100% no projeto fluxa-crm acima.
// Acesso: login anônimo neste projeto (as regras exigem request.auth != null).
// ---------------------------------------------------------------------------
const chatConfig = {
  apiKey: 'AIzaSyCoUESBs7tOXJwsVEtS7Xs4fC2cx_uLfpY',
  authDomain: 'fluxa-chat-a052d.firebaseapp.com',
  projectId: 'fluxa-chat-a052d',
  storageBucket: 'fluxa-chat-a052d.firebasestorage.app',
  messagingSenderId: '959385032553',
  appId: '1:959385032553:web:9eea545f250e338c1a8ff8',
};
const appChat = initializeApp(chatConfig, 'chat');
export const dbChat = initializeFirestore(appChat, {
  ignoreUndefinedProperties: true,
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
const authChat = getAuth(appChat);
/** Resolve quando o login anônimo do projeto do chat estiver pronto. */
export const chatPronto: Promise<void> = (async () => {
  try {
    if (!authChat.currentUser) await signInAnonymously(authChat);
  } catch (e) {
    console.error('Login anônimo do Chat falhou', e);
  }
})();
/** Roda o `iniciar` (que abre um listener) só depois do login do chat. */
export function aposChatPronto(iniciar: () => () => void): () => void {
  let cancelado = false;
  let parar: (() => void) | null = null;
  chatPronto.then(() => {
    if (!cancelado) parar = iniciar();
  });
  return () => {
    cancelado = true;
    parar?.();
  };
}
