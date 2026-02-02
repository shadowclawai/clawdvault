#!/bin/bash
# ClawdVault Deployment Script
# Run this on macOS with Solana + Anchor installed

set -e

NETWORK=${1:-devnet}
echo "🐺 Deploying ClawdVault to $NETWORK..."

# Check tools
if ! command -v anchor &> /dev/null; then
    echo "❌ Anchor CLI not found. Install with: cargo install --git https://github.com/coral-xyz/anchor avm --locked && avm install latest && avm use latest"
    exit 1
fi

if ! command -v solana &> /dev/null; then
    echo "❌ Solana CLI not found. Install with: sh -c \"\$(curl -sSfL https://release.anza.xyz/stable/install)\""
    exit 1
fi

# Configure Solana
echo "📡 Configuring Solana for $NETWORK..."
if [ "$NETWORK" = "mainnet" ]; then
    solana config set --url https://api.mainnet-beta.solana.com
else
    solana config set --url https://api.devnet.solana.com
fi

# Check wallet
WALLET=$(solana address 2>/dev/null || echo "")
if [ -z "$WALLET" ]; then
    echo "❌ No wallet found. Create one with: solana-keygen new"
    exit 1
fi
echo "💰 Deployer wallet: $WALLET"

# Check balance
BALANCE=$(solana balance --lamports | cut -d' ' -f1)
MIN_BALANCE=5000000000  # 5 SOL
if [ "$BALANCE" -lt "$MIN_BALANCE" ]; then
    echo "⚠️  Low balance: $(echo "scale=4; $BALANCE / 1000000000" | bc) SOL"
    if [ "$NETWORK" = "devnet" ]; then
        echo "   Getting airdrop..."
        solana airdrop 2
        sleep 5
    else
        echo "   Need at least 5 SOL for deployment"
        exit 1
    fi
fi

# Build
echo "🔨 Building program..."
cd "$(dirname "$0")/.."
anchor build

# Get program keypair
PROGRAM_KEYPAIR="target/deploy/clawdvault-keypair.json"
if [ ! -f "$PROGRAM_KEYPAIR" ]; then
    echo "❌ Program keypair not found at $PROGRAM_KEYPAIR"
    exit 1
fi

PROGRAM_ID=$(solana-keygen pubkey "$PROGRAM_KEYPAIR")
echo "🔑 Program ID: $PROGRAM_ID"

# Update program ID in source files
echo "📝 Updating program ID in source files..."
sed -i.bak "s/declare_id!(\".*\")/declare_id!(\"$PROGRAM_ID\")/" programs/clawdvault/src/lib.rs
sed -i.bak "s/PROGRAM_ID = new PublicKey('.*')/PROGRAM_ID = new PublicKey('$PROGRAM_ID')/" app/src/lib/anchor/client.ts
sed -i.bak "s/clawdvault = \".*\"/clawdvault = \"$PROGRAM_ID\"/" Anchor.toml

# Rebuild with correct ID
echo "🔨 Rebuilding with correct program ID..."
anchor build

# Deploy
echo "🚀 Deploying to $NETWORK..."
if [ "$NETWORK" = "devnet" ]; then
    anchor deploy --provider.cluster devnet
else
    anchor deploy --provider.cluster mainnet
fi

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Program ID: $PROGRAM_ID"
echo "Network: $NETWORK"
echo ""
echo "Next steps:"
echo "1. Update .env.local with PROGRAM_ID=$PROGRAM_ID"
echo "2. Initialize the protocol: anchor run initialize"
echo "3. Test with the frontend"
echo ""
echo "🐺 LFG!"
