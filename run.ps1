# PowerShell launcher. Any arguments are passed through (e.g. .\run.ps1 --dry-run).
#
# If Windows says "running scripts is disabled on this system" or "not digitally signed", either
# double-click run.bat instead, or run:
#   powershell -ExecutionPolicy Bypass -File .\run.ps1

Set-Location -LiteralPath $PSScriptRoot

Write-Host "Robinhood Chain Asset Sweeper v3 Rework" -ForegroundColor Green
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js is not installed. Install the LTS version from https://nodejs.org and run this again." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

$major = [int](node -p "process.versions.node.split('.')[0]")
if ($major -lt 20) {
    Write-Host "Your Node.js version is too old. Please install version 20 or newer from https://nodejs.org" -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

if (-not (Test-Path node_modules)) {
    Write-Host "First run: installing packages (this takes a few seconds)..." -ForegroundColor Cyan
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Installing packages failed. Check your internet connection and try again." -ForegroundColor Red
        Read-Host "Press Enter to close"
        exit 1
    }
    Write-Host ""
}

node --import tsx src/index.ts @args

Write-Host ""
Read-Host "Press Enter to close"
