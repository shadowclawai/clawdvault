/**
 * Core trade sync logic - shared between API route and cron
 */

import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { PROGRAM_ID } from '@/lib/anchor/client';
import { getTradeBySignature, recordTrade } from '@/lib/db';

// TradeEvent discriminator (first 8 bytes of sha256("event:TradeEvent"))
const TRADE_EVENT_DISCRIMINATOR = Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]);

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

export interface SyncResult {
  success: boolean;
  checked: number;
  synced: number;
  skipped: number;
  errors: number;
  syncedSignatures: string[];
  error?: string;
}

function getConnection(): Connection {
  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');
  return new Connection(rpcUrl, 'confirmed');
}

/**
 * Parse TradeEvent from transaction logs
 */
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

/**
 * Sync trades from on-chain to database
 */
export async function syncTrades(options: {
  limit?: number;
  mintFilter?: string | null;
} = {}): Promise<SyncResult> {
  const { limit = 100, mintFilter = null } = options;
  
  try {
    const connection = getConnection();
    
    console.log(`🔄 Syncing trades from on-chain (limit: ${limit})...`);
    
    const signatures = await connection.getSignaturesForAddress(
      PROGRAM_ID,
      { limit: Math.min(limit, 500) },
      'confirmed'
    );
    
    console.log(`Found ${signatures.length} recent program transactions`);
    
    let synced = 0;
    let skipped = 0;
    let errors = 0;
    const syncedTrades: string[] = [];
    
    for (const sigInfo of signatures) {
      try {
        // Check if we already have this trade
        const exists = await getTradeBySignature(sigInfo.signature);
        if (exists) {
          skipped++;
          continue;
        }
        
        // Fetch full transaction
        const tx = await connection.getTransaction(sigInfo.signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });
        
        if (!tx?.meta?.logMessages) {
          continue;
        }
        
        // Parse TradeEvent
        const tradeEvent = parseTradeEventFromLogs(tx.meta.logMessages);
        if (!tradeEvent) {
          continue; // Not a trade transaction (could be token creation, etc.)
        }
        
        // Filter by mint if specified
        if (mintFilter && tradeEvent.mint !== mintFilter) {
          continue;
        }
        
        // Record the trade
        await recordTrade({
          mint: tradeEvent.mint,
          type: tradeEvent.isBuy ? 'buy' : 'sell',
          wallet: tradeEvent.trader,
          solAmount: Number(tradeEvent.solAmount) / 1e9,
          tokenAmount: Number(tradeEvent.tokenAmount) / 1e6,
          signature: sigInfo.signature,
          timestamp: new Date(Number(tradeEvent.timestamp) * 1000),
        });
        
        synced++;
        syncedTrades.push(sigInfo.signature);
        console.log(`✅ Synced trade: ${sigInfo.signature.slice(0, 8)}... (${tradeEvent.isBuy ? 'BUY' : 'SELL'})`);
        
      } catch (err) {
        errors++;
        console.error(`Error processing ${sigInfo.signature}:`, err);
      }
    }
    
    console.log(`🔄 Sync complete: ${synced} synced, ${skipped} already existed, ${errors} errors`);
    
    return {
      success: true,
      checked: signatures.length,
      synced,
      skipped,
      errors,
      syncedSignatures: syncedTrades,
    };
    
  } catch (error) {
    console.error('Sync error:', error);
    return {
      success: false,
      checked: 0,
      synced: 0,
      skipped: 0,
      errors: 1,
      syncedSignatures: [],
      error: (error as Error).message,
    };
  }
}
