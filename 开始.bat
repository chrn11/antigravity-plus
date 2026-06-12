@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM ========== 1. 提权 ==========
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [UAC] Requesting admin privilege...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" 2>nul
    if errorlevel 1 (
        echo [UAC] Failed. Please run as Administrator manually.
        pause
    )
    exit /b
)

REM ========== 2. 停止已有代理 ==========
title Antigravity BYOK - Stopping old instance...
if exist "%TEMP%\antigravity-proxy.pid" (
    set /p PID=<"%TEMP%\antigravity-proxy.pid"
    tasklist /fi "PID eq %PID%" 2>nul | findstr "%PID%" >nul
    if not errorlevel 1 (
        echo [..] Stopping old proxy (PID: %PID%)...
        taskkill /f /pid %PID% >nul 2>&1
        if errorlevel 1 (echo [ERR] Failed to stop) else (echo [OK] Old proxy stopped)
    )
    del "%TEMP%\antigravity-proxy.pid" 2>nul
) else (
    powershell -NoProfile -Command "& { $p = Get-Process 'antigravity-proxy-bg' -ErrorAction SilentlyContinue; if ($p) { Write-Host 'Stopping old proxy...'; $p | Stop-Process -Force } }" 2>nul
)

REM ========== 3. 启动代理 ==========
title Antigravity BYOK - Starting...

if not exist "antigravity-proxy-bg.exe" (
    echo [ERR] antigravity-proxy-bg.exe not found
    pause
    exit /b
)

echo [..] Starting Antigravity BYOK Proxy...
start "" antigravity-proxy-bg.exe --https-port=443 --http-port=8080 --setup-hosts --setup-cert
ping -n 5 127.0.0.1 >nul

if not exist "%TEMP%\antigravity-proxy.pid" goto start_failed
set /p NEW_PID=<"%TEMP%\antigravity-proxy.pid"
tasklist /fi "PID eq %NEW_PID%" 2>nul | findstr "%NEW_PID%" >nul
if not errorlevel 1 goto start_ok

:start_failed
echo [ERR] Failed to start. See log: %TEMP%\antigravity-proxy.log
pause
exit /b

:start_ok
echo [OK] Proxy started (PID: %NEW_PID%)
echo      Management: http://127.0.0.1:8080/
echo      Log: %TEMP%\antigravity-proxy.log
pause
