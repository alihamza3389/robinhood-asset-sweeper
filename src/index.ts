import 'dotenv/config';
import chalk from 'chalk';
import ora from 'ora';
import { isAddress, parseUnits, formatUnits, Address } from 'viem';
import { checkbox, input, select, confirm } from '@inquirer/prompts';
import { AssetInfo, AssetTransferPlan, ExecutionResult, NetworkConfig, OperationMode } from './types.js';
import { fetchTokensFromBlockscout } from './blockscout.js';
import { createClients, fetchNativeAsset, fetchOnchainErc20, executeSingleTransfer } from './transfer.js';
import { fetchLivePrices, enrichAssetsWithPrices, formatUsd, formatBalance } from './prices.js';
import { executeSellToken } from './sell.js';
import { classifyAsset, loadOfficialRobinhoodStocks } from './registry.js';
import { loadSavedCustomTokens, saveCustomToken } from './customTokens.js';

// Defaults for Robinhood Chain Mainnet (Arbitrum Orbit L2)
const DEFAULT_CHAIN_ID = 4663;
const DEFAULT_RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';
const DEFAULT_EXPLORER_URL = 'https://robinhoodchain.blockscout.com';
const DEFAULT_BLOCKSCOUT_API_URL = 'https://robinhoodchain.blockscout.com/api/v2';
const DEFAULT_CHAIN_NAME = 'Robinhood Chain';
const DEFAULT_NATIVE_SYMBOL = 'ETH';
const DEFAULT_NATIVE_DECIMALS = 18;

async function main() {
  console.clear();
  console.log(chalk.bold.hex('#00C805')(`
╔══════════════════════════════════════════════════════════════════════════╗
║              ROBINHOOD CHAIN MULTI-ASSET SWEEPER & SELLER               ║
║         (Chain ID: 4663 • Real-Time USD Valuations • Viem Engine)        ║
╚══════════════════════════════════════════════════════════════════════════╝
`));

  // 1. Resolve Configuration
  let privateKey = process.env.PRIVATE_KEY?.trim();
  if (!privateKey || !privateKey.startsWith('0x') || privateKey.length !== 66) {
    console.log(chalk.yellow('Private key not found in .env'));
    privateKey = await input({
      message: 'Enter your Sender Private Key (0x...):',
      validate: (val) =>
        val.startsWith('0x') && val.length === 66 ? true : 'Must be a 66-character hex string starting with 0x',
    });
  }

  const rpcUrl = process.env.RPC_URL?.trim() || DEFAULT_RPC_URL;
  const chainId = parseInt(process.env.CHAIN_ID || '', 10) || DEFAULT_CHAIN_ID;
  const chainName = process.env.CHAIN_NAME || DEFAULT_CHAIN_NAME;
  const nativeSymbol = process.env.NATIVE_CURRENCY_SYMBOL || DEFAULT_NATIVE_SYMBOL;
  const nativeDecimals = parseInt(process.env.NATIVE_CURRENCY_DECIMALS || '', 10) || DEFAULT_NATIVE_DECIMALS;
  const explorerUrl = (process.env.EXPLORER_URL || DEFAULT_EXPLORER_URL).replace(/\/+$/, '');
  const blockscoutApiUrl = process.env.BLOCKSCOUT_API_URL?.trim() || DEFAULT_BLOCKSCOUT_API_URL;
  const blockscoutApiKey = process.env.BLOCKSCOUT_API_KEY?.trim() || '';

  const networkConfig: NetworkConfig = {
    rpcUrl,
    chainId,
    chainName,
    nativeCurrency: {
      name: nativeSymbol,
      symbol: nativeSymbol,
      decimals: nativeDecimals,
    },
    explorerUrl,
    blockscoutApiUrl,
    blockscoutApiKey,
  };

  // 2. Initialize Viem Clients
  const { account, publicClient, walletClient } = createClients(
    networkConfig,
    privateKey as `0x${string}`
  );

  console.log(chalk.cyan(`🔑 Sender Wallet:     ${chalk.bold.white(account.address)}`));
  console.log(chalk.cyan(`🌐 Network:           ${chalk.bold.white(chainName)} (Chain ID: ${chainId})`));
  console.log(chalk.cyan(`⚡ RPC URL:           ${chalk.bold.white(rpcUrl)}`));

  // 3. Mode Selection
  const mode = await select<OperationMode>({
    message: chalk.bold.white('Select operation mode:'),
    choices: [
      {
        name: `${chalk.bold.green('1. Transfer / Sweep Assets')} ${chalk.gray('- Transfer selected tokens/ETH to 1 address')}`,
        value: 'TRANSFER',
      },
      {
        name: `${chalk.bold.yellow('2. Batch Sell to ETH')} ${chalk.gray('- Swap selected reward tokens directly to ETH in your wallet')}`,
        value: 'SELL_TO_ETH',
      },
      {
        name: `${chalk.bold.cyan('3. Sell & Sweep')} ${chalk.gray('- Swap selected tokens to ETH + sweep all ETH to cold storage')}`,
        value: 'SELL_AND_SWEEP',
      },
    ],
  });

  // 4. Recipient Address (if transferring/sweeping)
  let recipientAddress = account.address;
  if (mode === 'TRANSFER' || mode === 'SELL_AND_SWEEP') {
    recipientAddress = (process.env.DESTINATION_ADDRESS?.trim() || '') as Address;
    if (!recipientAddress || !isAddress(recipientAddress)) {
      recipientAddress = (await input({
        message: 'Enter Destination Recipient Address (0x...):',
        validate: (val) => (isAddress(val) ? true : 'Invalid EVM address'),
      })) as Address;
    } else {
      console.log(chalk.cyan(`🎯 Destination:       ${chalk.bold.white(recipientAddress)} (from .env)`));
    }
  }

  // 5. Fetch Assets & Live USD Prices (Parallelized for Speed)
  const spinner = ora({ text: 'Scanning wallet & live market data...', color: 'green' }).start();

  const savedCustomTokens = loadSavedCustomTokens();

  const [_, priceData, nativeAssetResult, blockscoutTokensResult, customTokensResult] = await Promise.all([
    loadOfficialRobinhoodStocks().catch(() => {}),
    fetchLivePrices(publicClient).catch(() => ({ tokenPrices: {}, ethPriceUsd: 2450 })),
    fetchNativeAsset(publicClient, account.address, nativeSymbol, nativeDecimals).catch(() => null),
    fetchTokensFromBlockscout(blockscoutApiUrl, account.address, blockscoutApiKey, chainId).catch(() => []),
    Promise.all(savedCustomTokens.map((addr) => fetchOnchainErc20(publicClient, addr, account.address).catch(() => null))),
  ]);

  let allAssets: AssetInfo[] = [];

  if (nativeAssetResult && nativeAssetResult.balanceRaw > 0n) {
    allAssets.push(nativeAssetResult);
  }

  for (const t of blockscoutTokensResult) {
    if (!allAssets.some((a) => a.address.toLowerCase() === t.address.toLowerCase())) {
      allAssets.push(t);
    }
  }

  for (const ct of customTokensResult) {
    if (ct && ct.balanceRaw > 0n && !allAssets.some((a) => a.address.toLowerCase() === ct.address.toLowerCase())) {
      allAssets.push(ct);
    }
  }

  // Classify all assets in parallel
  allAssets = await Promise.all(
    allAssets.map(async (asset) => {
      if (asset.type === 'NATIVE') return asset;
      const classification = await classifyAsset(asset.address, publicClient);
      return {
        ...asset,
        category: classification.category,
        isSellable: classification.isSellable,
      };
    })
  );

  // Enrich with USD pricing
  const { tokenPrices, ethPriceUsd } = priceData;
  allAssets = enrichAssetsWithPrices(allAssets, tokenPrices, ethPriceUsd);

  const totalWalletUsd = allAssets.reduce((sum, a) => sum + (a.valueUsd || 0), 0);

  spinner.succeed(
    `Scan complete! Found ${allAssets.length} asset(s). Estimated Total: ${chalk.bold.green(formatUsd(totalWalletUsd))} (ETH: ${formatUsd(ethPriceUsd)})`
  );

  // Optional manual token addition
  const addManual = await confirm({
    message: 'Would you like to manually add any specific ERC-20 token contract address?',
    default: false,
  });

  if (addManual) {
    let adding = true;
    while (adding) {
      const customTokenAddr = await input({
        message: 'Enter ERC-20 Token Contract Address (0x...):',
        validate: (val) => (isAddress(val) ? true : 'Invalid contract address'),
      });

      const tokenSpin = ora('Querying token info on Robinhood Chain...').start();
      let customAsset = await fetchOnchainErc20(
        publicClient,
        customTokenAddr as `0x${string}`,
        account.address
      );

      if (customAsset) {
        saveCustomToken(customTokenAddr as Address);
        customAsset = enrichAssetsWithPrices([customAsset], tokenPrices, ethPriceUsd)[0];
        tokenSpin.succeed(
          `Found ${customAsset.name} (${customAsset.symbol}) - Balance: ${customAsset.balanceFormatted} (${formatUsd(customAsset.valueUsd)}) [Saved for future runs]`
        );
        if (!allAssets.some((a) => a.address.toLowerCase() === customAsset!.address.toLowerCase())) {
          allAssets.push(customAsset);
        }
      } else {
        tokenSpin.fail('Could not query token at that address.');
      }

      adding = await confirm({ message: 'Add another token?', default: false });
    }
  }

  if (allAssets.length === 0) {
    console.log(chalk.red('\nNo assets with non-zero balance were found in this wallet on Robinhood Chain.'));
    process.exit(0);
  }

  // Filter eligible assets based on mode
  let eligibleAssets = allAssets;
  if (mode === 'SELL_TO_ETH' || mode === 'SELL_AND_SWEEP') {
    const unregTokens = allAssets.filter((a) => !a.isSellable && a.type !== 'NATIVE');
    if (unregTokens.length > 0) {
      console.log(
        chalk.yellow(
          `\nℹ Note: ${unregTokens.length} unregistered token(s) (${unregTokens.map((t) => t.symbol).join(', ')}) cannot be sold on DEX and are excluded from the sell list.`
        )
      );
    }
    eligibleAssets = allAssets.filter((a) => a.isSellable);
  }

  if (eligibleAssets.length === 0) {
    console.log(chalk.red('\nNo sellable tokens found in this wallet for DEX routers.'));
    process.exit(0);
  }

  // 6. Interactive Asset Selection
  console.log(chalk.bold('\nSelect the assets to include:'));

  const choices = eligibleAssets.map((asset) => {
    const usdStr = chalk.bold.green(formatUsd(asset.valueUsd).padEnd(9));
    const formattedBal = formatBalance(asset.balanceFormatted);
    const tag = asset.type === 'NATIVE' ? chalk.yellow('(Native Gas)') : chalk.gray(`(${asset.address.slice(0, 6)}...${asset.address.slice(-4)})`);

    return {
      name: `${asset.symbol.padEnd(12)} | Balance: ${formattedBal.padEnd(14)} (${usdStr}) ${tag}`,
      value: asset.address,
      checked: true,
    };
  });

  const selectedAddresses = await checkbox({
    message: 'Choose assets (Space to toggle, Enter to confirm):',
    choices,
    validate: (val) => (val.length > 0 ? true : 'You must select at least one asset!'),
  });

  const selectedAssets = eligibleAssets.filter((a) => selectedAddresses.includes(a.address));

  // 7. Configure Amounts
  console.log(chalk.bold('\nConfigure amounts:'));
  const transferPlans: AssetTransferPlan[] = [];

  for (const asset of selectedAssets) {
    const isNative = asset.type === 'NATIVE';
    const amountChoice = await select({
      message: `Amount for ${chalk.bold.cyan(asset.symbol)} (Available: ${asset.balanceFormatted} / ${formatUsd(asset.valueUsd)}):`,
      choices: [
        {
          name: `100% (Max / All)${isNative ? ' [Auto-subtracts gas reserve]' : ''}`,
          value: 'MAX',
        },
        {
          name: 'Custom Amount',
          value: 'CUSTOM',
        },
      ],
    });

    if (amountChoice === 'MAX') {
      transferPlans.push({
        asset,
        amountRaw: asset.balanceRaw,
        amountFormatted: asset.balanceFormatted,
        isMax: true,
        valueUsd: asset.valueUsd,
      });
    } else {
      const customAmountStr = await input({
        message: `Enter amount of ${asset.symbol} to process:`,
        validate: (val) => {
          try {
            const raw = parseUnits(val, asset.decimals);
            if (raw <= 0n) return 'Amount must be greater than 0';
            if (raw > asset.balanceRaw) return 'Amount exceeds current wallet balance';
            return true;
          } catch {
            return 'Invalid number format';
          }
        },
      });

      const amountRaw = parseUnits(customAmountStr, asset.decimals);
      const customQty = Number(amountRaw) / Math.pow(10, asset.decimals);
      const customUsd = asset.priceUsd ? customQty * asset.priceUsd : undefined;

      transferPlans.push({
        asset,
        amountRaw,
        amountFormatted: customAmountStr,
        isMax: false,
        valueUsd: customUsd,
      });
    }
  }

  // 8. Execution Plan Ordering
  // For transfers: ERC20s first, Native ETH last
  transferPlans.sort((a, b) => {
    if (a.asset.type === 'ERC20' && b.asset.type === 'NATIVE') return -1;
    if (a.asset.type === 'NATIVE' && b.asset.type === 'ERC20') return 1;
    return 0;
  });

  const totalSelectedUsd = transferPlans.reduce((sum, p) => sum + (p.valueUsd || 0), 0);

  // 9. Review & Confirmation Preview
  console.log(chalk.bold.white('\n======================= TRANSACTION PLAN PREVIEW ======================='));
  console.log(chalk.cyan(`Mode:        ${chalk.bold.yellow(mode)}`));
  if (mode !== 'SELL_TO_ETH') {
    console.log(chalk.cyan(`Recipient:   ${chalk.bold.yellow(recipientAddress)}`));
  }
  console.log(chalk.cyan(`Total Items: ${chalk.bold.white(transferPlans.length)}`));
  console.log(chalk.cyan(`Est. Value:  ${chalk.bold.green(formatUsd(totalSelectedUsd))}`));
  console.log('-------------------------------------------------------------------------');

  transferPlans.forEach((plan, i) => {
    const asset = plan.asset;
    const typeLabel = asset.type === 'NATIVE' ? chalk.yellow('[Native]') : chalk.blue('[ERC-20]');
    const amountLabel = plan.isMax
      ? chalk.green.bold(`MAX (~${plan.amountFormatted} ${asset.symbol})`)
      : chalk.green(`${plan.amountFormatted} ${asset.symbol}`);
    const usdLabel = chalk.bold.green(formatUsd(plan.valueUsd));
    const actionLabel = mode === 'TRANSFER' ? chalk.gray('-> Transfer') : chalk.magenta('-> Swap to ETH');

    console.log(
      `  ${chalk.gray(i + 1 + '.')} ${typeLabel} ${chalk.bold(asset.symbol.padEnd(8))} Amount: ${amountLabel.padEnd(25)} (${usdLabel}) ${actionLabel}`
    );
  });
  console.log('=========================================================================\n');

  const proceed = await confirm({
    message: chalk.red.bold(`⚠️  Are you sure you want to execute these ${transferPlans.length} action(s) on Robinhood Chain?`),
    default: false,
  });

  if (!proceed) {
    console.log(chalk.yellow('\nOperation cancelled by user. No transactions were executed.'));
    process.exit(0);
  }

  // 10. Execution Loop
  console.log(chalk.bold.green('\n🚀 Starting execution...\n'));
  const results: ExecutionResult[] = [];

  for (let i = 0; i < transferPlans.length; i++) {
    const plan = transferPlans[i];
    const { asset } = plan;
    const progress = `[${i + 1}/${transferPlans.length}]`;

    if (mode === 'TRANSFER') {
      const txSpinner = ora({
        text: `${progress} Sending ${plan.isMax ? 'MAX' : plan.amountFormatted} ${asset.symbol} to ${recipientAddress.slice(0, 6)}...${recipientAddress.slice(-4)}`,
        color: 'cyan',
      }).start();

      const result = await executeSingleTransfer(
        plan,
        recipientAddress,
        walletClient,
        publicClient
      );

      results.push(result);

      if (result.status === 'SUCCESS') {
        const txUrl = explorerUrl ? `${explorerUrl}/tx/${result.txHash}` : result.txHash;
        txSpinner.succeed(
          chalk.green(
            `${progress} Sent ${result.amountFormatted} ${asset.symbol}! Tx: ${chalk.bold(result.txHash)}`
          )
        );
        if (explorerUrl) {
          console.log(chalk.gray(`      🔗 Explorer: ${txUrl}`));
        }
      } else if (result.status === 'SKIPPED') {
        txSpinner.warn(chalk.yellow(`${progress} Skipped ${asset.symbol}: ${result.error}`));
      } else {
        txSpinner.fail(chalk.red(`${progress} Failed ${asset.symbol}: ${result.error}`));
      }
    } else {
      // Selling mode (SELL_TO_ETH or SELL_AND_SWEEP)
      if (asset.type === 'NATIVE') {
        // Native ETH is handled at the end if SELL_AND_SWEEP
        continue;
      }

      const sellSpinner = ora({
        text: `${progress} Selling ${plan.amountFormatted} ${asset.symbol} for ETH...`,
        color: 'magenta',
      }).start();

      const result = await executeSellToken(
        publicClient,
        walletClient,
        asset,
        plan.amountRaw,
        plan.isMax,
        account.address, // ETH proceeds arrive at sender wallet
        3, // 3% slippage
        (statusText) => {
          sellSpinner.text = `${progress} ${statusText}`;
        }
      );

      results.push(result);

      if (result.status === 'SUCCESS') {
        const txUrl = explorerUrl ? `${explorerUrl}/tx/${result.txHash}` : result.txHash;
        sellSpinner.succeed(
          chalk.green(
            `${progress} Sold ${result.amountFormatted} ${asset.symbol} for ~${result.proceedsEth} ETH! Tx: ${chalk.bold(result.txHash)}`
          )
        );
        if (explorerUrl) {
          console.log(chalk.gray(`      🔗 Explorer: ${txUrl}`));
        }
      } else {
        sellSpinner.fail(chalk.red(`${progress} Failed to sell ${asset.symbol}: ${result.error}`));
      }
    }
  }

  // If mode is SELL_AND_SWEEP, sweep final remaining ETH to recipient
  if (mode === 'SELL_AND_SWEEP') {
    console.log(chalk.bold.cyan('\n🧹 Final Step: Sweeping consolidated ETH to destination address...'));
    const sweepSpinner = ora({ text: 'Calculating final ETH balance & gas...', color: 'green' }).start();

    const nativeAsset = await fetchNativeAsset(publicClient, account.address, nativeSymbol, nativeDecimals);
    const sweepPlan: AssetTransferPlan = {
      asset: nativeAsset,
      amountRaw: nativeAsset.balanceRaw,
      amountFormatted: nativeAsset.balanceFormatted,
      isMax: true,
    };

    const sweepResult = await executeSingleTransfer(
      sweepPlan,
      recipientAddress,
      walletClient,
      publicClient
    );

    results.push(sweepResult);

    if (sweepResult.status === 'SUCCESS') {
      const txUrl = explorerUrl ? `${explorerUrl}/tx/${sweepResult.txHash}` : sweepResult.txHash;
      sweepSpinner.succeed(
        chalk.green(`Swept ${sweepResult.amountFormatted} ETH to ${recipientAddress}! Tx: ${chalk.bold(sweepResult.txHash)}`)
      );
      if (explorerUrl) {
        console.log(chalk.gray(`      🔗 Explorer: ${txUrl}`));
      }
    } else {
      sweepSpinner.fail(chalk.red(`Failed to sweep ETH: ${sweepResult.error}`));
    }
  }

  // 11. Summary Report
  console.log(chalk.bold.white('\n========================= EXECUTION REPORT ========================='));
  const successfulCount = results.filter((r) => r.status === 'SUCCESS').length;
  const failedCount = results.filter((r) => r.status === 'FAILED').length;
  const skippedCount = results.filter((r) => r.status === 'SKIPPED').length;

  console.log(
    `Status: ${chalk.green(`${successfulCount} Succeeded`)}, ${chalk.red(`${failedCount} Failed`)}, ${chalk.yellow(`${skippedCount} Skipped`)}`
  );
  console.log('====================================================================');
  console.log(chalk.gray(`💖 Support the developer:`));
  console.log(chalk.gray(`   EVM:    ${chalk.white('0xcDcC4656293424544F32BfA58089e982B9624866')}`));
  console.log(chalk.gray(`   Solana: ${chalk.white('94TmHVSd6ZWc9cAWKysQXQ5hGaymBvkQVEgaTtLVyHt8')}`));
  console.log('====================================================================\n');
}

main().catch((err) => {
  console.error(chalk.red('\nFatal error occurred:'), err);
  process.exit(1);
});
