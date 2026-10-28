# 🧹 Robinhood Chain Asset Sweeper · v4

**Clean up your Robinhood Chain wallet in a few clicks.** Send your tokens somewhere else, sell them for ETH, bridge ETH to or from Ethereum, or get rid of spam, all at once, with a simple step-by-step menu.

It's made for people who are **not** developers. If you can copy and paste, you can use it.

```
 STEP 1/5  Choose what to do
? What would you like to do?
❯ 📤 Send to another wallet
  💱 Sell tokens for ETH
  🌉 Bridge ETH between Robinhood Chain and Ethereum
  🔥 Get rid of spam tokens
  🧪 Practice mode: OFF
  👋 Exit
```

---

## What can it do?

| Option | What happens |
| :--- | :--- |
| 📤 **Send to another wallet** | Moves tokens and/or ETH to another address, like your main wallet. |
| 💱 **Sell tokens for ETH** | Sells your tokens (BUCKET, tokenized stocks like AAPL or NVDA, reward tokens, launchpad tokens like ROB, and more) for ETH. Then you choose what happens to the ETH: **keep it** in your wallet, **send it** to another address, or **bridge it to Ethereum**, all in one go. |
| 🌉 **Bridge ETH between Robinhood Chain and Ethereum** | Moves ETH either way through [Across](https://across.to): **Robinhood Chain → Ethereum** (to your own wallet or an exchange), or **Ethereum → Robinhood Chain** (handy for topping up gas). Choose an amount in ETH, in US dollars, or everything. |
| 🔥 **Get rid of spam tokens** | Sends junk or scam tokens to a burn address so they stop cluttering your wallet. |

---

## 🌉 Bridging: Robinhood Chain ⇄ Ethereum

Moving ETH off (or onto) Robinhood Chain used to mean comparing bridge sites, connecting your wallet to each one, and hoping the fee shown was the fee you paid. The tool now does it in a few steps, through [**Across**](https://across.to), and shows you the other bridges' prices next to it.

### Why Across: it's the cheapest, by a lot

We checked every bridge that serves Robinhood Chain and compared what actually arrives for the same ETH. Across came out cheapest (or tied) at every size, in both directions.

> 📅 **These are live quotes from 28 October 2026** (ETH at about $2,360). Fees change with the market, so yours will differ. The tool always fetches fresh quotes and shows you this same comparison, for your exact amount, before you confirm.

| You bridge | Across | Relay | ChangeNOW | deBridge |
| :--- | ---: | ---: | ---: | ---: |
| **Robinhood → Ethereum** | | | | |
| 0.01 ETH (~$24) | **$0.14** | $0.14 | $0.56 | $3.14 |
| 0.1 ETH (~$236) | **$0.21** | $0.35 | $2.66 | $4.89 |
| 1 ETH (~$2,360) | **$0.92** | $2.48 | $33.08 | $23.33 |
| **Ethereum → Robinhood** | | | | |
| 0.01 ETH | **$0.01** | $0.04 | $0.56 | $2.92 |
| 0.1 ETH | **$0.03** | $0.16 | $2.66 | $4.62 |
| 1 ETH | **$0.14** | $1.44 | $33.08 | $20.90 |

<sub>Bridge fee = ETH sent minus ETH received, as quoted on 28 Oct 2026. ChangeNOW is custodial (you trust them with the funds), so it's shown for price only.</sub>

On top of the bridge fee you pay the normal network fee to send the deposit: **under a cent on Robinhood Chain**, and **a few cents on Ethereum** (about $0.03 in October 2026; Ethereum fees go up when the network is busy).

It's fast too: usually **seconds**, not minutes (see the real bridges below). And the amount Across quotes is **guaranteed**: it's written into the transaction itself, so you never get less.

### Real bridges made with this tool

| Date | Direction | Sent | Arrived | Bridge fee | Arrived in |
| :--- | :--- | ---: | ---: | ---: | ---: |
| 27 Oct 2026 | Robinhood → Ethereum | 0.004266 ETH | 0.004248 ETH | $0.04 | 10 seconds |
| 27 Oct 2026 | Ethereum → Robinhood | 0.004226 ETH | 0.004221 ETH | $0.01 | 1 second |
| 27 Oct 2026 | Ethereum → Robinhood | 0.002013 ETH | 0.002008 ETH | $0.01 (+ $0.03 gas) | 1 second |

### How to bridge

1. Choose **🌉 Bridge ETH**, then the direction: **Robinhood Chain → Ethereum** or **Ethereum → Robinhood Chain**.
2. Choose where it should arrive: **your own wallet** (the same address works on both chains), your saved address, or another address such as an exchange deposit address.
3. Choose how much: an amount **in ETH**, **in US dollars**, or **everything** (a tiny amount is kept back for the network fee).
4. Check the quote: what you send, what's **guaranteed** to arrive, the fee, and the comparison with other bridges. Nothing is sent until you say yes.
5. The tool sends the deposit and **waits until it arrives**, then shows your balance before and after, with links to both transactions.

You can also sell your tokens and bridge the ETH in one go: **💱 Sell tokens for ETH**, then **Bridge it to Ethereum**.

### Retire your Robinhood Chain wallet

Done with Robinhood Chain, or done with this wallet? The tool can empty it into ETH on Ethereum. Do it in this order, so there's still ETH for the network fees until the last step:

1. **🔥 Get rid of spam tokens** (optional), so the junk is gone.
2. **📤 Send to another wallet** anything you want to keep that can't be sold (the token list marks those as not sellable).
3. **💱 Sell tokens for ETH**, then **Bridge it to Ethereum**: every token is sold, and all the ETH is bridged to your wallet (or an exchange) on Ethereum in one go.

What's left behind is just the ETH kept back for the last network fee: a few cents or less. Try it in **🧪 Practice mode** first to see exactly what would happen.

### Good to know

- **Bridging from Ethereum** needs a little ETH on Ethereum for its network fee. "Everything" keeps that back for you.
- **The minimum** is set by Across: about 0.0002 ETH (around $0.50) in October 2026. The tool always shows the current limits.
- **Sending to an exchange?** Use the exchange's deposit address for **ETH on Ethereum**. Don't send Robinhood Chain ETH straight to an exchange unless it clearly supports the Robinhood Chain network: some list it in a way that can't be traded. Bridge to Ethereum first, then deposit normal ETH.
- **If Across can't deliver** (very rare), the ETH is refunded to your wallet on the chain it came from, as WETH (wrapped ETH, worth the same).
- **Closed the window too early?** Check on any bridge later with `--track 0x…` (the deposit's transaction hash).

---

## Why this exists

[**Bucket Shop**](https://www.bucketmarkets.com/) ([@RealBucketShop](https://x.com/RealBucketShop)) pays its fee rewards straight into holders' wallets, spread across **anywhere from 1 to 20 different assets**: crypto tokens and tokenized stocks like AAPL, NVDA or GLD.

That's great, until your wallet is full of dozens of tiny reward positions. Cashing them out one by one, on different sites, with an approval and a swap for each, takes ages and costs a fee every time.

This tool fixes that. It finds **all** your Bucket Shop payouts automatically, then in one pass it either:

- **sells them all for ETH**,
- **sells them and bridges the ETH to Ethereum** (or straight to an exchange), which is also how you [retire a wallet](#retire-your-robinhood-chain-wallet), or
- **sends them all** to your main wallet or cold storage.

It works for any Robinhood Chain wallet too: clearing airdrop dust, burning scam tokens, or moving everything to a new wallet.

### What's new in v4

- 🌉 **Bridge ETH between Robinhood Chain and Ethereum**, both ways, through [Across](https://across.to), the cheapest bridge we found (in October 2026, about $0.92 to move 1 ETH to Ethereum and $0.14 the other way). Amounts in ETH, US dollars or everything, with a comparison against other bridges. Every bridge transaction is checked field by field before your key signs it. [More below](#-bridging-robinhood-chain--ethereum).
- 🧪 **Practice mode switch** in the menu, and 👀 **Just look around**: explore any wallet without a key.
- 💱 **A simpler menu.** Sell your tokens, then choose to keep the ETH, send it on, or bridge it to Ethereum.
- ↩️ **Back to the menu after every action.** Answering No no longer closes the tool.

### What came in v3 (the rework)

Version 3 is a full rewrite, focused on safety and on being easy for anyone to use:

- A **setup wizard** and a simple **step-by-step menu**
- Your key can be **saved locked with a password**, so you don't paste it every time
- Sales are **price-protected** and use **exact approvals only**
- **Practice mode** to try everything without sending anything
- Finds **tokenized stocks** correctly, and sells tokens like **GLD and ROB through Uniswap** (v3 and v4)
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

1. **Your private key, and how to keep it.** We recommend **"Save it locked with a password"**. You paste your key once, choose a password, and from then on you only type the password. The key is encrypted on your computer and never leaves it. Not ready to use your key yet? Pick **"Just look around first"** (see [Practice mode](#try-it-with-no-risk-first-practice-mode)).
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

Bridging has its own short steps (direction, destination, amount, quote): see [How to bridge](#how-to-bridge).

When it's done, or if you answer **No** anywhere, you're taken **back to the menu** (no need to unlock again). Choose **Exit** to close the tool.

---

## Try it with no risk first: Practice mode

**Practice mode** goes through every step for real (the scan, the prices, the quotes, the safety checks) but **never sends anything**. There are two ways in:

**🧪 Have a wallet? Flip the switch.** Pick **🧪 Practice mode** in the menu to turn it ON, try a sale or a bridge on your own tokens, then turn it OFF and do it for real. No restart needed.

**👀 Just looking? No key needed.** New here, or not ready to trust a new tool with your key? Choose **Just look around** when the tool starts (or in the setup wizard), then paste **any** wallet address: yours, or one you saw on an explorer or on X. You'll see that wallet's real tokens, prices, sell routes and bridge quotes. Without a key nothing can ever be signed or sent.

You can also start straight in either one:

- **Windows (CMD):** `run.bat --dry-run` (practice) or `run.bat --look 0x…` (just looking)
- **Windows (PowerShell):** `.\run.ps1 --dry-run` or `.\run.ps1 --look 0x…`
- **Mac / Linux:** `./run.sh --dry-run` or `./run.sh --look 0x…`

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
- 🌉 **Bridging is checked inside the transaction itself.** Before your key signs anything, the tool reads the actual transaction and refuses unless it goes to Across's known contracts for that direction, for exactly your amount, paying exactly the address you chose on the other chain. It is then tested against the live chain, and the signed transaction is compared with what was checked. If Across ever can't deliver, the ETH is refunded to your wallet on the chain it left from.
- 👀 **Open source.** Every line of code is in the [`src`](./src) folder for anyone to check.

Blockchain transactions can't be undone. Always read the summary before confirming.

---

## Commands

| What you want | Windows (CMD) | Windows (PowerShell) | Mac / Linux |
| :--- | :--- | :--- | :--- |
| Start the tool | double-click `run.bat`, or `run.bat` | `.\run.ps1` | `./run.sh` |
| Practice mode (sends nothing) | `run.bat --dry-run` | `.\run.ps1 --dry-run` | `./run.sh --dry-run` |
| Just look around (no key, practice only) | `run.bat --look 0x…` | `.\run.ps1 --look 0x…` | `./run.sh --look 0x…` |
| Change your settings | `run.bat --setup` | `.\run.ps1 --setup` | `./run.sh --setup` |
| Start over (remove saved key and settings) | `run.bat --reset` | `.\run.ps1 --reset` | `./run.sh --reset` |
| Check on a bridge | `run.bat --track 0x…` | `.\run.ps1 --track 0x…` | `./run.sh --track 0x…` |
| Show help | `run.bat --help` | `.\run.ps1 --help` | `./run.sh --help` |

If you prefer npm: `npm start`, `npm run dry-run`, `npm run setup`, `npm run reset` (other options go after `--`, for example `npm start -- --look 0x…`).

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
Every transaction needs a tiny bit of ETH on Robinhood Chain to pay the network fee. A dollar or two covers many transactions. Have ETH on Ethereum? Use **🌉 Bridge ETH**, then **Ethereum → Robinhood Chain**, to bring some over for a few cents.

**A bridge says it's below the Across minimum**
Across has a minimum per bridge (about 0.0002 ETH, around $0.50, in October 2026; the tool shows the current one). Bridge a little more, or wait until you have more ETH.

**A bridge says "Still on its way"**
The deposit was sent, Across just hasn't delivered it yet. **Don't bridge again.** Check on it with `--track` and the deposit's transaction hash (shown on screen). It usually arrives within a minute.

**A bridge was refunded**
Very rarely Across can't deliver. The ETH then comes back to your wallet on the chain it left from, as WETH. On Robinhood Chain, run **💱 Sell tokens for ETH** to turn the WETH back into ETH. On Ethereum, unwrap it in your wallet app or on Uniswap.

**"The Robinhood Chain RPC is temporarily limiting requests"**
The public network connection sometimes limits busy connections. The tool now switches automatically to a second public connection (PublicNode), and then to Blockscout's connection (using the key you already set up), so you should rarely see this. If you still do, wait a few minutes and start the tool again, or set `RPC_URL` in your `.env` file to a private RPC provider.

**A token says "not sellable here"**
There's nowhere to sell it on Robinhood Chain right now (no market with enough trading). You can still send it or burn it.

**A sale was skipped because the price is below the market**
Not enough people are trading that token for the amount you're selling. Try selling a smaller amount, or accept a worse price with `--max-impact 30`.

**A token failed as a "phantom/spam token"**
Some scam tokens show a balance that can't actually be moved. The tool spots this before you pay a fee. Just ignore those tokens.

**"not confirmed within 3 minutes"**
The network was slow. Open the transaction link to see if it went through **before** running the tool again.

**How do I update to a new version?**
The tool checks for updates every time it starts. When a new version is out, it shows what changed and asks **"Update now?"**. Press Enter and it updates itself and restarts. Your saved key, settings and tokens are kept, and nothing ever updates without asking. (To turn the check off, set `SWEEPER_NO_UPDATE=1`.)

On versions before 3.2, or to update by hand: if you used git, run `git pull` in the folder. If you downloaded a ZIP, download the new one from the [Releases page](https://github.com/alihamza3389/robinhood-asset-sweeper/releases/latest) and extract it, then copy **`wallet.keystore.json`** and **`.env`** (plus `custom-tokens.json` if you added tokens by hand) from the old folder into the new one. Or skip that and just run the setup wizard again.
> On a Mac, files starting with a dot are hidden in Finder: press **Cmd + Shift + .** to show them.

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
- **Balances and routes:** one multicall reads every balance and checks the router registries (`StockRouterUsdg.isRegistered`, `Treasury.isRegistered`). Tokens those routers don't support are checked for Uniswap v3 pools with real liquidity (direct to WETH, or via USDG), then for Uniswap v4 token/ETH pools (found through the PoolManager's `Initialize` events on Blockscout; this covers launchpad tokens such as Pons launches). At sale time every path or pool is quoted and the one returning the most ETH is used. v4 sales go through the Universal Router with exact-amount Permit2 approvals that expire after 10 minutes.
- **Selling:** approve the exact amount, simulate for a live quote, then send with `minAmountOut` set to the quote minus the slippage limit.
- **Network connection:** three connections tried in order: the official Robinhood Chain RPC, then [PublicNode](https://robinhood-rpc.publicnode.com) (reads and transactions), then Blockscout's JSON-RPC with your key (reads only; it checks transactions but does not broadcast them). One that blocks or rate-limits is skipped for a few minutes; transactions retry patiently for about a minute if every connection that can send is busy. Nonces are tracked locally so back-to-back transactions never collide. On Ethereum (bridging only) the tool uses PublicNode, then dRPC, with Flashbots Protect as a send-only backup; Blockscout is not used there because its balances and nonces can lag.
- **Updates:** on start the tool asks GitHub for the latest release. If it is newer it shows the highlights and asks before doing anything; it then downloads the release, checks it is this tool at that version, backs up and replaces the program files (never `.env`, keys or `custom-tokens.json`), and the launcher reinstalls packages and restarts. git clones update with a fast-forward `git pull`.
- **Bridging:** ETH between Robinhood Chain and Ethereum, either way, through the Across Swap API, ETH to ETH only. The quote's calldata is decoded and checked field by field against the route's pinned contracts (SpokePoolPeriphery, the origin chain's SpokePool, origin and destination WETH, destination chain id) plus depositor, recipient, amount, no destination message, output equal to the guaranteed amount and deadline. It is simulated with `eth_call`, signed locally with viem, and the signed bytes are decoded and compared with the checked plan before broadcast. Deposits from Ethereum carry a small tip (the network's suggestion, 0.05 to 2 gwei) and allow the base fee to triple before inclusion (2x on Robinhood Chain). Quotes older than 90 seconds are fetched again. Comparison quotes (Relay, deBridge, ChangeNOW) are for display only. Dollar amounts need Binance and CoinGecko to agree within 1%. The recipient must not be a contract on the destination chain (it would receive WETH). After sending, the deposit is followed through the Across status API.
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
| Uniswap v4 PoolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` |
| Uniswap Universal Router | `0x8876789976dEcBfCbBbe364623C63652db8C0904` |
| Uniswap V4Quoter | `0x55083D93eAdff4E1875E5489986Ad56806883139` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| Across SpokePoolPeriphery (both chains) | `0x97CCDBea4632140639aD5eA9b944aa034eb15fD4` |
| Across SpokePool, Robinhood Chain | `0xD29C85F15DF544bA632C9E25829fd29d767d7978` |
| Across SpokePool, Ethereum | `0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5` |

### Options

```
--dry-run            Simulate everything, never sign or send
--slippage <pct>     Max price movement for sells (default 2)
--max-impact <pct>   Skip a sale if its quote is this far below the market (default 15)
--setup              Run the setup wizard again
--reset              Remove saved settings and the saved key
--track <tx hash>    Check on a bridge deposit sent earlier
--look <address>     Just look around: any wallet, practice only, no key
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
# bridge signing on a local fork, with a throwaway key (see the file header). Robinhood -> Ethereum:
anvil --fork-url https://robinhood-rpc.publicnode.com --chain-id 4663 --port 8549
# or Ethereum -> Robinhood:  anvil --fork-url https://ethereum-rpc.publicnode.com --chain-id 1 --port 8549
FORK_RPC=http://127.0.0.1:8549 node --import tsx test/bridge-fork.ts
```

Code layout: `src/scan` finds tokens and prices, `src/actions` sends, sells, burns and bridges, `src/bridge` talks to Across and checks its quotes, `src/ui` draws the screens, `src/keystore.ts` handles the saved key.

</details>

---

*Released under the [MIT License](./LICENSE). This software is provided as is, without warranty. You are responsible for the transactions you sign.*
