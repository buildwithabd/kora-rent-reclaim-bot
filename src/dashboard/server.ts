import express from "express";
import dotenv from "dotenv";
import { RentReclaimer } from "../core/RentReclaimer.js";
import { Config } from "../types.js";
import { logger } from "../utils/logger.js";
import { lamportsToSol } from "../utils/solana.js";

dotenv.config();

// ----------------------------------------------------------
function loadConfig(): Config {
  const key = process.env.KORA_FEEPAYER_PRIVATE_KEY || "";
  const treasury = process.env.TREASURY_WALLET || "";
  if (!key) throw new Error("KORA_FEEPAYER_PRIVATE_KEY is not set");
  if (!treasury) throw new Error("TREASURY_WALLET is not set");

  return {
    rpcUrl: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    feePayerPrivateKey: key,
    treasuryWallet: treasury,
    dashboardPort: Number(process.env.DASHBOARD_PORT || "3000"),
    minRentThreshold: Number(process.env.MIN_RENT_THRESHOLD || "1000000"),
    accountAgeThreshold: Number(process.env.ACCOUNT_AGE_THRESHOLD || "7"),
  };
}

// ----------------------------------------------------------
// Inline HTML for the single-page dashboard
// ----------------------------------------------------------
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Kora Rent Reclaim Dashboard</title>
<style>
  *         { margin:0; padding:0; box-sizing:border-box; }
  body      { font-family: 'Segoe UI', sans-serif; background:#0f172a; color:#e2e8f0; min-height:100vh; padding:2rem; }
  .wrap     { max-width:960px; margin:0 auto; }
  h1        { text-align:center; font-size:1.9rem; margin-bottom:.25rem; color:#f8fafc; }
  .sub      { text-align:center; color:#64748b; margin-bottom:2rem; font-size:.95rem; }
  .cards    { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:1rem; margin-bottom:2rem; }
  .card     { background:#1e293b; border-radius:10px; padding:1.25rem; }
  .card h3  { color:#64748b; font-size:.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem; }
  .card .val{ font-size:1.6rem; font-weight:700; color:#f1f5f9; }
  .card .sub2{ font-size:.78rem; color:#475569; margin-top:.2rem; }
  .btns     { display:flex; gap:.75rem; margin-bottom:2rem; }
  .btn      { flex:1; padding:.75rem 1rem; border:none; border-radius:8px; font-size:.9rem; font-weight:600; cursor:pointer; transition:opacity .2s; }
  .btn:disabled{ opacity:.4; cursor:not-allowed; }
  .btn-primary  { background:#6366f1; color:#fff; }
  .btn-secondary{ background:#334155; color:#e2e8f0; }
  .btn-primary:hover   { background:#4f46e5; }
  .btn-secondary:hover { background:#475569; }
  .panel    { background:#1e293b; border-radius:10px; padding:1.5rem; }
  .panel h2{ font-size:1rem; margin-bottom:1rem; color:#f1f5f9; }
  .item     { border-bottom:1px solid #334155; padding:.7rem 0; }
  .item:last-child{ border-bottom:none; }
  .item .addr{ font-family:monospace; font-size:.82rem; color:#818cf8; word-break:break-all; }
  .item .detail{ font-size:.8rem; color:#64748b; margin-top:.2rem; }
  .toast    { position:fixed; bottom:1.5rem; right:1.5rem; background:#334155; color:#f1f5f9; padding:.7rem 1.2rem; border-radius:8px; font-size:.85rem; display:none; box-shadow:0 4px 12px rgba(0,0,0,.4); }
  .toast.show{ display:block; animation:slide .25s ease; }
  @keyframes slide{ from{ transform:translateY(40px); opacity:0 } to{ transform:translateY(0); opacity:1 } }
  .cfg      { background:#1e293b; border-radius:10px; padding:1rem 1.5rem; margin-bottom:1.5rem; display:flex; flex-wrap:wrap; gap:1rem; }
  .cfg span { font-size:.8rem; color:#64748b; }
  .cfg b    { color:#94a3b8; }
</style>
</head>
<body>
<div class="wrap">
  <h1>🔐 Kora Rent Reclaim</h1>
  <p class="sub">Monitor &amp; reclaim rent from Kora-sponsored Solana accounts</p>

  <div class="cfg" id="cfg"></div>

  <div class="cards" id="cards">
    <div class="card"><h3>Monitored</h3><div class="val">—</div></div>
    <div class="card"><h3>Rent Locked</h3><div class="val">—</div></div>
    <div class="card"><h3>Reclaimed</h3><div class="val">—</div></div>
    <div class="card"><h3>Reclaimable</h3><div class="val">—</div><div class="sub2">—</div></div>
  </div>

  <div class="btns">
    <button class="btn btn-secondary" id="btnScan" onclick="doScan()">🔍 Scan</button>
    <button class="btn btn-primary"   id="btnReclaim" onclick="doReclaim()">💸 Reclaim</button>
  </div>

  <div class="panel">
    <h2>Reclaimable Accounts</h2>
    <div id="list"><p style="color:#475569;font-size:.85rem;">Click Scan to populate this list.</p></div>
  </div>
</div>
<div class="toast" id="toast"></div>

<script>
async function api(method, path) {
  const r = await fetch(path, { method });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}

function setDisabled(v) {
  document.getElementById('btnScan').disabled = v;
  document.getElementById('btnReclaim').disabled = v;
}

async function loadConfig() {
  const c = await api('GET', '/api/config');
  document.getElementById('cfg').innerHTML =
    '<span><b>Fee Payer:</b> ' + c.feePayer.slice(0,12) + '…</span>' +
    '<span><b>Treasury:</b> '  + c.treasury.slice(0,12) + '…</span>' +
    '<span><b>RPC:</b> '       + c.rpcUrl + '</span>';
}

async function loadStats() {
  const s = await api('GET', '/api/stats');
  const cards = document.querySelectorAll('.card');
  cards[0].querySelector('.val').textContent = s.totalAccountsMonitored;
  cards[1].querySelector('.val').textContent = s.totalRentLockedSOL.toFixed(4) + ' SOL';
  cards[2].querySelector('.val').textContent = s.totalRentReclaimedSOL.toFixed(4) + ' SOL';
  cards[3].querySelector('.val').textContent = s.reclaimableAccounts;
  cards[3].querySelector('.sub2').textContent = s.estimatedReclaimableSOL.toFixed(4) + ' SOL';
}

function renderList(accounts) {
  if (!accounts.length) {
    document.getElementById('list').innerHTML = '<p style="color:#475569;font-size:.85rem;">No reclaimable accounts found.</p>';
    return;
  }
  document.getElementById('list').innerHTML = accounts.map(a =>
    '<div class="item">' +
      '<div class="addr">' + a.address + '</div>' +
      '<div class="detail">💰 ' + (a.estimatedRent / 1e9).toFixed(6) + ' SOL &nbsp;|&nbsp; ' + a.reason + '</div>' +
    '</div>'
  ).join('');
}

async function doScan() {
  setDisabled(true);
  document.getElementById('btnScan').textContent = '⏳ Scanning…';
  try {
    const r = await api('POST', '/api/scan');
    renderList(r.accounts);
    toast('Found ' + r.reclaimable + ' reclaimable accounts');
    await loadStats();
  } catch(e) { toast('Scan failed: ' + e.message); }
  finally {
    setDisabled(false);
    document.getElementById('btnScan').textContent = '🔍 Scan';
  }
}

async function doReclaim() {
  if (!confirm('Reclaim rent from all eligible accounts?')) return;
  setDisabled(true);
  document.getElementById('btnReclaim').textContent = '⏳ Reclaiming…';
  try {
    const r = await api('POST', '/api/reclaim');
    toast('Reclaimed ' + r.totalReclaimedSOL.toFixed(6) + ' SOL from ' + r.successful + ' accounts');
    await loadStats();
    await doScan();               // refresh list
  } catch(e) { toast('Reclaim failed: ' + e.message); }
  finally {
    setDisabled(false);
    document.getElementById('btnReclaim').textContent = '💸 Reclaim';
  }
}

// Boot
loadConfig().catch(console.error);
loadStats().catch(console.error);
setInterval(() => loadStats().catch(()=>{}), 30000);
</script>
</body>
</html>`;

// ----------------------------------------------------------
async function main() {
  const config = loadConfig();
  const reclaimer = new RentReclaimer(config);
  const app = express();
  app.use(express.json());

  // --- serve dashboard ---
  app.get("/", (_req, res) => res.send(DASHBOARD_HTML));

  // --- API: config (no secrets) ---
  app.get("/api/config", (_req, res) => {
    res.json({
      rpcUrl: config.rpcUrl,
      feePayer: reclaimer.getFeePayerAddress(),
      treasury: reclaimer.getTreasuryAddress(),
    });
  });

  // --- API: stats ---
  app.get("/api/stats", async (_req, res) => {
    try {
      const sponsored = await reclaimer.getSponsoredAccounts();
      const reclaimable = await reclaimer.identifyReclaimableAccounts(
        sponsored
      );
      const stats = reclaimer.getStats(sponsored, reclaimable);
      res.json({
        totalAccountsMonitored: stats.totalAccountsMonitored,
        totalRentLocked: stats.totalRentLocked,
        totalRentLockedSOL: lamportsToSol(stats.totalRentLocked),
        totalRentReclaimed: stats.totalRentReclaimed,
        totalRentReclaimedSOL: lamportsToSol(stats.totalRentReclaimed),
        reclaimableAccounts: stats.reclaimableAccounts,
        estimatedReclaimable: stats.estimatedReclaimable,
        estimatedReclaimableSOL: lamportsToSol(stats.estimatedReclaimable),
      });
    } catch (e) {
      logger.error("/api/stats", { error: e });
      res.status(500).json({ error: "stats failed" });
    }
  });

  // --- API: scan ---
  app.post("/api/scan", async (_req, res) => {
    try {
      const sponsored = await reclaimer.getSponsoredAccounts();
      const reclaimable = await reclaimer.identifyReclaimableAccounts(
        sponsored
      );
      res.json({
        scanned: sponsored.length,
        reclaimable: reclaimable.length,
        accounts: reclaimable,
      });
    } catch (e) {
      logger.error("/api/scan", { error: e });
      res.status(500).json({ error: "scan failed" });
    }
  });

  // --- API: reclaim ---
  app.post("/api/reclaim", async (_req, res) => {
    try {
      const { scanned, reclaimable, results } =
        await reclaimer.runScanAndReclaim();
      const ok = results.filter((r) => r.success);
      const total = ok.reduce((s, r) => s + r.reclaimedAmount, 0);
      res.json({
        scanned: scanned.length,
        reclaimable: reclaimable.length,
        successful: ok.length,
        failed: results.length - ok.length,
        totalReclaimed: total,
        totalReclaimedSOL: lamportsToSol(total),
        results,
      });
    } catch (e) {
      logger.error("/api/reclaim", { error: e });
      res.status(500).json({ error: "reclaim failed" });
    }
  });

  // --- listen ---
  const port = config.dashboardPort || 3000;
  app.listen(port, () => {
    logger.info(`Dashboard running on http://localhost:${port}`);
    console.log(`\n🌐  Dashboard → http://localhost:${port}\n`);
  });
}

main().catch((err) => {
  logger.error("Dashboard failed to start", { error: err });
  process.exit(1);
});
