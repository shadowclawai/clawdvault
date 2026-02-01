import { NextResponse } from 'next/server';
import { createToken, executeTrade } from '@/lib/db';
import { createTokenOnChain, isMockMode } from '@/lib/solana';
import { CreateTokenRequest, CreateTokenResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    // Get creator wallet from header or body
    const walletHeader = request.headers.get('X-Wallet');
    const authHeader = request.headers.get('Authorization');
    
    const body: CreateTokenRequest = await request.json();
    
    // Creator is wallet address if provided, otherwise use API key or anonymous
    const creator = walletHeader || body.creator || authHeader?.replace('Bearer ', '') || 'anonymous';
    
    // Validate required fields
    if (!body.name || !body.symbol) {
      return NextResponse.json(
        { success: false, error: 'Name and symbol are required' },
        { status: 400 }
      );
    }
    
    // Validate symbol
    if (body.symbol.length > 10) {
      return NextResponse.json(
        { success: false, error: 'Symbol must be 10 characters or less' },
        { status: 400 }
      );
    }
    
    // Validate name
    if (body.name.length > 32) {
      return NextResponse.json(
        { success: false, error: 'Name must be 32 characters or less' },
        { status: 400 }
      );
    }
    
    // Validate initialBuy
    if (body.initialBuy !== undefined) {
      if (body.initialBuy < 0) {
        return NextResponse.json(
          { success: false, error: 'Initial buy amount cannot be negative' },
          { status: 400 }
        );
      }
      if (body.initialBuy > 100) {
        return NextResponse.json(
          { success: false, error: 'Initial buy amount cannot exceed 100 SOL' },
          { status: 400 }
        );
      }
    }
    
    // Step 1: Create token on-chain (or mock)
    console.log(`Creating token: ${body.name} (${body.symbol}) for ${creator}`);
    console.log(`Mode: ${isMockMode() ? 'MOCK' : 'ON-CHAIN'}`);
    
    let onChainResult;
    try {
      onChainResult = await createTokenOnChain({
        name: body.name,
        symbol: body.symbol,
        description: body.description,
        image: body.image,
        creator,
      });
    } catch (error) {
      console.error('On-chain creation failed:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to create token on-chain' },
        { status: 500 }
      );
    }
    
    // Step 2: Save to database with the on-chain mint address
    const token = await createToken({
      mint: onChainResult.mint, // Use the on-chain mint address
      name: body.name,
      symbol: body.symbol,
      description: body.description,
      image: body.image,
      creator,
      creator_name: body.creatorName,
      twitter: body.twitter,
      telegram: body.telegram,
      website: body.website,
    });
    
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Failed to save token to database' },
        { status: 500 }
      );
    }
    
    // Step 3: Execute initial buy if specified
    let initialBuyResult = null;
    if (body.initialBuy && body.initialBuy > 0) {
      try {
        initialBuyResult = await executeTrade(
          token.mint,
          'buy',
          body.initialBuy,
          creator
        );
      } catch (err) {
        console.error('Initial buy failed:', err);
        // Don't fail token creation if initial buy fails
      }
    }
    
    const response: CreateTokenResponse = {
      success: true,
      token: initialBuyResult?.token || token,
      mint: token.mint,
      signature: onChainResult.signature,
      onChain: !isMockMode(),
    };
    
    // Add initial buy info to response
    if (initialBuyResult) {
      (response as any).initialBuy = {
        sol_spent: body.initialBuy,
        tokens_received: initialBuyResult.trade.token_amount,
      };
    }
    
    console.log(`✅ Token created: ${token.mint}`);
    
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error('Error creating token:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create token' },
      { status: 500 }
    );
  }
}
