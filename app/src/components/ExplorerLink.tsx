'use client';

interface ExplorerLinkProps {
  address: string;
  type?: 'address' | 'tx' | 'token';
  label?: string;
  truncate?: boolean;
  className?: string;
}

const NETWORK = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';

export function getExplorerUrl(address: string, type: 'address' | 'tx' | 'token' = 'address'): string {
  const base = 'https://explorer.solana.com';
  const cluster = NETWORK === 'mainnet' ? '' : `?cluster=${NETWORK}`;
  
  switch (type) {
    case 'tx':
      return `${base}/tx/${address}${cluster}`;
    case 'token':
      return `${base}/address/${address}${cluster}`;
    default:
      return `${base}/address/${address}${cluster}`;
  }
}

export default function ExplorerLink({ 
  address, 
  type = 'address', 
  label,
  truncate = true,
  className = ''
}: ExplorerLinkProps) {
  const displayText = label || (truncate 
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : address);
  
  return (
    <a
      href={getExplorerUrl(address, type)}
      target="_blank"
      rel="noopener noreferrer"
      className={`text-cyan-400 hover:text-cyan-300 hover:underline ${className}`}
      title={address}
    >
      {displayText}
    </a>
  );
}
