#!/usr/bin/env node
/**
 * End-to-end Blink test on devnet: GET the Action → POST as a funded devnet
 * wallet → check the returned tx only invokes allowed programs → sign locally →
 * send → assert the YES balance increased.
 *
 *   E2E_KEYPAIR=~/devnet-tester.json \
 *   BLINK_BASE_URL=https://<your-domain> [MARKET_ID=<numeric id>] [AMOUNT=5] \
 *   NODE_PATH=app/node_modules node scripts/e2e-blink-devnet.cjs
 *
 * The wallet needs ≥ AMOUNT mock USDC and ~0.01 SOL. Devnet only.
 */
const fs = require("fs");
const os = require("os");
const { Connection, Keypair, PublicKey, Transaction } = require("@solana/web3.js");
const { getAssociatedTokenAddressSync } = require("@solana/spl-token");

const BASE = (process.env.BLINK_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const RPC = process.env.E2E_RPC_URL || "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID || "GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y",
);
const AMOUNT = Number(process.env.AMOUNT || 5);
const ALLOWED = new Set([
  "ComputeBudget111111111111111111111111111111",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  PROGRAM_ID.toBase58(),
]);

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function loadKeypair() {
  const p = (process.env.E2E_KEYPAIR || "").replace(/^~/, os.homedir());
  if (!p) fail("set E2E_KEYPAIR to a funded devnet keypair JSON");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

async function json(url, init) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, headers: res.headers, body };
}

/** First active, liquid, USDC market from the keeper cache (or MARKET_ID). */
async function pickMarket() {
  if (process.env.MARKET_ID) return process.env.MARKET_ID;
  const { status, body } = await json(`${BASE}/api/markets`);
  if (status !== 200) fail(`/api/markets returned ${status}`);
  const now = Date.now() / 1000;
  const m = body.markets.find(
    (x) => !x.resolved && x.endTs > now + 600 && x.lEff > 0 && !x.group && x.reserveYes > 0,
  );
  if (!m) fail("no active market found");
  return String(m.marketId);
}

function yesMint(marketPda) {
  return PublicKey.findProgramAddressSync([Buffer.from("yes_mint"), marketPda.toBuffer()], PROGRAM_ID)[0];
}

async function yesBalance(conn, owner, mint) {
  try {
    const ata = getAssociatedTokenAddressSync(mint, owner);
    return Number((await conn.getTokenAccountBalance(ata, "confirmed")).value.amount);
  } catch {
    return 0;
  }
}

async function main() {
  const kp = loadKeypair();
  const conn = new Connection(RPC, "confirmed");
  const id = await pickMarket();
  const action = `${BASE}/api/actions/market/${id}`;

  // 1. GET — spec headers + YES/NO buttons.
  const get = await json(action);
  if (get.status !== 200) fail(`GET ${get.status} ${JSON.stringify(get.body)}`);
  if (!get.headers.get("x-action-version")) fail("missing X-Action-Version");
  if (!get.headers.get("x-blockchain-ids")) fail("missing X-Blockchain-Ids");
  if (get.body.disabled) fail(`action disabled: ${get.body.error?.message}`);
  const labels = get.body.links.actions.map((a) => a.label);
  console.log(`✓ GET ${get.body.title} — ${labels.join(" | ")}`);

  // 2. POST — unsigned tx for this wallet.
  const post = await json(`${action}?side=yes&amount=${AMOUNT}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account: kp.publicKey.toBase58() }),
  });
  if (post.status !== 200) fail(`POST ${post.status} ${JSON.stringify(post.body)}`);
  console.log(`✓ POST message: ${post.body.message}`);

  // 3. Inspect: fee payer + program allowlist.
  const tx = Transaction.from(Buffer.from(post.body.transaction, "base64"));
  if (!tx.feePayer?.equals(kp.publicKey)) fail("fee payer is not the user");
  const programs = tx.instructions.map((ix) => ix.programId.toBase58());
  const bad = programs.filter((p) => !ALLOWED.has(p));
  if (bad.length) fail(`tx invokes unexpected programs: ${bad.join(", ")}`);
  console.log(`✓ programs: ${[...new Set(programs)].join(", ")}`);

  // 4. Sign locally, send, confirm, and check the position.
  const pda = marketPda(id);
  const mint = yesMint(pda);
  const before = await yesBalance(conn, kp.publicKey, mint);
  tx.partialSign(kp);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await waitConfirmed(conn, sig);
  const after = await yesBalance(conn, kp.publicKey, mint);
  if (!(after > before)) fail(`YES balance did not increase (${before} → ${after})`);
  console.log(`✓ sent ${sig}`);
  console.log(`✓ YES balance ${before / 1e6} → ${after / 1e6}`);
}

/**
 * Poll until confirmed. (A deserialized legacy tx has no lastValidBlockHeight,
 * so the blockheight-based confirmTransaction strategy can't be used.)
 */
async function waitConfirmed(conn, sig, timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const st = (await conn.getSignatureStatuses([sig])).value[0];
    if (st?.err) fail(`tx failed: ${JSON.stringify(st.err)}`);
    if (st && ["confirmed", "finalized"].includes(st.confirmationStatus)) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  fail(`tx ${sig} not confirmed in ${timeoutMs / 1000}s`);
}

/** Market PDA: seeds ["market", u64 LE id]. */
function marketPda(id) {
  const le = Buffer.alloc(8);
  le.writeBigUInt64LE(BigInt(id));
  return PublicKey.findProgramAddressSync([Buffer.from("market"), le], PROGRAM_ID)[0];
}

main().catch((e) => fail(e.stack || String(e)));
