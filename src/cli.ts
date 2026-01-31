import { Command } from "commander";
import dotenv from "dotenv";
import { RentReclaimer } from "./core/RentReclaimer.js";
import { Config } from "./types.js";
import { lamportsToSol } from "./utils/solana.js";

dotenv.config();

// ----------------------------------------------------------
// Config loader
// ----------------------------------------------------------
function loadConfig(): Config {
  const key = process.env.KORA_FEEPAYER_PRIVATE_KEY || "";
  const treasury = process.env.TREASURY_WALLET || "";

  if (!key) throw new Error("KORA_FEEPAYER_PRIVATE_KEY is not set in .env");
  if (!treasury) throw new Error("TREASURY_WALLET is not set in .env");

  return {
    rpcUrl: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    feePayerPrivateKey: key,
    treasuryWallet: treasury,
    minRentThreshold: Number(process.env.MIN_RENT_THRESHOLD || "1000000"),
    accountAgeThreshold: Number(process.env.ACCOUNT_AGE_THRESHOLD || "7"),
  };
}

// ----------------------------------------------------------
// Commands
// ----------------------------------------------------------
const program = new Command();

program
  .name("kora-rent-reclaim")
  .description("CLI for reclaiming rent from Kora-sponsored Solana accounts")
  .version("1.0.0");

// --- scan ---
program
  .command("scan")
  .description("Scan for reclaimable accounts (no transactions sent)")
  .action(async () => {
    try {
      console.log("\n🔍  Scanning …\n");
      const reclaimer = new RentReclaimer(loadConfig());
      const sponsored = await reclaimer.getSponsoredAccounts();
      const reclaimable = await reclaimer.identifyReclaimableAccounts(
        sponsored
      );

      console.log(`📊  ${sponsored.length} sponsored accounts found\n`);

      if (reclaimable.length === 0) {
        console.log("✅  Nothing to reclaim right now.\n");
        return;
      }

      let total = 0;
      reclaimable.forEach((a, i) => {
        total += a.estimatedRent;
        console.log(`  ${i + 1}. ${a.address}`);
        console.log(`     Reason : ${a.reason}`);
        console.log(
          `     Rent   : ${lamportsToSol(a.estimatedRent).toFixed(6)} SOL  (${
            a.estimatedRent
          } lamports)\n`
        );
      });

      console.log(
        `💰  Total reclaimable : ${lamportsToSol(total).toFixed(6)} SOL\n`
      );
    } catch (e) {
      console.error("❌ ", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

// --- reclaim ---
program
  .command("reclaim")
  .description("Scan and reclaim rent from eligible accounts")
  .option(
    "--dry-run",
    "Print what would happen without sending any transaction"
  )
  .action(async (opts: { dryRun?: boolean }) => {
    try {
      const reclaimer = new RentReclaimer(loadConfig());

      if (opts.dryRun) {
        console.log("\n🧪  DRY-RUN — no transactions will be sent\n");
        const sponsored = await reclaimer.getSponsoredAccounts();
        const reclaimable = await reclaimer.identifyReclaimableAccounts(
          sponsored
        );

        console.log(
          `📊  ${sponsored.length} sponsored  |  ${reclaimable.length} reclaimable\n`
        );
        let total = 0;
        reclaimable.forEach((a, i) => {
          total += a.estimatedRent;
          console.log(
            `  ${i + 1}. ${a.address}  →  ${lamportsToSol(
              a.estimatedRent
            ).toFixed(6)} SOL`
          );
        });
        console.log(
          `\n💰  Would reclaim ${lamportsToSol(total).toFixed(6)} SOL total\n`
        );
        return;
      }

      // --- live run ---
      console.log("\n🔍  Scanning and reclaiming …\n");
      const { scanned, reclaimable, results } =
        await reclaimer.runScanAndReclaim();

      console.log(
        `📊  Scanned: ${scanned.length}   Reclaimable: ${reclaimable.length}\n`
      );

      if (results.length === 0) {
        console.log("✅  Nothing to reclaim.\n");
        return;
      }

      const ok = results.filter((r) => r.success);
      const fail = results.filter((r) => !r.success);

      ok.forEach((r, i) => {
        console.log(`  ✅ ${i + 1}. ${r.accountAddress}`);
        console.log(
          `       Reclaimed : ${lamportsToSol(r.reclaimedAmount).toFixed(
            6
          )} SOL`
        );
        console.log(`       Tx        : ${r.signature}\n`);
      });

      if (fail.length) {
        console.log(`  ❌  ${fail.length} failed:\n`);
        fail.forEach((r) => {
          console.log(`     ${r.accountAddress}  →  ${r.error}\n`);
        });
      }

      const totalSOL = lamportsToSol(
        ok.reduce((s, r) => s + r.reclaimedAmount, 0)
      );
      console.log(
        `📈  Summary : ${ok.length} ok / ${
          fail.length
        } failed  |  ${totalSOL.toFixed(6)} SOL reclaimed`
      );
      console.log(`    Treasury: ${reclaimer.getTreasuryAddress()}\n`);
    } catch (e) {
      console.error("❌ ", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

// --- stats ---
program
  .command("stats")
  .description("Show current rent statistics")
  .action(async () => {
    try {
      console.log("\n📊  Fetching stats …\n");
      const reclaimer = new RentReclaimer(loadConfig());
      const sponsored = await reclaimer.getSponsoredAccounts();
      const reclaimable = await reclaimer.identifyReclaimableAccounts(
        sponsored
      );
      const stats = reclaimer.getStats(sponsored, reclaimable);

      console.log(`  Fee Payer          : ${reclaimer.getFeePayerAddress()}`);
      console.log(`  Treasury           : ${reclaimer.getTreasuryAddress()}\n`);
      console.log(`  Accounts monitored : ${stats.totalAccountsMonitored}`);
      console.log(
        `  Rent locked        : ${lamportsToSol(stats.totalRentLocked).toFixed(
          6
        )} SOL`
      );
      console.log(
        `  Lifetime reclaimed : ${lamportsToSol(
          stats.totalRentReclaimed
        ).toFixed(6)} SOL`
      );
      console.log(
        `  Reclaimable now    : ${stats.reclaimableAccounts}  (${lamportsToSol(
          stats.estimatedReclaimable
        ).toFixed(6)} SOL)\n`
      );
    } catch (e) {
      console.error("❌ ", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

// --- info ---
program
  .command("info")
  .description("Print loaded configuration")
  .action(() => {
    try {
      const cfg = loadConfig();
      console.log("\nℹ️   Configuration\n");
      console.log(`  RPC URL              : ${cfg.rpcUrl}`);
      console.log(`  Treasury             : ${cfg.treasuryWallet}`);
      console.log(
        `  Min rent threshold   : ${lamportsToSol(cfg.minRentThreshold).toFixed(
          6
        )} SOL`
      );
      console.log(`  Inactivity threshold : ${cfg.accountAgeThreshold} days\n`);
    } catch (e) {
      console.error("❌ ", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program.parse();
