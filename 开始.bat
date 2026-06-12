@echo off
chcp 65001 >nul
title Antigravity BYOK 代理
cd /d "%~dp0"

REM 检查管理员权限
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo 正在请求管理员权限...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" 2>nul
    if errorlevel 1 (
        echo 提权失败，请手动以管理员身份运行。
        pause
    )
    exit /b
)

REM ===== 以下代码在管理员权限下执行 =====

REM 检查是否已有代理在运行（PID 文件）
if not exist "%TEMP%\antigravity-proxy.pid" goto check_exe
set /p OLD_PID=<"%TEMP%\antigravity-proxy.pid"
tasklist /fi "PID eq %OLD_PID%" 2>nul | findstr "%OLD_PID%" >nul
if not errorlevel 1 (
    echo 代理已在运行中（PID: %OLD_PID%）
    pause
    exit /b
)
del "%TEMP%\antigravity-proxy.pid" 2>nul
echo 已清理失活进程的 PID 文件。

:check_exe
if not exist "antigravity-proxy-bg.exe" (
    echo ❌ 找不到 antigravity-proxy-bg.exe
    echo 当前目录: %~dp0
    pause
    exit /b
)

REM 启动代理（后台进程）
echo 正在启动 Antigravity BYOK 代理...
start /B "" antigravity-proxy-bg.exe --https-port=443 --http-port=8080 --setup-hosts --setup-cert

REM 等待 4 秒确认启动（ping 兼容所有 Windows 版本）
ping -n 5 127.0.0.1 >nul

:check_start
if not exist "%TEMP%\antigravity-proxy.pid" goto start_failed
set /p NEW_PID=<"%TEMP%\antigravity-proxy.pid"
tasklist /fi "PID eq %NEW_PID%" 2>nul | findstr "%NEW_PID%" >nul
if not errorlevel 1 goto start_ok

:start_failed
echo ❌ 启动失败，查看日志: %%TEMP%%\antigravity-proxy.log
pause
exit /b

:start_ok
echo ✅ 代理已启动（PID: %NEW_PID%）
echo    管理: http://127.0.0.1:8080/
echo    日志: %%TEMP%%\antigravity-proxy.log
pause
