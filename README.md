# Bitcoin Observatory

A responsive, buildless Bitcoin dashboard that turns market and network data into something easy to digest: daily historical prices, an ordinary least-squares power-law fit in log space, monthly CPI adjustment, drawdowns, live Coinbase spot quotes, live mempool and fee data, blocks and mining, supply and halvings, Lightning, and a plain-language Bitcoin 101 guide.

Serve `dist/` with any static HTTP server. There is no build step or production package dependency. The deployment manifest is `.openai/hosting.json`.

## Views

| Group | View | What it shows |
| --- | --- | --- |
| Market | Overview | Price metrics, a live **network pulse** (block height, next-block fee, mempool, hashrate, difficulty, halving countdown, sats per dollar, market cap), spot and long-term charts |
| Market | Spot price · Power law · Adjusted price · Market cycles | Interactive charts described below |
| Network | Mempool & fees | Fee tiers with the dollar cost of common transaction types, projected vs. just-mined blocks coloured by fee rate, mempool totals, a "where would my transaction land?" slider, and the fee-rate distribution |
| Network | Blocks & mining | 1-year hashrate (7-day average) and difficulty, next difficulty adjustment, weekly mining-pool share, hashprice and recent blocks |
| Network | Supply & halving | Halving countdown, exact issued supply from the current block height, inflation and stock-to-flow, the issuance curve and every reward era |
| Network | Lightning | Public capacity, channels, nodes, Tor/clearnet split and what a payment costs vs. on-chain |
| Learn | Bitcoin 101 | BTC / sats / fiat converter, concept cards linking to live views, protocol numbers and a searchable glossary |

## Network data

Network views use the public [mempool.space REST API](https://mempool.space/docs/api/rest) directly from the browser. Fast data (fees, mempool, blocks, difficulty, prices) refreshes every minute; hashrate, pools, rewards and Lightning every 15 minutes. When a request fails, the last good value or the timestamped fallback `dist/network-snapshot.json` is shown and labelled. Refresh the fallback with:

```bash
python3 scripts/snapshot-network.py
```

Circulating supply is computed exactly from block height and the issuance schedule (lost coins are not subtracted). Fee costs assume native SegWit sizes (simple payment ≈ 141 vB). Future halving dates use the current epoch's average block time.

## Market data

Historical dataset: Coin Metrics Community Data, daily observations from 2010-07-18 through 2026-05-23. CPI source: BLS CUUR0000SA0, monthly observations from January 2010 through August 2026. Missing CPI months use the last available prior observation. Coinbase Exchange spot quotes and candles refresh every minute in the browser; failure is visibly labeled and falls back to a recent cached quote or the historical snapshot. A spot quote does not extend the historical series.

The default envelope is calibrated to contain every loaded historical price, including record-setting cycle peaks; it is not a forecast interval. Optional statistical bands use historical residual standard deviations and may exclude peaks. The upper curve fits record-setting local maxima within ±365 daily observations, then shifts to clear the maximum historical residual. The lower curve shifts the central fit below its minimum historical residual. Both use a 0.005-log-unit margin. Recent spot charts fetch public Coinbase Exchange OHLC data (5-minute, hourly, 6-hour, daily resolutions) and support zoom, pan, crosshairs, line/candle display, and CSV export. Unavailable market data falls back to timestamped saved candles in `spot-snapshot.json`. The methodology dialog documents the exact formulas and sources.

Chart interactions: both charts support wheel/pinch and button zoom, drag/arrow-key pan, and reset. The spot chart pins a candle on click/tap; a second selection shows the absolute and percentage change between two closes. Enter selects the hovered or center point and Escape clears. The long-term tooltip and pinned panel show the active envelope’s upper and lower prices alongside the observed price, fitted trend, and multiplier, including CPI adjustment when selected. Future model dates display no observed price or multiplier.
