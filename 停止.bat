@echo off
chcp 65001 >nul
title 停止 Antigravity BYOK 代理

REM 方法一：通过 PID 文件停止（最可靠）
if exist "%TEMP%\antigravity-proxy.pid" (
    set /p PID=<"%TEMP%\antigravity-proxy.pid"
    setlocal enabledelayedexpansion
    tasklist /fi "PID eq !PID!" 2>nul | find "!PID!" >nul
    if not errorlevel 1 (
        echo 正在停止代理（PID: !PID!）...
        taskkill /f /pid !PID! >nul 2>&1
        if errorlevel 1 (echo ❌ 停止失败) else (echo ✅ 代理已停止)
    )
    endlocal
    del "%TEMP%\antigravity-proxy.pid" 2>nul
    pause
    exit /b
)

REM 方法二：尝试用 PowerShell 按进程名查找（不显示系统错误）
powershell -Command "& {
    $bg = Get-Process 'antigravity-proxy-bg' -ErrorAction SilentlyContinue;
    $con = Get-Process 'antigravity-proxy' -ErrorAction SilentlyContinue;
    if ($bg) { Write-Host '正在停止后台代理...'; $bg | Stop-Process -Force; Write-Host '✅ 代理已停止' }
    elseif ($con) { Write-Host '正在停止控制台代理...'; $con | Stop-Process -Force; Write-Host '✅ 代理已停止' }
    else { Write-Host '代理未在运行' }
}" 2>nul

pause
