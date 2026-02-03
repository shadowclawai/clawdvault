/**
 * Raydium SDK integration for pool creation
 */

import { 
  Raydium, 
  TxVersion, 
  parseTokenAccountResp,
  CREATE_CPMM_POOL_PROGRAM,
  CREATE_CPMM_POOL_FEE_ACC,
  DEVNET_PROGRAM_ID,
  getCpmmPdaAmmConfigId,
} from '@raydium-io/raydium-sdk-v2';
import { 
  Connection, 
  Keypair, 
  PublicKey,
  clusterApiUrl,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, NATIVE_MINT } from '@solana/spl-token';
import BN from 'bn.js';
import bs58 from 'bs58';

// Get cluster from environment
const getCluster = (): 'mainnet' | 'devnet' => {
  return (process.env.SOLANA_NETWORK === 'mainnet-beta' ? 'mainnet' : 'devnet') as 'mainnet' | 'devnet';
};

// Get connection
const getConnection = (): Connection => {
  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');
  return new Connection(rpcUrl, 'confirmed');
};

// Get migration wallet
const getMigrationWallet = (): Keypair | null => {
  const privateKey = process.env.MIGRATION_WALLET_PRIVATE_KEY;
  if (!privateKey) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(privateKey));
  } catch {
    return null;
  }
};

let raydiumInstance: Raydium | null = null;

/**
 * Initialize Raydium SDK
 */
export async function initRaydium(): Promise<Raydium> {
  if (raydiumInstance) return raydiumInstance;

  const wallet = getMigrationWallet();
  if (!wallet) {
    throw new Error('Migration wallet not configured');
  }

  const connection = getConnection();
  const cluster = getCluster();

  console.log(`Initializing Raydium SDK on ${cluster}...`);

  raydiumInstance = await Raydium.load({
    owner: wallet,
    connection,
    cluster,
    disableFeatureCheck: true,
    disableLoadToken: false,
    blockhashCommitment: 'finalized',
  });

  return raydiumInstance;
}

/**
 * Create a CPMM pool for a graduated token
 * 
 * @param tokenMint - The token mint address
 * @param tokenAmount - Amount of tokens (in base units)
 * @param solAmount - Amount of SOL (in lamports)
 * @returns Pool creation result
 */
export async function createCpmmPool(
  tokenMint: string,
  tokenAmount: bigint,
  solAmount: bigint,
): Promise<{
  poolId: string;
  lpMint: string;
  txSignature: string;
}> {
  const raydium = await initRaydium();
  const cluster = getCluster();
  
  // Get program IDs based on cluster
  const programId = cluster === 'devnet' 
    ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM 
    : CREATE_CPMM_POOL_PROGRAM;
  const poolFeeAccount = cluster === 'devnet'
    ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC
    : CREATE_CPMM_POOL_FEE_ACC;

  // Get fee configs
  const feeConfigs = await raydium.api.getCpmmConfigs();
  
  if (cluster === 'devnet') {
    feeConfigs.forEach((config) => {
      config.id = getCpmmPdaAmmConfigId(
        DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM, 
        config.index
      ).publicKey.toBase58();
    });
  }

  // Use first fee config (usually 0.25% fee)
  const feeConfig = feeConfigs[0];
  if (!feeConfig) {
    throw new Error('No fee config available');
  }

  // Token info for our token
  const tokenMintInfo = {
    address: tokenMint,
    programId: TOKEN_PROGRAM_ID.toBase58(),
    decimals: 6, // Our tokens use 6 decimals
  };

  // WSOL mint info
  const wsolMintInfo = {
    address: NATIVE_MINT.toBase58(),
    programId: TOKEN_PROGRAM_ID.toBase58(),
    decimals: 9,
  };

  // Determine mint order (Raydium requires mintA < mintB by pubkey)
  const tokenPubkey = new PublicKey(tokenMint);
  const isTokenMintA = tokenPubkey.toBuffer().compare(NATIVE_MINT.toBuffer()) < 0;

  const mintA = isTokenMintA ? tokenMintInfo : wsolMintInfo;
  const mintB = isTokenMintA ? wsolMintInfo : tokenMintInfo;
  
  // Amounts in correct order
  const mintAAmount = isTokenMintA ? new BN(tokenAmount.toString()) : new BN(solAmount.toString());
  const mintBAmount = isTokenMintA ? new BN(solAmount.toString()) : new BN(tokenAmount.toString());

  console.log('Creating CPMM pool...');
  console.log(`  MintA: ${mintA.address} (${mintAAmount.toString()})`);
  console.log(`  MintB: ${mintB.address} (${mintBAmount.toString()})`);
  console.log(`  Fee config: ${feeConfig.id}`);

  // Create pool
  const { execute, extInfo } = await raydium.cpmm.createPool({
    programId,
    poolFeeAccount,
    mintA,
    mintB,
    mintAAmount,
    mintBAmount,
    startTime: new BN(0), // Start immediately
    feeConfig,
    associatedOnly: false,
    ownerInfo: {
      useSOLBalance: true, // Use native SOL balance
    },
    txVersion: TxVersion.V0,
    computeBudgetConfig: {
      units: 600000,
      microLamports: 100000, // Priority fee
    },
  });

  // Execute transaction
  const { txId } = await execute({ sendAndConfirm: true });

  console.log(`✅ CPMM pool created!`);
  console.log(`  Pool ID: ${extInfo.address.poolId.toBase58()}`);
  console.log(`  LP Mint: ${extInfo.address.lpMint.toBase58()}`);
  console.log(`  Tx: ${txId}`);

  return {
    poolId: extInfo.address.poolId.toBase58(),
    lpMint: extInfo.address.lpMint.toBase58(),
    txSignature: txId,
  };
}

/**
 * Get migration wallet balances
 */
export async function getMigrationWalletBalances(): Promise<{
  sol: number;
  tokens: Map<string, number>;
}> {
  const wallet = getMigrationWallet();
  if (!wallet) {
    throw new Error('Migration wallet not configured');
  }

  const connection = getConnection();
  
  // SOL balance
  const solBalance = await connection.getBalance(wallet.publicKey);
  
  // Token accounts
  const tokenAccounts = await connection.getTokenAccountsByOwner(
    wallet.publicKey,
    { programId: TOKEN_PROGRAM_ID }
  );

  const tokens = new Map<string, number>();
  for (const { account } of tokenAccounts.value) {
    const data = account.data;
    // Parse token account data (mint at offset 0, amount at offset 64)
    const mint = new PublicKey(data.slice(0, 32)).toBase58();
    const amount = data.readBigUInt64LE(64);
    tokens.set(mint, Number(amount));
  }

  return {
    sol: solBalance / 1e9,
    tokens,
  };
}
