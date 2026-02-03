# ClawdVault API Reference

Base URL: `https://clawdvault.com`

---

## Quick Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| **Tokens** |
| `POST` | `/api/token/prepare-create` | Prepare token creation tx for wallet signing |
| `POST` | `/api/token/execute-create` | Execute signed token creation |
| `GET` | `/api/tokens` | List all tokens |
| `GET` | `/api/tokens/{mint}` | Get token details + recent trades |
| `GET` | `/api/metadata/{mint}` | Metaplex-compatible metadata JSON |
| **Trading** |
| `GET` | `/api/trade` | Get price quote |
| `POST` | `/api/trade/prepare` | Prepare trade tx for wallet signing |
| `POST` | `/api/trade/execute` | Execute signed trade |
| `GET` | `/api/trades` | Get trade history for a token |
| **Price Data** |
| `GET` | `/api/candles` | OHLCV candle data for charting |
| `GET` | `/api/stats` | On-chain bonding curve stats |
| `GET` | `/api/holders` | Top token holders |
| `GET` | `/api/balance` | Get wallet's token balance |
| `GET` | `/api/sol-price` | Current SOL/USD price |
| `GET` | `/api/network` | Network status + program info |
| **Graduation** |
| `GET` | `/api/graduate` | Check token graduation status |
| `POST` | `/api/graduate` | Trigger Raydium migration (admin) |
| **Chat** |
| `GET` | `/api/chat` | Get chat messages for token |
| `POST` | `/api/chat` | Send chat message |
| `POST` | `/api/reactions` | Add emoji reaction |
| `DELETE` | `/api/reactions` | Remove emoji reaction |
| **User** |
| `GET` | `/api/profile` | Get user profile |
| `POST` | `/api/profile` | Update username/avatar |
| `POST` | `/api/auth/session` | Create JWT session token |
| `GET` | `/api/auth/session` | Verify session token |
| **Sync** |
| `GET` | `/api/sync/trades` | Sync on-chain trades to DB |
| `POST` | `/api/sync/trades` | Force sync for specific token |
| **Utility** |
| `POST` | `/api/upload` | Upload image to storage |

---

## Tokens

### Create Token

Two-step non-custodial flow where user signs the transaction.

#### Step 1: Prepare

`POST /api/token/prepare-create`

```json
{
  "creator": "YourWalletAddress...",
  "name": "Wolf Coin",
  "symbol": "WOLF",
  "uri": "https://example.com/metadata.json",
  "initialBuy": 0.5
}
```

**Response:**
```json
{
  "success": true,
  "transaction": "base64_encoded_tx...",
  "mint": "NewMintAddress...",
  "programId": "GUyF2TVe32Cid4iGVt2F6wPYDhLSVmTUZBj2974outYM",
  "network": "mainnet-beta",
  "initialBuy": {
    "sol": 0.5,
    "estimatedTokens": 17500000
  }
}
```

#### Step 2: Sign & Execute

`POST /api/token/execute-create`

```json
{
  "signedTransaction": "base64_signed_tx...",
  "mint": "NewMintAddress...",
  "creator": "YourWalletAddress...",
  "name": "Wolf Coin",
  "symbol": "WOLF",
  "description": "The coin of the pack",
  "image": "https://...",
  "twitter": "@wolfcoin",
  "initialBuy": {
    "solAmount": 0.5,
    "estimatedTokens": 17500000
  }
}
```

### List Tokens

`GET /api/tokens`

| Param | Default | Description |
|-------|---------|-------------|
| `page` | 1 | Page number |
| `per_page` | 20 | Results per page |
| `sort` | created_at | Sort field |
| `graduated` | - | Filter: true/false |

**Response:**
```json
{
  "tokens": [...],
  "total": 42,
  "page": 1,
  "per_page": 20
}
```

### Get Token

`GET /api/tokens/{mint}`

Returns token details and recent trades.

**Response:**
```json
{
  "token": {
    "mint": "...",
    "name": "Wolf Coin",
    "symbol": "WOLF",
    "price_sol": 0.000028,
    "market_cap": 30,
    "virtual_sol_reserves": 30,
    "virtual_token_reserves": 1073000000,
    "graduated": false,
    ...
  },
  "trades": [...]
}
```

### Get Metadata

`GET /api/metadata/{mint}`

Returns Metaplex-compatible JSON for on-chain token URI.

---

## Trading

### Get Quote

`GET /api/trade?mint=...&type=buy&amount=1`

| Param | Required | Description |
|-------|----------|-------------|
| `mint` | ✅ | Token mint address |
| `type` | ✅ | "buy" or "sell" |
| `amount` | ✅ | SOL (buy) or tokens (sell) |

**Response:**
```json
{
  "input": 1.0,
  "output": 35000000,
  "price_impact": 3.2,
  "fee": 0.01,
  "current_price": 0.000028
}
```

### Prepare Trade

`POST /api/trade/prepare`

```json
{
  "mint": "TokenMintAddress...",
  "type": "buy",
  "amount": 0.5,
  "wallet": "YourWalletAddress...",
  "slippage": 0.01
}
```

**Response:**
```json
{
  "success": true,
  "transaction": "base64_encoded_tx...",
  "type": "buy",
  "input": { "sol": 0.5, "fee": 0.005 },
  "output": { "tokens": 17500000, "minTokens": 17325000 },
  "priceImpact": 1.67,
  "currentPrice": 0.000028,
  "onChain": true
}
```

### Execute Trade

`POST /api/trade/execute`

```json
{
  "signedTransaction": "base64_signed_tx...",
  "mint": "TokenMintAddress...",
  "type": "buy",
  "wallet": "YourWalletAddress..."
}
```

> **Security Note:** Trade amounts are parsed from the on-chain `TradeEvent` logs, not from client input. This prevents spoofing - you cannot lie about trade amounts.

**Response:**
```json
{
  "success": true,
  "signature": "5xyz...",
  "explorer": "https://explorer.solana.com/tx/5xyz...",
  "slot": 123456789,
  "blockTime": 1706886400,
  "trade": {
    "mint": "TokenMintAddress...",
    "trader": "YourWalletAddress...",
    "type": "buy",
    "solAmount": 0.5,
    "tokenAmount": 17500000,
    "protocolFee": 0.0025,
    "creatorFee": 0.0025
  }
}
```

The `trade` object contains verified on-chain data parsed from the program's `TradeEvent` log.

### Get Trade History

`GET /api/trades?mint=...`

| Param | Default | Description |
|-------|---------|-------------|
| `mint` | - | Token mint (required) |
| `limit` | 50 | Max results |
| `before` | - | Cursor (ISO date) |

---

## Price Data

### Get Candles (OHLCV)

`GET /api/candles?mint=...&interval=5m&limit=100`

Returns OHLCV candle data for charting. **This is the recommended source of truth for price display.**

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `mint` | string | required | Token mint address |
| `interval` | string | `5m` | Candle interval: `1m`, `5m`, `15m`, `1h`, `1d` |
| `limit` | number | `100` | Number of candles (max 1000) |

**Response:**
```json
{
  "mint": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  "interval": "5m",
  "candles": [
    {
      "time": 1706918400,
      "open": 0.000028,
      "high": 0.000032,
      "low": 0.000027,
      "close": 0.000031,
      "volume": 2.5
    }
  ]
}
```

**Candle fields:**
- `time` - Unix timestamp (seconds)
- `open` - Opening price in SOL
- `high` - Highest price in interval
- `low` - Lowest price in interval  
- `close` - Closing price in SOL (use this for current price)
- `volume` - Trading volume in SOL

**Getting current price:**
```bash
# Get the most recent candle's close price
curl "https://clawdvault.com/api/candles?mint=YOUR_MINT&interval=1m&limit=1"
```

The last candle's `close` price is the most recent trade price.

---

## Graduation (Raydium Migration)

When a token's bonding curve reaches 120 SOL in reserves, it becomes eligible for "graduation" - migration to a Raydium liquidity pool for traditional AMM trading.

### Check Graduation Status

`GET /api/graduate?mint=...`

**Response:**
```json
{
  "success": true,
  "data": {
    "mint": "TokenMintAddress...",
    "graduated": true,
    "migratedToRaydium": false,
    "realSolReserves": "120000000000",
    "realTokenReserves": "200000000000000",
    "canMigrate": true
  }
}
```

| Field | Description |
|-------|-------------|
| `graduated` | Whether curve hit 120 SOL threshold |
| `migratedToRaydium` | Whether Raydium pool was created |
| `canMigrate` | `true` if graduated but not yet migrated |

### Trigger Migration (Admin Only)

`POST /api/graduate`

> **Note:** This endpoint requires admin authentication and is disabled in production unless `ENABLE_GRADUATION_API=true` is set.

```json
{
  "mint": "TokenMintAddress..."
}
```

**Response (success):**
```json
{
  "success": true,
  "data": {
    "mint": "TokenMintAddress...",
    "releaseSignature": "5xyz...",
    "migrationWallet": "MigrationWalletAddress...",
    "solReleased": "120000000000",
    "tokensReleased": "200000000000000",
    "raydiumPool": "PoolIdAddress...",
    "lpMint": "LpMintAddress...",
    "poolTxSignature": "6abc...",
    "message": "Token graduated to Raydium successfully!"
  }
}
```

---

## On-Chain Data

### Get Stats

`GET /api/stats?mint=...`

Returns on-chain bonding curve state.

**Response:**
```json
{
  "success": true,
  "mint": "...",
  "onChain": {
    "totalSupply": 1000000000,
    "bondingCurveBalance": 900000000,
    "circulatingSupply": 100000000,
    "bondingCurveSol": 5.5,
    "virtualSolReserves": 35.5,
    "virtualTokenReserves": 900000000,
    "price": 0.000039,
    "marketCap": 39,
    "graduated": false
  }
}
```

### Get Holders

`GET /api/holders?mint=...&creator=...`

Returns top 10 token holders with labels.

### Get Balance

`GET /api/balance?wallet=...&mint=...`

Returns a wallet's token balance.

### Get SOL Price

`GET /api/sol-price`

Returns current SOL/USD price (cached 60s).

### Get Network Status

`GET /api/network`

Returns network info and Anchor program status.

---

## Chat

### Get Messages

`GET /api/chat?mint=...`

| Param | Default | Description |
|-------|---------|-------------|
| `mint` | - | Token mint (required) |
| `limit` | 50 | Max messages |
| `before` | - | Cursor (ISO date) |

### Send Message

`POST /api/chat`

**Headers:**
- `Authorization: Bearer <session_token>` OR
- `X-Wallet: <wallet>` + `X-Signature: <signature>`

**Body:**
```json
{
  "mint": "TokenMint...",
  "message": "Hello!",
  "replyTo": "optional_message_id"
}
```

### Add Reaction

`POST /api/reactions`

```json
{
  "messageId": "msg_id",
  "emoji": "🔥"
}
```

### Remove Reaction

`DELETE /api/reactions?messageId=...&emoji=🔥`

Requires `X-Wallet` and `X-Signature` headers.

---

## User Profiles

### Get Profile

`GET /api/profile?wallet=...`

### Update Profile

`POST /api/profile`

Requires wallet signature.

```json
{
  "username": "wolfpack",
  "avatar": "https://..."
}
```

Username: 2-20 chars, alphanumeric + `_` + `-`

---

## Authentication

### Create Session

`POST /api/auth/session`

**Headers:**
- `X-Wallet: <wallet>`
- `X-Signature: <signature>`

Sign: `{ "action": "create_session" }`

**Response:**
```json
{
  "success": true,
  "token": "jwt...",
  "expiresIn": 86400,
  "wallet": "..."
}
```

### Verify Session

`GET /api/auth/session`

**Headers:**
- `Authorization: Bearer <token>`

---

## Sync (On-Chain Data Recovery)

Sync endpoints fetch trades directly from on-chain transactions and add any missing ones to the database. Useful for data recovery or catching up after downtime.

### Sync Recent Trades

`GET /api/sync/trades?limit=100`

| Param | Default | Description |
|-------|---------|-------------|
| `limit` | 100 | Max transactions to check (max 500) |
| `mint` | - | Filter to specific token |

**Response:**
```json
{
  "success": true,
  "checked": 100,
  "synced": 3,
  "skipped": 95,
  "errors": 2,
  "syncedSignatures": ["5xyz...", "6abc...", "7def..."]
}
```

### Force Sync Token

`POST /api/sync/trades`

```json
{
  "mint": "TokenMintAddress..."
}
```

Syncs up to 500 recent trades for a specific token.

---

## Upload

### Upload Image

`POST /api/upload`

**Content-Type:** `multipart/form-data`

| Field | Description |
|-------|-------------|
| `file` | Image file (PNG, JPEG, GIF, WebP, max 5MB) |

**Response:**
```json
{
  "success": true,
  "url": "https://.../token-images/uuid.png",
  "filename": "uuid.png"
}
```

---

## Error Responses

All errors return:
```json
{
  "success": false,
  "error": "Error message"
}
```

Common HTTP codes:
- `400` - Bad request / validation error
- `401` - Authentication required
- `403` - Forbidden (e.g., mock trades in prod)
- `404` - Not found
- `500` - Server error

---

## Program Info

- **Program ID:** `GUyF2TVe32Cid4iGVt2F6wPYDhLSVmTUZBj2974outYM`
- **Network:** Mainnet (production) / Devnet (dev)
- **Trading Fee:** 1% (0.5% protocol + 0.5% creator)
- **Initial Reserves:** 30 SOL / 1.073B tokens
- **Graduation:** ~120 SOL reserves (~$69K market cap)
