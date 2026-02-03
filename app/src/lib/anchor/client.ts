/**
 * ClawdVault Anchor Client
 * 
 * TypeScript client for interacting with the ClawdVault on-chain program.
 * Non-custodial bonding curve trading - users sign their own transactions.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from '@solana/spl-token';

// Program ID - DEPLOYED TO DEVNET 2026-02-02
export const PROGRAM_ID = new PublicKey('GUyF2TVe32Cid4iGVt2F6wPYDhLSVmTUZBj2974outYM');

// Metaplex Token Metadata Program
const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

/**
 * Find the metadata PDA for a mint
 */
export function findMetadataPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID
  );
}

/**
 * Build CreateMetadataAccountV3 instruction
 */
function buildCreateMetadataInstruction(
  metadataPDA: PublicKey,
  mint: PublicKey,
  mintAuthority: PublicKey,
  payer: PublicKey,
  updateAuthority: PublicKey,
  name: string,
  symbol: string,
  uri: string
): TransactionInstruction {
  // CreateMetadataAccountV3 instruction data
  // Discriminator: 33
  const nameBuffer = Buffer.from(name.slice(0, 32));
  const symbolBuffer = Buffer.from(symbol.slice(0, 10));
  const uriBuffer = Buffer.from(uri.slice(0, 200));
  
  // Build instruction data (Borsh serialization)
  const data = Buffer.concat([
    Buffer.from([33]), // CreateMetadataAccountV3 discriminator
    // Name (string: 4-byte length + data)
    Buffer.from([nameBuffer.length, 0, 0, 0]),
    nameBuffer,
    // Symbol (string: 4-byte length + data)
    Buffer.from([symbolBuffer.length, 0, 0, 0]),
    symbolBuffer,
    // URI (string: 4-byte length + data)
    Buffer.from([uriBuffer.length, 0, 0, 0]),
    uriBuffer,
    // Seller fee basis points (u16)
    Buffer.from([0, 0]),
    // Creators (Option<Vec>): None
    Buffer.from([0]),
    // Collection (Option): None
    Buffer.from([0]),
    // Uses (Option): None
    Buffer.from([0]),
    // Is mutable (bool)
    Buffer.from([1]),
    // Collection details (Option): None
    Buffer.from([0]),
  ]);
  
  return new TransactionInstruction({
    programId: TOKEN_METADATA_PROGRAM_ID,
    keys: [
      { pubkey: metadataPDA, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: mintAuthority, isSigner: true, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: updateAuthority, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('SysvarRent111111111111111111111111111111111'), isSigner: false, isWritable: false },
    ],
    data,
  });
}

// Seeds
const CONFIG_SEED = Buffer.from('config');
const CURVE_SEED = Buffer.from('bonding_curve');
const VAULT_SEED = Buffer.from('sol_vault');

// Constants matching the program
export const TOTAL_SUPPLY = BigInt('1000000000000000'); // 1B * 10^6
export const INITIAL_VIRTUAL_SOL = BigInt('30000000000'); // 30 SOL
export const INITIAL_VIRTUAL_TOKENS = TOTAL_SUPPLY;
export const GRADUATION_THRESHOLD = BigInt('120000000000'); // 120 SOL
export const PROTOCOL_FEE_BPS = 50;
export const CREATOR_FEE_BPS = 50;
export const TOTAL_FEE_BPS = 100;
export const BPS_DENOMINATOR = 10000;

/**
 * Find the config PDA
 */
export function findConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], PROGRAM_ID);
}

/**
 * Find the bonding curve PDA for a mint
 */
export function findBondingCurvePDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [CURVE_SEED, mint.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * Find the SOL vault PDA for a mint
 */
export function findSolVaultPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, mint.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * Find the token vault address (ATA of bonding curve)
 */
export async function findTokenVaultAddress(
  mint: PublicKey,
  bondingCurve: PublicKey
): Promise<PublicKey> {
  return getAssociatedTokenAddress(mint, bondingCurve, true);
}

/**
 * Bonding curve state
 */
export interface BondingCurveState {
  creator: PublicKey;
  mint: PublicKey;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves: bigint;
  realTokenReserves: bigint;
  tokenTotalSupply: bigint;
  graduated: boolean;
  createdAt: bigint;
  bump: number;
  solVaultBump: number;
  tokenVaultBump: number;
}

/**
 * Calculate tokens out for a buy
 */
export function calculateBuyTokensOut(
  solAmount: bigint,
  virtualSolReserves: bigint,
  virtualTokenReserves: bigint
): { tokensOut: bigint; fee: bigint; priceImpact: number } {
  // Calculate fee first
  const fee = (solAmount * BigInt(TOTAL_FEE_BPS)) / BigInt(BPS_DENOMINATOR);
  const solAfterFee = solAmount - fee;
  
  // Constant product formula
  const newVirtualSol = virtualSolReserves + solAfterFee;
  const invariant = virtualSolReserves * virtualTokenReserves;
  const newVirtualTokens = invariant / newVirtualSol;
  const tokensOut = virtualTokenReserves - newVirtualTokens;
  
  // Calculate price impact
  const spotPrice = Number(virtualSolReserves) / Number(virtualTokenReserves);
  const avgPrice = Number(solAfterFee) / Number(tokensOut);
  const priceImpact = ((avgPrice - spotPrice) / spotPrice) * 100;
  
  return { tokensOut, fee, priceImpact };
}

/**
 * Calculate SOL out for a sell
 */
export function calculateSellSolOut(
  tokenAmount: bigint,
  virtualSolReserves: bigint,
  virtualTokenReserves: bigint
): { solOut: bigint; fee: bigint; priceImpact: number } {
  // Constant product formula
  const newVirtualTokens = virtualTokenReserves + tokenAmount;
  const invariant = virtualSolReserves * virtualTokenReserves;
  const newVirtualSol = invariant / newVirtualTokens;
  const solOutGross = virtualSolReserves - newVirtualSol;
  
  // Calculate fee
  const fee = (solOutGross * BigInt(TOTAL_FEE_BPS)) / BigInt(BPS_DENOMINATOR);
  const solOut = solOutGross - fee;
  
  // Calculate price impact
  const spotPrice = Number(virtualSolReserves) / Number(virtualTokenReserves);
  const avgPrice = Number(solOutGross) / Number(tokenAmount);
  const priceImpact = ((spotPrice - avgPrice) / spotPrice) * 100;
  
  return { solOut, fee, priceImpact };
}

/**
 * Calculate current token price in SOL
 */
export function calculatePrice(
  virtualSolReserves: bigint,
  virtualTokenReserves: bigint
): number {
  return Number(virtualSolReserves) / Number(virtualTokenReserves);
}

/**
 * Calculate market cap in SOL
 */
export function calculateMarketCap(
  virtualSolReserves: bigint,
  virtualTokenReserves: bigint,
  totalSupply: bigint = TOTAL_SUPPLY
): number {
  const price = calculatePrice(virtualSolReserves, virtualTokenReserves);
  return price * Number(totalSupply);
}

/**
 * Calculate progress to graduation (0-100%)
 */
export function calculateGraduationProgress(realSolReserves: bigint): number {
  return (Number(realSolReserves) / Number(GRADUATION_THRESHOLD)) * 100;
}

/**
 * Read u64 from buffer (little-endian)
 */
function readU64(buffer: Buffer, offset: number): bigint {
  return buffer.readBigUInt64LE(offset);
}

/**
 * Write u64 to buffer (little-endian)
 */
function writeU64(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return buf;
}

/**
 * ClawdVault client for building transactions
 */
export class ClawdVaultClient {
  connection: Connection;
  
  constructor(connection: Connection) {
    this.connection = connection;
  }
  
  /**
   * Build a create token transaction with metadata and optional initial buy
   * 
   * The mint keypair must be generated client-side and signed by the user.
   * Anchor handles mint account creation via `init` constraint.
   * Now includes Metaplex metadata creation and optional initial buy.
   */
  async buildCreateTokenTransaction(
    creator: PublicKey,
    mintKeypair: { publicKey: PublicKey },
    name: string,
    symbol: string,
    uri: string,
    initialBuyLamports: bigint = BigInt(0)
  ): Promise<Transaction> {
    const [configPDA] = findConfigPDA();
    const [curvePDA] = findBondingCurvePDA(mintKeypair.publicKey);
    const [solVaultPDA] = findSolVaultPDA(mintKeypair.publicKey);
    const [metadataPDA] = findMetadataPDA(mintKeypair.publicKey);
    const tokenVault = await findTokenVaultAddress(mintKeypair.publicKey, curvePDA);
    const creatorTokenAccount = await getAssociatedTokenAddress(mintKeypair.publicKey, creator);
    
    // Anchor discriminator for "create_token" = first 8 bytes of sha256("global:create_token")
    const discriminator = Buffer.from([84, 52, 204, 228, 24, 140, 234, 75]);
    
    // Encode strings with length prefix (Borsh format)
    const nameBytes = Buffer.from(name);
    const symbolBytes = Buffer.from(symbol);
    const uriBytes = Buffer.from(uri);
    
    const data = Buffer.concat([
      discriminator,
      Buffer.from([nameBytes.length, 0, 0, 0]), // u32 length
      nameBytes,
      Buffer.from([symbolBytes.length, 0, 0, 0]), // u32 length
      symbolBytes,
      Buffer.from([uriBytes.length, 0, 0, 0]), // u32 length
      uriBytes,
      writeU64(initialBuyLamports), // initial_buy_lamports: u64
    ]);
    
    // Account order must match CreateToken struct in program
    const createTokenIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: creator, isSigner: true, isWritable: true },
        { pubkey: configPDA, isSigner: false, isWritable: true },
        { pubkey: mintKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: metadataPDA, isSigner: false, isWritable: true },
        { pubkey: curvePDA, isSigner: false, isWritable: true },
        { pubkey: solVaultPDA, isSigner: false, isWritable: true },
        { pubkey: tokenVault, isSigner: false, isWritable: true },
        { pubkey: creatorTokenAccount, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: new PublicKey('SysvarRent111111111111111111111111111111111'), isSigner: false, isWritable: false },
      ],
      data,
    });
    
    const tx = new Transaction().add(createTokenIx);
    
    tx.feePayer = creator;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    
    return tx;
  }
  
  /**
   * Fetch bonding curve state
   */
  async getBondingCurve(mint: PublicKey): Promise<BondingCurveState | null> {
    const [curvePDA] = findBondingCurvePDA(mint);
    const account = await this.connection.getAccountInfo(curvePDA);
    
    if (!account) return null;
    
    // Decode the account data
    // Skip 8-byte discriminator
    const data = account.data.slice(8);
    
    return {
      creator: new PublicKey(data.slice(0, 32)),
      mint: new PublicKey(data.slice(32, 64)),
      virtualSolReserves: readU64(Buffer.from(data), 64),
      virtualTokenReserves: readU64(Buffer.from(data), 72),
      realSolReserves: readU64(Buffer.from(data), 80),
      realTokenReserves: readU64(Buffer.from(data), 88),
      tokenTotalSupply: readU64(Buffer.from(data), 96),
      graduated: data[104] === 1,
      createdAt: readU64(Buffer.from(data), 105),
      bump: data[113],
      solVaultBump: data[114],
      tokenVaultBump: data[115],
    };
  }
  
  /**
   * Build a buy transaction
   * 
   * Anchor discriminator for "buy": sha256("global:buy")[0..8]
   */
  async buildBuyTransaction(
    buyer: PublicKey,
    mint: PublicKey,
    solAmount: bigint,
    minTokensOut: bigint,
    creator: PublicKey,
    feeRecipient: PublicKey
  ): Promise<Transaction> {
    const [configPDA] = findConfigPDA();
    const [curvePDA] = findBondingCurvePDA(mint);
    const [solVaultPDA] = findSolVaultPDA(mint);
    const tokenVault = await findTokenVaultAddress(mint, curvePDA);
    const buyerTokenAccount = await getAssociatedTokenAddress(mint, buyer);
    
    // Anchor discriminator for "buy" = first 8 bytes of sha256("global:buy")
    const discriminator = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
    
    const data = Buffer.concat([
      discriminator,
      writeU64(solAmount),
      writeU64(minTokensOut),
    ]);
    
    const instruction = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: buyer, isSigner: true, isWritable: true },
        { pubkey: curvePDA, isSigner: false, isWritable: true },
        { pubkey: configPDA, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: solVaultPDA, isSigner: false, isWritable: true },
        { pubkey: tokenVault, isSigner: false, isWritable: true },
        { pubkey: buyerTokenAccount, isSigner: false, isWritable: true },
        { pubkey: feeRecipient, isSigner: false, isWritable: true },
        { pubkey: creator, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    
    const tx = new Transaction().add(instruction);
    tx.feePayer = buyer;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    
    return tx;
  }
  
  /**
   * Build a sell transaction
   * 
   * Anchor discriminator for "sell": sha256("global:sell")[0..8]
   */
  async buildSellTransaction(
    seller: PublicKey,
    mint: PublicKey,
    tokenAmount: bigint,
    minSolOut: bigint,
    creator: PublicKey,
    feeRecipient: PublicKey
  ): Promise<Transaction> {
    const [configPDA] = findConfigPDA();
    const [curvePDA] = findBondingCurvePDA(mint);
    const [solVaultPDA] = findSolVaultPDA(mint);
    const tokenVault = await findTokenVaultAddress(mint, curvePDA);
    const sellerTokenAccount = await getAssociatedTokenAddress(mint, seller);
    
    // Anchor discriminator for "sell" = first 8 bytes of sha256("global:sell")
    const discriminator = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);
    
    const data = Buffer.concat([
      discriminator,
      writeU64(tokenAmount),
      writeU64(minSolOut),
    ]);
    
    const instruction = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: seller, isSigner: true, isWritable: true },
        { pubkey: curvePDA, isSigner: false, isWritable: true },
        { pubkey: configPDA, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: solVaultPDA, isSigner: false, isWritable: true },
        { pubkey: tokenVault, isSigner: false, isWritable: true },
        { pubkey: sellerTokenAccount, isSigner: false, isWritable: true },
        { pubkey: feeRecipient, isSigner: false, isWritable: true },
        { pubkey: creator, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    
    const tx = new Transaction().add(instruction);
    tx.feePayer = seller;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    
    return tx;
  }

  /**
   * Build a release_for_migration transaction
   * Only callable by protocol authority after graduation threshold is hit
   */
  async buildReleaseForMigrationTx(
    authority: PublicKey,
    mint: PublicKey,
    migrationWallet: PublicKey,
  ): Promise<Transaction> {
    const [curvePDA] = findBondingCurvePDA(mint);
    const [configPDA] = findConfigPDA();
    const [solVaultPDA] = findSolVaultPDA(mint);
    const tokenVault = await findTokenVaultAddress(mint, curvePDA);
    
    // Migration wallet's token account
    const migrationTokenAccount = await getAssociatedTokenAddress(
      mint,
      migrationWallet
    );
    
    // release_for_migration discriminator (first 8 bytes of sha256("global:release_for_migration"))
    const discriminator = Buffer.from([0xec, 0x5a, 0x8b, 0x9f, 0x8b, 0x1a, 0x4c, 0x8d]);
    
    const instruction = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: authority, isSigner: true, isWritable: true },
        { pubkey: configPDA, isSigner: false, isWritable: false },
        { pubkey: curvePDA, isSigner: false, isWritable: true },
        { pubkey: solVaultPDA, isSigner: false, isWritable: true },
        { pubkey: tokenVault, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: migrationWallet, isSigner: false, isWritable: true },
        { pubkey: migrationTokenAccount, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: discriminator,
    });
    
    const tx = new Transaction().add(instruction);
    tx.feePayer = authority;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    
    return tx;
  }
}

export default ClawdVaultClient;
