import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  Keypair,
  AccountInfo,
} from "@solana/web3.js";
import { logger } from "./logger.js";

// ----------------------------------------------------------
// Rent constants (from Agave source)
// https://github.com/anza-xyz/agave/blob/v2.1.13/sdk/rent/src/lib.rs
// ----------------------------------------------------------
export const LAMPORTS_PER_BYTE_YEAR = 3480; // cost per byte per year
export const EXEMPTION_THRESHOLD = 2; // years of prepaid rent for exemption
export const ACCOUNT_METADATA_SIZE = 128; // bytes of overhead Solana adds

/**
 * Calculate the minimum rent-exempt balance for an account.
 * Formula: (dataLength + 128) × 3 480 × 2
 */
export function calculateRentExemption(dataLengthBytes: number): number {
  return (
    (dataLengthBytes + ACCOUNT_METADATA_SIZE) *
    LAMPORTS_PER_BYTE_YEAR *
    EXEMPTION_THRESHOLD
  );
}

// ----------------------------------------------------------
// Unit helpers
// ----------------------------------------------------------
export function lamportsToSol(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

export function solToLamports(sol: number): number {
  return Math.floor(sol * LAMPORTS_PER_SOL);
}

// ----------------------------------------------------------
// Account inspection
// ----------------------------------------------------------

/** Fetch AccountInfo from RPC.  Returns null if the account does not exist. */
export async function fetchAccountInfo(
  connection: Connection,
  address: string
): Promise<AccountInfo<Buffer> | null> {
  try {
    return await connection.getAccountInfo(new PublicKey(address));
  } catch (err) {
    logger.error(`fetchAccountInfo failed for ${address}`, { error: err });
    return null;
  }
}

/** True when the account no longer exists on-chain (null or 0 lamports). */
export function isAccountClosed(info: AccountInfo<Buffer> | null): boolean {
  return info === null || info.lamports === 0;
}

/** True when the account exists but holds zero bytes of data. */
export function hasEmptyData(info: AccountInfo<Buffer> | null): boolean {
  return info !== null && info.data.length === 0;
}

// ----------------------------------------------------------
// Activity queries
// ----------------------------------------------------------

/**
 * Check whether the account has had *any* transaction within the last
 * `daysThreshold` days.  Returns true on error (fail-safe: don't reclaim).
 */
export async function hasRecentActivity(
  connection: Connection,
  address: string,
  daysThreshold: number
): Promise<boolean> {
  try {
    const sigs = await connection.getSignaturesForAddress(
      new PublicKey(address),
      { limit: 1 } // we only need the most-recent one
    );

    if (sigs.length === 0) return false; // never transacted → inactive

    const blockTime = sigs[0].blockTime;
    if (!blockTime) return true; // can't determine → play it safe

    const daysSince = (Date.now() - blockTime * 1000) / (1000 * 60 * 60 * 24);

    return daysSince < daysThreshold; // true = still active
  } catch (err) {
    logger.error(`hasRecentActivity check failed for ${address}`, {
      error: err,
    });
    return true; // fail-safe: assume active, do NOT reclaim
  }
}

// ----------------------------------------------------------
// Reclaim transaction
// ----------------------------------------------------------

/**
 * Close a system-owned account and send its lamports to `treasury`.
 *
 * Why system-owned only?
 *   System accounts (owner = 11111…) can be drained by anyone who holds
 *   the private key.  Token accounts and custom-program accounts need
 *   program-specific close instructions — those are handled by future
 *   program-specific closers (see TECHNICAL_DEEP_DIVE.md § Future).
 *
 * Returns { success, signature?, error? }
 */
export async function closeAccountAndReclaimRent(
  connection: Connection,
  feePayer: Keypair, // must be the authority over the account
  accountToClose: PublicKey,
  treasury: PublicKey
): Promise<{ success: boolean; signature?: string; error?: string }> {
  try {
    const info = await connection.getAccountInfo(accountToClose);

    // --- guard clauses ---
    if (!info) {
      return {
        success: false,
        error: "Account does not exist or is already closed.",
      };
    }
    if (info.lamports === 0) {
      return { success: false, error: "Account already has zero balance." };
    }

    // Only system accounts can be closed this way
    if (!info.owner.equals(SystemProgram.programId)) {
      return {
        success: false,
        error: `Account is owned by ${info.owner.toBase58()} — needs a program-specific close instruction.`,
      };
    }

    // --- build & send ---
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: accountToClose,
        toPubkey: treasury,
        lamports: info.lamports,
      })
    );

    const signature = await sendAndConfirmTransaction(
      connection,
      tx,
      [feePayer],
      {
        commitment: "confirmed",
      }
    );

    logger.info(`Rent reclaimed: ${accountToClose.toBase58()}`, {
      signature,
      lamports: info.lamports,
    });

    return { success: true, signature };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      `closeAccountAndReclaimRent failed for ${accountToClose.toBase58()}`,
      {
        error: msg,
      }
    );
    return { success: false, error: msg };
  }
}
