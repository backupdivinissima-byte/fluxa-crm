import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

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
export const db = getFirestore(app);
