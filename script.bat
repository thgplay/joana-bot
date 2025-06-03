@echo off
echo Hook rodou em %date% %time% >> %USERPROFILE%\Desktop\log-hook.txt

cls
echo === FAZENDO DEPLOY ===

:: SPRING BOOT
git pull origin main

echo === ENCERRANDO ANTIGA INSTÂNCIA DO JOANA ===
for /f "tokens=1" %%a in ('wmic process where "CommandLine like '%%java%%joana%%.jar%%'" get ProcessId ^| findstr /r "[0-9]"') do (
    echo Matando PID %%a
    taskkill /F /PID %%a >nul 2>&1
)


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
