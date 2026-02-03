# ClawdVault Program Verification Guide

## Overview

This document explains how to create and verify builds for the ClawdVault Solana program, enabling verification on Solana Explorer and trust in wallets like Phantom.

**Program ID:** `GUyF2TVe32Cid4iGVt2F6wPYDhLSVmTUZBj2974outYM`

## Why Verification Matters

- Shows as "Verified" in Solana Explorer
- Phantom/Blowfish won't show "malicious dApp" warnings
- Users can trust the deployed code matches the source
- Security researchers can audit the actual deployed binary

## Build Environment

| Component | Version |
|-----------|---------|
| Anchor CLI | 0.32.1 |
| Solana Program | 2.3.0 |
| Docker Image | `solanafoundation/anchor:v0.32.1` |

## Creating a Verifiable Build

### Method 1: `anchor build --verifiable` (RECOMMENDED)

```bash
cd ~/.openclaw/workspace/clawdvault
anchor build --verifiable
```

This:
- Uses Docker image `solanafoundation/anchor:v0.32.1`
- Creates deterministic build in `target/verifiable/clawdvault.so`
- Works correctly with Anchor 0.32.x + Solana 2.3.0

### Method 2: `solana-verify build` (DOES NOT WORK)

```bash
# ❌ This fails - don't use!
solana-verify build --library-name clawdvault
```

**Why it fails:** `solana-verify` can't find a Docker image for Solana 2.3.0 and falls back to 1.17.6, causing massive dependency conflicts with Anchor 0.32.x.

Even specifying the image directly fails due to `--frozen` lockfile issues:
```bash
# Also fails
solana-verify build --library-name clawdvault --base-image solanafoundation/solana-verifiable-build:2.3.0
```

## Deployment & Verification Process

### Step 1: Create Verifiable Build

```bash
anchor build --verifiable
```

### Step 2: Get Build Hash

```bash
solana-verify get-executable-hash target/verifiable/clawdvault.so
# Output: 1315df554f39f1d22ca8dde321eeb3dcc2237d76e1b8f7fff9d87cdfc8b3d2fb
```

### Step 3: Deploy the Verifiable Build

**IMPORTANT:** Deploy the `target/verifiable/clawdvault.so`, NOT `target/deploy/clawdvault.so`!

```bash
# Deploy to mainnet (requires upgrade authority)
solana program deploy target/verifiable/clawdvault.so \
  --program-id GUyF2TVe32Cid4iGVt2F6wPYDhLSVmTUZBj2974outYM \
  --url mainnet-beta \
  --keypair <YOUR_KEYPAIR>
```

### Step 4: Verify Against Repository

```bash
# Local verification
solana-verify verify-from-repo \
  --program-id GUyF2TVe32Cid4iGVt2F6wPYDhLSVmTUZBj2974outYM \
  --url mainnet-beta \
  https://github.com/shadowclawai/clawdvault

# When prompted, upload verification data onchain
```

### Step 5: Submit for Remote Verification

```bash
# Trigger OtterSec API verification
solana-verify remote submit-job \
  --program-id GUyF2TVe32Cid4iGVt2F6wPYDhLSVmTUZBj2974outYM \
  --uploader <PROGRAM_AUTHORITY_PUBKEY>

# Check status
solana-verify remote get-job-status \
  --program-id GUyF2TVe32Cid4iGVt2F6wPYDhLSVmTUZBj2974outYM
```

## Current Status

| Network | Deployed Hash | Verifiable Build Hash | Match |
|---------|---------------|----------------------|-------|
| Mainnet | `06a229aa83b0fd4299186d447150f26c6123669ee14c42c9b766cdc1379672e3` | `06a229aa83b0fd4299186d447150f26c6123669ee14c42c9b766cdc1379672e3` | ✅ Yes |

**Status:** Verified build deployed! Submit for remote verification to show as verified in explorers.

## Troubleshooting

### "Unable to find docker image for Solana version X"

This happens with `solana-verify`. Use `anchor build --verifiable` instead.

### "Program is not deployed" Error

If `solana-verify` says the program isn't deployed but `solana program show` works, try specifying the full RPC URL:
```bash
solana-verify get-program-hash GUyF2TVe32Cid4iGVt2F6wPYDhLSVmTUZBj2974outYM \
  --url https://api.mainnet-beta.solana.com
```

### Hash Mismatch After Deployment

Ensure you deployed `target/verifiable/clawdvault.so`, not `target/deploy/clawdvault.so`. Regular builds are not deterministic.

### Platform Warning (arm64 vs amd64)

```
WARNING: The requested image's platform (linux/amd64) does not match...
```

This is normal on M1/M2 Macs. The build still works via emulation (just slower).

### Anchor Version Warnings

```
WARNING: `anchor-lang` version(0.32.0) and the current CLI version(0.32.1) don't match.
```

This can be fixed by updating `Cargo.toml`:
```toml
anchor-lang = { version = "0.32.1", features = ["init-if-needed"] }
```

Or adding to `Anchor.toml`:
```toml
[toolchain]
anchor_version = "0.32.0"
```

## References

- [Solana Verified Builds Guide](https://solana.com/docs/programs/verified-builds)
- [OtterSec Verify API](https://github.com/otter-sec/solana-verified-programs-api)
- [Ellipsis Labs Verifiable Build](https://github.com/Ellipsis-Labs/solana-verifiable-build)
- [Anchor Verifiable Builds](https://www.anchor-lang.com/docs/verifiable-builds)

## Security Contact

The program includes `solana-security-txt` for security researcher contact information.
