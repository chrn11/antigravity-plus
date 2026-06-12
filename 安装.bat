@echo off
chcp 65001 >nul
title 安装 Antigravity BYOK 代理
cd /d "%~dp0"

REM 以管理员权限运行
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo 需要管理员权限来配置 hosts 和安装证书。
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

REM 选择安装目录（默认 D:\soft\antigravity-plus）
set INSTALL_DIR=D:\soft\antigravity-plus
if not exist "%INSTALL_DIR%" (
    mkdir "%INSTALL_DIR%"
)

REM 复制核心文件
echo 正在安装到 %INSTALL_DIR%...
copy /Y "%~dp0antigravity-proxy-bg.exe" "%INSTALL_DIR%\" >nul
copy /Y "%~dp0antigravity-proxy.exe" "%INSTALL_DIR%\" >nul
copy /Y "%~dp0开始.bat" "%INSTALL_DIR%\" >nul
copy /Y "%~dp0停止.bat" "%INSTALL_DIR%\" >nul
copy /Y "%~dp0安装.bat" "%INSTALL_DIR%\" >nul

echo ✅ 安装完成

REM 一次性安装 CA 证书
echo 正在安装 CA 证书...
start /B "" antigravity-proxy-bg.exe --setup-cert
ping -n 3 127.0.0.1 >nul
echo ✅ CA 证书安装完毕

REM 创建配置文件目录和默认文件
set CONFIG_DIR=%APPDATA%\antigravity-plus
if not exist "%CONFIG_DIR%" (
    mkdir "%CONFIG_DIR%"
)

if not exist "%CONFIG_DIR%\deepseek.key" (
    echo 注意：请创建 API Key 文件 %CONFIG_DIR%\deepseek.key
    echo 或设置环境变量 ANTIGRAVITY_API_KEY
)

REM 创建开始菜单快捷方式
set START_MENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Antigravity BYOK
if not exist "%START_MENU%" (
    mkdir "%START_MENU%"
)
powershell -Command "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%START_MENU%\启动代理.lnk'); $Shortcut.TargetPath = '%INSTALL_DIR%\开始.bat'; $Shortcut.WorkingDirectory = '%INSTALL_DIR%'; $Shortcut.Save()"
powershell -Command "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%START_MENU%\停止代理.lnk'); $Shortcut.TargetPath = '%INSTALL_DIR%\停止.bat'; $Shortcut.WorkingDirectory = '%INSTALL_DIR%'; $Shortcut.Save()"

echo ✅ 已创建开始菜单快捷方式

REM 添加到启动文件夹（开机自启）
echo 是否要添加开机自启？
set /p AUTO_START="输入 y 确认: "
if /I "%AUTO_START%"=="y" (
    set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
    powershell -Command "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%STARTUP%\Antigravity BYOK.lnk'); $Shortcut.TargetPath = '%INSTALL_DIR%\开始.bat'; $Shortcut.WorkingDirectory = '%INSTALL_DIR%'; $Shortcut.Save()"
    echo ✅ 已添加开机自启
)

pause
