/**
 * Core trade sync logic - shared between API route and cron
 */

import { Connection, PublicKey, clusterApiUrl, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { PROGRAM_ID } from '@/lib/anchor/client';
import { getTradeBySignature, recordTrade, getToken } from '@/lib/db';
import { announceTrade } from '@/lib/moltx';

// Event discriminators (first 8 bytes of sha256("event:EventName"))
const TRADE_EVENT_DISCRIMINATOR = Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]);
const TOKEN_CREATED_DISCRIMINATOR = Buffer.from([96, 122, 113, 138, 50, 227, 149, 57]); // sha256("event:TokenCreatedEvent")

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

interface ParsedTokenCreatedEvent {
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  uri: string;
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
 * Parse TokenCreatedEvent from transaction logs
 */
function parseTokenCreatedEventFromLogs(logs: string[]): ParsedTokenCreatedEvent | null {
  for (const log of logs) {
    if (log.startsWith('Program data: ')) {
      const base64Data = log.slice('Program data: '.length);
      try {
        const data = Buffer.from(base64Data, 'base64');
        
        if (data.length >= 8 && data.slice(0, 8).equals(TOKEN_CREATED_DISCRIMINATOR)) {
          let offset = 8;
          
          const mint = new PublicKey(data.slice(offset, offset + 32)).toBase58();
          offset += 32;
          
          const creator = new PublicKey(data.slice(offset, offset + 32)).toBase58();
          offset += 32;
          
          // Read name (4-byte length prefix + string)
          const nameLen = data.readUInt32LE(offset);
          offset += 4;
          const name = data.slice(offset, offset + nameLen).toString('utf8');
          offset += nameLen;
          
          // Read symbol (4-byte length prefix + string)
          const symbolLen = data.readUInt32LE(offset);
          offset += 4;
          const symbol = data.slice(offset, offset + symbolLen).toString('utf8');
          offset += symbolLen;
          
          // Read uri (4-byte length prefix + string)
          const uriLen = data.readUInt32LE(offset);
          offset += 4;
          const uri = data.slice(offset, offset + uriLen).toString('utf8');
          offset += uriLen;
          
          const timestamp = data.readBigInt64LE(offset);
          
          return { mint, creator, name, symbol, uri, timestamp };
        }
      } catch (e) {
        // Not our event
      }
    }
  }
  return null;
}

/**
 * Parse initial buy from transaction logs (look for the msg! output)
 */
function parseInitialBuyFromLogs(logs: string[]): { solAmount: number; tokenAmount: number } | null {
  for (const log of logs) {
    // Look for: "🎯 Initial buy: X lamports -> Y tokens"
    const match = log.match(/Initial buy: (\d+) lamports -> (\d+) tokens/);
    if (match) {
      return {
        solAmount: parseInt(match[1]) / LAMPORTS_PER_SOL,
        tokenAmount: parseInt(match[2]) / 1_000_000, // 6 decimals
      };
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
        
        // Rate limit: small delay to avoid 429s
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Fetch full transaction
        const tx = await connection.getTransaction(sigInfo.signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });
        
        if (!tx?.meta?.logMessages) {
          continue;
        }
        
        // Try to parse TradeEvent first
        const tradeEvent = parseTradeEventFromLogs(tx.meta.logMessages);
        
        if (tradeEvent) {
          // Filter by mint if specified
          if (mintFilter && tradeEvent.mint !== mintFilter) {
            continue;
          }
          
          // Check if token exists in database
          const token = await getToken(tradeEvent.mint);
          if (!token) {
            console.log(`⏭️ Token ${tradeEvent.mint.slice(0, 8)}... not in DB, skipping trade`);
            continue;
          }
          
          // Record trade with on-chain reserves for accuracy
          const solAmount = Number(tradeEvent.solAmount) / 1e9;
          const tokenAmount = Number(tradeEvent.tokenAmount) / 1e6;
          const newVirtualSol = Number(tradeEvent.virtualSolReserves) / 1e9;
          const newVirtualTokens = Number(tradeEvent.virtualTokenReserves) / 1e6;
          
          const recordedTrade = await recordTrade({
            mint: tradeEvent.mint,
            type: tradeEvent.isBuy ? 'buy' : 'sell',
            wallet: tradeEvent.trader,
            solAmount,
            tokenAmount,
            signature: sigInfo.signature,
            timestamp: new Date(Number(tradeEvent.timestamp) * 1000),
            onChainReserves: {
              virtualSolReserves: newVirtualSol,
              virtualTokenReserves: newVirtualTokens,
            },
          });
          
          // Post to Moltx (fire and forget) - use solPriceUsd from recorded trade
          announceTrade({
            mint: tradeEvent.mint,
            symbol: token.symbol,
            name: token.name,
            type: tradeEvent.isBuy ? 'buy' : 'sell',
            solAmount,
            tokenAmount,
            trader: tradeEvent.trader,
            newPrice: newVirtualSol / newVirtualTokens,
            marketCap: (newVirtualSol / newVirtualTokens) * 1_000_000_000,
            solPriceUsd: recordedTrade?.solPriceUsd ? Number(recordedTrade.solPriceUsd) : undefined,
          }).catch(err => console.error('[Moltx] Trade announce failed:', err));
          
          synced++;
          syncedTrades.push(sigInfo.signature);
          console.log(`✅ Synced trade: ${sigInfo.signature.slice(0, 8)}... (${tradeEvent.isBuy ? 'BUY' : 'SELL'})`);
          continue;
        }
        
        // Try to parse TokenCreatedEvent (includes initial buy if any)
        const createEvent = parseTokenCreatedEventFromLogs(tx.meta.logMessages);
        if (createEvent) {
          // Filter by mint if specified
          if (mintFilter && createEvent.mint !== mintFilter) {
            continue;
          }
          
          // Check if token exists in database (don't auto-create, might interfere with registration)
          const existingToken = await getToken(createEvent.mint);
          
          if (!existingToken) {
            // Token not in DB - skip (will be created via normal registration flow)
            console.log(`⏭️ Token ${createEvent.symbol} not in DB, skipping (use registration flow)`);
            continue;
          }
          
          // Check for initial buy in the same transaction
          const initialBuy = parseInitialBuyFromLogs(tx.meta.logMessages);
          if (initialBuy && initialBuy.solAmount > 0) {
            console.log(`🎯 Found initial buy: ${initialBuy.solAmount} SOL`);
            
            try {
              const recordedTrade = await recordTrade({
                mint: createEvent.mint,
                type: 'buy',
                wallet: createEvent.creator,
                solAmount: initialBuy.solAmount,
                tokenAmount: initialBuy.tokenAmount,
                signature: sigInfo.signature,
                timestamp: new Date(Number(createEvent.timestamp) * 1000),
              });
              
              // Post initial buy to Moltx - use solPriceUsd from recorded trade
              announceTrade({
                mint: createEvent.mint,
                symbol: existingToken.symbol,
                name: existingToken.name,
                type: 'buy',
                solAmount: initialBuy.solAmount,
                tokenAmount: initialBuy.tokenAmount,
                trader: createEvent.creator,
                solPriceUsd: recordedTrade?.solPriceUsd ? Number(recordedTrade.solPriceUsd) : undefined,
              }).catch(err => console.error('[Moltx] Initial buy announce failed:', err));
              
              synced++;
              syncedTrades.push(sigInfo.signature);
              console.log(`✅ Synced initial buy: ${sigInfo.signature.slice(0, 8)}...`);
            } catch (tradeErr) {
              console.error(`Failed to record initial buy:`, tradeErr);
            }
          }
          
          continue;
        }
        
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
