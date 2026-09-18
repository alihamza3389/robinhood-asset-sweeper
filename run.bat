@echo off
setlocal enabledelayedexpansion

echo ================================================================
echo  Robinhood Chain Multi-Asset Sweeper and Batch Seller
echo ================================================================
echo.

REM Check if Node.js is installed
node -v >nul 2>&1
if errorlevel 1 goto :no_node

REM Check if .env exists
if not exist .env goto :create_env
goto :check_modules

:create_env
if exist .env.example (
    echo Creating .env from .env.example template...
    copy .env.example .env >nul
    echo.
    echo [ACTION REQUIRED] A new .env file was created.
    echo Open the .env file with Notepad, enter your PRIVATE_KEY, and save it.
    echo.
    pause
)
goto :check_modules

:check_modules
REM Install dependencies if node_modules is missing
if not exist node_modules (
    echo [1/2] First-time setup: Installing required packages...
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERROR] Failed to install packages. Check your internet connection.
        pause
        exit /b 1
    )
    echo [Dependencies installed successfully!]
    echo.
)

REM Launch the application
echo [2/2] Launching Sweeper and Batch Seller...
echo.
call npm start
goto :end

:no_node
echo [ERROR] Node.js is not installed or not in your system PATH!
echo.
echo Please download and install Node.js LTS from:
echo   https://nodejs.org
echo.
echo After installing Node.js, double-click run.bat again.
echo.
pause
exit /b 1

:end
echo.
pause
