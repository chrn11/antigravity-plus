@echo off
chcp 65001 >nul
title 停止 Antigravity BYOK 代理

REM 优先通过 PID 文件杀进程（比进程名匹配更可靠）
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

REM 兜底：按进程名查找
tasklist /fi "ImageName eq antigravity-proxy-bg.exe" 2>nul | find "antigravity-proxy-bg" >nul
if not errorlevel 1 (
    echo 正在停止后台代理...
    taskkill /f /im antigravity-proxy-bg.exe >nul 2>&1
    if errorlevel 1 (echo ❌ 停止失败) else (echo ✅ 代理已停止)
    pause
    exit /b
)

tasklist /fi "ImageName eq antigravity-proxy.exe" 2>nul | find "antigravity-proxy" >nul
if not errorlevel 1 (
    echo 正在停止控制台代理...
    taskkill /f /im antigravity-proxy.exe >nul 2>&1
    if errorlevel 1 (echo ❌ 停止失败) else (echo ✅ 代理已停止)
    pause
    exit /b
)

echo 代理未在运行
pause
