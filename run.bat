@echo off
REM One-click launcher for Windows. Double-click it, or run "run.bat --dry-run" from a terminal.
setlocal
cd /d "%~dp0"

echo Robinhood Chain Asset Sweeper v3 Rework
echo.

where node >nul 2>&1
if errorlevel 1 goto :no_node

for /f %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 20 goto :old_node

if exist node_modules goto :launch
echo First run: installing packages (this takes a few seconds)...
call npm install --no-audit --no-fund
if errorlevel 1 goto :install_failed
echo.

:launch
node --import tsx src/index.ts %*
goto :end

:no_node
echo Node.js is not installed.
echo Install the LTS version from https://nodejs.org, then double-click run.bat again.
goto :end

:old_node
echo Your Node.js version is too old. Please install version 20 or newer from https://nodejs.org
goto :end

:install_failed
echo.
echo Installing packages failed. Check your internet connection and try again.

:end
echo.
pause
