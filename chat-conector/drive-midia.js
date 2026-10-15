// Guarda fotos, vídeos, áudios e documentos no Google Drive de backupdivinissima@gmail.com
// (mesma autorização do backup: npm run backup-drive -- --autorizar).
// Sem drive-token.json ou sem DRIVE_CLIENT_ID/SECRET, fica desligado e o conector segue normal.
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { google } from 'googleapis';

const ARQ_TOKEN = './drive-token.json';
let drive = null;
let pastaRaiz = null;

if (process.env.DRIVE_CLIENT_ID && process.env.DRIVE_CLIENT_SECRET && fs.existsSync(ARQ_TOKEN)) {
  const oauth = new google.auth.OAuth2(process.env.DRIVE_CLIENT_ID, process.env.DRIVE_CLIENT_SECRET, 'http://localhost:53682');
  oauth.setCredentials(JSON.parse(fs.readFileSync(ARQ_TOKEN, 'utf8')));
  drive = google.drive({ version: 'v3', auth: oauth });
}

export const driveLigado = () => !!drive;

async function pasta(nome, pai) {
  const q = `name='${nome}' and mimeType='application/vnd.google-apps.folder' and trashed=false${pai ? ` and '${pai}' in parents` : ''}`;
  const r = await drive.files.list({ q, fields: 'files(id)', spaces: 'drive' });
  if (r.data.files?.length) return r.data.files[0].id;
  const c = await drive.files.create({
    requestBody: { name: nome, mimeType: 'application/vnd.google-apps.folder', ...(pai ? { parents: [pai] } : {}) },
    fields: 'id',
  });
  return c.data.id;
}

/** Envia o arquivo e devolve o link para abrir no Drive (ou null se desligado/erro). */
export async function guardarNoDrive(buffer, nomeArquivo, mimetype, numero) {
  if (!drive) return null;
  try {
    pastaRaiz ??= process.env.DRIVE_PASTA_MIDIA_ID || (await pasta('Fluxa Chat Midias'));
    const sub = await pasta(numero, pastaRaiz);
    const r = await drive.files.create({
      requestBody: { name: nomeArquivo, parents: [sub] },
      media: { mimeType: mimetype || 'application/octet-stream', body: Readable.from(buffer) },
      fields: 'webViewLink',
    });
    return r.data.webViewLink ?? null;
  } catch (e) {
    console.error('Drive (mídia):', e.message);
    return null;
  }
}
