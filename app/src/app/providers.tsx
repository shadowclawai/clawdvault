'use client';

import { WalletProvider } from '@/contexts/WalletContext';
import AgeGate from '@/components/AgeGate';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AgeGate>
      <WalletProvider>
        {children}
      </WalletProvider>
    </AgeGate>
  );
}
