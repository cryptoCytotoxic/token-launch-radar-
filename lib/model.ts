// Token Launch Radar — the valuation model.
//
// Idea in one paragraph: the snapshot itself tells us what a launched token is
// worth per dollar of TVL, because 144 of its protocols already trade. For each
// category we take the median market-cap/TVL multiple of those traded peers
// (winsorised, so one mania print cannot drag a whole category), then price a
// pre-token protocol as:
//
//   implied value = TVL x category multiple x growth factor x maturity factor
//
// The growth factor reads the protocol's own 7-day TVL change; the maturity
// factor reads how long it has run with no token (days from listed_at to the
// snapshot's as_of). Nothing is hardcoded by name: move a protocol's figures
// and its price moves. Everything below is deterministic — same snapshot in,
// same board out, byte for byte.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  peer_multiple: number;
  growth_factor: number;
  maturity_factor: number;
  on_watchlist: boolean;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  protocol_count: number;
  pre_token_count: number;
  products_set_aside: number;
  live_count: number;
  watchlist_count: number;
  global_multiple: number;
  category_multiples: { category: string; multiple: number; peers: number }[];
  rows: BoardRow[];
}

/** Parse and lightly validate the sealed snapshot's JSON text. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (typeof raw.as_of !== 'string' || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: missing as_of, protocols or watchlist');
  }
  for (const p of raw.protocols) {
    if (typeof p.slug !== 'string' || typeof p.tvl_usd !== 'number') {
      throw new Error('snapshot: a protocol is missing its slug or tvl_usd');
    }
  }
  return raw;
}

/** A protocol records no token when all three token fields are null. */
export function isPreToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null && p.mcap_usd === null;
}

const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * A wrapped, staked or bridged product of a token that already trades is not a
 * launch waiting to happen — WBTC is Bitcoin, USDT0 is Tether, an exchange's
 * own page is not a future token. The watchlist applies this rule at $50M+;
 * the board applies the same rule at every size, so its top ranks are all
 * protocols that could plausibly issue a token of their own.
 */
export function isProductOfTradedToken(p: Protocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return true;
  if (VERSION_SUFFIX.test(p.name)) return true;
  if (PRODUCT_WORD.test(p.name)) return true;
  return EXCHANGE_PREFIXES.some((x) => p.name === x || p.name.startsWith(`${x} `));
}

/** Whole days from an ISO day (YYYY-MM-DD) to another ISO day, or null. */
export function ageInDays(listedAt: string | null, asOf: string): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${listedAt}T00:00:00Z`);
  const b = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Clamp a traded peer's cap/TVL print so outliers cannot set a category's price. */
function winsorise(ratio: number): number {
  return Math.min(4, Math.max(0.02, ratio));
}

/**
 * The peer multiples: one per category, from the snapshot's own traded
 * protocols. A category with fewer than three traded peers is blended toward
 * the global median in proportion to how thin its evidence is.
 */
export function peerMultiples(snapshot: Snapshot): { global: number; byCategory: Map<string, { multiple: number; peers: number }> } {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0);
  const global = median(live.map((p) => winsorise(p.mcap_usd! / p.tvl_usd)));
  const groups = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Uncategorised';
    const list = groups.get(key) ?? [];
    list.push(winsorise(p.mcap_usd! / p.tvl_usd));
    groups.set(key, list);
  }
  const byCategory = new Map<string, { multiple: number; peers: number }>();
  for (const [category, ratios] of groups) {
    const own = median(ratios);
    const weight = Math.min(1, ratios.length / 6);
    byCategory.set(category, { multiple: own * weight + global * (1 - weight), peers: ratios.length });
  }
  return { global, byCategory };
}

/** Growth: a week of TVL change, dampened — a hot week lifts the price, never doubles it. */
export function growthFactor(change7d: number | null): number {
  if (change7d === null) return 1;
  return Math.min(1.45, Math.max(0.72, 1 + 0.38 * Math.tanh(change7d / 22)));
}

/** Maturity: the longer a protocol has run tokenless, the more of its record we credit. */
export function maturityFactor(ageDays: number | null): number {
  if (ageDays === null) return 0.95;
  return 0.88 + 0.24 * (1 - Math.exp(-ageDays / 540));
}

/** Human money for farm plans: $2.75B, $184M, $950K, $12,300. */
export function money(usd: number): string {
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(1)}K`;
  return `$${Math.round(usd)}`;
}

/** Small deterministic hash of a slug, so plan wording varies by protocol, never by run. */
function slugHash(slug: string): number {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Rough one-way gas/fee budget for a chain, in dollars, for honest plan costs. */
function chainCost(chain: string): string {
  if (chain === 'Ethereum') return '$6–$25 in ETH gas per transaction at typical fees';
  if (chain === 'Solana') return 'under $0.05 in SOL fees per transaction';
  if (chain === 'Bitcoin') return '$1–$4 in BTC fees per transaction';
  return '$0.10–$1.50 in gas per transaction on this chain';
}

type PlanKind = 'lending' | 'trading' | 'yield' | 'bridge' | 'generic';

function planKind(category: string | null): PlanKind {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lending') || c.includes('cdp')) return 'lending';
  if (c.includes('dex') || c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return 'trading';
  if (c.includes('yield') || c.includes('farm') || c.includes('vault') || c.includes('curator') || c.includes('staking') || c.includes('restaking')) return 'yield';
  if (c.includes('bridge')) return 'bridge';
  return 'generic';
}

/**
 * A concrete farm plan for one protocol: five steps, each naming the action,
 * a realistic size, what it costs and how long it takes. Wording is templated
 * by the protocol's category and main chain; figures come from its own row.
 */
export function farmSteps(p: Protocol, impliedUsd: number): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const chainList = p.chains.length > 1 ? `${chain} (it also runs on ${p.chains.slice(1, 3).join(' and ')})` : chain;
  const cost = chainCost(chain);
  const kind = planKind(p.category);
  const stake = p.tvl_usd >= 1e9 ? '$1,000–$5,000' : p.tvl_usd >= 1e8 ? '$500–$2,500' : '$250–$1,000';
  const pick = slugHash(p.slug) % 2;
  const open = pick === 0
    ? `Open ${p.name}'s app on ${chainList} and connect a fresh wallet you use only for farming; setup takes about 10 minutes and costs ${cost}.`
    : `Create a dedicated farming wallet, fund it on ${chainList}, and open ${p.name}; connecting and checking the live pools takes about 10 minutes and costs ${cost}.`;
  const core: Record<PlanKind, string> = {
    lending: `Supply ${stake} of a major asset (ETH or a dollar stablecoin) into ${p.name}'s main lending market on ${chain}; supplying costs ${cost} and about 5 minutes, and your position starts earning supply yield the same block.`,
    trading: `Trade on ${p.name} itself: route ${stake} of volume a week through its main market on ${chain} in normal-size swaps; each trade costs ${cost} plus the pool fee shown before you confirm, about 15 minutes a week.`,
    yield: `Deposit ${stake} into ${p.name}'s flagship vault or pool on ${chain}; the deposit costs ${cost} and about 5 minutes, and vault shares begin accruing yield immediately.`,
    bridge: `Bridge ${stake} to ${chain} through ${p.name} and leave the bridged position working on the far side for at least 30 days; the crossing costs ${cost} plus any bridge fee quoted up front, about 20 minutes including confirmations.`,
    generic: `Put ${stake} to work in ${p.name}'s core product on ${chain} — its most-used market or pool, not a side one; starting costs ${cost} and about 10 minutes.`,
  };
  const habit = pick === 0
    ? `Repeat a small action weekly — a deposit top-up, a borrow-and-repay cycle or a claim — so your history spans months, not one weekend; budget 10 minutes and ${cost} per visit.`
    : `Come back once a week for a small repeat action (top up, claim, or rebalance) so the wallet's history with ${p.name} grows steadily; each visit is about 10 minutes and costs ${cost}.`;
  const grow = `Grow the position toward ${money(Math.max(2500, Math.min(25000, p.tvl_usd / 20000)))} over 6–8 weeks if the product keeps working for you; ${p.name} holds ${money(p.tvl_usd)} of TVL, so a steady mid-size position is realistic, and every increase costs ${cost}.`;
  const watch = `Watch ${p.name}'s official channels weekly for a points program, a governance forum or a snapshot vote, and take part the week one appears — early participation windows are usually short, and this radar prices a launch near ${money(impliedUsd)} if its record holds.`;
  return [open, core[kind], habit, grow, watch];
}

/** Score every pre-token protocol and return the ranked board plus the dashboard's data. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { global, byCategory } = peerMultiples(snapshot);
  const watch = new Set(snapshot.watchlist);
  const candidates = snapshot.protocols.filter((p) => isPreToken(p) && !isProductOfTradedToken(p));
  const scored = candidates.map((p) => {
    const peer = byCategory.get(p.category ?? 'Uncategorised');
    const multiple = peer?.multiple ?? global;
    const growth = growthFactor(p.change_7d);
    const age = ageInDays(p.listed_at, snapshot.as_of);
    const maturity = maturityFactor(age);
    const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growth * maturity));
    return { p, multiple, growth, age, maturity, implied };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  let previous = Number.POSITIVE_INFINITY;
  const board: BoardRow[] = scored.map((s, i) => {
    const value = Math.min(s.implied, previous - 1);
    previous = value;
    return {
      slug: s.p.slug,
      name: s.p.name,
      rank: i + 1,
      implied_value_usd: Math.max(1, value),
      farm_steps: farmSteps(s.p, Math.max(1, value)),
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      listed_at: s.p.listed_at,
      age_days: s.age,
      peer_multiple: Math.round(s.multiple * 1000) / 1000,
      growth_factor: Math.round(s.growth * 1000) / 1000,
      maturity_factor: Math.round(s.maturity * 1000) / 1000,
      on_watchlist: watch.has(s.p.slug),
    };
  });
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    protocol_count: snapshot.protocols.length,
    pre_token_count: candidates.length,
    products_set_aside: snapshot.protocols.filter((p) => isPreToken(p) && isProductOfTradedToken(p)).length,
    live_count: snapshot.protocols.filter((p) => p.mcap_usd !== null).length,
    watchlist_count: snapshot.watchlist.length,
    global_multiple: Math.round(global * 1000) / 1000,
    category_multiples: [...byCategory.entries()]
      .map(([category, v]) => ({ category, multiple: Math.round(v.multiple * 1000) / 1000, peers: v.peers }))
      .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1)),
    rows: board,
  };
  return { board, radar };
}

/** The gate's board rules, checked locally so a bad board never leaves the machine. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100–4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  let allSame = true;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (!known.has(row.slug)) return `row ${i + 1}: slug ${row.slug} is not in the snapshot`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.rank !== i + 1) return `row ${i + 1}: rank is ${row.rank}, expected ${i + 1}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `row ${row.slug}: implied value is not a positive whole number`;
    if (row.implied_value_usd > previous) return `row ${row.slug}: implied value rises as rank ascends`;
    if (i > 0 && row.implied_value_usd !== board[0]!.implied_value_usd) allSame = false;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${row.slug}: farm plan holds ${row.farm_steps.length} steps, outside 3–12`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${row.slug}: a farm step is ${len} characters, outside 20–600`;
    }
  }
  if (allSame) return 'every implied value is the same: that is not a ranking';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  return null;
}

/** The dashboard's data as a script: window.RADAR = { ... }; */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
