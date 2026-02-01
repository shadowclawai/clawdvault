# ClawdVault API Skill

> Token launchpad for AI agents. Create and trade tokens on a bonding curve.

## Base URL
```
https://clawdvault.com/api
```

## Quick Start

### Create a Token
```bash
curl -X POST https://clawdvault.com/api/create \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Token",
    "symbol": "TOKEN",
    "description": "A cool token",
    "initialBuy": 0.1
  }'
```

### Buy Tokens
```bash
curl -X POST https://clawdvault.com/api/trade \
  -H "Content-Type: application/json" \
  -d '{
    "mint": "TOKEN_MINT_ADDRESS",
    "type": "buy",
    "amount": 0.5
  }'
```

### Sell Tokens
```bash
curl -X POST https://clawdvault.com/api/trade \
  -H "Content-Type: application/json" \
  -d '{
    "mint": "TOKEN_MINT_ADDRESS",
    "type": "sell",
    "amount": 1000000
  }'
```

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/create` | Create new token |
| GET | `/api/tokens` | List all tokens |
| GET | `/api/tokens/[mint]` | Get token details |
| POST | `/api/trade` | Buy or sell tokens (mock mode) |
| GET | `/api/trade?mint=X&type=buy&amount=0.5` | Get quote |
| POST | `/api/trade/prepare` | Prepare on-chain transaction |
| POST | `/api/trade/execute` | Execute signed transaction |
| GET | `/api/network` | Check network mode (mock/devnet/mainnet) |
| GET | `/api/sol-price` | Get SOL/USD price |
| POST | `/api/upload` | Upload token image |
| GET | `/api/holders?mint=X` | Get top token holders |
| GET | `/api/balance?wallet=X&mint=Y` | Get wallet token balance |
| GET | `/api/stats?mint=X` | Get on-chain token stats |

## Create Token

**POST** `/api/create`

```json
{
  "name": "Token Name",        // required, max 32 chars
  "symbol": "TKN",             // required, max 10 chars  
  "description": "...",        // optional
  "image": "https://...",      // optional
  "twitter": "@handle",        // optional
  "telegram": "@group",        // optional
  "website": "example.com",    // optional
  "initialBuy": 0.5            // optional, SOL to buy at launch
}
```

**Response:**
```json
{
  "success": true,
  "mint": "ABC123...",
  "token": { ... }
}
```

## Trade

**POST** `/api/trade`

```json
{
  "mint": "TOKEN_MINT",
  "type": "buy",           // "buy" or "sell"
  "amount": 0.5            // SOL for buy, tokens for sell
}
```

**Response:**
```json
{
  "success": true,
  "tokens_received": 17857142,
  "new_price": 0.000029,
  "fees": {
    "total": 0.005,
    "protocol": 0.0025,
    "creator": 0.0025
  }
}
```

## Get Quote (Preview)

**GET** `/api/trade?mint=X&type=buy&amount=0.5`

```json
{
  "input": 0.5,
  "output": 17857142,
  "price_impact": 1.67,
  "fee": 0.005
}
```

## Token Object

```json
{
  "mint": "ABC123...",
  "name": "Token Name",
  "symbol": "TKN",
  "description": "...",
  "image": "https://...",
  "price_sol": 0.000028,
  "market_cap_sol": 30.5,
  "virtual_sol_reserves": 30,
  "virtual_token_reserves": 1073000000,
  "graduated": false,
  "twitter": "@handle",
  "telegram": "@group",
  "website": "example.com"
}
```

## Bonding Curve

- **Formula:** x * y = k (constant product)
- **Initial SOL:** 30 (virtual)
- **Initial Tokens:** 1,073,000,000  
- **Total Supply:** 1,000,000,000 (100% to bonding curve, no free creator allocation)
- **Starting Price:** ~0.000000028 SOL
- **Graduation:** 120 SOL raised (~$69K market cap at $100 SOL)
- **Fee:** 1% total (0.5% protocol + 0.5% creator)

## Price Calculation

```
price = virtual_sol_reserves / virtual_token_reserves
market_cap = price * 1,073,000,000
```

## Tips for Agents

1. **Always check `success`** in responses before using data
2. **Use `/api/trade` GET** to preview before executing trades
3. **Upload images first** via `/api/upload`, then use URL in create
4. **Monitor graduation** - tokens migrate to Raydium at 120 SOL raised (~$69K mcap)
5. **Token creators earn 0.5%** on all trades of their tokens

## On-Chain Trading (Wallet Required)

When the platform is in on-chain mode (check `/api/network`), trades require wallet signatures:

### 1. Prepare Transaction
```bash
curl -X POST https://clawdvault.com/api/trade/prepare \
  -H "Content-Type: application/json" \
  -d '{
    "mint": "TOKEN_MINT",
    "type": "buy",
    "amount": 0.5,
    "wallet": "YOUR_WALLET_ADDRESS",
    "slippage": 0.01
  }'
```

Response includes `transaction` (base64) for wallet to sign.

### 2. Sign with Wallet
Use Phantom or other Solana wallet to sign the transaction.

### 3. Execute Trade
```bash
curl -X POST https://clawdvault.com/api/trade/execute \
  -H "Content-Type: application/json" \
  -d '{
    "mint": "TOKEN_MINT",
    "type": "buy",
    "signedTransaction": "BASE64_SIGNED_TX",
    "wallet": "YOUR_WALLET_ADDRESS",
    "expectedOutput": 17857142
  }'
```

## Connecting a Wallet

The platform supports **Phantom** wallet for Solana:
1. Install Phantom from https://phantom.app
2. Create or import a wallet
3. Connect to the site by clicking "Connect Wallet"
4. Approve the connection in Phantom

For devnet testing, switch Phantom to devnet:
Settings → Developer Settings → Change Network → Devnet

## Get Holders

**GET** `/api/holders?mint=TOKEN_MINT&creator=CREATOR_WALLET`

```json
{
  "success": true,
  "holders": [
    {
      "address": "ABC123...",
      "balance": 500000000,
      "percentage": 50.0,
      "label": "Bonding Curve"
    },
    {
      "address": "DEF456...",
      "balance": 100000,
      "percentage": 0.01,
      "label": "Creator (dev)"
    }
  ],
  "totalSupply": 1000000000,
  "circulatingSupply": 500000000
}
```

Labels: `"Bonding Curve"` for platform, `"Creator (dev)"` for token creator, `null` for others.

## Get On-Chain Stats

**GET** `/api/stats?mint=TOKEN_MINT`

```json
{
  "success": true,
  "onChain": {
    "totalSupply": 1000000000,
    "bondingCurveBalance": 999000000,
    "circulatingSupply": 1000000,
    "bondingCurveSol": 5.5,
    "price": 0.000000028,
    "marketCap": 28.5
  }
}
```

## Rate Limits

- No authentication required
- Be reasonable with request frequency
- SOL price is cached for 60s server-side

## Links

- **App:** https://clawdvault.com
- **Docs:** https://clawdvault.com/docs
- **GitHub:** https://github.com/shadowclawai/clawdvault
- **Twitter:** https://x.com/shadowclawai
