import { NextResponse } from 'next/server';
import { Connection, clusterApiUrl, Transaction, PublicKey } from '@solana/web3.js';
import { getToken, recordTrade, getTradeBySignature } from '@/lib/db';
import { PROGRAM_ID } from '@/lib/anchor/client';

export const dynamic = 'force-dynamic';

// Get connection based on environment
function getConnection(): Connection {
  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');
  return new Connection(rpcUrl, 'confirmed');
}

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

/**
 * Parse TradeEvent from transaction logs
 */
function parseTradeEventFromLogs(logs: string[]): ParsedTradeEvent | null {
  for (const log of logs) {
    // Anchor events are logged as "Program data: <base64>"
    if (log.startsWith('Program data: ')) {
      const base64Data = log.slice('Program data: '.length);
      try {
        const data = Buffer.from(base64Data, 'base64');
        
        // Check discriminator
        if (data.length >= 8 && data.slice(0, 8).equals(TRADE_EVENT_DISCRIMINATOR)) {
          // Parse the event data (offset 8 to skip discriminator)
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
        // Not our event, continue
      }
    }
  }
  return null;
}

interface ExecuteTradeRequest {
  signedTransaction: string;  // Base64 encoded signed transaction
  mint: string;
  type: 'buy' | 'sell';
  wallet: string;
  // Note: solAmount and tokenAmount from client are now ignored for recording
  // We parse the actual amounts from on-chain TradeEvent
}

/**
 * Execute a signed trade transaction
 * POST /api/trade/execute
 * 
 * Submits the user's signed transaction to the network
 */
export async function POST(request: Request) {
  try {
    const body: ExecuteTradeRequest = await request.json();
    
    // Validate
    if (!body.signedTransaction || !body.mint || !body.type || !body.wallet) {
      return NextResponse.json(
        { success: false, error: 'signedTransaction, mint, type, and wallet are required' },
        { status: 400 }
      );
    }

    // Verify token exists
    const token = await getToken(body.mint);
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Token not found' },
        { status: 404 }
      );
    }

    const connection = getConnection();
    
    // Deserialize the signed transaction
    const transactionBuffer = Buffer.from(body.signedTransaction, 'base64');
    const transaction = Transaction.from(transactionBuffer);
    
    // Send the transaction
    console.log(`📤 Submitting ${body.type} transaction for ${body.mint}...`);
    
    const signature = await connection.sendRawTransaction(transactionBuffer, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    
    console.log(`📝 Transaction submitted: ${signature}`);
    
    // Wait for confirmation
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    
    if (confirmation.value.err) {
      console.error('❌ Transaction failed:', confirmation.value.err);
      return NextResponse.json({
        success: false,
        error: 'Transaction failed on-chain',
        signature,
        details: confirmation.value.err,
      }, { status: 400 });
    }
    
    console.log(`✅ Transaction confirmed: ${signature}`);
    
    // Check for duplicate submission (prevents recording same trade twice)
    const isDuplicate = await getTradeBySignature(signature);
    if (isDuplicate) {
      console.log(`⚠️ Duplicate trade submission detected: ${signature}`);
      return NextResponse.json({
        success: true,
        signature,
        explorer: `https://explorer.solana.com/tx/${signature}?cluster=${
          process.env.SOLANA_NETWORK || 'devnet'
        }`,
        duplicate: true,
        message: 'Trade already recorded',
      });
    }
    
    // Get transaction details including logs
    const txDetails = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    
    // Parse TradeEvent from logs to get ACTUAL amounts (prevents spoofing)
    let tradeEvent: ParsedTradeEvent | null = null;
    if (txDetails?.meta?.logMessages) {
      tradeEvent = parseTradeEventFromLogs(txDetails.meta.logMessages);
    }
    
    // Record the trade in database using ON-CHAIN data
    let dbTradeId: string | undefined;
    try {
      if (tradeEvent) {
        // Use verified on-chain data
        const dbTrade = await recordTrade({
          mint: tradeEvent.mint,
          type: tradeEvent.isBuy ? 'buy' : 'sell',
          wallet: tradeEvent.trader,
          solAmount: Number(tradeEvent.solAmount) / 1e9, // lamports to SOL
          tokenAmount: Number(tradeEvent.tokenAmount) / 1e6, // with decimals
          signature,
          timestamp: new Date(Number(tradeEvent.timestamp) * 1000),
        });
        dbTradeId = dbTrade?.id;
        console.log(`📊 Trade recorded from on-chain event: ${tradeEvent.isBuy ? 'BUY' : 'SELL'} ${Number(tradeEvent.solAmount) / 1e9} SOL (ID: ${dbTradeId})`);
      } else {
        console.warn('⚠️ Could not parse TradeEvent from logs - trade not recorded in DB');
        // Don't fall back to client data - that would defeat the purpose
      }
    } catch (dbError) {
      console.error('Warning: Failed to record trade in database:', dbError);
      // Don't fail the request - trade succeeded on-chain
    }
    
    return NextResponse.json({
      success: true,
      signature,
      explorer: `https://explorer.solana.com/tx/${signature}?cluster=${
        process.env.SOLANA_NETWORK || 'devnet'
      }`,
      slot: confirmation.context?.slot,
      blockTime: txDetails?.blockTime,
      // Return verified on-chain amounts + DB trade ID
      trade: tradeEvent ? {
        id: dbTradeId,
        mint: tradeEvent.mint,
        trader: tradeEvent.trader,
        type: tradeEvent.isBuy ? 'buy' : 'sell',
        solAmount: Number(tradeEvent.solAmount) / 1e9,
        tokenAmount: Number(tradeEvent.tokenAmount) / 1e6,
        protocolFee: Number(tradeEvent.protocolFee) / 1e9,
        creatorFee: Number(tradeEvent.creatorFee) / 1e9,
      } : null,
    });
    
  } catch (error) {
    console.error('Error executing trade:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to execute trade: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
