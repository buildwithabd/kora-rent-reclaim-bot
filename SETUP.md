# Setup Guide

Complete installation and configuration guide for the Kora Rent Reclaim Bot.

---

## Prerequisites

Before you begin, ensure you have:

- ✅ Node.js 18 or higher ([Download](https://nodejs.org))
- ✅ npm (comes with Node.js)
- ✅ A code editor (VS Code recommended)
- ✅ Basic command line knowledge
- ✅ A Solana wallet keypair

---

## Installation Steps

### Step 1: Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/kora-rent-reclaim-bot.git
cd kora-rent-reclaim-bot
```

### Step 2: Install Dependencies

```bash
npm install
```

This installs all required packages:

- `@solana/web3.js` - Solana blockchain interaction
- `express` - Web dashboard server
- `winston` - Logging
- `node-cron` - Scheduled tasks
- `node-telegram-bot-api` - Telegram integration
- `commander` - CLI framework
- `bs58` - Base58 encoding
- TypeScript and type definitions

### Step 3: Create Configuration File

```bash
# Copy the template
cp .env.example .env

# Edit it with your preferred editor
notepad .env    # Windows
nano .env       # Linux/Mac
code .env       # VS Code
```

---

## Configuration

### Required Environment Variables

Open `.env` and configure these **required** fields:

```env
# ============================================
# REQUIRED CONFIGURATION
# ============================================

# Solana RPC endpoint
# Devnet (for testing): https://api.devnet.solana.com
# Mainnet (production): https://api.mainnet-beta.solana.com
SOLANA_RPC_URL=https://api.devnet.solana.com

# Your Kora fee payer's private key (base58 encoded)
# This is the wallet that sponsors transactions
KORA_FEEPAYER_PRIVATE_KEY=YOUR_BASE58_PRIVATE_KEY_HERE

# Treasury wallet public key
# This wallet will receive all reclaimed rent
TREASURY_WALLET=YOUR_PUBLIC_KEY_HERE
```

### Optional Environment Variables

These have sensible defaults but can be customized:

```env
# ============================================
# OPTIONAL CONFIGURATION
# ============================================

# Safety Thresholds
# -----------------
# Minimum lamports in an account before bothering to reclaim
# Default: 1000000 (0.001 SOL)
# Prevents wasting gas fees on micro-reclaims
MIN_RENT_THRESHOLD=1000000

# Days of inactivity before an account is eligible for reclaim
# Default: 7 days
# Higher = more conservative (safer)
# Lower = more aggressive (faster reclaim)
ACCOUNT_AGE_THRESHOLD=7

# Cron Service Configuration
# ---------------------------
# Schedule in cron format: minute hour day month weekday
# Default: "0 */6 * * *" (every 6 hours)
# Examples:
#   "0 */4 * * *"  = every 4 hours
#   "0 0 * * *"    = daily at midnight
#   "0 */1 * * *"  = every hour
CRON_SCHEDULE=0 */6 * * *

# Run a scan immediately when cron service starts
# Default: true
RUN_INITIAL_SCAN=true

# Telegram Bot Configuration (optional)
# --------------------------------------
# Get token from @BotFather on Telegram
TELEGRAM_BOT_TOKEN=

# Your chat ID from @userinfobot
TELEGRAM_CHAT_ID=

# Dashboard Configuration
# -----------------------
# Port for web dashboard
# Default: 3000
DASHBOARD_PORT=3000
```

---

## Getting Your Wallet Keys

### Option 1: Generate a New Test Wallet

If you're testing on devnet, generate a fresh wallet:

**Create generator script:**

```bash
notepad generate-wallet.mjs
```

**Paste this code:**

```javascript
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import fs from "fs";

const keypair = Keypair.generate();

fs.writeFileSync(
  "test-wallet.json",
  JSON.stringify(Array.from(keypair.secretKey))
);

console.log("\n=== New Wallet Generated ===\n");
console.log("Public Key (Treasury):");
console.log(keypair.publicKey.toBase58());
console.log("\nBase58 Private Key (Fee Payer):");
console.log(bs58.encode(keypair.secretKey));
console.log("\n✅ Saved to: test-wallet.json\n");
```

**Run it:**

```bash
node generate-wallet.mjs
```

**Copy the output:**

- `Public Key` → goes in `TREASURY_WALLET`
- `Base58 Private Key` → goes in `KORA_FEEPAYER_PRIVATE_KEY`

**Clean up:**

```bash
del generate-wallet.mjs    # Windows
rm generate-wallet.mjs     # Linux/Mac
```

### Option 2: Convert Existing Solana Wallet

If you have an existing Solana CLI wallet (`.json` file):

**Create converter:**

```bash
notepad convert-wallet.mjs
```

**Paste:**

```javascript
import fs from "fs";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";

const walletPath = process.argv[2] || "id.json";
const keypairJson = JSON.parse(fs.readFileSync(walletPath, "utf8"));
const keypair = Keypair.fromSecretKey(new Uint8Array(keypairJson));

console.log("\n=== Wallet Conversion ===\n");
console.log("Public Key:");
console.log(keypair.publicKey.toBase58());
console.log("\nBase58 Private Key:");
console.log(bs58.encode(keypair.secretKey));
console.log("\n");
```

**Run it:**

```bash
# Default: converts id.json
node convert-wallet.mjs

# Or specify a file:
node convert-wallet.mjs path/to/your-wallet.json
```

**Clean up:**

```bash
del convert-wallet.mjs    # Windows
rm convert-wallet.mjs     # Linux/Mac
```

---

## Funding Your Wallet (Devnet Only)

If testing on devnet, you need SOL:

### Method 1: Web Faucet

1. Go to https://faucet.solana.com
2. Paste your `TREASURY_WALLET` address
3. Click "Confirm Airdrop"
4. Wait ~30 seconds
5. Receive 2 SOL (free test tokens)

### Method 2: CLI Faucet

If you have Solana CLI installed:

```bash
solana airdrop 2 YOUR_PUBLIC_KEY --url devnet
```

---

## Verification

Test that everything is configured correctly:

### Test 1: Configuration Info

```bash
npx tsx src/cli.ts info
```

**Expected output:**

```
ℹ️   Configuration

  RPC URL              : https://api.devnet.solana.com
  Treasury             : YOUR_PUBLIC_KEY
  Min rent threshold   : 0.001000 SOL
  Inactivity threshold : 7 days
```

If you see this, configuration is ✅ **correct**!

### Test 2: Scan

```bash
npx tsx src/cli.ts scan
```

**Expected output (for fresh wallet):**

```
🔍  Scanning …

📊  0 sponsored accounts found

✅  Nothing to reclaim right now.
```

This is normal! Your wallet hasn't sponsored any accounts yet.

### Test 3: Stats

```bash
npx tsx src/cli.ts stats
```

**Should show all zeros** - this is correct for a new wallet.

### Test 4: Dashboard

```bash
npx tsx src/dashboard/server.ts
```

Open http://localhost:3000 in your browser.

**Should see:**

- Dashboard loads
- All stats show 0
- "Scan" button works
- No errors in console

If all four tests pass, you're ready! ✅

---

## Optional: Telegram Bot Setup

If you want Telegram integration:

### Step 1: Create Bot

1. Open Telegram
2. Search for [@BotFather](https://t.me/botfather)
3. Send `/newbot`
4. Follow prompts to name your bot
5. Copy the **token** you receive

Example token: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`

### Step 2: Get Your Chat ID

1. Search for [@userinfobot](https://t.me/userinfobot)
2. Send `/start`
3. Copy your **ID** number

Example ID: `987654321`

### Step 3: Update .env

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=987654321
```

### Step 4: Test

```bash
npx tsx src/telegram-bot.ts
```

Send `/start` to your bot in Telegram. You should get a welcome message!

---

## Troubleshooting

### Issue: "KORA_FEEPAYER_PRIVATE_KEY is not set"

**Solution:** You didn't create `.env` or it's empty.

```bash
# Make sure .env exists
ls -la .env    # Linux/Mac
dir .env       # Windows

# If missing, copy template
cp .env.example .env

# Then edit with your values
```

### Issue: "provided secretKey is invalid"

**Solution:** Your private key format is wrong.

- Must be **base58 encoded**
- Not raw JSON array
- Use the conversion scripts above

### Issue: "Cannot find module @solana/web3.js"

**Solution:** Dependencies not installed.

```bash
npm install
```

### Issue: "Connection refused" / "Failed to fetch"

**Solution:** RPC endpoint down or rate-limited.

Try a different RPC:

- Devnet: `https://api.devnet.solana.com`
- Or use a premium provider like Helius, QuickNode

### Issue: Dashboard won't start (port in use)

**Solution:** Port 3000 is occupied.

Change in `.env`:

```env
DASHBOARD_PORT=3001
```

Or stop the process using port 3000.

---

## Next Steps

Once setup is complete:

1. ✅ **Test all interfaces** (CLI, dashboard, cron, telegram)
2. ✅ **Review logs** in `logs/` directory
3. ✅ **Read documentation** (README.md, KORA_EXPLAINED.md)
4. ✅ **Customize thresholds** for your use case
5. ✅ **Deploy to production** (see deployment guides)

---

## Production Deployment

For production use on mainnet:

### Security Checklist

- [ ] Use a dedicated wallet for fee payer
- [ ] Store private key securely (environment variable, not hardcoded)
- [ ] Use a premium RPC endpoint (not public devnet URL)
- [ ] Set conservative `ACCOUNT_AGE_THRESHOLD` (30+ days)
- [ ] Set meaningful `MIN_RENT_THRESHOLD` (0.005+ SOL)
- [ ] Enable monitoring and alerts
- [ ] Test thoroughly on devnet first
- [ ] Start with dry-run mode
- [ ] Monitor logs closely for first week

### Recommended Configuration (Mainnet)

```env
SOLANA_RPC_URL=https://your-premium-rpc.com
KORA_FEEPAYER_PRIVATE_KEY=your_production_key
TREASURY_WALLET=your_secure_treasury

# Conservative settings for production
MIN_RENT_THRESHOLD=5000000      # 0.005 SOL minimum
ACCOUNT_AGE_THRESHOLD=30        # 30 days inactivity
CRON_SCHEDULE=0 0 * * *         # Daily at midnight
```

---

## Support

If you encounter issues:

1. Check the [Troubleshooting](#troubleshooting) section
2. Review log files in `logs/`
3. Ensure Node.js version is 18+
4. Verify `.env` configuration
5. Test with dry-run mode first

---

_Setup complete! You're ready to reclaim rent._ 🚀
