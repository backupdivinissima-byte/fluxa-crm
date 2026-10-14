// Fluxa Chat — backup diário das conversas no GOOGLE DRIVE (conta
// backupdivinissima@gmail.com). Salva um CSV por dia na pasta escolhida.
//
// Primeira vez (uma só): npm run backup-drive -- --autorizar
//   abre o link, você entra na conta backupdivinissima@gmail.com e autoriza;
//   o programa guarda a autorização em drive-token.json (não envie a ninguém).
// Depois, todo dia: npm run backup-drive
//
// Variáveis de ambiente:
//   EMPRESA_ID                       empresa no Fluxa
//   GOOGLE_APPLICATION_CREDENTIALS   .json da conta de serviço do Firebase (leitura do banco)
//   DRIVE_CLIENT_ID / DRIVE_CLIENT_SECRET   cliente OAuth "App para computador" (Google Cloud → APIs → Credenciais)
//   DRIVE_PASTA_ID                   (opcional) id da pasta no Drive; sem isso cria "Fluxa Chat Backup"
//   HORAS                            (opcional) janela do backup, padrão 24
import fs from 'node:fs';
import http from 'node:http';
import { Readable } from 'node:stream';
import { google } from 'googleapis';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const { EMPRESA_ID, DRIVE_CLIENT_ID, DRIVE_CLIENT_SECRET } = process.env;
for (const [k, v] of Object.entries({ EMPRESA_ID, DRIVE_CLIENT_ID, DRIVE_CLIENT_SECRET })) {
  if (!v) throw new Error(`Defina ${k}.`);
}
const ARQ_TOKEN = './drive-token.json';
const PORTA = 53682;
const oauth = new google.auth.OAuth2(DRIVE_CLIENT_ID, DRIVE_CLIENT_SECRET, `http://localhost:${PORTA}`);

async function autorizar() {
  const url = oauth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: ['https://www.googleapis.com/auth/drive.file'] });
  console.log('\nAbra este link no navegador e entre com backupdivinissima@gmail.com:\n\n' + url + '\n');
  const codigo = await new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const c = new URL(req.url, `http://localhost:${PORTA}`).searchParams.get('code');
      res.end('Pronto! Pode fechar esta janela.');
      if (c) {
        srv.close();
        resolve(c);
      }
    });
    srv.listen(PORTA);
  });
  const { tokens } = await oauth.getToken(codigo);
  fs.writeFileSync(ARQ_TOKEN, JSON.stringify(tokens));
  console.log('Autorizado. Agora rode: npm run backup-drive');
}

if (process.argv.includes('--autorizar')) {
  await autorizar();
  process.exit(0);
}
if (!fs.existsSync(ARQ_TOKEN)) throw new Error('Rode antes: npm run backup-drive -- --autorizar');
oauth.setCredentials(JSON.parse(fs.readFileSync(ARQ_TOKEN, 'utf8')));
const drive = google.drive({ version: 'v3', auth: oauth });

initializeApp({ credential: applicationDefault() });
const base = getFirestore().collection('empresas').doc(EMPRESA_ID);
const horas = Number(process.env.HORAS || 24);
const desde = new Date(Date.now() - horas * 3_600_000).toISOString();
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

let pasta = process.env.DRIVE_PASTA_ID;
if (!pasta) {
  const achada = await drive.files.list({ q: "name='Fluxa Chat Backup' and mimeType='application/vnd.google-apps.folder' and trashed=false", fields: 'files(id)' });
  pasta =
    achada.data.files?.[0]?.id ??
    (await drive.files.create({ requestBody: { name: 'Fluxa Chat Backup', mimeType: 'application/vnd.google-apps.folder' }, fields: 'id' })).data.id;
}
const dia = new Date().toISOString().slice(0, 10);
await drive.files.create({
  requestBody: { name: `conversas-${EMPRESA_ID.slice(0, 6)}-${dia}.csv`, parents: [pasta] },
  media: { mimeType: 'text/csv', body: Readable.from(['﻿' + linhas.join('\n')]) },
  fields: 'id',
});
console.log(`Backup salvo no Drive: ${conversas.size} conversas, ${total} mensagens.`);
