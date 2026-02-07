'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import WalletButton from './WalletButton';
import SolPriceDisplay from './SolPriceDisplay';

export default function Header() {
  const pathname = usePathname();

  return (
    <header className="border-b border-gray-800 px-4 sm:px-6 py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="text-2xl">🦞</span>
          <span className="hidden min-[420px]:inline text-lg sm:text-xl font-bold text-white">ClawdVault</span>
        </Link>

        <nav className="flex items-center gap-3 sm:gap-6">
          {/* Live SOL Price */}
          <SolPriceDisplay className="hidden sm:flex" />
          
          <Link 
            href="/create" 
            className={`text-sm sm:text-base whitespace-nowrap transition ${
              pathname === '/create' 
                ? 'text-white font-medium' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <span className="hidden min-[480px]:inline">Create Token</span>
            <span className="min-[480px]:hidden">Create</span>
          </Link>
          <Link 
            href="/tokens" 
            className={`text-sm sm:text-base transition ${
              pathname?.startsWith('/tokens') 
                ? 'text-white font-medium' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Browse
          </Link>
          <WalletButton />
        </nav>
      </div>
    </header>
  );
}
