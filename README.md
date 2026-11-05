# Meteora Fee Leaders — Vercel + Node.js

Read-only dashboard ranking the 10 tokens most frequently associated with fees in Meteora DLMM and DAMM v2 pools over the rolling 24-hour window.

## Why this uses Meteora's Data APIs

Meteora publishes indexed, read-only pool APIs. The project calls:

- `https://dlmm.datapi.meteora.ag/pools`
- `https://damm-v2.datapi.meteora.ag/pools`

The `/pools` endpoints support pagination and sorting by fee metrics. The backend requests the first 1,000 pools from each program, sorted by `fee_24h:desc`, then groups the returned pools by token mint address.

This dashboard does not need a wallet, signer, private key, or Solana transaction. The indexed API is a better fit than scanning raw Solana accounts for this read-only ranking. `@solana/web3.js` can be added later if you need direct RPC/account decoding.

## Ranking definition (important)

For every fetched pool, the full `fees.24h` value is added to both tokens in the pair. The dashboard then sums those amounts for each token mint and sorts descending.

That means:
- It measures fee activity in pools where a token appears.
- It is **not** the amount of fees distributed to token holders or a token's market-cap ranking.
- A pool's fee amount is counted once for each of its two tokens, so do not add all token rows together and interpret that as protocol-wide fees.
- TVL and volume are also attributed to both tokens, and therefore overlap.

The first 1,000 pools per program are fetched. The UI marks coverage as partial if a source reaches that page limit. A future enhancement can paginate all pool pages or add DBC once a stable public data endpoint is selected.

## Run locally

Requirements: Node.js 20+.

```bash
npm install
npm run dev
```

Open the local URL printed by Vercel CLI (normally `http://localhost:3000`).

## Deploy to Vercel

1. Create a Git repository and push this project.
2. In Vercel, choose **Add New → Project** and import the repository.
3. No environment variables are required for the public Meteora endpoints.
4. Deploy. The static frontend is served from `public/`; API functions are in `api/`.

## API

`GET /api/top-tokens`

Returns:
- `tokens`: top 10 token rows
- `coverage`: source and pool coverage metadata
- `updatedAt`: server timestamp
- `rankingBasis` and `attributionNote`: methodology details

`GET /api/health` — simple health check.

The API response is cached at the Vercel edge for 60 seconds, with stale-while-revalidate for 120 seconds.

## Notes

- The upstream data is indexed data and may lag the chain.
- Upstream field formats can evolve. The backend has small fallback normalizers for common response shapes; if Meteora changes its schema, update `tokenInfo()` / `poolMetrics()` in `api/top-tokens.js`.
- This is an analytics display only. It does not connect a wallet or submit transactions.
