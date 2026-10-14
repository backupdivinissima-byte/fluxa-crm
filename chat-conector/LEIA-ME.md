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
match /chatConexoes/{id} { allow read, write: if request.auth != null; }
```
