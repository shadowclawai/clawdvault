/**
 * Backfill missing trades from on-chain data
 * 
 * Usage: DATABASE_URL="..." SOLANA_RPC_URL="https://mainnet.helius-rpc.com/?api-key=..." npx ts-node scripts/backfill-trades.ts
 */

import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const PROGRAM_ID = new PublicKey('GUyF2TVe32Cid4iGVt2F6wPYDhLSVmTUZBj2974outYM');
const TRADE_EVENT_DISCRIMINATOR = Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]);

// Create connection pool using DIRECT_URL for migrations/scripts
const pool = new Pool({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

interface ParsedTradeEvent {
  mint: string;
  trader: string;
  isBuy: boolean;
  solAmount: bigint;
  tokenAmount: bigint;
  protocolFee: bigint;
  creatorFee: bigint;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  timestamp: bigint;
}

function parseTradeEventFromLogs(logs: string[]): ParsedTradeEvent | null {
  for (const log of logs) {
    if (log.startsWith('Program data: ')) {
      const base64Data = log.slice('Program data: '.length);
      try {
        const data = Buffer.from(base64Data, 'base64');
        
        if (data.length >= 8 && data.slice(0, 8).equals(TRADE_EVENT_DISCRIMINATOR)) {
          let offset = 8;
          
          const mint = new PublicKey(data.slice(offset, offset + 32)).toBase58();
          offset += 32;
          
          const trader = new PublicKey(data.slice(offset, offset + 32)).toBase58();
          offset += 32;
          
          const isBuy = data[offset] === 1;
          offset += 1;
          
          const solAmount = data.readBigUInt64LE(offset);
          offset += 8;
          
          const tokenAmount = data.readBigUInt64LE(offset);
          offset += 8;
          
          const protocolFee = data.readBigUInt64LE(offset);
          offset += 8;
          
          const creatorFee = data.readBigUInt64LE(offset);
          offset += 8;
          
          const virtualSolReserves = data.readBigUInt64LE(offset);
          offset += 8;
          
          const virtualTokenReserves = data.readBigUInt64LE(offset);
          offset += 8;
          
          const timestamp = data.readBigInt64LE(offset);
          
          return {
            mint,
            trader,
            isBuy,
            solAmount,
            tokenAmount,
            protocolFee,
            creatorFee,
            virtualSolReserves,
            virtualTokenReserves,
            timestamp,
          };
        }
      } catch (e) {
        // Not our event
      }
    }
  }
  return null;
}

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) {
    console.error('SOLANA_RPC_URL required');
    process.exit(1);
  }
  
  const connection = new Connection(rpcUrl, 'confirmed');
  
  // Get all tokens from DB
  const tokens = await prisma.token.findMany({
    select: { id: true, mint: true, name: true }
  });
  
  console.log(`Found ${tokens.length} tokens to check\n`);
  
  for (const token of tokens) {
    console.log(`\n=== ${token.name} (${token.mint}) ===`);
    
    // Get existing trades for this token
    const existingTrades = await prisma.trade.findMany({
      where: { tokenId: token.id },
      select: { signature: true }
    });
    const existingSigs = new Set(existingTrades.map(t => t.signature));
    console.log(`Existing trades in DB: ${existingSigs.size}`);
    
    // Get all signatures for the program that involve this token
    // We query by the bonding curve PDA
    const [bondingCurve] = PublicKey.findProgramAddressSync(
      [Buffer.from('bonding_curve'), new PublicKey(token.mint).toBuffer()],
      PROGRAM_ID
    );
    
    console.log(`Bonding curve PDA: ${bondingCurve.toBase58()}`);
    
    const signatures = await connection.getSignaturesForAddress(bondingCurve, { limit: 100 });
    console.log(`On-chain signatures: ${signatures.length}`);
    
    let synced = 0;
    let skipped = 0;
    
    for (const sigInfo of signatures) {
      if (existingSigs.has(sigInfo.signature)) {
        skipped++;
        continue;
      }
      
      // Fetch full transaction
      const tx = await connection.getTransaction(sigInfo.signature, {
        maxSupportedTransactionVersion: 0,
      });
      
      if (!tx || !tx.meta?.logMessages) {
        console.log(`  Skip ${sigInfo.signature.slice(0, 8)}... (no logs)`);
        continue;
      }
      
      const tradeEvent = parseTradeEventFromLogs(tx.meta.logMessages);
      
      if (tradeEvent && tradeEvent.mint === token.mint) {
        const solAmount = Number(tradeEvent.solAmount) / LAMPORTS_PER_SOL;
        const tokenAmount = Number(tradeEvent.tokenAmount);
        const virtualSolReserves = Number(tradeEvent.virtualSolReserves) / LAMPORTS_PER_SOL;
        const virtualTokenReserves = Number(tradeEvent.virtualTokenReserves);
        const priceSol = virtualSolReserves / virtualTokenReserves;
        
        console.log(`  Found: ${tradeEvent.isBuy ? 'BUY' : 'SELL'} ${solAmount.toFixed(4)} SOL → ${tokenAmount.toLocaleString()} tokens`);
        console.log(`         Reserves: ${virtualSolReserves.toFixed(4)} SOL / ${virtualTokenReserves.toLocaleString()} tokens`);
        
        // Insert trade
        await prisma.trade.create({
          data: {
            tokenId: token.id,
            tokenMint: token.mint,
            signature: sigInfo.signature,
            trader: tradeEvent.trader,
            tradeType: tradeEvent.isBuy ? 'buy' : 'sell',
            solAmount,
            tokenAmount,
            priceSol,
            protocolFee: Number(tradeEvent.protocolFee) / LAMPORTS_PER_SOL,
            creatorFee: Number(tradeEvent.creatorFee) / LAMPORTS_PER_SOL,
            totalFee: (Number(tradeEvent.protocolFee) + Number(tradeEvent.creatorFee)) / LAMPORTS_PER_SOL,
            createdAt: new Date(Number(tradeEvent.timestamp) * 1000),
          }
        });
        
        // Update token reserves
        await prisma.token.update({
          where: { id: token.id },
          data: {
            virtualSolReserves,
            virtualTokenReserves,
            realSolReserves: virtualSolReserves - 30, // Initial virtual = 30 SOL
            realTokenReserves: virtualTokenReserves,
          }
        });
        
        synced++;
      }
      
      // Rate limit
      await new Promise(r => setTimeout(r, 100));
    }
    
    console.log(`\nSynced: ${synced}, Skipped (existing): ${skipped}`);
  }
  
  console.log('\n✅ Backfill complete!');
  await prisma.$disconnect();
}

main().catch(console.error);
