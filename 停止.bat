@echo off
chcp 65001 >nul
title 停止 Antigravity BYOK 代理

REM ===== 方法一：通过 PID 文件停止 =====
if not exist "%TEMP%\antigravity-proxy.pid" goto stop_by_name
set /p PID=<"%TEMP%\antigravity-proxy.pid"
tasklist /fi "PID eq %PID%" 2>nul | findstr "%PID%" >nul
if errorlevel 1 goto del_pid
echo 正在停止代理（PID: %PID%）...
taskkill /f /pid %PID% >nul 2>&1
if errorlevel 1 (echo ❌ 停止失败) else (echo ✅ 代理已停止)

:del_pid
del "%TEMP%\antigravity-proxy.pid" 2>nul
pause
exit /b

REM ===== 方法二：通过进程名停止 =====
:stop_by_name
powershell -NoProfile -Command "& { $p = Get-Process 'antigravity-proxy-bg' -ErrorAction SilentlyContinue; if (!$p) { $p = Get-Process 'antigravity-proxy' -ErrorAction SilentlyContinue }; if ($p) { Write-Host '正在停止代理...'; $p | Stop-Process -Force; Write-Host '✅ 代理已停止' } else { Write-Host '代理未在运行' } }" 2>nul
pause
