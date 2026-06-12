@echo off
chcp 65001 >nul
title Antigravity BYOK 代理
set SELF_DIR=%~dp0

REM 以管理员权限运行
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -Command "Start-Process -FilePath '%SELF_DIR%开始.bat' -Verb RunAs -WorkingDirectory '%SELF_DIR%'"
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
start "" /B "%SELF_DIR%antigravity-proxy-bg.exe" --https-port=443 --http-port=8080 --setup-hosts --setup-cert

timeout /t 4 >nul

REM 通过 PID 文件判断是否启动成功（进程起来后 Go 会写该文件）
if exist "%TEMP%\antigravity-proxy.pid" (
    echo ✅ 代理已启动
    echo    管理: http://127.0.0.1:8080/
    echo    日志: %%TEMP%%\antigravity-proxy.log
) else (
    echo ❌ 启动失败，查看日志: %%TEMP%%\antigravity-proxy.log
)

pause
