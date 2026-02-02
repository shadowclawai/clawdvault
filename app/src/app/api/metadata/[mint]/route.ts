import { NextRequest, NextResponse } from 'next/server';
import { getTokenByMint } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Metaplex-compatible token metadata endpoint
 * GET /api/metadata/[mint]
 * 
 * Returns JSON metadata for on-chain token URI
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ mint: string }> }
) {
  try {
    const { mint } = await params;
    
    if (!mint) {
      return NextResponse.json({ error: 'Mint address required' }, { status: 400 });
    }

    // Get token from database
    const token = await getTokenByMint(mint);
    
    if (!token) {
      return NextResponse.json({ error: 'Token not found' }, { status: 404 });
    }

    // Return Metaplex-compatible metadata
    const metadata = {
      name: token.name,
      symbol: token.symbol,
      description: token.description || `${token.name} - Created on ClawdVault`,
      image: token.image || '',
      external_url: `https://clawdvault.com/token/${mint}`,
      attributes: [
        {
          trait_type: 'Creator',
          value: token.creator,
        },
        {
          trait_type: 'Platform',
          value: 'ClawdVault',
        },
      ],
      properties: {
        files: token.image ? [
          {
            uri: token.image,
            type: 'image/png',
          }
        ] : [],
        category: 'image',
        creators: [
          {
            address: token.creator,
            share: 100,
          }
        ],
      },
    };

    return NextResponse.json(metadata, {
      headers: {
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    console.error('Error fetching metadata:', error);
    return NextResponse.json({ error: 'Failed to fetch metadata' }, { status: 500 });
  }
}
