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

REM 检查端口是否已被占用
netstat -ano | findstr "127.0.0.1:443" | findstr "LISTENING" >nul
if not errorlevel 1 (
    echo 代理已在运行中（端口 443 被占用）
    pause
    exit /b
)

if not exist "%SELF_DIR%antigravity-proxy-bg.exe" (
    echo ❌ 找不到 antigravity-proxy-bg.exe
    echo 当前目录: %SELF_DIR%
    pause
    exit /b
)

if exist "%TEMP%\antigravity-proxy.pid" del "%TEMP%\antigravity-proxy.pid" 2>nul

echo 正在启动 Antigravity BYOK 代理...
start "" /B "%SELF_DIR%antigravity-proxy-bg.exe" --https-port=443 --http-port=8080 --setup-hosts --setup-cert

timeout /t 4 >nul

netstat -ano | findstr "127.0.0.1:443" | findstr "LISTENING" >nul
if not errorlevel 1 (
    echo ✅ 代理已启动
    echo    管理: http://127.0.0.1:8080/
    echo    日志: %%TEMP%%\antigravity-proxy.log
) else (
    echo ❌ 启动失败，查看日志: %%TEMP%%\antigravity-proxy.log
)

pause
