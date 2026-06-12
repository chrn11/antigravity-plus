@echo off
chcp 65001 >nul
title Antigravity BYOK 代理
cd /d "%~dp0"

REM 诊断日志（用于排查闪退）
echo [%TIME%] 开始.bat 启动 >"%TEMP%\antigravity-start.log"

REM 检查管理员权限
echo [%TIME%] 检查管理员权限 >>"%TEMP%\antigravity-start.log"
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo 正在请求管理员权限...
    echo [%TIME%] 不是管理员，请求提权 >>"%TEMP%\antigravity-start.log"
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" 2>nul
    if errorlevel 1 (
        echo 提权失败，请手动以管理员身份运行。
        echo [%TIME%] 提权失败 >>"%TEMP%\antigravity-start.log"
    )
    echo [%TIME%] 旧窗口退出 >>"%TEMP%\antigravity-start.log"
    exit /b
)

echo [%TIME%] 是管理员，继续执行 >>"%TEMP%\antigravity-start.log"

REM 检查是否已有代理在运行（PID 文件）
echo [%TIME%] 检查 PID 文件 >>"%TEMP%\antigravity-start.log"
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
echo [%TIME%] 检查 exe 文件 >>"%TEMP%\antigravity-start.log"
if not exist "antigravity-proxy-bg.exe" (
    echo ❌ 找不到 antigravity-proxy-bg.exe
    echo 当前目录: %~dp0
    pause
    exit /b
)

REM 启动代理
echo 正在启动 Antigravity BYOK 代理...
echo [%TIME%] 正在启动代理进程 >>"%TEMP%\antigravity-start.log"

REM 直接启动exe（不带 start /B，因为 GUI 程序会自动后台运行）
start "" antigravity-proxy-bg.exe --https-port=443 --http-port=8080 --setup-hosts --setup-cert

echo [%TIME%] start 命令执行完毕 >>"%TEMP%\antigravity-start.log"

REM 等待 4 秒确认启动
ping -n 5 127.0.0.1 >nul

echo [%TIME%] 等待完毕，检查启动状态 >>"%TEMP%\antigravity-start.log"

if not exist "%TEMP%\antigravity-proxy.pid" goto start_failed
set /p NEW_PID=<"%TEMP%\antigravity-proxy.pid"
tasklist /fi "PID eq %NEW_PID%" 2>nul | findstr "%NEW_PID%" >nul
if not errorlevel 1 goto start_ok

:start_failed
echo ❌ 启动失败，查看日志: %%TEMP%%\antigravity-proxy.log
echo [%TIME%] 启动失败 >>"%TEMP%\antigravity-start.log"
pause
exit /b

:start_ok
echo ✅ 代理已启动（PID: %NEW_PID%）
echo    管理: http://127.0.0.1:8080/
echo    日志: %%TEMP%%\antigravity-proxy.log
echo [%TIME%] 启动成功 >>"%TEMP%\antigravity-start.log"
pause
