import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

export const metadata = {
  title: 'API Documentation | ClawdVault',
  description: 'API documentation for ClawdVault token launchpad',
};

// Code block component for consistent styling
function CodeBlock({ children, title }: { children: string; title?: string }) {
  return (
    <div className="rounded-lg overflow-hidden border border-gray-700 mb-4">
      {title && (
        <div className="bg-gray-800 px-4 py-2 border-b border-gray-700">
          <span className="text-gray-400 text-xs font-mono">{title}</span>
        </div>
      )}
      <pre className="bg-[#0d1117] p-4 text-sm overflow-x-auto">
        <code className="text-[#e6edf3] font-mono leading-relaxed">{children}</code>
      </pre>
    </div>
  );
}

export default function DocsPage() {
  return (
    <main className="min-h-screen flex flex-col">
      <Header />

      <section className="py-12 px-6 flex-1">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold text-white mb-2">API Documentation</h1>
          <p className="text-gray-400 mb-8">
            Build integrations with ClawdVault. Perfect for AI agents, bots, and developers.
          </p>

          {/* Base URL */}
          <div className="bg-gray-800/50 rounded-xl p-4 mb-8 border border-gray-700">
            <div className="text-gray-400 text-sm mb-1">Base URL</div>
            <code className="text-orange-400 text-lg font-mono">https://clawdvault.com/api</code>
          </div>

          {/* Endpoints */}
          <div className="space-y-8">
            
            {/* How It Works */}
            <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mb-8">
              <div className="bg-orange-900/30 border-b border-gray-800 px-4 py-3">
                <span className="text-orange-400 font-medium">🔐 Non-Custodial Flow</span>
              </div>
              <div className="p-4">
                <p className="text-gray-400 mb-4">All transactions use a prepare → sign → execute flow. Your private key never leaves your device.</p>
                <div className="bg-[#0d1117] border border-gray-700 rounded-lg p-4 font-mono text-sm">
                  <span className="text-blue-400">1. Prepare</span> <span className="text-gray-500">→</span> <span className="text-purple-400">2. Sign Locally</span> <span className="text-gray-500">→</span> <span className="text-green-400">3. Execute</span>
                </div>
              </div>
            </section>

            {/* Create Token - Prepare */}
            <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="bg-green-900/30 border-b border-gray-800 px-4 py-3 flex items-center gap-3">
                <span className="bg-green-500 text-white text-xs font-bold px-2 py-1 rounded">POST</span>
                <code className="text-white font-mono">/api/token/prepare-create</code>
              </div>
              <div className="p-4">
                <p className="text-gray-400 mb-4">Step 1: Prepare a token creation transaction.</p>
                
                <h4 className="text-white font-medium mb-2">Request Body</h4>
                <CodeBlock title="JSON">{`{
  "creator": "YourWalletAddress...",
  "name": "Crab Token",
  "symbol": "CRAB",
  "initialBuy": 0.5
}`}</CodeBlock>

                <h4 className="text-white font-medium mb-2">Response</h4>
                <CodeBlock title="JSON">{`{
  "success": true,
  "transaction": "base64_unsigned_tx...",
  "mint": "NewMintAddress...",
  "mintKeypair": "base64_mint_secret..."
}`}</CodeBlock>
                <p className="text-gray-500 text-sm mt-2">Sign the transaction locally with your wallet + the mintKeypair, then call execute-create.</p>
              </div>
            </section>

            {/* Create Token - Execute */}
            <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="bg-green-900/30 border-b border-gray-800 px-4 py-3 flex items-center gap-3">
                <span className="bg-green-500 text-white text-xs font-bold px-2 py-1 rounded">POST</span>
                <code className="text-white font-mono">/api/token/execute-create</code>
              </div>
              <div className="p-4">
                <p className="text-gray-400 mb-4">Step 2: Execute the signed token creation transaction.</p>
                
                <h4 className="text-white font-medium mb-2">Request Body</h4>
                <CodeBlock title="JSON">{`{
  "signedTransaction": "base64_signed_tx...",
  "mint": "NewMintAddress...",
  "creator": "YourWalletAddress...",
  "name": "Crab Token",
  "symbol": "CRAB",
  "description": "...",
  "image": "https://...",
  "twitter": "@crabtoken",
  "telegram": "@crabtokenchat",
  "website": "crabtoken.xyz"
}`}</CodeBlock>

                <h4 className="text-white font-medium mb-2">Response</h4>
                <CodeBlock title="JSON">{`{
  "success": true,
  "signature": "5xyz...",
  "mint": "NewMintAddress...",
  "token": { ... }
}`}</CodeBlock>
              </div>
            </section>

            {/* Get Tokens */}
            <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="bg-blue-900/30 border-b border-gray-800 px-4 py-3 flex items-center gap-3">
                <span className="bg-blue-500 text-white text-xs font-bold px-2 py-1 rounded">GET</span>
                <code className="text-white font-mono">/api/tokens</code>
              </div>
              <div className="p-4">
                <p className="text-gray-400 mb-4">List all tokens with optional sorting.</p>
                
                <h4 className="text-white font-medium mb-2">Query Parameters</h4>
                <ul className="text-gray-400 text-sm space-y-1 mb-4 ml-4">
                  <li><code className="text-cyan-400">sort</code> — created_at, market_cap, volume, price</li>
                  <li><code className="text-cyan-400">page</code> — Page number (default: 1)</li>
                  <li><code className="text-cyan-400">limit</code> — Results per page (default: 50)</li>
                </ul>

                <h4 className="text-white font-medium mb-2">Response</h4>
                <CodeBlock title="JSON">{`{
  "tokens": [
    {
      "mint": "ABC123...",
      "name": "Crab Token",
      "symbol": "CRAB",
      "price_sol": 0.000000028,
      "market_cap_sol": 30.5,
      "volume_24h": 5.2,
      ...
    }
  ],
  "total": 42,
  "page": 1,
  "per_page": 50
}`}</CodeBlock>
              </div>
            </section>

            {/* Get Token */}
            <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="bg-blue-900/30 border-b border-gray-800 px-4 py-3 flex items-center gap-3">
                <span className="bg-blue-500 text-white text-xs font-bold px-2 py-1 rounded">GET</span>
                <code className="text-white font-mono">/api/tokens/[mint]</code>
              </div>
              <div className="p-4">
                <p className="text-gray-400 mb-4">Get details for a specific token including recent trades.</p>
                
                <h4 className="text-white font-medium mb-2">Response</h4>
                <CodeBlock title="JSON">{`{
  "token": {
    "mint": "ABC123...",
    "name": "Crab Token",
    "symbol": "CRAB",
    "description": "...",
    "image": "https://...",
    "price_sol": 0.000000028,
    "market_cap_sol": 30.5,
    "virtual_sol_reserves": 30,
    "virtual_token_reserves": 1073000000,
    "graduated": false,
    ...
  },
  "trades": [ ... ]
}`}</CodeBlock>
              </div>
            </section>

            {/* Get Quote */}
            <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="bg-blue-900/30 border-b border-gray-800 px-4 py-3 flex items-center gap-3">
                <span className="bg-blue-500 text-white text-xs font-bold px-2 py-1 rounded">GET</span>
                <code className="text-white font-mono">/api/trade?mint=...&amp;type=buy&amp;amount=0.5</code>
              </div>
              <div className="p-4">
                <p className="text-gray-400 mb-4">Get a quote without executing. Useful for previewing trades.</p>
                
                <h4 className="text-white font-medium mb-2">Response</h4>
                <CodeBlock title="JSON">{`{
  "input": 0.5,
  "output": 17857142,
  "price_impact": 1.67,
  "fee": 0.005,
  "current_price": 0.000000028
}`}</CodeBlock>
              </div>
            </section>

            {/* On-Chain Trade - Prepare */}
            <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="bg-purple-900/30 border-b border-gray-800 px-4 py-3 flex items-center gap-3">
                <span className="bg-purple-500 text-white text-xs font-bold px-2 py-1 rounded">POST</span>
                <code className="text-white font-mono">/api/trade/prepare</code>
                <span className="text-purple-400 text-xs">ON-CHAIN</span>
              </div>
              <div className="p-4">
                <p className="text-gray-400 mb-4">Prepare an on-chain trade transaction for wallet signing. Returns a transaction to sign with Phantom/Solflare.</p>
                
                <h4 className="text-white font-medium mb-2">Request Body</h4>
                <CodeBlock title="JSON">{`{
  "mint": "ABC123...",
  "type": "buy",
  "amount": 0.5,
  "wallet": "YourWallet...",
  "slippage": 0.01
}`}</CodeBlock>
                <ul className="text-gray-400 text-sm space-y-1 mb-4 ml-4">
                  <li><code className="text-cyan-400">type</code> — &quot;buy&quot; (SOL → tokens) or &quot;sell&quot; (tokens → SOL)</li>
                  <li><code className="text-cyan-400">amount</code> — SOL for buy, tokens for sell</li>
                  <li><code className="text-cyan-400">wallet</code> — Your Solana wallet address</li>
                  <li><code className="text-cyan-400">slippage</code> — Tolerance (default 0.01 = 1%)</li>
                </ul>

                <h4 className="text-white font-medium mb-2">Response</h4>
                <CodeBlock title="JSON">{`{
  "success": true,
  "transaction": "base64...",
  "type": "buy",
  "input": { "sol": 0.5, "fee": 0.005 },
  "output": { "tokens": 17857142, "minTokens": 17678570 },
  "priceImpact": 1.67,
  "platformWallet": "Platform..."
}`}</CodeBlock>
              </div>
            </section>

            {/* On-Chain Trade - Execute */}
            <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="bg-purple-900/30 border-b border-gray-800 px-4 py-3 flex items-center gap-3">
                <span className="bg-purple-500 text-white text-xs font-bold px-2 py-1 rounded">POST</span>
                <code className="text-white font-mono">/api/trade/execute</code>
                <span className="text-purple-400 text-xs">ON-CHAIN</span>
              </div>
              <div className="p-4">
                <p className="text-gray-400 mb-4">Execute a signed trade transaction. Call after user signs the transaction from /prepare.</p>
                
                <h4 className="text-white font-medium mb-2">Request Body</h4>
                <CodeBlock title="JSON">{`{
  "mint": "ABC123...",
  "type": "buy",
  "signedTransaction": "base64...",
  "wallet": "YourWallet...",
  "expectedOutput": 17857142,
  "solAmount": 0.5
}`}</CodeBlock>

                <h4 className="text-white font-medium mb-2">Response</h4>
                <CodeBlock title="JSON">{`{
  "success": true,
  "signature": "5xyz...",
  "trade": {
    "id": "...",
    "type": "buy",
    "solAmount": 0.495,
    "tokenAmount": 17857142
  },
  "newPrice": 0.000029,
  "fees": { "total": 0.005 }
}`}</CodeBlock>
              </div>
            </section>

            {/* SOL Price */}
            <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="bg-blue-900/30 border-b border-gray-800 px-4 py-3 flex items-center gap-3">
                <span className="bg-blue-500 text-white text-xs font-bold px-2 py-1 rounded">GET</span>
                <code className="text-white font-mono">/api/sol-price</code>
              </div>
              <div className="p-4">
                <p className="text-gray-400 mb-4">Get current SOL price in USD (cached, updates every 60s).</p>
                
                <h4 className="text-white font-medium mb-2">Response</h4>
                <CodeBlock title="JSON">{`{
  "price": 104.13,
  "valid": true,
  "cached": true,
  "source": "coingecko",
  "age": 45
}`}</CodeBlock>
              </div>
            </section>

            {/* Upload Image */}
            <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="bg-green-900/30 border-b border-gray-800 px-4 py-3 flex items-center gap-3">
                <span className="bg-green-500 text-white text-xs font-bold px-2 py-1 rounded">POST</span>
                <code className="text-white font-mono">/api/upload</code>
              </div>
              <div className="p-4">
                <p className="text-gray-400 mb-4">Upload an image for token creation. Returns a URL to use in /api/create.</p>
                
                <h4 className="text-white font-medium mb-2">Request</h4>
                <div className="bg-[#0d1117] border border-gray-700 rounded-lg p-4 mb-4">
                  <p className="text-[#e6edf3] text-sm font-mono">
                    Content-Type: <span className="text-orange-400">multipart/form-data</span><br/>
                    Field: <span className="text-cyan-400">file</span> <span className="text-gray-500">(PNG, JPG, GIF, WebP, max 5MB)</span>
                  </p>
                </div>

                <h4 className="text-white font-medium mb-2">Response</h4>
                <CodeBlock title="JSON">{`{
  "success": true,
  "url": "https://...supabase.co/storage/...",
  "filename": "abc123.png"
}`}</CodeBlock>
              </div>
            </section>

          </div>

          {/* Bonding Curve Info */}
          <div className="mt-12">
            <h2 className="text-2xl font-bold text-white mb-4">Bonding Curve</h2>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
              <p className="text-gray-400">
                ClawdVault uses a constant product (x*y=k) bonding curve:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div className="bg-[#0d1117] border border-gray-700 rounded-lg p-4">
                  <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">Initial Virtual SOL</div>
                  <div className="text-white text-lg font-mono">30 SOL</div>
                </div>
                <div className="bg-[#0d1117] border border-gray-700 rounded-lg p-4">
                  <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">Initial Virtual Tokens</div>
                  <div className="text-white text-lg font-mono">1,073,000,000</div>
                </div>
                <div className="bg-[#0d1117] border border-gray-700 rounded-lg p-4">
                  <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">Starting Price</div>
                  <div className="text-white text-lg font-mono">~0.000000028 SOL</div>
                </div>
                <div className="bg-[#0d1117] border border-gray-700 rounded-lg p-4">
                  <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">Graduation Threshold</div>
                  <div className="text-white text-lg font-mono">120 SOL raised</div>
                </div>
              </div>
              <div className="bg-[#0d1117] border border-gray-700 rounded-lg p-4 mt-4">
                <div className="text-gray-500 text-xs uppercase tracking-wider mb-2">Fee Breakdown</div>
                <div className="text-sm font-mono space-y-2">
                  <div className="flex gap-4">
                    <span className="text-white">Bonding Curve: 1%</span>
                    <span className="text-gray-500">→</span>
                    <span className="text-green-400">0.5% creator</span>
                    <span className="text-gray-500">+</span>
                    <span className="text-orange-400">0.5% protocol</span>
                  </div>
                  <div className="flex gap-4">
                    <span className="text-white">After Graduation: ~0.25%</span>
                    <span className="text-gray-500">→</span>
                    <span className="text-blue-400">Raydium swap fee (to LP)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Wallet Setup */}
          <div className="mt-12">
            <h2 className="text-2xl font-bold text-white mb-4">Connecting Your Wallet</h2>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
              <p className="text-gray-400">
                ClawdVault uses <a href="https://phantom.app" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300">Phantom</a> wallet for Solana transactions.
              </p>
              
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <span className="bg-purple-500/20 text-purple-400 text-sm font-bold px-2 py-1 rounded">1</span>
                  <div>
                    <div className="text-white font-medium">Install Phantom</div>
                    <p className="text-gray-500 text-sm">Download from <a href="https://phantom.app" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300">phantom.app</a> (browser extension or mobile app)</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-3">
                  <span className="bg-purple-500/20 text-purple-400 text-sm font-bold px-2 py-1 rounded">2</span>
                  <div>
                    <div className="text-white font-medium">Create or Import Wallet</div>
                    <p className="text-gray-500 text-sm">Set up a new wallet or import existing with your seed phrase</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-3">
                  <span className="bg-purple-500/20 text-purple-400 text-sm font-bold px-2 py-1 rounded">3</span>
                  <div>
                    <div className="text-white font-medium">Fund Your Wallet</div>
                    <p className="text-gray-500 text-sm">Buy SOL on an exchange and send to your Phantom address, or use a faucet for devnet testing</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-3">
                  <span className="bg-purple-500/20 text-purple-400 text-sm font-bold px-2 py-1 rounded">4</span>
                  <div>
                    <div className="text-white font-medium">Connect to ClawdVault</div>
                    <p className="text-gray-500 text-sm">Click &quot;Connect Wallet&quot; and approve the connection in Phantom</p>
                  </div>
                </div>
              </div>

              <div className="bg-[#0d1117] border border-gray-700 rounded-lg p-4 mt-4">
                <div className="text-gray-500 text-xs uppercase tracking-wider mb-2">For Devnet Testing</div>
                <p className="text-gray-400 text-sm">
                  In Phantom: Settings → Developer Settings → Change Network → <span className="text-purple-400">Devnet</span>
                  <br/>
                  Get free devnet SOL at <a href="https://faucet.solana.com" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300">faucet.solana.com</a>
                </p>
              </div>
            </div>
          </div>

          {/* For AI Agents */}
          <div className="mt-12">
            <h2 className="text-2xl font-bold text-white mb-4">For AI Agents 🤖</h2>
            <p className="text-gray-400 mb-4">
              Check out our <Link href="/SKILL.md" className="text-orange-400 hover:text-orange-300">SKILL.md</Link> file 
              for a concise reference designed for AI agents and LLMs.
            </p>
          </div>

          <div className="mt-8 pt-8 border-t border-gray-800">
            <Link href="/" className="text-orange-400 hover:text-orange-300 transition">
              ← Back to Home
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
