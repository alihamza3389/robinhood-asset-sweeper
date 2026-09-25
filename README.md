# 🧹 Robinhood Chain Asset Sweeper · v3 Rework

**Clean up your Robinhood Chain wallet in a few clicks.** Send your tokens somewhere else, sell them for ETH, or get rid of spam, all at once, with a simple step-by-step menu.

It's made for people who are **not** developers. If you can copy and paste, you can use it.

```
 STEP 1/5  Choose what to do
? What would you like to do?
❯ 📤 Send to another wallet
  💱 Sell tokens for ETH
  🧹 Sell everything, then send the ETH
  🔥 Get rid of spam tokens
  👋 Exit
```

---

## What can it do?

| Option | What happens |
| :--- | :--- |
| 📤 **Send to another wallet** | Moves tokens and/or ETH to another address, like your main wallet. |
| 💱 **Sell tokens for ETH** | Sells your tokens (BUCKET, tokenized stocks like AAPL or NVDA, reward tokens, and more) for ETH. The ETH stays in your wallet. |
| 🧹 **Sell everything, then send the ETH** | Sells your tokens, then sends all the ETH to another address in one go. |
| 🔥 **Get rid of spam tokens** | Sends junk or scam tokens to a burn address so they stop cluttering your wallet. |

---

## Why this exists

[**Bucket Shop**](https://www.bucketmarkets.com/) ([@RealBucketShop](https://x.com/RealBucketShop)) pays its fee rewards straight into holders' wallets, spread across **anywhere from 1 to 20 different assets**: crypto tokens and tokenized stocks like AAPL, NVDA or GLD.

That's great, until your wallet is full of dozens of tiny reward positions. Cashing them out one by one, on different sites, with an approval and a swap for each, takes ages and costs a fee every time.

This tool fixes that. It finds **all** your Bucket Shop payouts automatically, then in one pass it either:

- **sells them all for ETH**, or
- **sends them all** to your main wallet or cold storage.

It works for any Robinhood Chain wallet too: clearing airdrop dust, burning scam tokens, or moving everything to a new wallet.

### What's new in v3 (the rework)

Version 3 is a full rewrite, focused on safety and on being easy for anyone to use:

- A **setup wizard** and a simple **step-by-step menu**
- Your key can be **saved locked with a password**, so you don't paste it every time
- Sales are **price-protected** and use **exact approvals only**
- **Practice mode** to try everything without sending anything
- Finds **tokenized stocks** correctly, and can sell tokens like **GLD through Uniswap**
- A **summary and chart links** before anything is sent

---

## Before you start: you need 2 things

### 1. Node.js (free)

Node.js is the free program that runs this tool.

- **Windows or Mac:** go to [nodejs.org](https://nodejs.org), download the **LTS** version, and install it with the default options.
- **Linux (Ubuntu/Debian):** run `sudo apt install nodejs npm`, then check that `node -v` shows version 20 or newer.

### 2. A free Blockscout key (takes 30 seconds)

The tool uses Blockscout (the Robinhood Chain explorer) to find the tokens in your wallet.

1. Go to [dev.blockscout.com](https://dev.blockscout.com) and sign in with email, Google or GitHub.
2. Create an API key and copy it. It's free and needs no card.

You'll paste this key once, in the setup wizard.

---

## How to run it

### Step 1: Download

On this GitHub page, click the green **Code** button, then **Download ZIP**. Find the downloaded file, right-click it and choose **Extract All**.

<details>
<summary>Or, if you use git</summary>

```bash
git clone https://github.com/alihamza3389/robinhood-asset-sweeper.git
cd robinhood-asset-sweeper
```
</details>

### Step 2: Start it

- **Windows:** open the extracted folder and double-click **`run.bat`**.
  - Prefer typing commands? In **Command Prompt (CMD)** type `run.bat`. In **PowerShell** type `.\run.ps1` (or `.\run.bat`).
- **Mac / Linux:** open a terminal in the folder and type `./run.sh`

The first time, it installs what it needs (a few seconds), then opens the **setup wizard**.

### Step 3: The setup wizard (first time only)

It asks three things:

1. **Your private key, and how to keep it.** We recommend **"Save it locked with a password"**. You paste your key once, choose a password, and from then on you only type the password. The key is encrypted on your computer and never leaves it.
2. **Your Blockscout key** from above. The wizard checks it works.
3. **Your usual destination address** (optional), so you don't have to paste it every time.

> 🔑 **Where do I find my private key?** In MetaMask or Rabby: open the account menu, then **Account details**, then **Show private key**. Anyone with this key controls your wallet, so never share it with anyone. For extra safety, use a separate wallet that only holds what you want to clean up.

### Step 4: Follow the steps

Use the **arrow keys** to move, **Space** to tick or untick a token, and **Enter** to continue.

1. **Choose what to do.**
2. **Look through your wallet.** You'll see your balance and a list of every token found.
3. **Pick your tokens** and how much of each (everything, a number like `1.5`, or a percent like `50%`).
4. **Review.** A summary box shows exactly what will happen, plus a chart link for each token. **Nothing is sent before you confirm.**
5. **Go.** You'll see each step finish, with a link to view it on the explorer.

---

## Try it with no risk first

Run it in **practice mode**. It goes through every step and checks everything, but never sends anything:

- **Windows (CMD):** open Command Prompt in the folder and type `run.bat --dry-run`
- **Windows (PowerShell):** `.\run.ps1 --dry-run`
- **Mac / Linux:** `./run.sh --dry-run`

---

## Is it safe?

This tool signs real transactions, so it's built to be careful:

- 🔐 **Your key stays on your computer.** If you save it, it's locked with your password using the same encryption as MetaMask (the standard Ethereum keystore format). It is never sent anywhere.
- 🧾 **You always see a summary first.** Nothing is sent until you confirm.
- 🛡️ **Sales are price-protected.** Each sale is checked just before sending. If the price moves more than 2% while it's being sent, the sale is cancelled instead of going through at a bad price. A sale is also skipped if the price is far below the market (usually because too few people are trading that token).
- ✅ **Exact approvals only.** The trading contract can only ever use the exact amount you're selling, never more.
- 🧪 **Everything is tested before it's sent.** Fake "phantom" tokens that can't actually be moved are caught before you pay any fee.
- 🎯 **Address checks.** It warns you about unusual addresses and asks you to retype the last 4 characters of a new address, which protects against malware that secretly swaps copied addresses.
- 🔥 **Burning needs you to type `BURN`.** Only tokens flagged as likely spam are pre-selected.
- 👀 **Open source.** Every line of code is in the [`src`](./src) folder for anyone to check.

Blockchain transactions can't be undone. Always read the summary before confirming.

---

## Commands

| What you want | Windows (CMD) | Windows (PowerShell) | Mac / Linux |
| :--- | :--- | :--- | :--- |
| Start the tool | double-click `run.bat`, or `run.bat` | `.\run.ps1` | `./run.sh` |
| Practice mode (sends nothing) | `run.bat --dry-run` | `.\run.ps1 --dry-run` | `./run.sh --dry-run` |
| Change your settings | `run.bat --setup` | `.\run.ps1 --setup` | `./run.sh --setup` |
| Start over (remove saved key and settings) | `run.bat --reset` | `.\run.ps1 --reset` | `./run.sh --reset` |
| Show help | `run.bat --help` | `.\run.ps1 --help` | `./run.sh --help` |

If you prefer npm: `npm start`, `npm run dry-run`, `npm run setup`, `npm run reset`.

---

## Help! Something went wrong

**"node is not recognized"**
Node.js isn't installed, or the window was open before you installed it. Install Node.js, close the window, and try again.

**PowerShell says "running scripts is disabled" or "not digitally signed"**
Windows blocks PowerShell scripts by default. Either type `.\run.bat` instead (it works the same), or allow the script for this one run: `powershell -ExecutionPolicy Bypass -File .\run.ps1`.

**PowerShell says `run.bat` "is not recognized"**
PowerShell needs `.\` in front: type `.\run.bat` or `.\run.ps1`.

**The boxes or symbols look garbled**
Your terminal can't draw emoji. Start the tool in plain mode. CMD: `set SWEEPER_PLAIN=1` then `run.bat`. PowerShell: `$env:SWEEPER_PLAIN=1` then `.\run.ps1`. Mac/Linux: `SWEEPER_PLAIN=1 ./run.sh`.

**How do I paste into the window?**
Right-click, or press Ctrl+V (Ctrl+Shift+V on Linux). Your private key stays hidden as `****` while you paste it. That's normal.

**I forgot my password**
After 3 wrong tries, choose **"I forgot it: paste my private key instead"**, paste your key from MetaMask or Rabby, and pick a new password. A forgotten password never affects your funds.

**"Blockscout rejected the API key"**
Run the setup again (`run.bat --setup`, `.\run.ps1 --setup` or `./run.sh --setup`) and paste the key, making sure you copied all of it.

**"This wallet has no ETH"**
Every transaction needs a tiny bit of ETH on Robinhood Chain to pay the network fee. A dollar or two covers many transactions.

**A token says "not sellable here"**
There's nowhere to sell it on Robinhood Chain right now (no market with enough trading). You can still send it or burn it.

**A sale was skipped because the price is below the market**
Not enough people are trading that token for the amount you're selling. Try selling a smaller amount, or accept a worse price with `--max-impact 30`.

**A token failed as a "phantom/spam token"**
Some scam tokens show a balance that can't actually be moved. The tool spots this before you pay a fee. Just ignore those tokens.

**"not confirmed within 3 minutes"**
The network was slow. Open the transaction link to see if it went through **before** running the tool again.

**I want to start over**
Use `--reset` (see Commands). It shows what's saved and lets you pick what to remove. It never touches your wallet or funds.

---

## 💚 Support this project

This tool is free. If it saved you time or money, tips are appreciated:

- **EVM** (Ethereum, Base, Arbitrum, Robinhood Chain, Arc): `0xcDcC4656293424544F32BfA58089e982B9624866`
- **Solana:** `94TmHVSd6ZWc9cAWKysQXQ5hGaymBvkQVEgaTtLVyHt8`
- ⚡ **Trade on GMGN:** instant fills, multi-chain support (Robinhood Chain, Solana, Base, BSC, Ethereum), live charts and smart-money tracking. Sign up with [this referral link](https://gmgn.ai/r/sZ5uzVHs?chain=robinhood) to support the project. The chart links in the tool use the same referral.
- 👀 **New to GMGN?** Get instant access to the wallets of major KOLs, influencers and top traders on Robinhood Chain to follow: [rh-wallets.vercel.app](https://rh-wallets.vercel.app/)

---

<details>
<summary><b>For developers</b></summary>

### How it works

- **Finding tokens:** the Blockscout Pro API lists the wallet's tokens. The official Robinhood stock list and the Bucket price-feed tokens are also checked directly on-chain, so an indexing gap can't hide them. Robinhood stock tokens are type `ERC-8056` in Blockscout, so the scan accepts every fungible type, not just `ERC-20`.
- **Balances and routes:** one multicall reads every balance and checks the router registries (`StockRouterUsdg.isRegistered`, `Treasury.isRegistered`). Tokens those routers don't support are checked for Uniswap v3 pools with real liquidity (direct to WETH, or via USDG). At sale time every path is quoted and the one returning the most ETH is used.
- **Selling:** approve the exact amount, simulate for a live quote, then send with `minAmountOut` set to the quote minus the slippage limit.
- **Prices:** the Bucket indexer feed, Blockscout, and the BUCKET/ETH Uniswap v4 pool. Prices are for display only; sales use live on-chain quotes.
- **Saved key:** `wallet.keystore.json`, Web3 Secret Storage v3 (scrypt + AES-128-CTR). Compatible with MetaMask, geth and ethers (checked in the tests).

### Contracts

| Contract | Address |
| :--- | :--- |
| BucketRouter | `0x35f9D5187A37003CEc81B630b3d378BA55C364Ea` |
| StockRouterUsdg | `0x716f97Dd8e4A6DE04327e5A34a6B03f934905d6e` |
| StockRouterDirect | `0xbdA740412082BEf923131a3303c024a06E3a77Ec` |
| Treasury | `0xe211898a898e5788878C91A1e458F3FFF3A8dD92` |
| Uniswap v3 SwapRouter02 | `0xCaf681a66D020601342297493863E78C959E5cb2` |
| Uniswap v3 QuoterV2 | `0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7` |

### Options

```
--dry-run            Simulate everything, never sign or send
--slippage <pct>     Max price movement for sells (default 2)
--max-impact <pct>   Skip a sale if its quote is this far below the market (default 15)
--setup              Run the setup wizard again
--reset              Remove saved settings and the saved key
```

Advanced settings (such as `RPC_URL` for a private RPC provider) are in [`.env.example`](./.env.example).

### Network

| | |
| :--- | :--- |
| Chain | Robinhood Chain, ID `4663` (Arbitrum Orbit L2) |
| RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Explorer | [robin.etherscan.io](https://robin.etherscan.io) |

### Development

```bash
npm install
npm test           # unit tests
npm run typecheck
```

Code layout: `src/scan` finds tokens and prices, `src/actions` sends, sells and burns, `src/ui` draws the screens, `src/keystore.ts` handles the saved key.

</details>

---

*Released under the [MIT License](./LICENSE). This software is provided as is, without warranty. You are responsible for the transactions you sign.*
