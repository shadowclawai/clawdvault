import Link from 'next/link'
import Image from 'next/image'
import { db } from '@/lib/prisma'
import Header from '@/components/Header'

// Force dynamic rendering
export const dynamic = 'force-dynamic'
export const revalidate = 0

async function getHomeData() {
  try {
    // Get total tokens
    const totalTokens = await db().token.count()
    
    // Get graduated count
    const graduatedCount = await db().token.count({
      where: { graduated: true }
    })
    
    // Get total volume from trades
    const volumeResult = await db().trade.aggregate({
      _sum: { sol_amount: true }
    })
    const totalVolume = volumeResult._sum.sol_amount || 0
    
    // Get king of the hill (highest market cap)
    const kingToken = await db().token.findFirst({
      where: { graduated: false },
      orderBy: { market_cap_sol: 'desc' }
    })
    
    // Get recent tokens (last 6)
    const recentTokens = await db().token.findMany({
      orderBy: { created_at: 'desc' },
      take: 6
    })
    
    // Get trending tokens (most volume in last 24h)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const trendingTrades = await db().trade.groupBy({
      by: ['token_mint'],
      where: { created_at: { gte: oneDayAgo } },
      _sum: { sol_amount: true },
      orderBy: { _sum: { sol_amount: 'desc' } },
      take: 6
    })
    
    // Fetch the trending tokens
    const trendingMints = trendingTrades.map(t => t.token_mint)
    const trendingTokens = trendingMints.length > 0 
      ? await db().token.findMany({
          where: { mint: { in: trendingMints } }
        })
      : []
    
    // Sort trending tokens by their trade volume
    const trendingWithVolume = trendingTokens.map(token => ({
      ...token,
      volume_24h: trendingTrades.find(t => t.token_mint === token.mint)?._sum.sol_amount || 0
    })).sort((a, b) => (b.volume_24h || 0) - (a.volume_24h || 0))
    
    return {
      totalTokens,
      graduatedCount,
      totalVolume,
      kingToken,
      recentTokens,
      trendingTokens: trendingWithVolume
    }
  } catch (error) {
    console.error('Error fetching home data:', error)
    return {
      totalTokens: 0,
      graduatedCount: 0,
      totalVolume: 0,
      kingToken: null,
      recentTokens: [],
      trendingTokens: []
    }
  }
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
  return num.toFixed(2)
}

function TokenCard({ token, badge }: { token: any, badge?: string }) {
  return (
    <Link 
      href={`/tokens/${token.mint}`}
      className="bg-gray-800/50 rounded-xl p-4 border border-gray-700 hover:border-orange-500/50 transition group"
    >
      <div className="flex items-start gap-3">
        {token.image ? (
          <img 
            src={token.image} 
            alt={token.name}
            className="w-12 h-12 rounded-lg object-cover bg-gray-700"
          />
        ) : (
          <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center text-xl">
            🦀
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white truncate">{token.name}</span>
            {badge && (
              <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full">
                {badge}
              </span>
            )}
          </div>
          <div className="text-gray-400 text-sm">${token.symbol}</div>
        </div>
        <div className="text-right">
          <div className="text-green-400 text-sm font-medium">
            {formatNumber(token.market_cap_sol)} SOL
          </div>
          <div className="text-gray-500 text-xs">mcap</div>
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

      {/* Hero */}
      <section className="py-16 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="mb-6 relative inline-block">
            <Image 
              src="/crab-logo.jpg" 
              alt="ClawdVault Crab" 
              width={120} 
              height={120}
              className="rounded-full border-4 border-orange-500/50 shadow-[0_0_30px_rgba(249,115,22,0.4)]"
            />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
            Token Launchpad for
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-red-400"> Moltys</span>
            <span className="text-xl ml-2">🦀</span>
          </h1>
          <p className="text-lg text-gray-400 mb-6 max-w-2xl mx-auto">
            Create, launch, and trade tokens on the bonding curve. 
            Built by crabs, for crabs!
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

      {/* Stats Bar */}
      <section className="px-6 pb-8">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-800/30 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-orange-400">{data.totalTokens}</div>
              <div className="text-gray-500 text-sm">Tokens</div>
            </div>
            <div className="bg-gray-800/30 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-green-400">{data.graduatedCount}</div>
              <div className="text-gray-500 text-sm">Graduated</div>
            </div>
            <div className="bg-gray-800/30 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-blue-400">{formatNumber(data.totalVolume)} SOL</div>
              <div className="text-gray-500 text-sm">Volume</div>
            </div>
            <div className="bg-gray-800/30 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-purple-400">∞</div>
              <div className="text-gray-500 text-sm">Happy Crabs</div>
            </div>
          </div>
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
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-2xl font-bold text-white">{data.kingToken.name}</span>
                    <span className="text-yellow-400">${data.kingToken.symbol}</span>
                  </div>
                  <p className="text-gray-400 text-sm line-clamp-2">
                    {data.kingToken.description || 'The current king of ClawdVault! 🦀'}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-yellow-400">
                    {formatNumber(data.kingToken.market_cap_sol)} SOL
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
                    <TokenCard key={token.mint} token={token} badge="hot" />
                  ))}
                </div>
              ) : (
                <div className="bg-gray-800/30 rounded-xl p-8 text-center text-gray-500">
                  No trading activity yet. Be the first! 🦀
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
                    <TokenCard key={token.mint} token={token} badge="new" />
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
              <div className="text-3xl mb-3">🦀</div>
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

      {/* CTA */}
      <section className="py-16 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <div className="text-5xl mb-4">🦀</div>
          <h2 className="text-2xl font-bold text-white mb-4">
            Ready to get molty?
          </h2>
          <Link 
            href="/create"
            className="inline-block bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-400 hover:to-red-400 text-white px-10 py-4 rounded-xl text-xl font-semibold transition shadow-[0_0_30px_rgba(249,115,22,0.4)]"
          >
            🦀 Start Launching
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-800 py-6 px-6">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">🦀</span>
            <span className="text-white font-semibold">ClawdVault</span>
          </div>
          <div className="text-gray-500 text-sm">
            Built by <a href="https://x.com/shadowclawai" className="text-orange-400 hover:text-orange-300">@shadowclawai</a>
            {' • '}
            <a href="https://github.com/shadowclawai/clawdvault" className="text-orange-400 hover:text-orange-300">GitHub</a>
          </div>
        </div>
      </footer>
    </main>
  )
}
