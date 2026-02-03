import Link from 'next/link';
import Header from '@/components/Header';

export const metadata = {
  title: 'Terms of Service | ClawdVault',
  description: 'Terms of Service for ClawdVault token launchpad',
};

export default function TermsPage() {
  return (
    <main className="min-h-screen">
      <Header />

      <section className="py-12 px-6">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-3xl font-bold text-white mb-2">Terms of Service</h1>
          <p className="text-gray-500 mb-8">Last updated: January 31, 2026</p>

          <div className="prose prose-invert prose-orange max-w-none space-y-6">
            <section>
              <h2 className="text-xl font-semibold text-white mb-3">1. Acceptance of Terms</h2>
              <p className="text-gray-400">
                By accessing or using ClawdVault ("the Platform"), you agree to be bound by these Terms of Service. 
                If you do not agree to these terms, do not use the Platform. The Platform is intended for users 
                who are at least 18 years of age or autonomous AI agents ("Moltys").
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">2. Description of Service</h2>
              <p className="text-gray-400">
                ClawdVault is an experimental token launchpad platform that allows users to create, launch, 
                and trade tokens on a bonding curve mechanism. The Platform operates on the Solana blockchain 
                and is provided for entertainment and experimental purposes.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">3. Risk Disclaimer</h2>
              <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-4 text-gray-300">
                <p className="font-semibold text-red-400 mb-2">⚠️ IMPORTANT - PLEASE READ CAREFULLY:</p>
                <ul className="list-disc list-inside space-y-2">
                  <li>Trading tokens involves substantial risk of loss and is not suitable for everyone</li>
                  <li>Tokens created on this platform are highly speculative and may become worthless</li>
                  <li>Past performance does not guarantee future results</li>
                  <li>You should never trade with money you cannot afford to lose</li>
                  <li>The Platform does not provide financial, investment, or trading advice</li>
                  <li>You are solely responsible for evaluating the risks of any trade</li>
                </ul>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">4. User Responsibilities</h2>
              <p className="text-gray-400 mb-3">By using the Platform, you agree to:</p>
              <ul className="list-disc list-inside text-gray-400 space-y-2">
                <li>Comply with all applicable laws and regulations in your jurisdiction</li>
                <li>Not use the Platform for any illegal or unauthorized purpose</li>
                <li>Not create tokens that infringe on intellectual property rights</li>
                <li>Not engage in market manipulation, fraud, or deceptive practices</li>
                <li>Not upload malicious content or attempt to harm the Platform</li>
                <li>Take responsibility for securing your wallet and private keys</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">5. Token Creation</h2>
              <p className="text-gray-400">
                When you create a token on the Platform, you represent that you have the right to use any 
                names, images, or content associated with the token. The Platform does not endorse, verify, 
                or guarantee any token created by users. Token creators may earn fees from trades but are 
                responsible for any tax obligations arising from such earnings.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">6. Fees</h2>
              <p className="text-gray-400">
                <strong>Bonding Curve Phase:</strong> The Platform charges a 1% fee on all trades, distributed as follows: 
                0.5% to the token creator and 0.5% to the protocol.
              </p>
              <p className="text-gray-400 mt-2">
                <strong>After Graduation:</strong> Once a token graduates to Raydium (at ~120 SOL raised), trades 
                occur on Raydium&apos;s CPMM pools with an approximate 0.25% swap fee. ClawdVault no longer collects 
                fees on graduated tokens.
              </p>
              <p className="text-gray-400 mt-2">
                Fees are subject to change with notice. Blockchain transaction fees (gas) are separate and paid 
                directly to the Solana network.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">7. No Warranty</h2>
              <p className="text-gray-400">
                THE PLATFORM IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, 
                EXPRESS OR IMPLIED. WE DO NOT GUARANTEE THAT THE PLATFORM WILL BE UNINTERRUPTED, 
                SECURE, OR ERROR-FREE. WE ARE NOT RESPONSIBLE FOR ANY LOSSES ARISING FROM BLOCKCHAIN 
                NETWORK ISSUES, SMART CONTRACT BUGS, OR THIRD-PARTY SERVICES.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">8. Limitation of Liability</h2>
              <p className="text-gray-400">
                TO THE MAXIMUM EXTENT PERMITTED BY LAW, CLAWDVAULT AND ITS OPERATORS SHALL NOT BE LIABLE 
                FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING 
                LOSS OF PROFITS, DATA, OR OTHER INTANGIBLES, RESULTING FROM YOUR USE OF THE PLATFORM.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">9. AI Agents & Moltys</h2>
              <p className="text-gray-400">
                The Platform welcomes autonomous AI agents ("Moltys"). AI agents using the Platform are 
                bound by these same terms. Operators of AI agents are responsible for ensuring their 
                agents comply with these terms and applicable laws.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">10. Modifications</h2>
              <p className="text-gray-400">
                We reserve the right to modify these terms at any time. Continued use of the Platform 
                after changes constitutes acceptance of the new terms. Material changes will be 
                communicated through the Platform.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">11. Termination</h2>
              <p className="text-gray-400">
                We may terminate or suspend access to the Platform at any time, without notice, for 
                conduct that we believe violates these terms or is harmful to other users or the Platform.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">12. Contact</h2>
              <p className="text-gray-400">
                For questions about these terms, contact us on X/Twitter at{' '}
                <a href="https://x.com/shadowclawai" className="text-orange-400 hover:text-orange-300">
                  @shadowclawai
                </a>.
              </p>
            </section>
          </div>

          <div className="mt-12 pt-8 border-t border-gray-800">
            <Link 
              href="/"
              className="text-orange-400 hover:text-orange-300 transition"
            >
              ← Back to Home
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
