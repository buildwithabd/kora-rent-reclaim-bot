import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import { RentReclaimer } from "./core/RentReclaimer.js";
import { Config } from "./types.js";
import { logger } from "./utils/logger.js";
import { lamportsToSol } from "./utils/solana.js";

dotenv.config();

// ----------------------------------------------------------
function loadConfig(): Config {
  const key = process.env.KORA_FEEPAYER_PRIVATE_KEY || "";
  const treasury = process.env.TREASURY_WALLET || "";
  const token = process.env.TELEGRAM_BOT_TOKEN || "";

  if (!key) throw new Error("KORA_FEEPAYER_PRIVATE_KEY is not set");
  if (!treasury) throw new Error("TREASURY_WALLET is not set");
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");

  return {
    rpcUrl: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    feePayerPrivateKey: key,
    treasuryWallet: treasury,
    telegramBotToken: token,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
    minRentThreshold: Number(process.env.MIN_RENT_THRESHOLD || "1000000"),
    accountAgeThreshold: Number(process.env.ACCOUNT_AGE_THRESHOLD || "7"),
  };
}

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------
function shortAddr(addr: string): string {
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

// ----------------------------------------------------------
async function main() {
  const config = loadConfig();
  const reclaimer = new RentReclaimer(config);
  const bot = new TelegramBot(config.telegramBotToken!, { polling: true });

  logger.info("Telegram bot started");

  // --- /start ---
  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      `🤖 *Kora Rent Reclaim Bot*

I monitor accounts sponsored by your Kora node and help you reclaim locked rent.

*Commands:*
/scan — find reclaimable accounts
/reclaim — scan + reclaim rent
/stats — current statistics
/info — configuration
/help — this message`,
      { parse_mode: "Markdown" }
    );
  });

  // --- /help ---
  bot.onText(/\/help/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      `📚 *Help*

/scan      – Read-only scan for reclaimable accounts
/reclaim   – Scan and execute reclaim transactions
/stats     – Aggregated statistics
/info      – Show current configuration
/help      – This message`,
      { parse_mode: "Markdown" }
    );
  });

  // --- /scan ---
  bot.onText(/\/scan/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, "🔍 Scanning …");

    try {
      const sponsored = await reclaimer.getSponsoredAccounts();
      const reclaimable = await reclaimer.identifyReclaimableAccounts(
        sponsored
      );

      if (reclaimable.length === 0) {
        return bot.sendMessage(chatId, "✅ No reclaimable accounts right now.");
      }

      const total = reclaimable.reduce((s, a) => s + a.estimatedRent, 0);
      let text =
        `📊 *Scan Results*\n` +
        `Sponsored: ${sponsored.length} | Reclaimable: ${reclaimable.length}\n` +
        `Estimated total: ${lamportsToSol(total).toFixed(6)} SOL\n\n`;

      // Show up to 8 accounts
      reclaimable.slice(0, 8).forEach((a, i) => {
        text +=
          `${i + 1}\\. \`${shortAddr(a.address)}\`\n` +
          `   💰 ${lamportsToSol(a.estimatedRent).toFixed(6)} SOL — ${
            a.reason
          }\n`;
      });

      if (reclaimable.length > 8)
        text += `\n_…and ${reclaimable.length - 8} more_\n`;

      text += `\nRun /reclaim to recover these funds.`;
      await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
    } catch (e) {
      logger.error("/scan failed", { error: e });
      await bot.sendMessage(chatId, `❌ Error: ${e}`);
    }
  });

  // --- /reclaim ---
  bot.onText(/\/reclaim/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, "💸 Scanning and reclaiming …");

    try {
      const { scanned, reclaimable, results } =
        await reclaimer.runScanAndReclaim();

      const ok = results.filter((r) => r.success);
      const fail = results.filter((r) => !r.success);
      const total = ok.reduce((s, r) => s + r.reclaimedAmount, 0);

      let text =
        `💸 *Reclaim Results*\n` +
        `Scanned: ${scanned.length} | Reclaimable: ${reclaimable.length}\n` +
        `✅ ${ok.length} succeeded | ❌ ${fail.length} failed\n` +
        `Total reclaimed: ${lamportsToSol(total).toFixed(6)} SOL\n\n`;

      ok.slice(0, 5).forEach((r, i) => {
        text +=
          `✅ ${i + 1}\\. \`${shortAddr(r.accountAddress)}\` — ` +
          `${lamportsToSol(r.reclaimedAmount).toFixed(6)} SOL\n`;
      });

      if (ok.length > 5) text += `_…and ${ok.length - 5} more_\n`;
      if (fail.length)
        text += `\n⚠️ ${fail.length} reclaim(s) failed — check logs.\n`;

      text += `\nTreasury: \`${shortAddr(reclaimer.getTreasuryAddress())}\``;
      await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
    } catch (e) {
      logger.error("/reclaim failed", { error: e });
      await bot.sendMessage(chatId, `❌ Error: ${e}`);
    }
  });

  // --- /stats ---
  bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const sponsored = await reclaimer.getSponsoredAccounts();
      const reclaimable = await reclaimer.identifyReclaimableAccounts(
        sponsored
      );
      const stats = reclaimer.getStats(sponsored, reclaimable);

      const text =
        `📈 *Statistics*\n\n` +
        `Monitored     : ${stats.totalAccountsMonitored}\n` +
        `Rent locked   : ${lamportsToSol(stats.totalRentLocked).toFixed(
          6
        )} SOL\n` +
        `Lifetime recl.: ${lamportsToSol(stats.totalRentReclaimed).toFixed(
          6
        )} SOL\n` +
        `Reclaimable   : ${stats.reclaimableAccounts} (${lamportsToSol(
          stats.estimatedReclaimable
        ).toFixed(6)} SOL)\n\n` +
        `Fee payer: \`${shortAddr(reclaimer.getFeePayerAddress())}\`\n` +
        `Treasury : \`${shortAddr(reclaimer.getTreasuryAddress())}\``;

      await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
    } catch (e) {
      logger.error("/stats failed", { error: e });
      await bot.sendMessage(chatId, `❌ Error: ${e}`);
    }
  });

  // --- /info ---
  bot.onText(/\/info/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      `ℹ️ *Config*

RPC             : \`${config.rpcUrl}\`
Treasury        : \`${config.treasuryWallet}\`
Min threshold   : ${lamportsToSol(config.minRentThreshold)} SOL
Inactivity days : ${config.accountAgeThreshold}`,
      { parse_mode: "Markdown" }
    );
  });

  // Startup notification
  if (config.telegramChatId) {
    bot.sendMessage(
      config.telegramChatId,
      "🤖 Kora Rent Reclaim Bot is online."
    );
  }

  logger.info("Telegram bot listening for commands");

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Telegram bot shutting down");
    await bot.stopPolling();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error("Telegram bot failed to start", { error: err });
  process.exit(1);
});
