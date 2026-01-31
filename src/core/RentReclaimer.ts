import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

import {
  Config,
  SponsoredAccount,
  ReclaimableAccount,
  ReclaimResult,
  ReclaimReason,
  RentStats,
} from "../types.js";

import {
  fetchAccountInfo,
  isAccountClosed,
  hasEmptyData,
  hasRecentActivity,
  closeAccountAndReclaimRent,
  lamportsToSol,
} from "../utils/solana.js";

import {
  logger,
  logReclaimOperation,
  logScanResults,
} from "../utils/logger.js";

export class RentReclaimer {
  private connection: Connection;
  private feePayer: Keypair;
  private treasury: PublicKey;
  private config: Config;

  // In-memory running totals (reset on process restart)
  private lifetimeReclaimed = 0;
  private lastScanTime = 0;

  constructor(config: Config) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl, "confirmed");

    // Decode the base58 private key into a Keypair
    const bytes = bs58.decode(config.feePayerPrivateKey);
    this.feePayer = Keypair.fromSecretKey(bytes);
    this.treasury = new PublicKey(config.treasuryWallet);

    logger.info("RentReclaimer initialized", {
      feePayer: this.feePayer.publicKey.toBase58(),
      treasury: this.treasury.toBase58(),
      rpc: config.rpcUrl,
    });
  }

  // --------------------------------------------------------
  // 1. DISCOVER
  // --------------------------------------------------------

  /**
   * Walk the fee-payer's recent transaction history and collect every
   * unique account that appeared in those transactions.
   *
   * Production note: for high-volume operators you would persist this
   * list in a database and only query *new* signatures each cycle.
   * This RPC-only approach is fine for demonstration and small operators.
   */
  async getSponsoredAccounts(): Promise<SponsoredAccount[]> {
    logger.info("Fetching sponsored accounts …");

    try {
      const signatures = await this.connection.getSignaturesForAddress(
        this.feePayer.publicKey,
        { limit: 100 }
      );

      const seen = new Set<string>();
      const result: SponsoredAccount[] = [];

      for (const sigInfo of signatures) {
        let tx;
        try {
          tx = await this.connection.getParsedTransaction(sigInfo.signature, {
            maxSupportedTransactionVersion: 0,
          });
        } catch {
          continue; // skip unparsable transactions
        }

        if (!tx?.transaction?.message?.accountKeys) continue;

        for (const key of tx.transaction.message.accountKeys) {
          const addr = key.pubkey.toBase58();
          if (seen.has(addr)) continue;
          seen.add(addr);

          const info = await fetchAccountInfo(this.connection, addr);
          if (!info) {
            // Account is gone — still record it so we can flag it as closed
            result.push({
              address: addr,
              lamports: 0,
              owner: "",
              executable: false,
              dataLength: 0,
              lastActivity: sigInfo.blockTime ?? undefined,
            });
            continue;
          }

          result.push({
            address: addr,
            lamports: info.lamports,
            owner: info.owner.toBase58(),
            executable: info.executable,
            dataLength: info.data.length,
            lastActivity: sigInfo.blockTime ?? undefined,
          });
        }
      }

      logger.info(`Found ${result.length} sponsored accounts`);
      return result;
    } catch (err) {
      logger.error("getSponsoredAccounts failed", { error: err });
      return [];
    }
  }

  // --------------------------------------------------------
  // 2. EVALUATE
  // --------------------------------------------------------

  /**
   * Run every sponsored account through the three safety checks.
   * Only accounts that pass ALL applicable checks are returned.
   *
   * Rules (in order):
   *   A) Closed accounts  → always reclaimable (nothing to break)
   *   B) Empty accounts   → reclaimable if lamports ≥ minRentThreshold
   *   C) Inactive accounts → reclaimable if no tx in accountAgeThreshold days
   *      AND lamports ≥ minRentThreshold
   */
  async identifyReclaimableAccounts(
    accounts: SponsoredAccount[]
  ): Promise<ReclaimableAccount[]> {
    logger.info("Identifying reclaimable accounts …");

    const minRent = this.config.minRentThreshold;
    const ageDays = this.config.accountAgeThreshold;
    const reclaimable: ReclaimableAccount[] = [];

    for (const acct of accounts) {
      try {
        const info = await fetchAccountInfo(this.connection, acct.address);

        // --- Rule A: closed ---
        if (isAccountClosed(info)) {
          // Only worth reclaiming if the *original* balance was meaningful
          if (acct.lamports >= minRent) {
            reclaimable.push({
              ...acct,
              reason: ReclaimReason.ACCOUNT_CLOSED,
              estimatedRent: acct.lamports,
            });
          }
          continue;
        }

        // From here, info is guaranteed non-null
        const live = info!;

        // --- Rule B: empty data ---
        if (hasEmptyData(live) && live.lamports >= minRent) {
          reclaimable.push({
            ...acct,
            lamports: live.lamports,
            reason: ReclaimReason.ACCOUNT_EMPTY,
            estimatedRent: live.lamports,
          });
          continue;
        }

        // --- Rule C: inactive ---
        if (live.lamports >= minRent) {
          const active = await hasRecentActivity(
            this.connection,
            acct.address,
            ageDays
          );
          if (!active) {
            reclaimable.push({
              ...acct,
              lamports: live.lamports,
              reason: ReclaimReason.ACCOUNT_INACTIVE,
              estimatedRent: live.lamports,
            });
          }
        }
      } catch (err) {
        logger.warn(`Skipping ${acct.address} — evaluation error`, {
          error: err,
        });
      }
    }

    const total = reclaimable.reduce((s, a) => s + a.estimatedRent, 0);
    logger.info(
      `Identified ${reclaimable.length} reclaimable accounts (${lamportsToSol(
        total
      )} SOL)`
    );
    return reclaimable;
  }

  // --------------------------------------------------------
  // 3. RECLAIM
  // --------------------------------------------------------

  /** Attempt to reclaim rent from a single account. */
  async reclaimRent(account: ReclaimableAccount): Promise<ReclaimResult> {
    logger.info(`Reclaiming ${account.address} — reason: ${account.reason}`);

    try {
      const res = await closeAccountAndReclaimRent(
        this.connection,
        this.feePayer,
        new PublicKey(account.address),
        this.treasury
      );

      const result: ReclaimResult = {
        success: res.success,
        accountAddress: account.address,
        reclaimedAmount: res.success ? account.estimatedRent : 0,
        signature: res.signature,
        error: res.error,
        timestamp: Date.now(),
      };

      logReclaimOperation(
        account.address,
        account.estimatedRent,
        res.success,
        res.signature,
        res.error
      );

      if (res.success) this.lifetimeReclaimed += account.estimatedRent;
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logReclaimOperation(
        account.address,
        account.estimatedRent,
        false,
        undefined,
        msg
      );
      return {
        success: false,
        accountAddress: account.address,
        reclaimedAmount: 0,
        error: msg,
        timestamp: Date.now(),
      };
    }
  }

  /** Reclaim a batch, one at a time with a 1-second pause between each
   *  to avoid hitting RPC rate limits. */
  async reclaimAll(accounts: ReclaimableAccount[]): Promise<ReclaimResult[]> {
    logger.info(`Batch reclaim starting — ${accounts.length} accounts`);
    const results: ReclaimResult[] = [];

    for (const acct of accounts) {
      results.push(await this.reclaimRent(acct));
      await new Promise((r) => setTimeout(r, 1000)); // 1 s delay
    }

    const ok = results.filter((r) => r.success);
    const total = ok.reduce((s, r) => s + r.reclaimedAmount, 0);

    logger.info("Batch reclaim done", {
      total: accounts.length,
      successful: ok.length,
      failed: accounts.length - ok.length,
      totalSOL: lamportsToSol(total),
    });

    return results;
  }

  // --------------------------------------------------------
  // 4. FULL CYCLE
  // --------------------------------------------------------

  /** Discover → evaluate → reclaim.  Used by the cron service. */
  async runScanAndReclaim(): Promise<{
    scanned: SponsoredAccount[];
    reclaimable: ReclaimableAccount[];
    results: ReclaimResult[];
  }> {
    logger.info("=== Scan-and-Reclaim cycle started ===");

    const scanned = await this.getSponsoredAccounts();
    const reclaimable = await this.identifyReclaimableAccounts(scanned);

    logScanResults(
      scanned.length,
      reclaimable.length,
      reclaimable.reduce((s, a) => s + a.estimatedRent, 0)
    );

    const results = await this.reclaimAll(reclaimable);
    this.lastScanTime = Date.now();

    logger.info("=== Scan-and-Reclaim cycle finished ===");
    return { scanned, reclaimable, results };
  }

  // --------------------------------------------------------
  // 5. REPORTING
  // --------------------------------------------------------

  getStats(
    scanned: SponsoredAccount[],
    reclaimable: ReclaimableAccount[]
  ): RentStats {
    return {
      totalAccountsMonitored: scanned.length,
      totalRentLocked: scanned.reduce((s, a) => s + a.lamports, 0),
      totalRentReclaimed: this.lifetimeReclaimed,
      reclaimableAccounts: reclaimable.length,
      estimatedReclaimable: reclaimable.reduce(
        (s, a) => s + a.estimatedRent,
        0
      ),
      lastScanTime: this.lastScanTime,
    };
  }

  getFeePayerAddress(): string {
    return this.feePayer.publicKey.toBase58();
  }
  getTreasuryAddress(): string {
    return this.treasury.toBase58();
  }
}
