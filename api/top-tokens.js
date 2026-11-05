const SOURCES = [
  { name: "DLMM", base: "https://dlmm.datapi.meteora.ag" },
  { name: "DAMM v2", base: "https://damm-v2.datapi.meteora.ag" }
];

const PAGE_SIZE = 1000;
const WINDOW = "24h";

function firstNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function metric(obj, key = WINDOW) {
  if (obj == null) return 0;
  if (typeof obj === "number" || typeof obj === "string") return firstNumber(obj);
  return firstNumber(obj[key], obj[key.toUpperCase()], obj[`${key}_usd`], obj.usd);
}

function tokenInfo(pool, side) {
  const candidates = [
    pool?.[`token_${side}`],
    pool?.[side],
    pool?.tokens?.[side === "x" ? 0 : 1],
    pool?.[`token${side.toUpperCase()}`]
  ];
  const token = candidates.find(v => v && typeof v === "object") || {};
  const symbol = token.symbol || token.ticker || pool?.[`${side}_symbol`] ||
    pool?.[`token_${side}_symbol`] || "UNKNOWN";
  const address = token.address || token.mint || token.public_key ||
    pool?.[`${side}_mint`] || pool?.[`${side}_address`] || "";
  const name = token.name || pool?.[`${side}_name`] || symbol;
  return { symbol: String(symbol), address: String(address), name: String(name) };
}

function poolMetrics(pool) {
  return {
    fees: metric(pool?.fees) || metric(pool?.fee),
    volume: metric(pool?.volume),
    tvl: firstNumber(pool?.tvl, pool?.tvl_usd, pool?.liquidity_usd)
  };
}

async function fetchPools(source) {
  const url = new URL("/pools", source.base);
  url.searchParams.set("page", "1");
  url.searchParams.set("page_size", String(PAGE_SIZE));
  url.searchParams.set("sort_by", "fee_24h:desc");

  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(18000)
  });

  if (!response.ok) {
    throw new Error(`${source.name} API returned HTTP ${response.status}`);
  }

  const json = await response.json();
  const pools = Array.isArray(json) ? json :
    Array.isArray(json?.data) ? json.data :
    Array.isArray(json?.pools) ? json.pools : [];

  return { source: source.name, pools, total: Number(json?.total ?? pools.length) };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  try {
    const results = await Promise.allSettled(SOURCES.map(fetchPools));
    const failures = results
      .filter(r => r.status === "rejected")
      .map(r => r.reason?.message || "Unknown upstream error");
    const datasets = results
      .filter(r => r.status === "fulfilled")
      .map(r => r.value);

    if (!datasets.length) {
      return res.status(502).json({
        error: "Could not retrieve Meteora pool data",
        details: failures
      });
    }

    const tokens = new Map();
    let poolCount = 0;

    for (const dataset of datasets) {
      for (const pool of dataset.pools) {
        poolCount += 1;
        const stats = poolMetrics(pool);
        const poolAddress = pool.address || pool.public_key || pool.pool_address || "";
        const poolName = pool.name || pool.pair || "Meteora pool";
        const pair = [tokenInfo(pool, "x"), tokenInfo(pool, "y")];

        for (const token of pair) {
          if (!token.address && token.symbol === "UNKNOWN") continue;
          const key = token.address || `${token.symbol}:${token.name}`;
          if (!tokens.has(key)) {
            tokens.set(key, {
              address: token.address,
              symbol: token.symbol,
              name: token.name,
              fees24h: 0,
              volume24h: 0,
              tvl: 0,
              poolCount: 0,
              protocols: new Set(),
              pools: []
            });
          }
          const row = tokens.get(key);
          row.fees24h += stats.fees;
          row.volume24h += stats.volume;
          row.tvl += stats.tvl;
          row.poolCount += 1;
          row.protocols.add(dataset.source);
          if (row.pools.length < 5) {
            row.pools.push({
              address: poolAddress,
              name: poolName,
              protocol: dataset.source,
              fees24h: stats.fees,
              volume24h: stats.volume,
              tvl: stats.tvl
            });
          }
        }
      }
    }

    const ranked = [...tokens.values()]
      .sort((a, b) => b.fees24h - a.fees24h)
      .slice(0, 10)
      .map((token, index) => ({
        rank: index + 1,
        ...token,
        protocols: [...token.protocols],
        pools: token.pools.sort((a, b) => b.fees24h - a.fees24h)
      }));

    return res.status(200).json({
      updatedAt: new Date().toISOString(),
      window: WINDOW,
      rankingBasis: "Sum of 24h pool fees for every Meteora pool in which the token appears",
      attributionNote: "Each pool's full fee amount is attributed to both tokens in that pool. This is a token-activity ranking, not a claim that the token itself receives those fees.",
      coverage: {
        poolsScanned: poolCount,
        protocols: datasets.map(d => ({
          name: d.source,
          poolsReturned: d.pools.length,
          indexedPoolCount: d.total
        })),
        partial: failures.length > 0 || datasets.some(d => d.pools.length >= PAGE_SIZE),
        errors: failures
      },
      tokens: ranked
    });
  } catch (error) {
    return res.status(500).json({ error: "Unexpected API error", details: error.message });
  }
}