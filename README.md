# Robinhood Chain Multi-Asset Sweeper & Batch Seller 🚀 (v2.0)

An interactive CLI tool built on **Viem** and **Blockscout Pro API** to batch sweep, sell, or burn multiple assets (Native ETH + ERC-20 tokens, tokenized stocks, and reward distributions) in one sequence on **Robinhood Chain (Arbitrum Orbit L2, Chain ID: `4663`)**.

---

## 💡 What's New in v2.0

* ⚡ **Batch Sell & Liquidation Engine**:
  * Swap any selection of tokens directly to ETH in one interactive session.
  * Native routing through Robinhood Chain DEX contracts:
    * **$BUCKET Token**: Liquidated via `BucketRouter` (`0x35f9D5...`).
    * **USDG-routed Stocks** (AAPL, SPCX, NVDA, PLTR, TSLA): Liquidated via `StockRouterUsdg` (`0x716f97...`).
    * **Crypto & Registered Stocks** (POOLS, DOGO, JUGGERNAUT, CASHCAT, USDG, NET, etc.): Liquidated via `StockRouterDirect` (`0xbdA740...`).
* 🎛️ **4 Flexible Execution Modes**:
  1. `Transfer / Sweep Assets`: Direct peer-to-peer or cold-storage batch transfer of selected assets to any destination.
  2. `Batch Sell to ETH`: Converts selected tokens to ETH and deposits the proceeds directly into your wallet.
  3. `Sell & Sweep`: Sells selected tokens for ETH, consolidates the balance, and sweeps the final remaining ETH to a target destination address.
  4. `Burn / Discard to Dead Address`: Safely purge dead tokens, worthless meme coins, or scam dust by permanently transferring them to `0x000000000000000000000000000000000000dEaD`.
* 🎯 **Dynamic Destination Prompting**:
  * Automatically prompts for the recipient address when you run the script, pre-filling your `.env` destination as the default. You can also type `"dead"` or `"burn"` at the prompt to route directly to the burn address.
* 🔗 **Live Clickable GMGN Chart Links**:
  * On the amount configuration step, the tool displays the complete contract address hyperlinked directly to [GMGN.ai](https://gmgn.ai) (`https://gmgn.ai/robinhood/token/sZ5uzVHs_<address>`), letting you instantly inspect liquidity, volume, and charts before confirming.
* 🚀 **Parallelized Fast Scanning Engine**:
  * Simultaneous asynchronous discovery queries Blockscout Pro API, official Robinhood stock token registries, and on-chain Uniswap v4 pool states in parallel, bringing startup scan times down to ~1-2 seconds.
* 📈 **Real-Time On-Chain Pricing & USD Valuations**:
  * Pulls live asset valuations from indexer price feeds and reads on-chain Uniswap v4 `StateView` (`0xF333...`) slot0 pool ratios to accurately price $BUCKET and other assets in USD.
* 💾 **Automatic Custom Token Persistence**:
  * Manually added ERC-20 contract addresses are automatically saved to `custom-tokens.json` and scanned on every future run without requiring re-entry.
* 🛡️ **Zero-Revert Safeguards & Scam Token Detection**:
  * Automatically verifies live on-chain token balances immediately prior to transaction construction to eliminate precision mismatches and balance drift errors.
  * Accurately detects and decodes phantom scam tokens (where contracts spoof fake balances while actual internal balances are 0).

---

## 🪣 Why This Exists & Use Cases

* 🪣 **Bucket Shop ([bucket.markets](https://bucket.markets)) Distribution Sweeper**:
  Bucket Shop distributes fee rewards across **1 to 20 different assets** (crypto tokens, tokenized stocks) into user wallets. This tool auto-detects all accumulated payout rewards and either sweeps them or liquidates them all into ETH in one pass.
* 💸 **Portfolio Liquidation**:
  Exit small positions, airdrop dust, or reward tokens across multiple pools into native ETH without manually approving and swapping on separate web UIs.
* 🔥 **Purging Dead Tokens & Scam Dust**:
  Clean up wallet bloat by batch burning worthless or dead tokens to `0x000000000000000000000000000000000000dEaD`.
* 🧹 **Cold Storage & Wallet Migration**:
  Transfer an entire multi-asset portfolio to cold storage or a hardware wallet in seconds instead of transferring tokens one-by-one.
* ⛽ **Burner Wallet Draining**:
  Sweep all tokens and remaining native gas from temporary addresses to a primary vault with automated gas reserve deduction.

---

## 🌐 Network Specification (Robinhood Chain)

| Parameter | Value |
| :--- | :--- |
| **Network Name** | Robinhood Chain |
| **Chain ID** | `4663` (Testnet: `46630`) |
| **RPC Endpoint** | `https://rpc.mainnet.chain.robinhood.com` |
| **Gas Token** | `ETH` (18 decimals) |
| **Block Explorer** | [https://robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com) |
| **Blockscout API Base** | `https://robinhoodchain.blockscout.com/api/v2` |

---

## 🚀 Quick Start

> 📘 **New to coding or terminal tools?** Check out the step-by-step **[Beginner's Setup Guide (Windows & Linux)](./GUIDE.md)** for a complete, zero-code walkthrough!

### ⚡ 1-Click Launchers (Recommended)

* **Windows**: Simply double-click **`run.bat`** (automatically checks Node.js, sets up `.env`, installs packages, and launches the interactive tool).
* **Linux / macOS**: Run **`./run.sh`** in your terminal.

---

### 💻 Manual Setup

#### 1. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Open `.env` and fill in:
* `PRIVATE_KEY`: Your sender wallet private key (starts with `0x`).
* `DESTINATION_ADDRESS`: (Optional) Default address where you want swept assets sent.
* `BLOCKSCOUT_API_KEY`: Your Blockscout Pro API key from [dev.blockscout.com](https://dev.blockscout.com) (**100% Free** — takes 10 seconds to generate, no payment/credit card required).

*(All Robinhood Chain RPC, Chain ID `4663`, and Explorer endpoints are pre-configured by default).*

#### 2. Install & Run
```bash
npm install
npm start
```

### 3. Workflow
1. **Mode Selection**: Choose between `Transfer / Sweep Assets`, `Batch Sell to ETH`, `Sell & Sweep`, or `Burn / Discard to Dead Address`.
2. **Destination Address**: Enter the target recipient address, confirm the `.env` default with `[Enter]`, or type `"dead"` to burn.
3. **Interactive Selection**: Toggle the assets you want to process using `[Space]`.
4. **Amount Configuration & GMGN Verification**: Review the complete contract address and clickable [GMGN.ai](https://gmgn.ai) chart link for each token, then choose `100% (Max)` or specify custom quantities.
5. **Plan Preview & Confirmation**: Review estimated USD values, gas reserve calculations, and execution routes before confirming.
6. **Execution**: Transactions are signed locally and broadcast sequentially with live hash and explorer links.

---

## 🔒 Security, Privacy & Local Key Management

* 🛡️ **100% Open-Source & Auditable**: No compiled binaries, minified bundles, or obfuscated code. Every line of TypeScript is cleanly laid out in [`src/`](./src) so you can inspect every transaction handler and network call before running.
* 🔐 **Local-Only In-Memory Signing (`secp256k1`)**: All transaction payloads are constructed, serialized, and signed in-memory on your local machine using [`viem`](https://viem.sh). Your raw private key **never** leaves your local environment.
* 🚫 **Zero Telemetry & No Key Exfiltration**: The script only makes standard JSON-RPC calls to official Robinhood nodes and read-only queries to Blockscout / indexers. Zero telemetry services, external trackers, or third-party servers.
* 🛑 **Exact Allowance Approvals**: Token approvals for DEX routers are strictly scoped to the exact required routers when executing swaps.
* 📁 **Strict Git Protection**: The repository's [`.gitignore`](.gitignore) strictly prevents `.env`, secrets, and personal [`custom-tokens.json`](custom-tokens.json) from ever being staged or committed.

---

## 💖 Support & Donations

If this tool helped you manage your assets or save time, donations are appreciated:

* **EVM** (Ethereum / Arbitrum / Base / Polygon / Robinhood Chain):
  ```
  0xcDcC4656293424544F32BfA58089e982B9624866
  ```

* **Solana**:
  ```
  94TmHVSd6ZWc9cAWKysQXQ5hGaymBvkQVEgaTtLVyHt8
  ```
