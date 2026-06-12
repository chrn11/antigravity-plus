@echo off
chcp 65001 >nul
title Stop Antigravity BYOK Proxy

REM method 1: PID file
if not exist "%TEMP%\antigravity-proxy.pid" goto stop_by_name
set /p PID=<"%TEMP%\antigravity-proxy.pid"
tasklist /fi "PID eq %PID%" 2>nul | findstr "%PID%" >nul
if errorlevel 1 goto del_pid
echo [..] Stopping proxy (PID: %PID%)...
taskkill /f /pid %PID% >nul 2>&1
if errorlevel 1 (echo [ERR] Failed) else (echo [OK] Stopped)

:del_pid
del "%TEMP%\antigravity-proxy.pid" 2>nul
pause
exit /b

REM method 2: process name
:stop_by_name
powershell -NoProfile -Command "& { $p = Get-Process 'antigravity-proxy-bg' -ErrorAction SilentlyContinue; if (!$p) { $p = Get-Process 'antigravity-proxy' -ErrorAction SilentlyContinue }; if ($p) { Write-Host 'Stopping proxy...'; $p | Stop-Process -Force; Write-Host 'Stopped' } else { Write-Host 'Proxy not running' } }" 2>nul
pause
