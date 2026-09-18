@echo off
title Robinhood Chain Multi-Asset Sweeper & Batch Seller
echo ================================================================
echo  Robinhood Chain Multi-Asset Sweeper & Batch Seller
echo ================================================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in your system PATH!
    echo.
    echo Please download and install Node.js from:
    echo   https://nodejs.org
    echo.
    echo (Tip: Choose the recommended LTS version, install it, then double-click run.bat again.)
    echo.
    pause
    exit /b 1
)

:: Check if .env exists; if not, create from .env.example
if not exist .env (
    if exist .env.example (
        echo [.env missing] Creating .env from .env.example template...
        copy .env.example .env >nul
        echo.
        echo [ACTION REQUIRED] A new .env file was created for you.
        echo Open the .env file with Notepad, paste your PRIVATE_KEY, and save it.
        echo.
        pause
    )
)

:: Install dependencies if node_modules is missing
if not exist node_modules (
    echo [1/2] First-time setup: Installing required packages...
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo [ERROR] Failed to install packages. Please check your internet connection.
        pause
        exit /b 1
    )
    echo [Dependencies installed successfully!]
    echo.
)

:: Launch the application
echo [2/2] Launching Sweeper & Batch Seller...
echo.
call npm start

if %errorlevel% neq 0 (
    echo.
    echo [Notice] The script ended or exited with code %errorlevel%.
)

echo.
pause
