# Publicar a API do Fluxa CRM ("Importar via API")

O código já está pronto e no GitHub. Falta só publicar essa parte (o back-end/API)
no Firebase — isso eu não consigo fazer sozinho, precisa ser feito uma vez no seu
computador, com a sua conta que já tem acesso ao projeto **fluxa-crm**.

Depois de publicado, fica no ar pra sempre (não precisa repetir, só se eu mudar o
código da API de novo no futuro).

---

## Passo 1 — Ativar o plano Blaze no projeto fluxa-crm

Cloud Functions (a tecnologia por trás da API) só funciona no plano pago por uso
do Firebase, chamado **Blaze**. Isso não significa que vai custar algo agora — o
plano Blaze tem uma cota gratuita bem generosa (2 milhões de chamadas por mês),
então só vai gerar custo se um dia o uso da API for muito grande.

1. Acesse [console.firebase.google.com](https://console.firebase.google.com) e
   abra o projeto **fluxa-crm**.
2. No canto inferior esquerdo, clique em **Fazer upgrade do plano** (ou
   Configurações do projeto → Uso e faturamento → Modificar plano).
3. Escolha **Blaze (pagamento por utilização)** e siga os passos (vincula uma
   conta de faturamento do Google Cloud — se você já tem uma de outro projeto,
   pode reaproveitar).

## Passo 2 — Baixar o código do projeto

1. Acesse [github.com/backupdivinissima-byte/fluxa-crm](https://github.com/backupdivinissima-byte/fluxa-crm)
2. Clique no botão verde **Code** → **Download ZIP**.
3. Extraia o ZIP baixado (ex.: vira uma pasta `fluxa-crm-main`).

## Passo 3 — Instalar as dependências da API

Abra um terminal **dentro da pasta extraída** (Shift + botão direito → "Abrir
janela do PowerShell aqui") e rode:

```
cd functions
npm install
cd ..
```

## Passo 4 — Publicar

Ainda no terminal, na pasta principal do projeto (não dentro de `functions`):

```
firebase deploy --only functions --project fluxa-crm
```

Isso usa a mesma conta que você já logou no Firebase CLI antes (durante a
migração). Se pedir login de novo, faça `firebase login` primeiro.

Ao final, o terminal mostra uma linha parecida com:

```
✔  functions[api(us-central1)] Successful create operation.
Function URL (api): https://us-central1-fluxa-crm.cloudfunctions.net/api
```

Se aparecer essa URL batendo com `https://us-central1-fluxa-crm.cloudfunctions.net/api`,
deu tudo certo — é exatamente essa URL que já está configurada na tela
"Importar / Sincronização" do Fluxa CRM.

### Se der erro de permissão

A conta que você usa no `firebase login` (a mesma da migração de Auth) precisa
ter papel de **Editor** (ou "Cloud Functions Admin") no projeto fluxa-crm, não
só o papel específico de Authentication. Se der erro tipo "permission denied"
ou "403", me avisa — ou vá em Firebase Console → Configurações do projeto →
Usuários e permissões e confira/ajuste o papel dessa conta.

## Passo 5 — Testar

1. No Fluxa CRM, entre como administrador → **Importar / Sincronização** →
   clique em **Gerar chave de API** → copie a chave mostrada.
2. No terminal, teste a conexão (troque `SUA_CHAVE_AQUI` pela chave copiada):

```
curl https://us-central1-fluxa-crm.cloudfunctions.net/api/v1/status -H "X-Api-Key: SUA_CHAVE_AQUI"
```

Deve responder algo como `{"ok":true,"empresa":"Divinissima Semijoias"}`.

3. Se quiser testar enviando um cliente de verdade, veja o exemplo completo de
   `curl` que já aparece na própria tela "Importar / Sincronização" do site.

## Se algo der errado na Etapa 4 (Firestore recusa salvar a chave)

Se o botão "Gerar chave de API" na tela do site der erro de permissão, é porque
as regras de segurança do Firestore (Firebase Console → Firestore Database →
Regras) ainda não liberam os campos novos (`apiKeyHash`, `apiKeyGeradaEm`) na
empresa. Me manda o print do erro que eu te passo o ajuste certo pra colar lá.
