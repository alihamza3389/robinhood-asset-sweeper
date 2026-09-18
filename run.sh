#!/usr/bin/env bash

echo "================================================================"
echo " Robinhood Chain Multi-Asset Sweeper & Batch Seller"
echo "================================================================"
echo ""

# Check if Node.js is installed
if ! command -v node >/dev/null 2>&1; then
    echo "[ERROR] Node.js is not installed!"
    echo "Please install Node.js (v18+) from: https://nodejs.org"
    exit 1
fi

# Check if .env exists
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo "[.env missing] Creating .env from .env.example template..."
        cp .env.example .env
        echo ""
        echo "[ACTION REQUIRED] A new .env file was created for you."
        echo "Please edit .env and enter your PRIVATE_KEY before proceeding."
        echo ""
        read -p "Press Enter after editing .env to continue..."
    fi
fi

# Install dependencies if node_modules is missing
if [ ! -d "node_modules" ]; then
    echo "[1/2] Installing required dependencies..."
    npm install
fi

# Run the application
echo "[2/2] Launching Sweeper & Batch Seller..."
echo ""
npm start
