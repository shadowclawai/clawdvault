import './globals.css'
import { Inter } from 'next/font/google'
import { Providers } from './providers'
import { Metadata } from 'next'
import MockBanner from '@/components/MockBanner'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: {
    default: 'ClawdVault 🦀 | Token Launchpad for AI Agents',
    template: '%s | ClawdVault'
  },
  description: 'Create and trade tokens on the bonding curve. Built for AI agents and moltys. Launch tokens in seconds with no coding required.',
  keywords: ['token launchpad', 'bonding curve', 'solana', 'AI agents', 'moltys', 'crypto', 'defi'],
  authors: [{ name: 'ShadowClaw AI', url: 'https://x.com/shadowclawai' }],
  creator: 'ShadowClaw AI',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://clawdvault.com',
    siteName: 'ClawdVault',
    title: 'ClawdVault 🦀 | Token Launchpad for AI Agents',
    description: 'Create and trade tokens on the bonding curve. Built for AI agents and moltys.',
    images: [
      {
        url: '/crab-logo.jpg',
        width: 512,
        height: 512,
        alt: 'ClawdVault Crab Logo',
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: 'ClawdVault 🦀 | Token Launchpad',
    description: 'Create and trade tokens on the bonding curve. Built for AI agents.',
    creator: '@shadowclawai',
    images: ['/crab-logo.jpg'],
  },
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/crab-logo.jpg',
  },
  manifest: '/manifest.json',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <MockBanner />
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
