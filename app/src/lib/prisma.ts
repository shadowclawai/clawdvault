import { PrismaClient } from '../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Create adapter
const adapter = new PrismaPg(pool);

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Export db() for compatibility
export const db = () => prisma;

// Fee configuration (basis points)
export const FEE_CONFIG = {
  TOTAL_BPS: 100,      // 1% total fee
  PROTOCOL_BPS: 50,    // 0.5% to protocol
  CREATOR_BPS: 50,     // 0.5% to creator  
};

// Calculate fee breakdown
export function calculateFees(solAmount: number) {
  const totalFee = (solAmount * FEE_CONFIG.TOTAL_BPS) / 10000;
  
  return {
    total: totalFee,
    protocol: (solAmount * FEE_CONFIG.PROTOCOL_BPS) / 10000,
    creator: (solAmount * FEE_CONFIG.CREATOR_BPS) / 10000,
  };
}

// Constants
export const INITIAL_VIRTUAL_SOL = 30;
export const INITIAL_VIRTUAL_TOKENS = 1_000_000_000;
export const GRADUATION_THRESHOLD_SOL = 120; // ~$69K market cap at $100/SOL
