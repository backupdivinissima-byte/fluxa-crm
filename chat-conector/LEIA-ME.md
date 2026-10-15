# Conector do WhatsApp (Fluxa Chat)

Programa que fica ligado e faz a ponte entre o WhatsApp (QR Code) e o Fluxa. **Não foi testado com um WhatsApp real.**

## Riscos
- Usa uma biblioteca **não oficial** (Baileys). O WhatsApp não permite isso nos termos de uso e o **número pode ser bloqueado**. Prefira um número dedicado ao atendimento.
- O programa precisa ficar **ligado o tempo todo**. Se o computador desligar, o WhatsApp para de chegar no Fluxa.

## Como rodar (Windows)
1. Instale o Node.js 20 ou mais novo (nodejs.org).
2. Abra o terminal nesta pasta (`chat-conector`) e rode `npm install`.
3. Coloque o arquivo `.json` da conta de serviço do Firebase em um lugar seguro (nunca no repositório).
4. No terminal (PowerShell):
   ```
   $env:EMPRESA_ID="<id da empresa no Fluxa>"
   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\caminho\conta-servico.json"
   npm start
   ```
5. No Fluxa: aba **Chat → Gerar QR Code**. No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho.

Um conector por empresa (cada empresa com o seu EMPRESA_ID e o seu número).

## Regras do Firestore
Dentro de `match /empresas/{empresaId}` acrescente:
```
match /conversas/{id} { allow read, write: if request.auth != null;
  match /mensagens/{m} { allow read, write: if request.auth != null; } }
match /chatSaida/{id} { allow read, write: if request.auth != null; }
match /chatTags/{id} { allow read, write: if request.auth != null; }
match /chatConexoes/{id} { allow read, write: if request.auth != null; }
```

## Backup das conversas por e-mail
Todos os canais (WhatsApp, Instagram Direct e Messenger) gravam as conversas no mesmo lugar do Fluxa, então um único comando faz o backup de todos:
1. Na conta Gmail que vai **enviar** (pode ser a própria backupdivinissima@gmail.com): ative a verificação em duas etapas e crie uma **senha de app** (Conta Google → Segurança → Senhas de app).
2. No PowerShell:
   ```
   $env:EMPRESA_ID="<id da empresa>"
   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\caminho\conta-servico.json"
   $env:BACKUP_EMAIL_PARA="backupdivinissima@gmail.com"
   $env:BACKUP_EMAIL_DE="backupdivinissima@gmail.com"
   $env:BACKUP_EMAIL_SENHA="<senha de app>"
   npm run backup
   ```
3. Para repetir todo dia, crie uma tarefa no **Agendador de Tarefas do Windows** que rode `npm run backup` (uma tarefa por empresa).
O e-mail leva um CSV com as mensagens das últimas 24 horas. Não coloque a senha de app em nenhum arquivo do repositório.

## Backup no Google Drive (backupdivinissima@gmail.com)
Alternativa ao e-mail, sem senha de app: salva um CSV por dia numa pasta "Fluxa Chat Backup" do Drive.
1. Google Cloud (projeto fluxa-crm) → APIs e serviços → ative a **Google Drive API**.
2. Credenciais → Criar credenciais → **ID do cliente OAuth** → tipo **App para computador**. Anote o ID e a chave secreta. Se pedir a tela de consentimento, deixe como **Externo** e adicione backupdivinissima@gmail.com como usuário de teste.
3. No PowerShell (nesta pasta), com `EMPRESA_ID`, `GOOGLE_APPLICATION_CREDENTIALS`, `DRIVE_CLIENT_ID` e `DRIVE_CLIENT_SECRET` definidos:
   `npm run backup-drive -- --autorizar` (faz o login uma vez) e depois `npm run backup-drive` todo dia (Agendador de Tarefas).
Não guarde `drive-token.json` nem a chave secreta no repositório.

## Teste rápido do WhatsApp (sem banco de dados)
Só para ver se o QR Code conecta e se as mensagens chegam. No PowerShell, nesta pasta, **sem** definir `GOOGLE_APPLICATION_CREDENTIALS`:
```
npm install
npm start
```
O QR Code aparece no próprio terminal. Leia no celular (WhatsApp → Aparelhos conectados → Conectar um aparelho) e mande uma mensagem de outro número: ela aparece no terminal como `[RECEBIDA]`. Para sair, Ctrl+C. A sessão fica salva na pasta `sessao-teste`.

## Fotos, vídeos, áudios e documentos no Drive
Com o Drive autorizado (`npm run backup-drive -- --autorizar`, uma vez) e `DRIVE_CLIENT_ID`/`DRIVE_CLIENT_SECRET` definidos, o conector salva cada mídia em "Fluxa Chat Midias/<número>" no Drive de backupdivinissima@gmail.com e a conversa mostra o link "Abrir ... no Drive". Sem isso, só foto pequena e miniatura de vídeo aparecem. Quem abrir o link precisa estar logado nessa conta do Google.
