import 'dotenv/config';
import chalk from 'chalk';
import ora from 'ora';
import { isAddress, parseUnits, formatUnits, Address } from 'viem';
import { checkbox, input, select, confirm } from '@inquirer/prompts';
import { AssetInfo, AssetTransferPlan, ExecutionResult, NetworkConfig } from './types.js';
import { fetchTokensFromBlockscout } from './blockscout.js';
import { createClients, fetchNativeAsset, fetchOnchainErc20, executeSingleTransfer } from './transfer.js';

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
║              ROBINHOOD CHAIN MULTI-ASSET BATCH SENDER                   ║
║         (Chain ID: 4663 • Blockscout Pro API • Viem Engine)              ║
╚══════════════════════════════════════════════════════════════════════════╝
`));

  // 1. Resolve Configuration with Robinhood Chain defaults
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
  console.log(chalk.cyan(`🔎 Blockscout API:    ${chalk.bold.white(blockscoutApiUrl)}`));
  if (blockscoutApiKey) {
    console.log(chalk.cyan(`🔑 Blockscout Key:    ${chalk.green('Configured (Pro API Active)')}`));
  }

  // 3. Recipient Address
  let recipientAddress = process.env.DESTINATION_ADDRESS?.trim();
  if (!recipientAddress || !isAddress(recipientAddress)) {
    recipientAddress = await input({
      message: 'Enter Destination Recipient Address (0x...):',
      validate: (val) => (isAddress(val) ? true : 'Invalid EVM address'),
    });
  } else {
    console.log(chalk.cyan(`🎯 Destination:       ${chalk.bold.white(recipientAddress)} (from .env)`));
  }

  // 4. Fetch Assets
  const spinner = ora({ text: 'Scanning wallet balances & Blockscout Pro API...', color: 'green' }).start();

  const allAssets: AssetInfo[] = [];

  // A. Native ETH balance
  try {
    const nativeAsset = await fetchNativeAsset(
      publicClient,
      account.address,
      nativeSymbol,
      nativeDecimals
    );
    if (nativeAsset.balanceRaw > 0n) {
      allAssets.push(nativeAsset);
    }
  } catch (err: any) {
    spinner.warn(`Could not fetch native balance: ${err.message}`);
  }

  // B. Blockscout API ERC-20 tokens
  try {
    const blockscoutTokens = await fetchTokensFromBlockscout(
      blockscoutApiUrl,
      account.address,
      blockscoutApiKey,
      chainId
    );

    for (const t of blockscoutTokens) {
      if (!allAssets.some((a) => a.address.toLowerCase() === t.address.toLowerCase())) {
        allAssets.push(t);
      }
    }
  } catch (err: any) {
    spinner.warn(`Blockscout token fetch notice: ${err.message}`);
  }

  spinner.succeed(`Scan complete! Found ${allAssets.length} asset(s) with non-zero balance.`);

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
      const customAsset = await fetchOnchainErc20(
        publicClient,
        customTokenAddr as `0x${string}`,
        account.address
      );

      if (customAsset) {
        tokenSpin.succeed(
          `Found ${customAsset.name} (${customAsset.symbol}) - Balance: ${customAsset.balanceFormatted}`
        );
        if (!allAssets.some((a) => a.address.toLowerCase() === customAsset.address.toLowerCase())) {
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

  // 5. Interactive Asset Selection
  console.log(chalk.bold('\nSelect the assets you wish to send:'));

  const choices = allAssets.map((asset) => ({
    name: `${asset.symbol.padEnd(8)} | Balance: ${chalk.green(asset.balanceFormatted)} ${asset.symbol} ${
      asset.type === 'NATIVE' ? chalk.yellow('(Native Gas)') : chalk.gray(`(${asset.address.slice(0, 8)}...${asset.address.slice(-6)})`)
    }`,
    value: asset.address,
    checked: true,
  }));

  const selectedAddresses = await checkbox({
    message: 'Choose assets (Space to toggle, Enter to confirm):',
    choices,
    validate: (val) => (val.length > 0 ? true : 'You must select at least one asset!'),
  });

  const selectedAssets = allAssets.filter((a) => selectedAddresses.includes(a.address));

  // 6. Configure Transfer Amounts
  console.log(chalk.bold('\nConfigure transfer amounts:'));
  const transferPlans: AssetTransferPlan[] = [];

  for (const asset of selectedAssets) {
    const isNative = asset.type === 'NATIVE';
    const amountChoice = await select({
      message: `Amount to send for ${chalk.bold.cyan(asset.symbol)} (Available: ${asset.balanceFormatted}):`,
      choices: [
        {
          name: `100% (Send Max / All)${isNative ? ' [Auto-subtracts gas reserve]' : ''}`,
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
      });
    } else {
      const customAmountStr = await input({
        message: `Enter amount of ${asset.symbol} to send:`,
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
      transferPlans.push({
        asset,
        amountRaw,
        amountFormatted: customAmountStr,
        isMax: false,
      });
    }
  }

  // 7. Order Execution Plan (ERC20s first, Native last)
  transferPlans.sort((a, b) => {
    if (a.asset.type === 'ERC20' && b.asset.type === 'NATIVE') return -1;
    if (a.asset.type === 'NATIVE' && b.asset.type === 'ERC20') return 1;
    return 0;
  });

  // 8. Review & Confirmation Preview
  console.log(chalk.bold.white('\n======================= TRANSFER PLAN PREVIEW ======================='));
  console.log(chalk.cyan(`Recipient:   ${chalk.bold.yellow(recipientAddress)}`));
  console.log(chalk.cyan(`Total Items: ${chalk.bold.white(transferPlans.length)}`));
  console.log('---------------------------------------------------------------------');
  transferPlans.forEach((plan, i) => {
    const asset = plan.asset;
    const typeLabel = asset.type === 'NATIVE' ? chalk.yellow('[Native]') : chalk.blue('[ERC-20]');
    const amountLabel = plan.isMax
      ? chalk.green.bold(`MAX (~${plan.amountFormatted} ${asset.symbol})`)
      : chalk.green(`${plan.amountFormatted} ${asset.symbol}`);
    console.log(
      `  ${chalk.gray(i + 1 + '.')} ${typeLabel} ${chalk.bold(asset.symbol.padEnd(8))} Amount: ${amountLabel}`
    );
  });
  console.log('=====================================================================\n');

  const proceed = await confirm({
    message: chalk.red.bold(`⚠️  Are you sure you want to broadcast these ${transferPlans.length} transaction(s) on Robinhood Chain?`),
    default: false,
  });

  if (!proceed) {
    console.log(chalk.yellow('\nOperation cancelled by user. No transactions were sent.'));
    process.exit(0);
  }

  // 9. Execute Transfers
  console.log(chalk.bold.green('\n🚀 Starting multi-asset transfer execution...\n'));

  const results: ExecutionResult[] = [];

  for (let i = 0; i < transferPlans.length; i++) {
    const plan = transferPlans[i];
    const { asset } = plan;
    const progress = `[${i + 1}/${transferPlans.length}]`;

    const txSpinner = ora({
      text: `${progress} Sending ${plan.isMax ? 'MAX' : plan.amountFormatted} ${asset.symbol} to ${recipientAddress.slice(0, 6)}...${recipientAddress.slice(-4)}`,
      color: 'cyan',
    }).start();

    const result = await executeSingleTransfer(
      plan,
      recipientAddress as Address,
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
  }

  // 10. Summary Report
  console.log(chalk.bold.white('\n========================= EXECUTION REPORT ========================='));
  const successfulCount = results.filter((r) => r.status === 'SUCCESS').length;
  const failedCount = results.filter((r) => r.status === 'FAILED').length;
  const skippedCount = results.filter((r) => r.status === 'SKIPPED').length;

  console.log(
    `Status: ${chalk.green(`${successfulCount} Succeeded`)}, ${chalk.red(`${failedCount} Failed`)}, ${chalk.yellow(`${skippedCount} Skipped`)}`
  );
  console.log('====================================================================\n');
}

main().catch((err) => {
  console.error(chalk.red('\nFatal error occurred:'), err);
  process.exit(1);
});
