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

// Program ID - UPDATE AFTER DEPLOYMENT
// Placeholder until real program deployed (use anchor build keypair after deploy)
export const PROGRAM_ID = new PublicKey('GMdG56oR3Qpc8NT6TwAtwdwNggxRADn6VAYbotLF1aM');

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
}

export default ClawdVaultClient;
