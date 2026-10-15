# Fluxa Chat no servidor (VPS) — passo a passo

Objetivo: o conector do WhatsApp rodar 24 horas num servidor, sem depender do computador ligado nem de janela preta aberta.

## 1. O que contratar
Uma VPS simples com **Ubuntu 24.04 (ou 22.04)**, **1 vCPU e 2 GB de memória** (para a Divinissima e a Carla Fidelis juntas). Serve qualquer provedor (Hostinger, Contabo, DigitalOcean, Hetzner, Oracle...). Escolha um local no Brasil ou nos EUA. Anote o **IP** e a **senha** (ou chave) de acesso.

## 2. Preparar o servidor (uma vez só)
Entre no servidor (terminal do provedor ou `ssh root@IP`) e rode:

    curl -fsSL https://get.docker.com | sh
    git clone https://github.com/backupdivinissima-byte/fluxa-crm.git
    cd fluxa-crm/chat-conector/servidor
    mkdir -p segredos

## 3. Colocar a chave do Firebase (segredo — nunca no GitHub)
Envie o arquivo `fluxa-chat-a052d-firebase-adminsdk...json` (o mesmo da pasta Downloads) para o servidor, com o nome **conta-servico.json**, dentro de `fluxa-crm/chat-conector/servidor/segredos/`.
Do seu Windows, num terminal: `scp "C:\Users\josyc\Downloads\fluxa-chat-a052d-firebase-adminsdk-....json" root@IP:/root/fluxa-crm/chat-conector/servidor/segredos/conta-servico.json`
(o painel do provedor também costuma ter um gerenciador de arquivos).

## 4. Ligar
    docker compose up -d --build

Ver o que está acontecendo (as mesmas linhas da janela preta):

    docker logs -f fluxa-chat-divinissima

## 5. Passar o WhatsApp do computador para o servidor
1. **Feche** o conector do seu computador (janela preta) — só pode haver um conector por número.
2. No Fluxa: Chat → **Reconectar WhatsApp** → **Gerar QR Code** e leia no celular (Aparelhos conectados). A sessão fica guardada no servidor.

## 6. Carla Fidelis (quando a conta dela existir)
No arquivo `docker-compose.yml`, tire o `#` das linhas da `carlafidelis`, coloque o id da empresa dela e rode de novo `docker compose up -d --build`. Depois ela faz o mesmo passo 5 no Chat dela, com o número de WhatsApp dela.

## Dia a dia
- Atualizar para uma versão nova: `cd fluxa-crm && git pull && cd chat-conector/servidor && docker compose up -d --build`
- Reiniciar: `docker compose restart`
- Parar: `docker compose down` (a sessão do WhatsApp é mantida)

## Segurança
- A chave `conta-servico.json` só fica no servidor (pasta `segredos`, fora do GitHub).
- Ative o firewall do provedor liberando só a porta de acesso (SSH). O conector não abre nenhuma porta.
- Troque a senha de acesso do servidor e, se puder, use chave SSH.
