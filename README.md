# Robinhood Chain Multi-Asset Batch Sender 🚀

An interactive CLI tool built on **Viem** and **Blockscout Pro API** to batch transfer multiple assets (Native ETH + ERC-20 tokens) from one wallet to a single destination address on the **Robinhood Chain (Arbitrum Orbit L2, Chain ID: `4663`)**.

---

## 💡 Why This Exists & Use Cases

This tool was created to eliminate the painful, repetitive process of manually signing dozens of individual transfer transactions.

* 🪣 **Bucket Shop ([bucket.markets](https://bucket.markets)) Distribution Sweeper**:
  Bucket Shop distributes trading fees across **1 to 20 different assets** (crypto tokens, tokenized stocks, etc.) directly into user wallets and Bucket Accounts. Holders quickly accumulate scattered balances across multiple tokens. This tool auto-detects all your accumulated payout rewards and sweeps them to your main wallet in one shot.
* 🧹 **Portfolio Migration & Cold Storage**:
  Move your entire multi-token portfolio to a new address or hardware wallet in seconds instead of transferring tokens one-by-one.
* 🧽 **Wallet Cleanup & Dust Consolidation**:
  Consolidate leftover token balances, airdrops, and DeFi farming remnants across protocols on the Robinhood Chain.
* 🔥 **Burner Wallet Draining**:
  Instantly sweep all assets and native gas from temporary or trading wallets to a secure primary vault.


---

## Network Specification (Robinhood Chain)

| Parameter | Value |
| :--- | :--- |
| **Network Name** | Robinhood Chain |
| **Chain ID** | `4663` (Testnet: `46630`) |
| **RPC Endpoint** | `https://rpc.mainnet.chain.robinhood.com` |
| **Gas Token** | `ETH` (18 decimals) |
| **Block Explorer** | [https://robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com) |
| **Blockscout API Base** | `https://robinhoodchain.blockscout.com/api/v2` |

---

## Quick Start

### 1. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Open `.env` and fill in:
- `PRIVATE_KEY`: Your sender wallet private key (starts with `0x`).
- `DESTINATION_ADDRESS`: The address where you want all selected assets sent.
- `BLOCKSCOUT_API_KEY`: Your Blockscout Pro API key from [dev.blockscout.com](https://dev.blockscout.com).

*(All Robinhood Chain RPC, Chain ID `4663`, and Explorer endpoints are pre-configured by default).*

---

### 2. Run the Interactive Sender
```bash
npm start
```

### 3. How It Works
1. **Asset Discovery**: Connects to Robinhood Chain, queries native balance via RPC and all ERC-20 token holdings via Blockscout Pro API.
2. **Interactive Checklist**: Toggle the assets you want to send using `[Space]`.
3. **Amount Configuration**: Choose `100% (Max)` or specify custom amounts.
4. **Gas Protection**: ERC-20 tokens are transferred first; Native ETH is transferred last with automatic dynamic gas reserve calculation.
5. **Confirmation & Broadcast**: Shows a summary plan before prompting for final confirmation, then broadcasts transactions sequentially with live receipt tracking.

---

## 💖 Support & Donations

If this tool helped you or saved you gas, consider buying the dev a coffee!

- **EVM** (Ethereum / Arbitrum / Base / Polygon / Robinhood Chain):
  ```
  0xcDcC4656293424544F32BfA58089e982B9624866
  ```

- **Solana**:
  ```
  94TmHVSd6ZWc9cAWKysQXQ5hGaymBvkQVEgaTtLVyHt8
  ```

