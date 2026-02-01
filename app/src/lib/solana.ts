import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createInitializeMint2Instruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddress,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';

// Network config - use devnet for testing, mainnet for production
const NETWORK = process.env.SOLANA_NETWORK || 'devnet';
const RPC_URL = process.env.SOLANA_RPC_URL || 
  (NETWORK === 'mainnet-beta' 
    ? 'https://api.mainnet-beta.solana.com'
    : 'https://api.devnet.solana.com');

// Token config
const TOKEN_DECIMALS = 6;
const TOTAL_SUPPLY = 1_000_000_000; // 1 billion tokens
const BONDING_CURVE_ALLOCATION = 800_000_000; // 80% for bonding curve
const INITIAL_DEV_ALLOCATION = 200_000_000; // 20% for initial liquidity/dev

// Platform wallet (holds fees, can be used for initial liquidity)
const PLATFORM_WALLET = process.env.PLATFORM_WALLET_SECRET 
  ? Keypair.fromSecretKey(bs58.decode(process.env.PLATFORM_WALLET_SECRET))
  : null;

export interface CreateTokenOnChainParams {
  name: string;
  symbol: string;
  description?: string;
  image?: string;
  creator: string; // Creator's wallet address
}

export interface CreateTokenOnChainResult {
  mint: string;
  signature: string;
  metadataUri?: string;
}

/**
 * Get Solana connection
 */
export function getConnection(): Connection {
  return new Connection(RPC_URL, 'confirmed');
}

/**
 * Check if we're in mock mode (no platform wallet configured)
 */
export function isMockMode(): boolean {
  return !PLATFORM_WALLET;
}

/**
 * Create a new SPL token on-chain
 * 
 * For now, this creates a basic SPL token.
 * Future: Add Metaplex metadata, bonding curve integration
 */
export async function createTokenOnChain(
  params: CreateTokenOnChainParams
): Promise<CreateTokenOnChainResult> {
  // If no platform wallet, return mock result
  if (!PLATFORM_WALLET) {
    console.log('⚠️ Mock mode: No PLATFORM_WALLET_SECRET configured');
    const mockMint = Keypair.generate().publicKey.toBase58();
    return {
      mint: mockMint,
      signature: `mock_${Date.now()}_${mockMint.slice(0, 8)}`,
    };
  }

  const connection = getConnection();
  const payer = PLATFORM_WALLET;
  
  // Generate a new keypair for the mint
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;
  
  // Get minimum rent for mint account
  const mintRent = await getMinimumBalanceForRentExemptMint(connection);
  
  // Creator's public key (for receiving tokens)
  const creatorPubkey = new PublicKey(params.creator);
  
  // Get associated token accounts
  const creatorATA = await getAssociatedTokenAddress(mint, creatorPubkey);
  const platformATA = await getAssociatedTokenAddress(mint, payer.publicKey);
  
  // Build transaction
  const transaction = new Transaction();
  
  // 1. Create mint account
  transaction.add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint,
      space: MINT_SIZE,
      lamports: mintRent,
      programId: TOKEN_PROGRAM_ID,
    })
  );
  
  // 2. Initialize mint (platform wallet is mint authority)
  transaction.add(
    createInitializeMint2Instruction(
      mint,
      TOKEN_DECIMALS,
      payer.publicKey, // Mint authority
      payer.publicKey, // Freeze authority (can be null)
      TOKEN_PROGRAM_ID
    )
  );
  
  // 3. Create platform's token account
  transaction.add(
    createAssociatedTokenAccountInstruction(
      payer.publicKey, // Payer
      platformATA,     // ATA to create
      payer.publicKey, // Owner
      mint             // Mint
    )
  );
  
  // 4. Mint tokens to platform (for bonding curve)
  transaction.add(
    createMintToInstruction(
      mint,
      platformATA,
      payer.publicKey, // Mint authority
      BigInt(BONDING_CURVE_ALLOCATION) * BigInt(10 ** TOKEN_DECIMALS)
    )
  );
  
  // 5. Create creator's token account (if different from platform)
  if (!creatorPubkey.equals(payer.publicKey)) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        creatorATA,
        creatorPubkey,
        mint
      )
    );
    
    // 6. Mint initial allocation to creator
    transaction.add(
      createMintToInstruction(
        mint,
        creatorATA,
        payer.publicKey,
        BigInt(INITIAL_DEV_ALLOCATION) * BigInt(10 ** TOKEN_DECIMALS)
      )
    );
  } else {
    // Creator is platform, mint full supply to platform
    transaction.add(
      createMintToInstruction(
        mint,
        platformATA,
        payer.publicKey,
        BigInt(INITIAL_DEV_ALLOCATION) * BigInt(10 ** TOKEN_DECIMALS)
      )
    );
  }
  
  // Send transaction
  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [payer, mintKeypair],
    { commitment: 'confirmed' }
  );
  
  console.log(`✅ Token created on-chain:`);
  console.log(`   Mint: ${mint.toBase58()}`);
  console.log(`   Signature: ${signature}`);
  console.log(`   Network: ${NETWORK}`);
  
  return {
    mint: mint.toBase58(),
    signature,
  };
}

/**
 * Get token balance for a wallet
 */
export async function getTokenBalance(
  mint: string,
  wallet: string
): Promise<number> {
  if (isMockMode()) return 0;
  
  const connection = getConnection();
  const mintPubkey = new PublicKey(mint);
  const walletPubkey = new PublicKey(wallet);
  
  try {
    const ata = await getAssociatedTokenAddress(mintPubkey, walletPubkey);
    const balance = await connection.getTokenAccountBalance(ata);
    return parseFloat(balance.value.uiAmountString || '0');
  } catch (error) {
    return 0;
  }
}

/**
 * Get SOL balance for a wallet
 */
export async function getSolBalance(wallet: string): Promise<number> {
  if (isMockMode()) return 0;
  
  const connection = getConnection();
  const pubkey = new PublicKey(wallet);
  const balance = await connection.getBalance(pubkey);
  return balance / LAMPORTS_PER_SOL;
}

/**
 * Transfer tokens from platform wallet to buyer
 * Used when someone buys tokens through the bonding curve
 */
export async function transferTokens(
  mint: string,
  to: string,
  amount: number
): Promise<string> {
  if (!PLATFORM_WALLET) {
    return `mock_transfer_${Date.now()}`;
  }
  
  const connection = getConnection();
  const mintPubkey = new PublicKey(mint);
  const toPubkey = new PublicKey(to);
  
  const fromATA = await getAssociatedTokenAddress(mintPubkey, PLATFORM_WALLET.publicKey);
  const toATA = await getAssociatedTokenAddress(mintPubkey, toPubkey);
  
  const transaction = new Transaction();
  
  // Create recipient's ATA if needed (instruction will fail silently if exists)
  transaction.add(
    createAssociatedTokenAccountInstruction(
      PLATFORM_WALLET.publicKey,
      toATA,
      toPubkey,
      mintPubkey
    )
  );
  
  // Transfer tokens
  const { createTransferInstruction } = await import('@solana/spl-token');
  transaction.add(
    createTransferInstruction(
      fromATA,
      toATA,
      PLATFORM_WALLET.publicKey,
      BigInt(amount) * BigInt(10 ** TOKEN_DECIMALS)
    )
  );
  
  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [PLATFORM_WALLET],
    { commitment: 'confirmed' }
  );
  
  return signature;
}

/**
 * Check network status
 */
export async function getNetworkStatus(): Promise<{
  network: string;
  slot: number;
  mockMode: boolean;
}> {
  const connection = getConnection();
  const slot = await connection.getSlot();
  
  return {
    network: NETWORK,
    slot,
    mockMode: isMockMode(),
  };
}
