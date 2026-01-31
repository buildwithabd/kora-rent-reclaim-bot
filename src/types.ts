/** Top-level runtime configuration (populated from .env) */
export interface Config {
  rpcUrl: string;
  feePayerPrivateKey: string;
  treasuryWallet: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  cronSchedule?: string;
  dashboardPort?: number;
  minRentThreshold: number; // lamports
  accountAgeThreshold: number; // days
}

/** Raw on-chain state of a single sponsored account */
export interface SponsoredAccount {
  address: string;
  lamports: number;
  owner: string; // program that owns the account
  executable: boolean;
  dataLength: number; // bytes of on-chain data
  lastActivity?: number; // unix timestamp (seconds)
}

/** A sponsored account that passed all safety checks and is safe to reclaim */
export interface ReclaimableAccount extends SponsoredAccount {
  reason: ReclaimReason;
  estimatedRent: number; // lamports we expect to recover
}

/** Why an account was flagged as reclaimable */
export enum ReclaimReason {
  ACCOUNT_CLOSED = "Account is closed (zero balance)",
  ACCOUNT_EMPTY = "Account data is empty",
  ACCOUNT_INACTIVE = "Account inactive for extended period",
}

/** Result of a single reclaim transaction attempt */
export interface ReclaimResult {
  success: boolean;
  accountAddress: string;
  reclaimedAmount: number; // lamports actually moved (0 on failure)
  signature?: string; // tx signature on success
  error?: string; // human-readable error on failure
  timestamp: number; // unix ms
}

/** Aggregated numbers shown on the dashboard / stats command */
export interface RentStats {
  totalAccountsMonitored: number;
  totalRentLocked: number; // lamports
  totalRentReclaimed: number; // lamports (lifetime)
  reclaimableAccounts: number;
  estimatedReclaimable: number; // lamports
  lastScanTime: number; // unix ms
}
