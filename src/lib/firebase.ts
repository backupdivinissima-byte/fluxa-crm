import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';

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
export const auth = getAuth(app);
// ignoreUndefinedProperties: várias telas (ex.: conexão com ERP) montam
// objetos com campos opcionais que ficam `undefined` quando não usados
// (ex.: nome do cabeçalho só se autenticação = header). Sem essa opção, o
// Firestore rejeita a escrita inteira com "Unsupported field value:
// undefined" em vez de simplesmente ignorar esses campos.
export const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
