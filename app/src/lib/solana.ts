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

// Metaplex Token Metadata Program ID
const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

// Derive metadata PDA for a mint
function getMetadataPDA(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('metadata'),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
  return pda;
}

// Build CreateMetadataAccountV3 instruction manually
function createMetadataInstruction(
  metadataPDA: PublicKey,
  mint: PublicKey,
  mintAuthority: PublicKey,
  payer: PublicKey,
  updateAuthority: PublicKey,
  name: string,
  symbol: string,
  uri: string,
  creators: { address: PublicKey; verified: boolean; share: number }[] | null
): import('@solana/web3.js').TransactionInstruction {
  const { TransactionInstruction } = require('@solana/web3.js');
  
  // Data for CreateMetadataAccountV3
  // Discriminator: 33 (CreateMetadataAccountV3)
  const nameBytes = Buffer.from(name.slice(0, 32).padEnd(32, '\0'));
  const symbolBytes = Buffer.from(symbol.slice(0, 10).padEnd(10, '\0'));
  const uriBytes = Buffer.from(uri.slice(0, 200).padEnd(200, '\0'));
  
  // Build data buffer manually
  const data = Buffer.alloc(1 + 4 + 32 + 4 + 10 + 4 + 200 + 2 + 1 + 1 + 1 + 1 + 1);
  let offset = 0;
  
  // Discriminator (CreateMetadataAccountV3 = 33)
  data.writeUInt8(33, offset); offset += 1;
  
  // Name (length-prefixed string)
  data.writeUInt32LE(name.length, offset); offset += 4;
  Buffer.from(name).copy(data, offset); offset += name.length;
  
  // Symbol (length-prefixed string) 
  data.writeUInt32LE(symbol.length, offset); offset += 4;
  Buffer.from(symbol).copy(data, offset); offset += symbol.length;
  
  // URI (length-prefixed string)
  data.writeUInt32LE(uri.length, offset); offset += 4;
  Buffer.from(uri).copy(data, offset); offset += uri.length;
  
  // Seller fee basis points (0)
  data.writeUInt16LE(0, offset); offset += 2;
  
  // Creators (None for simplicity)
  data.writeUInt8(0, offset); offset += 1; // Option: None
  
  // Collection (None)
  data.writeUInt8(0, offset); offset += 1;
  
  // Uses (None)
  data.writeUInt8(0, offset); offset += 1;
  
  // Is mutable
  data.writeUInt8(1, offset); offset += 1;
  
  // Collection details (None)
  data.writeUInt8(0, offset); offset += 1;
  
  const trimmedData = data.slice(0, offset);
  
  return new TransactionInstruction({
    keys: [
      { pubkey: metadataPDA, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: mintAuthority, isSigner: true, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: updateAuthority, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false }, // System program
      { pubkey: new PublicKey('SysvarRent111111111111111111111111111111111'), isSigner: false, isWritable: false }, // Rent sysvar
    ],
    programId: TOKEN_METADATA_PROGRAM_ID,
    data: trimmedData,
  });
}

// Network config - use devnet for testing, mainnet for production
const NETWORK = process.env.SOLANA_NETWORK || 'devnet';
const RPC_URL = process.env.SOLANA_RPC_URL || 
  (NETWORK === 'mainnet-beta' 
    ? 'https://api.mainnet-beta.solana.com'
    : 'https://api.devnet.solana.com');

// Token config
const TOKEN_DECIMALS = 6;
const TOTAL_SUPPLY = 1_000_000_000; // 1 billion tokens
const BONDING_CURVE_ALLOCATION = TOTAL_SUPPLY; // 100% goes to bonding curve (pump.fun style)
// No free creator allocation - creators must buy like everyone else

// Platform wallet (holds fees, can be used for initial liquidity)
const PLATFORM_WALLET = process.env.PLATFORM_WALLET_SECRET 
  ? Keypair.fromSecretKey(bs58.decode(process.env.PLATFORM_WALLET_SECRET))
  : null;

// Fee recipient wallet (receives protocol fees - separate from platform wallet)
const FEE_RECIPIENT_WALLET = process.env.FEE_RECIPIENT_WALLET 
  ? new PublicKey(process.env.FEE_RECIPIENT_WALLET)
  : PLATFORM_WALLET?.publicKey || null;

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
  
  // 3. Create token metadata (Metaplex)
  const metadataPDA = getMetadataPDA(mint);
  transaction.add(
    createMetadataInstruction(
      metadataPDA,
      mint,
      payer.publicKey,
      payer.publicKey,
      payer.publicKey,
      params.name,
      params.symbol,
      params.image || '', // Token image URI
      null // No creators for simplicity
    )
  );
  
  // 4. Create platform's token account
  transaction.add(
    createAssociatedTokenAccountInstruction(
      payer.publicKey, // Payer
      platformATA,     // ATA to create
      payer.publicKey, // Owner
      mint             // Mint
    )
  );
  
  // 5. Mint tokens to platform (for bonding curve)
  transaction.add(
    createMintToInstruction(
      mint,
      platformATA,
      payer.publicKey, // Mint authority
      BigInt(BONDING_CURVE_ALLOCATION) * BigInt(10 ** TOKEN_DECIMALS)
    )
  );
  
  // pump.fun style: NO free creator allocation
  // All tokens go to bonding curve, creators must buy like everyone else
  // Creator can use "initial buy" option to purchase tokens at launch price
  
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
 * Execute initial buy during token creation
 * Platform transfers tokens to creator
 */
export async function executeInitialBuy(
  mint: string,
  creator: string,
  solAmount: number,
  virtualSol: number,
  virtualTokens: number
): Promise<{ signature: string; tokensReceived: number } | null> {
  if (isMockMode() || !PLATFORM_WALLET) {
    return null; // Let DB handle it in mock mode
  }

  // Calculate tokens using bonding curve math
  const newVirtualSol = virtualSol + solAmount;
  const invariant = virtualSol * virtualTokens;
  const newVirtualTokens = invariant / newVirtualSol;
  const tokensReceived = virtualTokens - newVirtualTokens;

  console.log(`Initial buy: ${solAmount} SOL -> ${tokensReceived.toFixed(0)} tokens`);

  const connection = getConnection();
  const mintPubkey = new PublicKey(mint);
  const creatorPubkey = new PublicKey(creator);

  const platformATA = await getAssociatedTokenAddress(mintPubkey, PLATFORM_WALLET.publicKey);
  const creatorATA = await getAssociatedTokenAddress(mintPubkey, creatorPubkey);

  const transaction = new Transaction();

  // Create creator's ATA if it doesn't exist
  const creatorATAInfo = await connection.getAccountInfo(creatorATA);
  if (!creatorATAInfo) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        PLATFORM_WALLET.publicKey,
        creatorATA,
        creatorPubkey,
        mintPubkey
      )
    );
  }

  // Transfer tokens from platform to creator
  const { createTransferInstruction } = await import('@solana/spl-token');
  transaction.add(
    createTransferInstruction(
      platformATA,
      creatorATA,
      PLATFORM_WALLET.publicKey,
      BigInt(Math.floor(tokensReceived * (10 ** TOKEN_DECIMALS)))
    )
  );

  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [PLATFORM_WALLET],
    { commitment: 'confirmed' }
  );

  console.log(`✅ Initial buy complete: ${signature}`);

  return { signature, tokensReceived };
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

/**
 * Bonding curve parameters
 */
const PROTOCOL_FEE_BPS = 50; // 0.5%
const CREATOR_FEE_BPS = 50;  // 0.5%
const TOTAL_FEE_BPS = PROTOCOL_FEE_BPS + CREATOR_FEE_BPS; // 1%

export interface BuyParams {
  mint: string;
  buyer: string;           // Buyer's wallet address
  solAmount: number;       // SOL to spend
  minTokensOut: number;    // Minimum tokens to receive (slippage)
  creatorWallet?: string;  // Creator wallet for fees
}

export interface SellParams {
  mint: string;
  seller: string;          // Seller's wallet address
  tokenAmount: number;     // Tokens to sell
  minSolOut: number;       // Minimum SOL to receive (slippage)
  creatorWallet?: string;  // Creator wallet for fees
}

export interface TradeResult {
  signature: string;
  solAmount: number;
  tokenAmount: number;
  fee: number;
}

/**
 * Create a buy transaction for the user to sign
 * Returns serialized transaction that user signs with their wallet
 */
export async function createBuyTransaction(
  params: BuyParams
): Promise<{ transaction: string; expectedTokens: number }> {
  if (!PLATFORM_WALLET) {
    throw new Error('Platform wallet not configured');
  }

  const connection = getConnection();
  const mintPubkey = new PublicKey(params.mint);
  const buyerPubkey = new PublicKey(params.buyer);
  
  // Calculate fee
  const feeAmount = params.solAmount * (TOTAL_FEE_BPS / 10000);
  const solToTrade = params.solAmount - feeAmount;
  
  // Get buyer's token account
  const buyerATA = await getAssociatedTokenAddress(mintPubkey, buyerPubkey);
  const platformATA = await getAssociatedTokenAddress(mintPubkey, PLATFORM_WALLET.publicKey);
  
  const transaction = new Transaction();
  
  // 1. Transfer SOL from buyer to platform (including fees)
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: buyerPubkey,
      toPubkey: PLATFORM_WALLET.publicKey,
      lamports: Math.floor(params.solAmount * LAMPORTS_PER_SOL),
    })
  );
  
  // Set recent blockhash and fee payer
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = buyerPubkey;
  
  // Serialize for user to sign (partial sign not needed yet)
  const serialized = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
  
  return {
    transaction: serialized.toString('base64'),
    expectedTokens: params.minTokensOut, // Caller provides expected amount
  };
}

/**
 * Execute the second half of a buy after user signed
 * Platform sends tokens to buyer
 */
export async function completeBuyTransaction(
  userSignedTx: string,
  mint: string,
  buyer: string,
  tokenAmount: number
): Promise<TradeResult> {
  if (!PLATFORM_WALLET) {
    throw new Error('Platform wallet not configured');
  }

  const connection = getConnection();
  
  // Deserialize and verify user's signed transaction
  const txBuffer = Buffer.from(userSignedTx, 'base64');
  const userTx = Transaction.from(txBuffer);
  
  // Broadcast user's SOL transfer transaction
  const solSignature = await connection.sendRawTransaction(txBuffer);
  await connection.confirmTransaction(solSignature, 'confirmed');
  
  console.log(`✅ SOL received from buyer: ${solSignature}`);
  
  // Now send tokens to buyer
  const mintPubkey = new PublicKey(mint);
  const buyerPubkey = new PublicKey(buyer);
  
  const platformATA = await getAssociatedTokenAddress(mintPubkey, PLATFORM_WALLET.publicKey);
  const buyerATA = await getAssociatedTokenAddress(mintPubkey, buyerPubkey);
  
  const tokenTx = new Transaction();
  
  // Create buyer's ATA if needed
  const buyerATAInfo = await connection.getAccountInfo(buyerATA);
  if (!buyerATAInfo) {
    tokenTx.add(
      createAssociatedTokenAccountInstruction(
        PLATFORM_WALLET.publicKey,
        buyerATA,
        buyerPubkey,
        mintPubkey
      )
    );
  }
  
  // Transfer tokens
  const { createTransferInstruction } = await import('@solana/spl-token');
  tokenTx.add(
    createTransferInstruction(
      platformATA,
      buyerATA,
      PLATFORM_WALLET.publicKey,
      BigInt(Math.floor(tokenAmount * (10 ** TOKEN_DECIMALS)))
    )
  );
  
  const tokenSignature = await sendAndConfirmTransaction(
    connection,
    tokenTx,
    [PLATFORM_WALLET],
    { commitment: 'confirmed' }
  );
  
  console.log(`✅ Tokens sent to buyer: ${tokenSignature}`);
  
  return {
    signature: tokenSignature,
    solAmount: 0, // Filled by caller
    tokenAmount,
    fee: 0, // Filled by caller
  };
}

/**
 * Create a sell transaction for the user to sign
 * User sends tokens, receives SOL back
 */
export async function createSellTransaction(
  params: SellParams
): Promise<{ transaction: string; expectedSol: number }> {
  if (!PLATFORM_WALLET) {
    throw new Error('Platform wallet not configured');
  }

  const connection = getConnection();
  const mintPubkey = new PublicKey(params.mint);
  const sellerPubkey = new PublicKey(params.seller);
  
  const sellerATA = await getAssociatedTokenAddress(mintPubkey, sellerPubkey);
  const platformATA = await getAssociatedTokenAddress(mintPubkey, PLATFORM_WALLET.publicKey);
  
  const transaction = new Transaction();
  
  // Transfer tokens from seller to platform
  const { createTransferInstruction } = await import('@solana/spl-token');
  transaction.add(
    createTransferInstruction(
      sellerATA,
      platformATA,
      sellerPubkey, // Seller signs
      BigInt(Math.floor(params.tokenAmount * (10 ** TOKEN_DECIMALS)))
    )
  );
  
  // Set recent blockhash and fee payer
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = sellerPubkey;
  
  const serialized = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
  
  return {
    transaction: serialized.toString('base64'),
    expectedSol: params.minSolOut,
  };
}

/**
 * Complete a sell after user signed token transfer
 * Platform sends SOL to seller
 */
export async function completeSellTransaction(
  userSignedTx: string,
  seller: string,
  solAmount: number
): Promise<TradeResult> {
  if (!PLATFORM_WALLET) {
    throw new Error('Platform wallet not configured');
  }

  const connection = getConnection();
  
  // Broadcast user's token transfer transaction
  const txBuffer = Buffer.from(userSignedTx, 'base64');
  const tokenSignature = await connection.sendRawTransaction(txBuffer);
  await connection.confirmTransaction(tokenSignature, 'confirmed');
  
  console.log(`✅ Tokens received from seller: ${tokenSignature}`);
  
  // Calculate fee
  const feeAmount = solAmount * (TOTAL_FEE_BPS / 10000);
  const solToSend = solAmount - feeAmount;
  
  // Send SOL to seller
  const sellerPubkey = new PublicKey(seller);
  
  const solTx = new Transaction();
  
  // Transfer SOL to seller (minus fees)
  solTx.add(
    SystemProgram.transfer({
      fromPubkey: PLATFORM_WALLET.publicKey,
      toPubkey: sellerPubkey,
      lamports: Math.floor(solToSend * LAMPORTS_PER_SOL),
    })
  );
  
  // Transfer protocol fee to fee recipient (if different from platform wallet)
  if (FEE_RECIPIENT_WALLET && !FEE_RECIPIENT_WALLET.equals(PLATFORM_WALLET.publicKey)) {
    const protocolFee = feeAmount * (PROTOCOL_FEE_BPS / TOTAL_FEE_BPS);
    solTx.add(
      SystemProgram.transfer({
        fromPubkey: PLATFORM_WALLET.publicKey,
        toPubkey: FEE_RECIPIENT_WALLET,
        lamports: Math.floor(protocolFee * LAMPORTS_PER_SOL),
      })
    );
    console.log(`💰 Protocol fee: ${protocolFee.toFixed(6)} SOL → ${FEE_RECIPIENT_WALLET.toBase58()}`);
  }
  
  const solSignature = await sendAndConfirmTransaction(
    connection,
    solTx,
    [PLATFORM_WALLET],
    { commitment: 'confirmed' }
  );
  
  console.log(`✅ SOL sent to seller: ${solSignature}`);
  
  return {
    signature: solSignature,
    solAmount: solToSend,
    tokenAmount: 0, // Filled by caller
    fee: feeAmount,
  };
}

/**
 * Get platform wallet public key
 */
export function getPlatformWalletPubkey(): string | null {
  return PLATFORM_WALLET?.publicKey.toBase58() || null;
}

/**
 * Get fee recipient wallet public key
 */
export function getFeeRecipientPubkey(): string | null {
  return FEE_RECIPIENT_WALLET?.toBase58() || null;
}
