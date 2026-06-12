@echo off
chcp 65001 >nul
cd /d "%~dp0"

:menu
cls
echo ========================================
echo   Antigravity BYOK Proxy Manager
echo ========================================
echo.
echo   [1] Start proxy
echo   [2] Stop proxy
echo   [3] Restart (stop + start)
echo   [0] Exit
echo.
set /p ACTION="Select (0-3): "

if "%ACTION%"=="0" exit /b
if "%ACTION%"=="2" goto stop
if "%ACTION%"=="3" goto restart

REM ========== start ==========
:start
title Antigravity BYOK - Starting...

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [UAC] Requesting admin privilege...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" 2>nul
    if errorlevel 1 (
        echo [UAC] Failed. Please run as Administrator manually.
    )
    pause
    goto menu
)

REM clean up any old instance
if exist "%TEMP%\antigravity-proxy.pid" (
    set /p PID=<"%TEMP%\antigravity-proxy.pid"
    tasklist /fi "PID eq %PID%" 2>nul | findstr "%PID%" >nul
    if not errorlevel 1 (
        taskkill /f /pid %PID% >nul 2>&1
    )
    del "%TEMP%\antigravity-proxy.pid" 2>nul
) else (
    powershell -NoProfile -Command "& { $p = Get-Process 'antigravity-proxy-bg' -ErrorAction SilentlyContinue; if ($p) { $p | Stop-Process -Force } }" 2>nul
)

if not exist "antigravity-proxy-bg.exe" (
    echo [ERR] antigravity-proxy-bg.exe not found
    pause
    goto menu
)

echo [..] Starting Antigravity BYOK Proxy...
start /B "" antigravity-proxy-bg.exe --https-port=443 --http-port=8080
ping -n 5 127.0.0.1 >nul

if not exist "%TEMP%\antigravity-proxy.pid" goto start_failed
set /p NEW_PID=<"%TEMP%\antigravity-proxy.pid"
tasklist /fi "PID eq %NEW_PID%" 2>nul | findstr "%NEW_PID%" >nul
if errorlevel 1 goto start_failed

echo [OK] Proxy started (PID: %NEW_PID%)
echo      Management: http://127.0.0.1:8080/
echo      Log: %TEMP%\antigravity-proxy.log
pause
goto menu

:start_failed
echo [ERR] Failed to start. See log: %TEMP%\antigravity-proxy.log
pause
goto menu

REM ========== stop ==========
:stop
title Antigravity BYOK - Stopping...

if exist "%TEMP%\antigravity-proxy.pid" (
    set /p PID=<"%TEMP%\antigravity-proxy.pid"
    tasklist /fi "PID eq %PID%" 2>nul | findstr "%PID%" >nul
    if not errorlevel 1 (
        echo [..] Stopping proxy (PID: %PID%)...
        taskkill /f /pid %PID% >nul 2>&1
        if errorlevel 1 (echo [ERR] Failed) else (echo [OK] Stopped)
    )
    del "%TEMP%\antigravity-proxy.pid" 2>nul
    pause
    goto menu
)

powershell -NoProfile -Command "& { $p = Get-Process 'antigravity-proxy-bg' -ErrorAction SilentlyContinue; if ($p) { Write-Host 'Stopping proxy...'; $p | Stop-Process -Force; Write-Host '[OK] Stopped' } else { Write-Host 'Proxy not running' } }" 2>nul
pause
goto menu

REM ========== restart ==========
:restart
echo [..] Stopping old proxy first...
if exist "%TEMP%\antigravity-proxy.pid" (
    set /p PID=<"%TEMP%\antigravity-proxy.pid"
    tasklist /fi "PID eq %PID%" 2>nul | findstr "%PID%" >nul
    if not errorlevel 1 (
        taskkill /f /pid %PID% >nul 2>&1
        echo [OK] Old proxy stopped
    )
    del "%TEMP%\antigravity-proxy.pid" 2>nul
) else (
    powershell -NoProfile -Command "& { $p = Get-Process 'antigravity-proxy-bg' -ErrorAction SilentlyContinue; if ($p) { $p | Stop-Process -Force } }" 2>nul
)
goto start
