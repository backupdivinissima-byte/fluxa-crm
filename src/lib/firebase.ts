import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Reaproveita o mesmo projeto Firebase já criado para a Divinissima
// (divinissima-crm) — evita pedir pra criar um projeto novo do zero.
// O Fluxa CRM usa coleções de topo próprias (empresas/usuarios), então
// não encosta nas coleções antigas (clientes/vendedores soltos) que o
// site atual da Divinissima continua usando normalmente.
const firebaseConfig = {
  apiKey: 'AIzaSyDcpVaJ52mnzyU1nZ3Q_tiY9ZZnfeLMP7c',
  authDomain: 'divinissima-crm.firebaseapp.com',
  projectId: 'divinissima-crm',
  storageBucket: 'divinissima-crm.firebasestorage.app',
  messagingSenderId: '71117223059',
  appId: '1:71117223059:web:fce1618e8334c718844966',
};

export const isFirebaseConfigured = true;

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
