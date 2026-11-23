# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/cryptoCytotoxic/token-launch-radar-/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/cryptoCytotoxic/token-launch-radar-/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar prices every protocol in the sealed DefiLlama snapshot that records no token and is not a wrapped, staked or bridged product of one that trades — 198 of them, the whole $50M+ watchlist included — at what a token launch would be worth on its own figures, and gives each one a concrete, costed farm plan. The model is stated on the dashboard itself: implied value = TVL × category peer multiple (the median market-cap/TVL of the snapshot's own traded protocols in that category, winsorised) × a growth factor from its 7-day TVL change × a maturity factor from how long it has run tokenless. No protocol is priced by name.

The dashboard is a static page that renders with no network: a sortable, filterable board, a detail view for every protocol showing the value breakdown, and its farm steps.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) reads the snapshot, writes `board.json` and `data.js`, copies `dashboard/` and `screenshots/` into the output, and writes `dossier.json` with the vendored `buildDossier`. Open `out/dashboard/index.html` in a browser to read the radar.

---

Entered on [make.fun](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
