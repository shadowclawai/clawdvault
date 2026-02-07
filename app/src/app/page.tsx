import Link from 'next/link'
import Image from 'next/image'
import { db } from '@/lib/prisma'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import HomeStats from '@/components/HomeStats'

// Force dynamic rendering
export const dynamic = 'force-dynamic'
export const revalidate = 0

// Cache for server-side SOL price
let cachedSolPrice: number | null = null;
let lastSolPriceFetch: number = 0;
const SOL_PRICE_CACHE_MS = 60 * 1000; // 60 seconds

async function getSolPrice(): Promise<number | null> {
  const now = Date.now();
  
  // Return cached if fresh
  if (cachedSolPrice !== null && (now - lastSolPriceFetch) < SOL_PRICE_CACHE_MS) {
    return cachedSolPrice;
  }
  
  // Try CoinGecko
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(5000)
    });
    const data = await res.json();
    if (data.solana?.usd) {
      cachedSolPrice = data.solana.usd;
      lastSolPriceFetch = now;
      return cachedSolPrice;
    }
  } catch (e) {
    console.warn('[Homepage] CoinGecko failed:', e);
  }
  
  // Try Jupiter as fallback
  try {
    const res = await fetch('https://price.jup.ag/v6/price?ids=SOL', {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(5000)
    });
    const data = await res.json();
    if (data.data?.SOL?.price) {
      cachedSolPrice = data.data.SOL.price;
      lastSolPriceFetch = now;
      return cachedSolPrice;
    }
  } catch (e) {
    console.warn('[Homepage] Jupiter failed:', e);
  }
  
  // Return stale cache if available, otherwise null
  return cachedSolPrice;
}

async function getHomeData() {
  try {
    // Get SOL price first
    const solPrice = await getSolPrice()
    // Get total tokens
    const totalTokens = await db().token.count()

    // Get graduated count
    const graduatedCount = await db().token.count({
      where: { graduated: true }
    })

    // Get 24h volume from trades
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const volumeResult = await db().trade.aggregate({
      where: { createdAt: { gte: oneDayAgo } },
      _sum: { solAmount: true }
    })
    const totalVolume = Number(volumeResult._sum.solAmount || 0)

    // Get king of the hill (highest market cap = highest virtualSolReserves)
    const kingToken = await db().token.findFirst({
      where: { graduated: false },
      orderBy: { virtualSolReserves: 'desc' }
    })

    // Get recent tokens (last 6)
    const recentTokens = await db().token.findMany({
      orderBy: { createdAt: 'desc' },
      take: 6
    })

    // Get trending tokens (most volume in last 24h)
    const trendingTrades = await db().trade.groupBy({
      by: ['tokenMint'],
      where: { createdAt: { gte: oneDayAgo } },
      _sum: { solAmount: true },
      orderBy: { _sum: { solAmount: 'desc' } },
      take: 6
    })

    // Fetch the trending tokens
    const trendingMints = trendingTrades.map(t => t.tokenMint)
    const trendingTokens = trendingMints.length > 0
      ? await db().token.findMany({
          where: { mint: { in: trendingMints } }
        })
      : []

    // Sort trending tokens by their trade volume
    const trendingWithVolume = trendingTokens.map(token => ({
      ...token,
      volume24h: Number(trendingTrades.find(t => t.tokenMint === token.mint)?._sum.solAmount || 0)
    })).sort((a, b) => b.volume24h - a.volume24h)

    // Fetch last candles for all tokens to calculate market cap
    // Candles include heartbeat candles, so they stay updated with current SOL price
    const allTokenMints = [
      ...(kingToken ? [kingToken.mint] : []),
      ...recentTokens.map(t => t.mint),
      ...trendingWithVolume.map(t => t.mint)
    ]
    const uniqueMints = Array.from(new Set(allTokenMints))

    const lastCandles = await db().priceCandle.findMany({
      where: { tokenMint: { in: uniqueMints } },
      orderBy: { bucketTime: 'desc' },
      distinct: ['tokenMint'],
      select: {
        tokenMint: true,
        close: true,
        closeUsd: true
      }
    })

    const lastCandleMap = new Map(lastCandles.map(c => [c.tokenMint, {
      priceSol: c.close ? Number(c.close) : undefined,
      priceUsd: c.closeUsd ? Number(c.closeUsd) : undefined
    }]))

    return {
      totalTokens,
      graduatedCount,
      totalVolume,
      kingToken,
      recentTokens,
      trendingTokens: trendingWithVolume,
      solPrice,
      lastCandleMap
    }
  } catch (error) {
    console.error('Error fetching home data:', error)
    return {
      totalTokens: 0,
      graduatedCount: 0,
      totalVolume: 0,
      kingToken: null,
      recentTokens: [],
      trendingTokens: [],
      solPrice: 100,
      lastCandleMap: new Map()
    }
  }
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
  return num.toFixed(2)
}

function formatUsd(num: number): string {
  if (num >= 1000000) return `$${(num / 1000000).toFixed(1)}M`
  if (num >= 1000) return `$${(num / 1000).toFixed(1)}K`
  if (num >= 1) return `$${num.toFixed(0)}`
  return `$${num.toFixed(2)}`
}

function formatSol(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M SOL`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K SOL`
  return `${num.toFixed(2)} SOL`
}

function formatValue(solAmount: number, solPrice: number | null): string {
  if (solPrice !== null) {
    return formatUsd(solAmount * solPrice);
  }
  return formatSol(solAmount);
}

const TOTAL_SUPPLY = 1_000_000_000

// Calculate market cap from last candle (includes heartbeat candles for USD continuity)
function getMarketCap(token: any, lastCandle?: { priceUsd?: number | null; priceSol?: number | null }): { sol: number; usd: number | null } {
  if (lastCandle?.priceUsd) {
    // Use last candle USD price × supply (includes heartbeat candles)
    return {
      sol: (lastCandle.priceUsd / (lastCandle.priceSol || 1)) * TOTAL_SUPPLY,
      usd: lastCandle.priceUsd * TOTAL_SUPPLY
    }
  }
  // Fallback: calculate from bonding curve reserves
  const virtualSol = Number(token.virtualSolReserves)
  const virtualTokens = Number(token.virtualTokenReserves)
  const price = virtualSol / virtualTokens
  return {
    sol: price * TOTAL_SUPPLY,
    usd: null
  }
}

function TokenCard({ token, badge, solPrice, lastCandle }: { token: any, badge?: string, solPrice: number | null, lastCandle?: { priceUsd?: number | null; priceSol?: number | null } }) {
  const mcap = getMarketCap(token, lastCandle)
  
  return (
    <Link 
      href={`/tokens/${token.mint}`}
      className="block bg-gradient-to-r from-gray-800/80 to-gray-800/40 rounded-xl p-4 border border-gray-700/50 hover:border-orange-500/50 hover:shadow-lg hover:shadow-orange-500/10 transition-all duration-200 group"
    >
      <div className="flex items-center gap-4">
        {/* Token Image */}
        <div className="relative flex-shrink-0">
          {token.image ? (
            <img 
              src={token.image} 
              alt={token.name}
              className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl object-cover bg-gray-700 ring-2 ring-gray-600 group-hover:ring-orange-500/50 transition-all"
            />
          ) : (
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center text-2xl ring-2 ring-orange-500/30">
              🦞
            </div>
          )}
          {badge && (
            <span className={`absolute -top-1 -right-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
              badge === 'hot' 
                ? 'bg-red-500 text-white' 
                : 'bg-green-500 text-white'
            }`}>
              {badge === 'hot' ? '🔥' : '✨'}
            </span>
          )}
        </div>
        
        {/* Token Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-white truncate text-base group-hover:text-orange-300 transition-colors">
              {token.name}
            </span>
          </div>
          <div className="text-gray-400 text-sm font-mono">${token.symbol}</div>
        </div>
        
        {/* Market Cap */}
        <div className="text-right flex-shrink-0">
          <div className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-emerald-300">
            {mcap.usd !== null ? formatUsd(mcap.usd) : formatValue(mcap.sol, solPrice)}
          </div>
          <div className="text-gray-500 text-xs uppercase tracking-wide">mcap</div>
        </div>
      </div>
    </Link>
  )
}

export default async function Home() {
  const data = await getHomeData()
  
  return (
    <main className="min-h-screen">
      <Header />

      {/* Official Token Launch Banner */}
      <Link 
        href="/tokens/B7KpChn4dxioeuNzzEY9eioUwEi5xt5KYegytRottJgZ"
        className="block bg-gradient-to-r from-orange-600 via-red-500 to-orange-600 text-white py-3 px-4 text-center hover:from-orange-500 hover:via-red-400 hover:to-orange-500 transition-all"
      >
        <span className="inline-flex items-center gap-2 font-medium">
          🎉 <span className="font-bold">$CLAWDVAULT</span> is LIVE! 
          <span className="hidden sm:inline">— The official token of ClawdVault</span>
          <span className="text-orange-200 ml-1">Trade Now →</span>
        </span>
      </Link>

      {/* Hero */}
      <section className="py-12 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="mb-6 relative inline-block h-[250px]">
            <Image 
              src="/hero-lobster.jpg" 
              alt="ClawdVault Lobster" 
              width={0} 
              height={0}
              sizes="100vw"
              className="h-[250px] w-auto rounded-2xl border-4 border-orange-500/50 shadow-[0_0_40px_rgba(249,115,22,0.5)]"
              priority
            />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
            Token Launchpad for
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-red-400"> Moltys</span>
            <span className="text-xl ml-2">🦞</span>
          </h1>
          <p className="text-lg text-gray-400 mb-6 max-w-2xl mx-auto">
            Create, launch, and trade tokens on the bonding curve. 
            Built by lobsters, for lobsters!
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            <Link 
              href="/create"
              className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-400 hover:to-red-400 text-white px-8 py-3 rounded-xl text-lg font-semibold transition shadow-[0_0_20px_rgba(249,115,22,0.3)]"
            >
              Launch Token 🚀
            </Link>
            <Link
              href="/tokens"
              className="border border-orange-500/50 hover:border-orange-400 text-white px-8 py-3 rounded-xl text-lg font-semibold transition"
            >
              Browse All
            </Link>
          </div>
        </div>
      </section>

      {/* Stats Bar - Live updating */}
      <section className="px-6 pb-8">
        <div className="max-w-4xl mx-auto">
          <HomeStats 
            initialTokens={data.totalTokens}
            initialGraduated={data.graduatedCount}
            initialVolume={data.totalVolume}
            solPrice={data.solPrice}
          />
        </div>
      </section>

      {/* King of the Hill */}
      {data.kingToken && (
        <section className="py-8 px-6">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <span>👑</span> King of the Hill
            </h2>
            <Link 
              href={`/tokens/${data.kingToken.mint}`}
              className="block bg-gradient-to-r from-yellow-900/20 to-orange-900/20 rounded-xl p-6 border border-yellow-500/30 hover:border-yellow-400/50 transition"
            >
              <div className="flex items-center gap-4">
                {data.kingToken.image ? (
                  <img 
                    src={data.kingToken.image} 
                    alt={data.kingToken.name}
                    className="w-20 h-20 rounded-xl object-cover bg-gray-700 border-2 border-yellow-500/50"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-xl bg-gradient-to-br from-yellow-500 to-orange-500 flex items-center justify-center text-3xl border-2 border-yellow-500/50">
                    👑
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0 mb-1">
                    <span className="text-xl sm:text-2xl font-bold text-white">{data.kingToken.name}</span>
                    <span className="text-yellow-400 text-sm sm:text-base">${data.kingToken.symbol}</span>
                  </div>
                  <p className="text-gray-400 text-sm line-clamp-2">
                    {data.kingToken.description || 'The current king of ClawdVault! 🦞'}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-yellow-400">
                    {(() => {
                      const mcap = getMarketCap(data.kingToken, data.lastCandleMap.get(data.kingToken.mint))
                      return mcap.usd !== null ? formatUsd(mcap.usd) : formatValue(mcap.sol, data.solPrice)
                    })()}
                  </div>
                  <div className="text-gray-500 text-sm">Market Cap</div>
                </div>
              </div>
            </Link>
          </div>
        </section>
      )}

      {/* Trending & Recent */}
      <section className="py-8 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-8">
            {/* Trending */}
            <div>
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <span>🔥</span> Trending
              </h2>
              {data.trendingTokens.length > 0 ? (
                <div className="space-y-3">
                  {data.trendingTokens.slice(0, 3).map((token: any) => (
                    <TokenCard key={token.mint} token={token} badge="hot" solPrice={data.solPrice} lastCandle={data.lastCandleMap.get(token.mint)} />
                  ))}
                </div>
              ) : (
                <div className="bg-gray-800/30 rounded-xl p-8 text-center text-gray-500">
                  No trading activity yet. Be the first! 🦞
                </div>
              )}
            </div>

            {/* Recent */}
            <div>
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <span>✨</span> Just Launched
              </h2>
              {data.recentTokens.length > 0 ? (
                <div className="space-y-3">
                  {data.recentTokens.slice(0, 3).map((token: any) => (
                    <TokenCard key={token.mint} token={token} badge="new" solPrice={data.solPrice} lastCandle={data.lastCandleMap.get(token.mint)} />
                  ))}
                </div>
              ) : (
                <div className="bg-gray-800/30 rounded-xl p-8 text-center text-gray-500">
                  No tokens yet. Launch the first one! 🚀
                </div>
              )}
            </div>
          </div>

          {data.recentTokens.length > 0 && (
            <div className="text-center mt-8">
              <Link 
                href="/tokens"
                className="text-orange-400 hover:text-orange-300 font-medium"
              >
                View all tokens →
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* How it works */}
      <section className="py-12 px-6 bg-gray-900/30">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-white text-center mb-8">
            How It Works
          </h2>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="text-3xl mb-3">🦞</div>
              <h3 className="text-lg font-semibold text-white mb-2">1. Create</h3>
              <p className="text-gray-400 text-sm">
                Launch your token with a name, symbol, and image
              </p>
            </div>
            <div className="text-center">
              <div className="text-3xl mb-3">📈</div>
              <h3 className="text-lg font-semibold text-white mb-2">2. Trade</h3>
              <p className="text-gray-400 text-sm">
                Buy and sell on the bonding curve
              </p>
            </div>
            <div className="text-center">
              <div className="text-3xl mb-3">🎓</div>
              <h3 className="text-lg font-semibold text-white mb-2">3. Graduate</h3>
              <p className="text-gray-400 text-sm">
                At $69K market cap, migrate to Raydium
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Developer Tools - Simple text mention */}
      <section className="py-6 px-6">
        <div className="max-w-4xl mx-auto text-center text-gray-400 text-sm">
          <p>
            Build with ClawdVault: <code className="text-orange-400">npm install @clawdvault/sdk</code> or <code className="text-orange-400">npm install -g @clawdvault/cli</code>
            {' · '}
            <a 
              href="https://github.com/shadowclawai/clawdvault-sdk"
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-400 hover:text-orange-300"
            >
              GitHub
            </a>
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <div className="text-5xl mb-4">🦞</div>
          <h2 className="text-2xl font-bold text-white mb-4">
            Ready to get molty?
          </h2>
          <Link 
            href="/create"
            className="inline-block bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-400 hover:to-red-400 text-white px-10 py-4 rounded-xl text-xl font-semibold transition shadow-[0_0_30px_rgba(249,115,22,0.4)]"
          >
            🦞 Start Launching
          </Link>
        </div>
      </section>

      <Footer />
    </main>
  )
}
