@echo off
chcp 65001 >nul
title Antigravity BYOK 代理
set SELF_DIR=%~dp0

REM 以管理员权限运行（使用完整路径避免中文编码问题）
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" 2>nul
    exit /b
)

cd /d "%SELF_DIR%"

REM 检查是否已经有代理进程在运行（用 PID 文件，不要查端口——443 可能被其他服务占用）
if exist "%TEMP%\antigravity-proxy.pid" (
    set /p OLD_PID=<"%TEMP%\antigravity-proxy.pid"
    setlocal enabledelayedexpansion
    tasklist /fi "PID eq !OLD_PID!" 2>nul | find "!OLD_PID!" >nul
    if not errorlevel 1 (
        echo 代理已在运行中（PID: !OLD_PID!）
        endlocal
        pause
        exit /b
    )
    endlocal
    REM PID 文件存在但进程已死 → 清理后继续
    del "%TEMP%\antigravity-proxy.pid" 2>nul
)

if not exist "%SELF_DIR%antigravity-proxy-bg.exe" (
    echo ❌ 找不到 antigravity-proxy-bg.exe
    echo 当前目录: %SELF_DIR%
    pause
    exit /b
)

echo 正在启动 Antigravity BYOK 代理...
REM 将 stderr 也重定向到日志文件，避免 Go 启动阶段错误喷到控制台
start "" /B "%SELF_DIR%antigravity-proxy-bg.exe" --https-port=443 --http-port=8080 --setup-hosts --setup-cert 2>>"%TEMP%\antigravity-proxy.log"

timeout /t 4 >nul

REM 通过 PID 文件 + 进程存活双重确认
if exist "%TEMP%\antigravity-proxy.pid" (
    set /p NEW_PID=<"%TEMP%\antigravity-proxy.pid"
    setlocal enabledelayedexpansion
    tasklist /fi "PID eq !NEW_PID!" 2>nul | find "!NEW_PID!" >nul
    if not errorlevel 1 (
        echo ✅ 代理已启动（PID: !NEW_PID!）
        endlocal
        echo    管理: http://127.0.0.1:8080/
        echo    日志: %%TEMP%%\antigravity-proxy.log
        pause
        exit /b
    )
    endlocal
)

echo ❌ 启动失败，查看日志: %%TEMP%%\antigravity-proxy.log
pause
