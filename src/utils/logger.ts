import winston from "winston";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_DIR = path.resolve(__dirname, "../../logs");

// Make sure the logs folder exists before Winston tries to write
fs.mkdirSync(LOG_DIR, { recursive: true });

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: "kora-rent-reclaim" },
  transports: [
    // --- Console (colourised, human-friendly) ---
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp }) => {
          return `${timestamp} [${level}] ${message}`;
        })
      ),
    }),
    // --- File: all logs ---
    new winston.transports.File({
      filename: path.join(LOG_DIR, "combined.log"),
    }),
    // --- File: errors only ---
    new winston.transports.File({
      filename: path.join(LOG_DIR, "error.log"),
      level: "error",
    }),
    // --- File: reclaim audit trail ---
    new winston.transports.File({
      filename: path.join(LOG_DIR, "reclaim-operations.log"),
      level: "info",
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    }),
  ],
});

/** Convenience: log a single reclaim attempt with all details */
export function logReclaimOperation(
  accountAddress: string,
  amountLamports: number,
  success: boolean,
  signature?: string,
  error?: string
) {
  const payload = {
    operation: "RECLAIM",
    accountAddress,
    amountLamports,
    success,
    signature,
    error,
    timestamp: new Date().toISOString(),
  };
  success
    ? logger.info("Rent reclaimed successfully", payload)
    : logger.error("Rent reclaim failed", payload);
}

/** Convenience: log a scan summary */
export function logScanResults(
  totalAccounts: number,
  reclaimableCount: number,
  totalReclaimableLamports: number
) {
  logger.info("Account scan completed", {
    operation: "SCAN",
    totalAccounts,
    reclaimableCount,
    totalReclaimableLamports,
    timestamp: new Date().toISOString(),
  });
}
