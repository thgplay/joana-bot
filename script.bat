@echo off
cls
echo === FAZENDO DEPLOY ===

:: SPRING BOOT
git pull origin main

echo === ENCERRANDO ANTIGO SPRING ===
for /f "tokens=2" %%a in ('tasklist ^| findstr java') do taskkill /PID %%a /F

echo === COMPILANDO SPRING ===
call mvnw clean install -DskipTests

echo === INICIANDO SPRING ===
if exist target\joana.jar (
    echo Iniciando joana.jar...
    start "JoanaSpring" cmd /c "java -jar target\joana.jar & pause"
) else (
    echo ❌ ERRO: joana.jar não encontrado!
)

:: NODE (VENOM BOT)
cd /d "%~dp0src\main\javascript"
git pull origin main

echo === REINICIANDO NODE COM PM2 ===
pm2 restart venom-bot || pm2 start index.js --name venom-bot

echo === DEPLOY FINALIZADO ===
pause
