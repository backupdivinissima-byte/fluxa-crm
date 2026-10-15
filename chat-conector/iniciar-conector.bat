@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Fluxa Chat - conector do WhatsApp (Divinissima) ===
where node >nul 2>nul || (echo Node.js nao encontrado. Instale a versao LTS em https://nodejs.org e rode de novo. & pause & exit /b 1)
set CHAVE=
if exist "%~dp0conta-servico.json" set CHAVE=%~dp0conta-servico.json
if "%CHAVE%"=="" for %%F in ("%USERPROFILE%\Downloads\fluxa-chat-a052d-firebase-adminsdk*.json") do set CHAVE=%%~fF
if "%CHAVE%"=="" (echo Nao achei a chave do Firebase. Ela deve estar na pasta Downloads com nome fluxa-chat-a052d-firebase-adminsdk...json (do projeto fluxa-chat) & pause & exit /b 1)
echo Chave encontrada.
if not exist node_modules (echo Instalando pecas, aguarde alguns minutos... & call npm install || (echo Erro no npm install. & pause & exit /b 1))
set EMPRESA_ID=uVqpWP9nssgfcPCh68uG2zebqA63
set GOOGLE_APPLICATION_CREDENTIALS=%CHAVE%
echo Conectando. Deixe esta janela aberta.
call npm start
pause
