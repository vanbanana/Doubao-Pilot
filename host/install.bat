@echo off
chcp 65001 >nul
rem 豆包 Pilot 本机助手 — 一键安装 (Windows)。双击本文件即可。
setlocal
set "DIR=%~dp0"

set "NODE="
where node >nul 2>nul && set "NODE=node"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"

if not defined NODE (
  echo [X] 未找到 Node.js。请先安装 Node 18+: https://nodejs.org/zh-cn/download
  echo     安装完成后重新双击本文件。
  pause
  exit /b 1
)

set "BROWSER=%~1"
if "%BROWSER%"=="" set "BROWSER=chrome"

echo 使用 Node: %NODE%
"%NODE%" "%DIR%install.mjs" install --browser %BROWSER%

echo.
pause
endlocal
