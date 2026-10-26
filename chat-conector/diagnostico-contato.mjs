// Diagnóstico SOMENTE LEITURA: mostra a conversa e as últimas mensagens (sem o texto) de um contato. Uso: node diagnostico-contato.mjs whatsapp_55DDDNUMERO [outra_conversa...]
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
initializeApp();
const db = getFirestore();
const base = db.collection('empresas').doc(process.env.EMPRESA_ID);
for (const id of [...(process.argv.slice(2))]) {
  const r = base.collection('conversas').doc(id);
  const s = await r.get();
  console.log('==', id, s.exists ? JSON.stringify({ nome: s.data().nome, contato: s.data().contato, jid: s.data().contatoJid, ultimaEm: s.data().ultimaEm, ultimaDe: s.data().ultimaDe }) : 'NAO EXISTE');
  const m = await r.collection('mensagens').orderBy('em', 'desc').limit(Number(process.env.LIMITE || 8)).get();
  for (const d of m.docs) { const x = d.data(); console.log('  ', x.em, x.de, x.autor ?? '-', x.entrega ?? '-', x.erroEnvio ? 'ERRO' : '', (x.texto || '').length + ' chars'); }
}
const q = await base.collection('chatSaida').where('para', '==', process.argv[2].replace('whatsapp_','')).get();
console.log('chatSaida docs:', q.size);
const ult = q.docs.map((d) => d.data()).sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || '')).slice(0, 6);
for (const x of ult) console.log('  saida', x.criadoEm, 'conversaId=' + x.conversaId, 'enviada=' + x.enviada, 'jid=' + (x.paraJid || '-'), x.erro ? 'ERRO ' + String(x.erro).slice(0, 60) : '');
process.exit(0);
