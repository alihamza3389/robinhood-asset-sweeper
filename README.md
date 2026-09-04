# Robinhood Chain Multi-Asset Sweeper & Batch Seller (v2.0)

An interactive CLI tool built on **Viem** and **Blockscout Pro API** to batch sweep or batch sell multiple assets (Native ETH + ERC-20 tokens, tokenized stocks, and reward distributions) in one sequence on **Robinhood Chain (Arbitrum Orbit L2, Chain ID: `4663`)**.

---

## What's New in v2.0

* **Batch Sell & Liquidation Engine**:
  * Swap any selection of tokens directly to ETH in one interactive session.
  * Native routing through Robinhood Chain DEX contracts:
    * **$BUCKET Token**: Liquidated via `BucketRouter` (`0x35f9D5...`).
    * **USDG-routed Stocks** (AAPL, SPCX, NVDA, PLTR, TSLA): Liquidated via `StockRouterUsdg` (`0x716f97...`).
    * **Crypto & Registered Stocks** (POOLS, DOGO, JUGGERNAUT, CASHCAT, USDG, NET, etc.): Liquidated via `StockRouterDirect` (`0xbdA740...`).
* **3 Flexible Execution Modes**:
  1. `Transfer / Sweep Assets`: Direct peer-to-peer or cold-storage batch transfer of selected assets.
  2. `Batch Sell to ETH`: Converts selected tokens to ETH and deposits the proceeds directly into your wallet.
  3. `Sell & Sweep`: Sells selected tokens for ETH, consolidates the balance, and sweeps the final remaining ETH to a target destination address.
* **Parallelized Scanning Engine**:
  * Simultaneous asynchronous discovery queries Blockscout Pro API, official Robinhood stock token registries, and on-chain Uniswap v4 pool states in parallel, bringing startup scan times down to ~1-2 seconds.
* **Real-Time On-Chain Pricing**:
  * Pulls live asset valuations from indexer price feeds and reads on-chain Uniswap v4 `StateView` (`0xF333...`) slot0 pool ratios to accurately price $BUCKET and other assets in USD.
* **Automatic Custom Token Persistence**:
  * Manually added ERC-20 contract addresses are automatically saved to `custom-tokens.json` and scanned on every future run without requiring re-entry.
* **Zero-Revert Safeguards**:
  * Automatically verifies live on-chain token balances immediately prior to transaction construction to eliminate precision mismatches and balance drift errors.

---

## Use Cases

* **Bucket Shop ([bucket.markets](https://bucket.markets)) Distribution Sweeping**:
  Bucket Shop distributes fee rewards across 1 to 20 different assets (crypto tokens, tokenized stocks) into user wallets. This tool auto-detects all accumulated payout rewards and either sweeps them or liquidates them all into ETH in one pass.
* **Portfolio Liquidation**:
  Exit small positions, airdrop dust, or reward tokens across multiple pools into native ETH without manually approving and swapping on separate web UIs.
* **Cold Storage Migration**:
  Transfer an entire multi-asset portfolio to cold storage or a hardware wallet in seconds.
* **Burner Wallet Draining**:
  Sweep all tokens and remaining native gas from temporary addresses to a primary vault with automated gas reserve deduction.

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
* `PRIVATE_KEY`: Your sender wallet private key (starts with `0x`).
* `DESTINATION_ADDRESS`: The address where you want swept assets sent.
* `BLOCKSCOUT_API_KEY`: Your Blockscout Pro API key from [dev.blockscout.com](https://dev.blockscout.com) (Free, no credit card required).

### 2. Run the Tool
```bash
npm start
```

### 3. Workflow
1. **Mode Selection**: Choose between `Transfer / Sweep Assets`, `Batch Sell to ETH`, or `Sell & Sweep`.
2. **Interactive Selection**: Toggle the assets you want to process using `[Space]`.
3. **Amount Configuration**: Choose `100% (Max)` or specify exact token quantities.
4. **Plan Preview & Confirmation**: Review estimated USD values, gas reserve calculations, and execution routes before confirming.
5. **Execution**: Transactions are signed locally and broadcast sequentially with live hash and explorer links.

---

## Security & Architecture

* **100% Non-Custodial & Local In-Memory Signing**: Private keys are loaded into memory and used strictly with Viem for local `secp256k1` transaction signing. Keys never touch external servers or telemetry endpoints.
* **Exact Allowance Approvals**: Token approvals for DEX routers are strictly scoped to the exact required routers when executing swaps.
* **Dynamic Orbit L2 Gas Estimation**: Uses dynamic base fee + tip calculations tailored to Arbitrum Orbit chains with safety margins to prevent stuck transactions.
* **Git Ignored Secrets**: `.env` and `custom-tokens.json` are strictly ignored by git to protect private keys and personal tracked token lists.

---

## Donations & Support

If this tool helped you manage your assets or save time, donations are appreciated:

* **EVM** (Ethereum / Arbitrum / Base / Polygon / Robinhood Chain):
  ```
  0xcDcC4656293424544F32BfA58089e982B9624866
  ```

* **Solana**:
  ```
  94TmHVSd6ZWc9cAWKysQXQ5hGaymBvkQVEgaTtLVyHt8
  ```
