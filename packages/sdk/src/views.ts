/**
 * Display-ready, JSON-safe views of the program's list accounts.
 *
 * One implementation shared by the web app's hooks (direct RPC path) and the
 * keeper (which caches these rows in Redis), so the two can't drift. Every
 * view is plain numbers/strings/booleans — safe to `JSON.stringify` — and the
 * time-dependent fields can be recomputed for a newer `now` via `refresh*`.
 */
import { priceFromReserves, i80f48ToNumber, sumProbabilities } from "./math";
import { decodeName } from "./encoding";
import type {
  BetVaultAccount,
  CommitmentVaultAccount,
  CommitmentVaultGroupAccount,
  GroupMarketAccount,
  MarketAccount,
} from "./types/accounts";

/** Current on-chain account sizes — `dataSize` filters that skip legacy layouts. */
export const ACCOUNT_SIZES = {
  market: 443,
  groupMarket: 1188,
  commitmentVault: 288,
  commitmentVaultGroup: 560,
} as const;

/** `Pubkey::default()` as base58 — an unset pubkey on-chain. */
const PUBKEY_DEFAULT = "11111111111111111111111111111111";
/** `GroupMarket::winning_leg` before resolution / on cancel. */
const NO_WINNING_LEG = 0xff;

type BnLike = { toString(): string };
type PkLike = { toBase58(): string };

const bnToNum = (bn: BnLike): number => Number(BigInt(bn.toString()));
const pkOrEmpty = (pk: PkLike): string => {
  const s = pk.toBase58();
  return s === PUBKEY_DEFAULT ? "" : s;
};

// ----------------------------------------------------------------------------
// Markets
// ----------------------------------------------------------------------------

export interface MarketView {
  publicKey: string;
  marketId: number;
  authority: string;
  /** Collateral mint (any SPL token — not necessarily USDC). */
  collateralMint: string;
  name: string;
  startTs: number;
  endTs: number;
  lZero: number;
  reserveYes: number;
  reserveNo: number;
  totalLpShares: number;
  resolved: boolean;
  winningSide: number;
  price: number;
  lEff: number;
  cumYesPerShare: number;
  cumNoPerShare: number;
  /** GroupMarket PDA this leg is attached to. "" if standalone. */
  group: string;
  /** Calibrated initial YES price in bps (set by `initialize_market` or the
   *  vault launch path). 0 = legacy 50/50. Used as the display price for
   *  freshly-launched markets with zero reserves. */
  initialPriceBps: number;
  /** When reserves were last rebased (`accrue`). Optional: rows cached by an
   *  older keeper lack it. Pair the reserves with L_eff at THIS time — see
   *  `quoteReserves`. */
  lastAccrualTs?: number;
}

/** Price when reserves are empty: seed price, else residual ratio, else 0.5. */
function fallbackPrice(initialPriceBps: number, cumYes: number, cumNo: number): number {
  // 1. initial_price_bps — the calibration target until the first deposit.
  if (initialPriceBps > 0 && cumYes + cumNo === 0) return initialPriceBps / 10_000;
  // 2. cumulative residuals (expired markets whose reserves drained to LPs):
  //    more NO released → price was high (YES), and vice versa.
  if (cumYes + cumNo > 0) return cumNo / (cumYes + cumNo);
  // 3. legacy markets with no calibration.
  return 0.5;
}

interface PriceInputs {
  resolved: boolean;
  winningSide: number;
  expired: boolean;
  x: number;
  y: number;
  /** L_eff at `last_accrual_ts` — the time the reserves (x, y) were last rebased. */
  lEffAtLastAccrual: number;
  initialPriceBps: number;
  cumYes: number;
  cumNo: number;
}

/**
 * Display YES price. The on-chain reserves reflect the pool at
 * `last_accrual_ts`, so they must be paired with L_eff at that same instant —
 * pairing them with L_eff(now) would under/overshoot whenever `accrue` hasn't
 * run recently (L_eff decays, reserves stay frozen between accruals).
 */
export function displayPrice(p: PriceInputs): number {
  if (p.resolved) return p.winningSide === 1 ? 1 : p.winningSide === 2 ? 0 : 0.5;
  const hasReserves = p.x > 0 || p.y > 0;
  if (p.expired || !hasReserves) {
    if (p.lEffAtLastAccrual > 0 && hasReserves) {
      return Math.max(0.001, Math.min(0.999, priceFromReserves(p.x, p.y, p.lEffAtLastAccrual)));
    }
    return fallbackPrice(p.initialPriceBps, p.cumYes, p.cumNo);
  }
  return p.lEffAtLastAccrual > 0 ? priceFromReserves(p.x, p.y, p.lEffAtLastAccrual) : 0.5;
}

const lEffAt = (lZero: number, endTs: number, ts: number) =>
  lZero * Math.sqrt(Math.max(endTs - ts, 1));

/** Decoded `Market` account → display row. `now` in unix seconds. */
export function marketView(publicKey: string, m: MarketAccount, now: number): MarketView {
  const endTs = bnToNum(m.endTs);
  const lZero = i80f48ToNumber(m.lZero);
  const x = i80f48ToNumber(m.reserveYes);
  const y = i80f48ToNumber(m.reserveNo);
  const cumYesPerShare = i80f48ToNumber(m.cumYesPerShare);
  const cumNoPerShare = i80f48ToNumber(m.cumNoPerShare);
  const initialPriceBps: number = m.initialPriceBps ?? 0;
  const marketId = bnToNum(m.marketId);
  const lastAccrualTs = bnToNum(m.lastAccrualTs);

  const price = displayPrice({
    resolved: m.resolved,
    winningSide: m.winningSide,
    expired: now >= endTs,
    x,
    y,
    lEffAtLastAccrual: lEffAt(lZero, endTs, lastAccrualTs),
    initialPriceBps,
    cumYes: cumYesPerShare,
    cumNo: cumNoPerShare,
  });

  return {
    publicKey,
    marketId,
    authority: m.authority.toBase58(),
    collateralMint: m.collateralMint.toBase58(),
    name: decodeName(m.name) || `Market #${marketId}`,
    startTs: bnToNum(m.startTs),
    endTs,
    lZero,
    reserveYes: x,
    reserveNo: y,
    totalLpShares: i80f48ToNumber(m.totalLpShares),
    resolved: m.resolved,
    winningSide: m.winningSide,
    price,
    lEff: lEffAt(lZero, endTs, now),
    cumYesPerShare,
    cumNoPerShare,
    // Pubkey::default() → "" so callers can test attachment with a truthy check.
    group: pkOrEmpty(m.group),
    initialPriceBps,
    lastAccrualTs,
  };
}

/**
 * Curve state for swap quotes. The stored reserves (x, y) sit on the curve for
 * L_eff at `last_accrual_ts`, so quotes must use that L_eff — pairing them with
 * L_eff(now) puts the point off-curve and overstates outputs badly (11× on a
 * market idle for ~2 days). The program accrues before swapping; the residual
 * error is tiny and covered by slippage. Falls back to `lEff` for old rows.
 */
export function quoteReserves(m: MarketView): {
  reserveYes: number;
  reserveNo: number;
  lEff: number;
} {
  const lEff = m.lastAccrualTs === undefined ? m.lEff : lEffAt(m.lZero, m.endTs, m.lastAccrualTs);
  return { reserveYes: m.reserveYes, reserveNo: m.reserveNo, lEff };
}

/** Recompute the time-dependent fields of a (possibly cached) market row. */
export function refreshMarketView(m: MarketView, now: number): MarketView {
  return { ...m, lEff: lEffAt(m.lZero, m.endTs, now) };
}

// ----------------------------------------------------------------------------
// Group markets
// ----------------------------------------------------------------------------

export interface GroupView {
  publicKey: string;
  groupId: number;
  authority: string;
  name: string;
  startTs: number;
  endTs: number;
  legCount: number;
  /** Length = legCount. `null` slots indicate an attached pubkey we couldn't resolve. */
  legs: (MarketView | null)[];
  /** Pubkeys of all leg slots (raw, before resolution). */
  legPubkeys: string[];
  resolved: boolean;
  /** Index of the winning leg, or `null` if not resolved or cancelled. */
  winningLeg: number | null;
  /** Σ p_i across attached legs. Should be ≈ 1; drift = arb opportunity. */
  sumProbabilities: number;
  /** Number of slots in `legs` that hold a real pubkey (not Pubkey::default()). */
  attachedLegCount: number;
  /** True when every slot in [0..legCount) is populated. */
  isComplete: boolean;
  /** True for unresolved groups that are missing legs — eligible for cancel. */
  isIncomplete: boolean;
}

/** (Re)attach leg rows from `marketByPubkey` and recompute Σ p_i. */
export function joinGroupLegs(g: GroupView, marketByPubkey: Map<string, MarketView>): GroupView {
  const legs = g.legPubkeys.map((pk) => marketByPubkey.get(pk) ?? null);
  const prices = legs.filter((m): m is MarketView => m !== null).map((m) => m.price);
  return { ...g, legs, sumProbabilities: sumProbabilities(prices) };
}

/** Decoded `GroupMarket` account → display row, legs joined from `marketByPubkey`. */
export function groupView(
  publicKey: string,
  g: GroupMarketAccount,
  marketByPubkey: Map<string, MarketView>,
): GroupView {
  const legCount = g.legCount;
  const legPubkeys = g.legs.slice(0, legCount).map((p) => p.toBase58());
  const groupId = bnToNum(g.groupId);
  const attachedLegCount = legPubkeys.filter((pk) => pk !== PUBKEY_DEFAULT).length;
  const isComplete = attachedLegCount === legCount;

  return joinGroupLegs(
    {
      publicKey,
      groupId,
      authority: g.authority.toBase58(),
      name: decodeName(g.name) || `Group #${groupId}`,
      startTs: bnToNum(g.startTs),
      endTs: bnToNum(g.endTs),
      legCount,
      legs: [],
      legPubkeys,
      resolved: g.resolved,
      winningLeg: g.resolved && g.winningLeg !== NO_WINNING_LEG ? g.winningLeg : null,
      sumProbabilities: 0,
      attachedLegCount,
      isComplete,
      isIncomplete: !g.resolved && !isComplete,
    },
    marketByPubkey,
  );
}

// ----------------------------------------------------------------------------
// Binary commitment vaults
// ----------------------------------------------------------------------------

export interface VaultView {
  publicKey: string;
  vaultId: number;
  authority: string;
  name: string;
  commitEndTs: number;
  marketEndTs: number;
  yesTotal: number; // raw u64 (6 decimals → divide by 1e6 for display)
  noTotal: number;
  total: number;
  commitCount: number;
  minTotal: number;
  launched: boolean;
  winningPriceBps: number;
  market: string; // "" if Pubkey::default()
  /** `true` iff `now < commit_end_ts`. */
  isCommitOpen: boolean;
  /** `true` iff `!launched && now >= commit_end_ts && total >= min_total`. */
  isLaunchReady: boolean;
  /** `true` iff `!launched && now >= commit_end_ts && total < min_total`. */
  isRefundOpen: boolean;
  /** Market launched and still trading (`launched && now < market_end_ts`). */
  isMarketLive: boolean;
  /** Market ended — claim is open (`launched && now >= market_end_ts`). */
  isClaimOpen: boolean;
  /** Implied current price from the commit ratio, in [0, 1]. */
  impliedPrice: number;
}

type VaultPhase = Pick<
  VaultView,
  "isCommitOpen" | "isLaunchReady" | "isRefundOpen" | "isMarketLive" | "isClaimOpen"
>;

function vaultPhase(
  v: Pick<VaultView, "launched" | "commitEndTs" | "marketEndTs" | "total" | "minTotal">,
  now: number,
): VaultPhase {
  const committed = !v.launched && now >= v.commitEndTs;
  return {
    isCommitOpen: !v.launched && now < v.commitEndTs,
    isLaunchReady: committed && v.total >= v.minTotal,
    isRefundOpen: committed && v.total < v.minTotal,
    isMarketLive: v.launched && now < v.marketEndTs,
    isClaimOpen: v.launched && now >= v.marketEndTs,
  };
}

/** Decoded `CommitmentVault` account → display row. */
export function vaultView(publicKey: string, v: CommitmentVaultAccount, now: number): VaultView {
  const yesTotal = bnToNum(v.yesTotal);
  const noTotal = bnToNum(v.noTotal);
  const total = yesTotal + noTotal;
  const vaultId = bnToNum(v.vaultId);
  const base = {
    publicKey,
    vaultId,
    authority: v.authority.toBase58(),
    name: decodeName(v.name) || `Vault #${vaultId}`,
    commitEndTs: bnToNum(v.commitEndTs),
    marketEndTs: bnToNum(v.marketEndTs),
    yesTotal,
    noTotal,
    total,
    commitCount: v.commitCount,
    minTotal: bnToNum(v.minTotal),
    launched: v.launched,
    winningPriceBps: v.winningPriceBps,
    market: pkOrEmpty(v.market),
    impliedPrice: total > 0 ? yesTotal / total : 0.5,
  };
  return { ...base, ...vaultPhase(base, now) };
}

export function refreshVaultView(v: VaultView, now: number): VaultView {
  return { ...v, ...vaultPhase(v, now) };
}

// ----------------------------------------------------------------------------
// Multi-outcome commitment vaults
// ----------------------------------------------------------------------------

export interface VaultGroupLegView {
  index: number;
  name: string;
  total: number; // raw u64 (6 decimals)
  shareBps: number; // 0..10_000
}

export interface VaultGroupView {
  publicKey: string;
  vaultId: number;
  authority: string;
  name: string;
  legCount: number;
  legs: VaultGroupLegView[];
  total: number;
  commitEndTs: number;
  marketEndTs: number;
  commitCount: number;
  minTotal: number;
  /** GroupMarket created? */
  groupMarketInitialized: boolean;
  /** Number of legs whose underlying Market has been launched. */
  legsLaunched: number;
  /** All legs launched. */
  fullyLaunched: boolean;
  groupMarket: string;
  isCommitOpen: boolean;
  isLaunchReady: boolean;
  /** Refund opens when commit ended below min_total OR any leg < 100 bps. */
  isRefundOpen: boolean;
  /** All legs launched and markets still trading (now < market_end_ts). */
  isMarketLive: boolean;
  /** All legs launched and markets ended — claim opens. */
  isClaimOpen: boolean;
}

/** Minimum per-leg share at launch (1%). */
const MIN_LEG_SHARE_BPS = 100;

type VaultGroupPhase = Pick<
  VaultGroupView,
  "isCommitOpen" | "isLaunchReady" | "isRefundOpen" | "isMarketLive" | "isClaimOpen"
>;

function vaultGroupPhase(v: Omit<VaultGroupView, keyof VaultGroupPhase>, now: number) {
  const minShareBps = v.legs.reduce((min, l) => Math.min(min, l.shareBps), 10_000);
  const ended = now >= v.commitEndTs;
  const underfilled = v.total < v.minTotal || minShareBps < MIN_LEG_SHARE_BPS;
  const phase: VaultGroupPhase = {
    isCommitOpen: !v.groupMarketInitialized && !ended,
    isLaunchReady: !v.fullyLaunched && ended && !underfilled,
    isRefundOpen: !v.groupMarketInitialized && ended && underfilled,
    isMarketLive: v.fullyLaunched && now < v.marketEndTs,
    isClaimOpen: v.fullyLaunched && now >= v.marketEndTs,
  };
  return phase;
}

function vaultGroupLegs(v: CommitmentVaultGroupAccount): {
  legs: VaultGroupLegView[];
  total: number;
} {
  const totals = v.legTotals.slice(0, v.legCount).map(bnToNum);
  const total = totals.reduce((a, b) => a + b, 0);
  const legs = totals.map((legTotal, index) => ({
    index,
    name: decodeName(v.legNames[index]) || `Leg ${index}`,
    total: legTotal,
    shareBps: total > 0 ? Math.floor((legTotal * 10_000) / total) : 0,
  }));
  return { legs, total };
}

/** Decoded `CommitmentVaultGroup` account → display row. */
export function vaultGroupView(
  publicKey: string,
  v: CommitmentVaultGroupAccount,
  now: number,
): VaultGroupView {
  const { legs, total } = vaultGroupLegs(v);
  const vaultId = bnToNum(v.vaultId);
  const base = {
    publicKey,
    vaultId,
    authority: v.authority.toBase58(),
    name: decodeName(v.name) || `VaultGroup #${vaultId}`,
    legCount: v.legCount,
    legs,
    total,
    commitEndTs: bnToNum(v.commitEndTs),
    marketEndTs: bnToNum(v.marketEndTs),
    commitCount: v.commitCount,
    minTotal: bnToNum(v.minTotal),
    groupMarketInitialized: v.groupMarketInitialized,
    legsLaunched: v.legsLaunched,
    fullyLaunched: v.groupMarketInitialized && v.legsLaunched === v.legCount,
    groupMarket: pkOrEmpty(v.groupMarket),
  };
  return { ...base, ...vaultGroupPhase(base, now) };
}

export function refreshVaultGroupView(v: VaultGroupView, now: number): VaultGroupView {
  return { ...v, ...vaultGroupPhase(v, now) };
}

// ----------------------------------------------------------------------------
// Bet vaults (Bet Vault v2 — stakes set the odds, winner takes the pot)
// ----------------------------------------------------------------------------

export interface BetVaultView {
  publicKey: string;
  vaultId: number;
  authority: string;
  /** Only key allowed to resolve. */
  resolver: string;
  collateralMint: string;
  name: string;
  commitEndTs: number;
  marketEndTs: number;
  yesTotal: number; // raw (collateral decimals)
  noTotal: number;
  total: number;
  commitCount: number;
  minTotal: number;
  lpBps: number;
  launched: boolean;
  /** Launch odds in bps of YES (0 until launched). */
  priceBps: number;
  /** Launched Market PDA, "" before launch. */
  market: string;
  /** 0 until settled, then 1 = YES, 2 = NO. */
  winningSide: number;
  settled: boolean;
  refunding: boolean;
  voided: boolean;
  voidGraceSecs: number;
  payoutPool: number;
  /** YES share of the stakes so far, in [0, 1] (0.5 when empty). */
  impliedYes: number;
}

/** Decoded `BetVault` account → display row (time-independent). */
export function betVaultView(publicKey: string, v: BetVaultAccount): BetVaultView {
  const yesTotal = bnToNum(v.yesTotal);
  const noTotal = bnToNum(v.noTotal);
  const total = yesTotal + noTotal;
  const vaultId = bnToNum(v.vaultId);
  return {
    publicKey,
    vaultId,
    authority: v.authority.toBase58(),
    resolver: v.resolver.toBase58(),
    collateralMint: v.collateralMint.toBase58(),
    name: decodeName(v.name) || `Bet #${vaultId}`,
    commitEndTs: bnToNum(v.commitEndTs),
    marketEndTs: bnToNum(v.marketEndTs),
    yesTotal,
    noTotal,
    total,
    commitCount: v.commitCount,
    minTotal: bnToNum(v.minTotal),
    lpBps: v.lpBps,
    launched: v.launched,
    priceBps: v.priceBps,
    market: pkOrEmpty(v.market),
    winningSide: v.winningSide,
    settled: v.settled,
    refunding: v.refunding,
    voided: v.voided,
    voidGraceSecs: bnToNum(v.voidGraceSecs),
    payoutPool: bnToNum(v.payoutPool),
    impliedYes: total > 0 ? yesTotal / total : 0.5,
  };
}

/** Where a bet is in its life — mirrors the on-chain checks in instructions/bet/*. */
export type BetPhase =
  /** Taking stakes (now < commit_end_ts). */
  | "staking"
  /** Stakes closed, launchable (both sides, 1–99% odds, ≥ min total). */
  | "launch-ready"
  /** Stakes closed, can never launch → each committer refunds 1:1. */
  | "refundable"
  /** Market trading until market_end_ts. */
  | "live"
  /** Market ended; waiting for the resolver. */
  | "awaiting-resolution"
  /** Market resolved; settle_bet_vault (permissionless) not yet run. */
  | "settle-ready"
  /** Settled: winners claim their share of the pot. */
  | "claimable"
  /** Resolver never resolved; anyone may void → everyone refunds pro-rata. */
  | "voidable"
  /** Voided: every committer claims a pro-rata refund. */
  | "voided";

const MIN_PRICE_BPS = 100;
const MAX_PRICE_BPS = 9900;

/** `marketResolved` comes from the launched market's row (unknown → false). */
export function betPhase(v: BetVaultView, now: number, marketResolved = false): BetPhase {
  if (v.voided) return "voided";
  if (v.settled) return "claimable";
  if (!v.launched) {
    if (now < v.commitEndTs) return "staking";
    const bps = v.total > 0 ? Math.floor((v.yesTotal * 10_000) / v.total) : 0;
    const launchable =
      !v.refunding &&
      v.total >= v.minTotal &&
      v.yesTotal > 0 &&
      v.noTotal > 0 &&
      bps >= MIN_PRICE_BPS &&
      bps <= MAX_PRICE_BPS &&
      now + 300 < v.marketEndTs;
    return launchable ? "launch-ready" : "refundable";
  }
  if (marketResolved) return "settle-ready";
  if (now < v.marketEndTs) return "live";
  return now >= v.marketEndTs + v.voidGraceSecs ? "voidable" : "awaiting-resolution";
}
