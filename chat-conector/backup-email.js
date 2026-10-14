// Fluxa Chat — backup diário das conversas (WhatsApp, Instagram Direct e
// Messenger) enviado por e-mail em arquivo CSV.
//
// Lê do Firestore as mensagens das últimas HORAS horas (padrão 24) e envia
// para BACKUP_EMAIL_PARA. Agende este comando uma vez por dia
// (Agendador de Tarefas do Windows): npm run backup
//
// Variáveis de ambiente:
//   EMPRESA_ID                       empresa no Fluxa
//   GOOGLE_APPLICATION_CREDENTIALS   .json da conta de serviço do Firebase
//   BACKUP_EMAIL_PARA                destino (ex.: backupdivinissima@gmail.com)
//   BACKUP_EMAIL_DE                  conta Gmail que envia (pode ser a mesma)
//   BACKUP_EMAIL_SENHA               "senha de app" do Gmail (NÃO a senha normal)
//   HORAS                            (opcional) janela do backup, padrão 24
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import nodemailer from 'nodemailer';

const { EMPRESA_ID, BACKUP_EMAIL_PARA, BACKUP_EMAIL_DE, BACKUP_EMAIL_SENHA } = process.env;
for (const [k, v] of Object.entries({ EMPRESA_ID, BACKUP_EMAIL_PARA, BACKUP_EMAIL_DE, BACKUP_EMAIL_SENHA })) {
  if (!v) throw new Error(`Defina ${k}.`);
}
const horas = Number(process.env.HORAS || 24);
const desde = new Date(Date.now() - horas * 3_600_000).toISOString();

initializeApp({ credential: applicationDefault() });
const db = getFirestore();
const base = db.collection('empresas').doc(EMPRESA_ID);

const csv = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`;

const conversas = await base.collection('conversas').where('ultimaEm', '>=', desde).get();
const linhas = ['canal;contato;nome;quando;de;autor;mensagem'];
let total = 0;
for (const c of conversas.docs) {
  const d = c.data();
  const msgs = await c.ref.collection('mensagens').where('em', '>=', desde).orderBy('em').get();
  for (const m of msgs.docs) {
    const x = m.data();
    linhas.push([d.canal, d.telefone || d.contato, d.nome, x.em, x.de, x.autor, x.texto].map(csv).join(';'));
    total++;
  }
}

const dia = new Date().toISOString().slice(0, 10);
const transporte = nodemailer.createTransport({ service: 'gmail', auth: { user: BACKUP_EMAIL_DE, pass: BACKUP_EMAIL_SENHA } });
await transporte.sendMail({
  from: BACKUP_EMAIL_DE,
  to: BACKUP_EMAIL_PARA,
  subject: `Backup Fluxa Chat — ${dia} (${total} mensagens)`,
  text: `Backup das conversas das últimas ${horas}h: ${conversas.size} conversas, ${total} mensagens. Arquivo em anexo.\nContém dados pessoais de clientes: guarde com cuidado.`,
  attachments: [{ filename: `conversas-${dia}.csv`, content: '\uFEFF' + linhas.join('\n'), contentType: 'text/csv; charset=utf-8' }],
});
console.log(`Backup enviado: ${conversas.size} conversas, ${total} mensagens.`);
