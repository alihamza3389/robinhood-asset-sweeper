# Robinhood Chain Multi-Asset Sweeper and Batch Seller (PowerShell Launcher)

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host " Robinhood Chain Multi-Asset Sweeper and Batch Seller" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check if Node.js is installed
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js is not installed or not found in your PATH!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please download and install Node.js (LTS recommended) from:" -ForegroundColor Yellow
    Write-Host "  https://nodejs.org" -ForegroundColor White
    Write-Host ""
    Write-Host "After installation, reopen your terminal and run this script again." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to exit..."
    exit 1
}

# 2. Check if .env exists
if (-not (Test-Path .env)) {
    if (Test-Path .env.example) {
        Write-Host "[.env missing] Creating .env from .env.example template..." -ForegroundColor Yellow
        Copy-Item .env.example .env
        Write-Host ""
        Write-Host "[ACTION REQUIRED] A new .env file was created for you." -ForegroundColor Cyan
        Write-Host "Please open .env in your text editor, enter your PRIVATE_KEY, and save it." -ForegroundColor Yellow
        Write-Host ""
        Read-Host "Press Enter after saving .env to continue..."
    } else {
        Write-Host "[WARNING] .env.example template was not found!" -ForegroundColor Yellow
    }
}

# 3. Check dependencies
if (-not (Test-Path node_modules)) {
    Write-Host "[1/2] First-time setup: Installing required packages..." -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "[ERROR] npm install failed. Please check your internet connection." -ForegroundColor Red
        Read-Host "Press Enter to exit..."
        exit 1
    }
    Write-Host "[Dependencies installed successfully!]" -ForegroundColor Green
    Write-Host ""
}

# 4. Launch the application
Write-Host "[2/2] Launching Sweeper and Batch Seller..." -ForegroundColor Green
Write-Host ""
npm start

Write-Host ""
Read-Host "Press Enter to exit..."
