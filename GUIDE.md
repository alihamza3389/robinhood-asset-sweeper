# Beginner's Guide: Running the Sweeper & Batch Seller

A step-by-step setup guide designed for everyone, including those with zero coding or developer experience.

---

## 🖥️ Method 1: Windows Setup (Zero-Code / 1-Click)

### Step 1: Install Node.js
Node.js is the free, open-source engine that runs the tool on your computer.

1. Go to the official website: **[https://nodejs.org](https://nodejs.org)**
2. Click the green button that says **LTS (Recommended for most users)**.
3. Once downloaded, open the installer (`.msi` file).
4. Click **Next $\rightarrow$ Next $\rightarrow$ Install** using all default options.
5. Finish the setup.

---

### Step 2: Download the Project
1. At the top of this GitHub repository page, click the green **Code** button.
2. Select **Download ZIP**.
3. Once downloaded, right-click the `.zip` file and select **Extract All...** to extract it into a folder (e.g. on your Desktop or in Downloads).

---

### Step 3: Configure Your Wallet (`.env` file)
The script needs to know which wallet to scan. Your private key stays **100% on your local computer** and is never uploaded or sent anywhere.

1. Inside the extracted folder, look for the file named **`.env.example`**.
2. Make a copy of **`.env.example`** and rename the copy to **`.env`**
   > **Windows Tip:** If Windows hides file extensions, you can just right-click in an empty space inside the folder, select **New $\rightarrow$ Text Document**, open it, paste the contents from `.env.example`, and save it as `.env`.
3. Open **`.env`** with Notepad or any text editor.
4. Fill in the two main fields:
   * **`PRIVATE_KEY`**: Your wallet private key (starts with `0x`).
     * *How to get it in MetaMask / Rabby*: Open wallet $\rightarrow$ Settings $\rightarrow$ Export Private Key $\rightarrow$ Copy.
   * **`BLOCKSCOUT_API_KEY`**: Get a free API key from **[https://dev.blockscout.com](https://dev.blockscout.com)**
     * Takes 10 seconds: Sign up with email $\rightarrow$ Click "Create New Key" $\rightarrow$ Copy key. (100% Free, no credit card required).
   * **`DESTINATION_ADDRESS`**: *(Optional)* The wallet address you want to send tokens/ETH to. If left blank, the script will simply prompt you when you run it.
5. Save the file (**Ctrl + S**).

---

### Step 4: Run the Tool (CMD, PowerShell, or 1-Click)

You can launch using whichever method you prefer:

* **Option A: 1-Click Double Click**
  Inside the folder, simply double-click:
  ```
  run.bat
  ```
* **Option B: Command Prompt (cmd.exe)**
  ```cmd
  run.bat
  ```
* **Option C: PowerShell / pwsh**
  ```powershell
  .\run.ps1
  ```
  *(Or simply `.\run.bat`)*

On your first time running, it will automatically install required packages in a few seconds, then launch the interactive tool!
Use your keyboard arrows to select options, **[Space]** to select/unselect tokens, and **[Enter]** to confirm.

---

## 🐧 Method 2: Linux / macOS Setup

If you are on Linux (Ubuntu, Debian, Arch, Fedora) or macOS:

### 1. Install Node.js (v18 or higher)
* **Ubuntu / Debian**:
  ```bash
  sudo apt update && sudo apt install -y nodejs npm git
  ```
* **Arch Linux**:
  ```bash
  sudo pacman -S nodejs npm git
  ```
* **macOS** (via Homebrew):
  ```bash
  brew install node git
  ```

### 2. Clone & Setup
```bash
# Clone the repository
git clone https://github.com/alihamza3389/robinhood-asset-sweeper.git
cd robinhood-asset-sweeper

# Copy the environment file template
cp .env.example .env

# Edit .env and enter your PRIVATE_KEY and BLOCKSCOUT_API_KEY
nano .env
```

### 3. Run
You can launch with the 1-click shell script:
```bash
./run.sh
```
Or directly via npm:
```bash
npm install
npm start
```

---

## 💡 How to Use the 4 Modes

When the tool starts up, it will ask you what you want to do:

1. **1. Transfer / Sweep Assets**:
   * Sweeps selected tokens and Native ETH directly to another wallet address in sequential order.
2. **2. Batch Sell to ETH**:
   * Automatically sells all selected tokens on Robinhood Chain DEXs and deposits the proceeds directly into your wallet as ETH.
3. **3. Sell & Sweep**:
   * Liquidates your tokens to ETH first, then consolidates and sweeps the final remaining ETH to your cold storage / destination wallet in one final sweep.
4. **4. Burn / Discard to Dead Address**:
   * Permanently rids your wallet of dead meme coins, scam airdrops, or unwanted dust by sending them to `0x000000000000000000000000000000000000dEaD`.

---

## ❓ Frequently Asked Questions & Troubleshooting

### Q: Is my private key safe?
**Yes.** This tool is 100% open-source TypeScript. All cryptographic signing takes place in-memory on your machine using Viem. The code never sends your private key to any external website or third-party server.

### Q: Windows says "node is not recognized as an internal or external command"
This means Node.js wasn't installed or you haven't restarted your terminal after installing. Download and install Node.js LTS from [nodejs.org](https://nodejs.org), restart your computer or reopen File Explorer, and double-click `run.bat` again.

### Q: Why did a spam token fail to burn with "Phantom spam token"?
Some scam airdrop creators deploy smart contracts with a fake `balanceOf()` function that displays a fake balance on Blockscout to spam your wallet, but their contract has no real internal tokens to transfer. The tool automatically identifies these phantom tokens and skips them.

### Q: Where do I get gas?
Transactions on Robinhood Chain require tiny amounts of ETH on Robinhood Chain (Arbitrum Orbit L2, Chain ID `4663`) to pay for gas. Usually $0.10 to $0.50 worth of ETH is enough for dozens of transactions.
