import { NextResponse } from 'next/server';
import { Connection, clusterApiUrl } from '@solana/web3.js';
import { db } from '@/lib/prisma';
import { updateCandles } from '@/lib/candles';
import { getSolPrice } from '@/lib/sol-price';

export const dynamic = 'force-dynamic';

function getConnection(): Connection {
  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');
  return new Connection(rpcUrl, 'confirmed');
}

interface ExecuteSellRequest {
  signedTransaction: string;
  mint: string;
  seller: string;
  tokenAmount: number;
  expectedSol: number;
}

export async function POST(request: Request) {
  try {
    const body: ExecuteSellRequest = await request.json();
    
    if (!body.signedTransaction || !body.mint || !body.seller || !body.tokenAmount) {
      return NextResponse.json(
        { success: false, error: 'signedTransaction, mint, seller, and tokenAmount are required' },
        { status: 400 }
      );
    }

    const connection = getConnection();
    const transactionBuffer = Buffer.from(body.signedTransaction, 'base64');
    
    console.log(`📤 Submitting sell transaction for ${body.mint}...`);
    
    const signature = await connection.sendRawTransaction(transactionBuffer, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    
    console.log(`📝 Sell transaction submitted: ${signature}`);
    
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    
    if (confirmation.value.err) {
      console.error('❌ Sell transaction failed:', confirmation.value.err);
      return NextResponse.json({
        success: false,
        error: 'Transaction failed on-chain',
        signature,
        details: confirmation.value.err,
      }, { status: 400 });
    }
    
    console.log(`✅ Sell confirmed: ${signature}`);
    
    // Get token from DB
    const token = await db().token.findUnique({
      where: { mint: body.mint },
    });
    
    if (!token) {
      return NextResponse.json({
        success: true,
        warning: 'Sell succeeded but token not found in DB',
        signature,
      });
    }
    
    // Calculate fees (1% total, deducted from SOL received)
    const solBeforeFee = body.expectedSol / 0.99; // Gross amount
    const totalFee = solBeforeFee * 0.01;
    const protocolFee = totalFee * 0.5;
    const creatorFee = totalFee * 0.5;
    const pricePerToken = body.tokenAmount > 0 ? body.expectedSol / body.tokenAmount : 0;
    
    // Record trade in database
    const trade = await db().trade.create({
      data: {
        tokenId: token.id,
        tokenMint: body.mint,
        trader: body.seller,
        tradeType: 'SELL',
        solAmount: body.expectedSol,
        tokenAmount: body.tokenAmount,
        priceSol: pricePerToken,
        totalFee: totalFee,
        protocolFee: protocolFee,
        creatorFee: creatorFee,
        
        signature: signature,
      },
    });
    
    console.log(`📊 Trade recorded: ${trade.id}`);

    // Update price candles for charts (with USD conversion)
    const solPriceUsd = await getSolPrice();
    await updateCandles(body.mint, pricePerToken, body.expectedSol, new Date(), solPriceUsd ?? undefined).catch(err => {
      console.warn('Failed to update candles:', err);
    });
    
    return NextResponse.json({
      success: true,
      signature,
      trade: {
        id: trade.id,
        type: 'SELL',
        solAmount: body.expectedSol,
        tokenAmount: body.tokenAmount,
        pricePerToken,
      },
      explorer: `https://solscan.io/tx/${signature}?cluster=${
        process.env.SOLANA_NETWORK || 'devnet'
      }`,
    });
    
  } catch (error) {
    console.error('Error executing sell:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to execute sell: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
