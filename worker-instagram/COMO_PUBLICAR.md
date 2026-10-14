# Webhook do Instagram (comentários das lives) — Cloudflare Workers

Servidor gratuito que recebe cada comentário da live (enviado pela Meta) e grava no Fluxa.

## 1. Firebase
1. Configurações do projeto → Contas de serviço → **Gerar nova chave privada** (baixa um .json; não compartilhe).
2. Firestore → Regras: dentro de `match /instagramLives/{id}` acrescente
   `match /arrobas/{c} { allow read: if request.auth != null; }`
3. Authentication → Usuários: copie o **UID** do e-mail administrador da empresa (é o EMPRESA_ID).

## 2. Cloudflare
1. Crie conta grátis em cloudflare.com → Workers & Pages → Create → Worker → nome `fluxa-instagram-webhook`.
2. Edit code → apague tudo → cole o conteúdo de `index.js` → Deploy. Anote o endereço `https://….workers.dev`.
3. Settings → Variables and Secrets → adicione:
   - `VERIFY_TOKEN` (texto inventado, ex.: fluxa-live-2026)
   - `APP_SECRET` (secret): chave secreta do app do Instagram
   - `EMPRESA_ID`: o UID do passo 1.3
   - `FIREBASE_PROJECT_ID`: fluxa-crm
   - `SERVICE_ACCOUNT_JSON` (secret): conteúdo inteiro do .json do passo 1.1

## 3. Meta (app Divinissima → API do Instagram com login do Instagram)
1. **Configurar webhooks**: URL de retorno = endereço do Worker; token de verificação = VERIFY_TOKEN → Verificar e salvar.
2. Assine o campo **live_comments**.
3. Na conta @divinissimasemijoias, ative **Assinar webhooks** (bloco "Gerar tokens de acesso").
