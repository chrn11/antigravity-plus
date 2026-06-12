@echo off
chcp 65001 >nul
title Antigravity BYOK Proxy
cd /d "%~dp0"

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

REM check PID file
if not exist "%TEMP%\antigravity-proxy.pid" goto check_exe
set /p OLD_PID=<"%TEMP%\antigravity-proxy.pid"
tasklist /fi "PID eq %OLD_PID%" 2>nul | findstr "%OLD_PID%" >nul
if not errorlevel 1 (
    echo [OK] Proxy already running (PID: %OLD_PID%)
    pause
    exit /b
)
del "%TEMP%\antigravity-proxy.pid" 2>nul
echo [INFO] Cleaned stale PID file.

:check_exe
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
