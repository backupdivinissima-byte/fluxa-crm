@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Fluxa Chat - conector do WhatsApp (Divinissima) ===
where node >nul 2>nul || (echo Node.js nao encontrado. Instale a versao LTS em https://nodejs.org e rode de novo. & pause & exit /b 1)
if not exist "%~dp0..\conta-servico.json" (echo Falta o arquivo C:\fluxa-chat\conta-servico.json ^(chave do Firebase^). & pause & exit /b 1)
if not exist node_modules (echo Instalando pecas, aguarde... & call npm install || (echo Erro no npm install. & pause & exit /b 1))
set EMPRESA_ID=uVqpWP9nssgfcPCh68uG2zebqA63
set GOOGLE_APPLICATION_CREDENTIALS=%~dp0..\conta-servico.json
echo Conectando. Deixe esta janela aberta.
call npm start
pause
