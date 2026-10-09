@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 还没有 Node.js。请先安装 18 或更新版本：https://nodejs.org/
  start https://nodejs.org/
  pause
  exit /b 1
)
if not exist cli\node_modules\ (
  call npm ci --prefix cli || goto fail
)
if not exist renderer\node_modules\ (
  call npm ci --prefix renderer || goto fail
)
if not exist web\node_modules\ (
  call npm ci --prefix web || goto fail
)
if not exist web\dist\index.html (
  call npm --prefix web run build || goto fail
)
where uv >nul 2>nul
if not errorlevel 1 (
  call uv sync --project analyzer --group dev
)
echo 关闭这个窗口就会停止工作台。
node cli\kiseki.mjs web
goto end
:fail
echo 准备运行环境时出错。
pause
:end
