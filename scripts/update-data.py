#!/usr/bin/env python3
"""Keep dist/data.json current. Run daily by .github/workflows/update-data.yml.

- Prices: the existing history (Coin Metrics Community Data, which stopped
  publishing PriceUSD after 2026-05-23) is kept as-is and extended with
  Coinbase Exchange daily closes for every completed UTC day since.
- CPI: U.S. CPI-U all items, not seasonally adjusted, monthly. BLS series
  CUUR0000SA0, with the identical FRED series CPIAUCNS as a fallback.
- Snapshot: supply computed exactly from the current block height.

Each source is optional: if one fails, its previous values are kept and the
script still succeeds, so the site never loses data because an API hiccupped.
Usage (from the repo root):  python3 scripts/update-data.py
"""
import csv, datetime as dt, io, json, pathlib, sys, time, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "dist" / "data.json"
UA = {"User-Agent": "bitcoin-observatory-updater"}
DAY = 86400


def get(url, timeout=30, tries=3):
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read()
        except Exception as exc:  # noqa: BLE001 - network errors of every kind are retried
            if attempt == tries - 1:
                raise
            print(f"  retry {url}: {exc}", file=sys.stderr)
            time.sleep(2 ** attempt * 2)


def coinbase_daily(start: dt.date, end: dt.date):
    """Daily closes for start..end inclusive (UTC days), max 300 candles per request."""
    out = {}
    cur = start
    while cur <= end:
        stop = min(end, cur + dt.timedelta(days=290))
        url = ("https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400"
               f"&start={cur.isoformat()}T00:00:00Z&end={(stop + dt.timedelta(days=1)).isoformat()}T00:00:00Z")
        for t, low, high, open_, close, vol in json.loads(get(url)):
            d = dt.datetime.fromtimestamp(t, dt.timezone.utc).date()
            if start <= d <= end and close > 0:
                out[d.isoformat()] = round(float(close), 2)
        cur = stop + dt.timedelta(days=1)
        time.sleep(0.4)
    return out


def update_prices(data):
    prices = data["prices"]
    last = dt.date.fromisoformat(prices[-1][0])
    yesterday = dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=1)
    if last >= yesterday:
        print(f"prices: already through {last}")
        return 0
    closes = coinbase_daily(last + dt.timedelta(days=1), yesterday)
    added = 0
    for day in sorted(closes):
        if day > prices[-1][0]:
            prices.append([day, closes[day]])
            added += 1
    print(f"prices: +{added} Coinbase daily closes, now through {prices[-1][0]}")
    return added


def cpi_from_bls():
    """Official source. The keyless v1 API returns roughly the last three years."""
    body = json.loads(get("https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0"))
    if body.get("status") != "REQUEST_SUCCEEDED":
        raise RuntimeError(" ".join(body.get("message") or ["BLS request not processed"]))
    out = {}
    for obs in body["Results"]["series"][0]["data"]:
        if not obs["period"].startswith("M") or obs["period"] == "M13":
            continue
        try:
            out[f"{obs['year']}-{obs['period'][1:]}"] = float(obs["value"])
        except ValueError:  # BLS marks unpublished months with "-"
            continue
    return out


def cpi_from_fred():
    """Same series (CPIAUCNS) mirrored by the St. Louis Fed, full history as CSV."""
    text = get("https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCNS&cosd=2010-01-01", timeout=60).decode()
    out = {}
    for row in csv.reader(io.StringIO(text)):
        if len(row) == 2 and row[0][:4].isdigit() and row[1] not in ("", "."):
            out[row[0][:7]] = float(row[1])
    return out


def update_cpi(data):
    before = max(data["cpi"])
    for name, fetch in (("BLS", cpi_from_bls), ("FRED", cpi_from_fred)):
        try:
            fresh = fetch()
        except Exception as exc:  # noqa: BLE001
            print(f"cpi: {name} failed ({exc})", file=sys.stderr)
            continue
        data["cpi"].update(fresh)  # merge: never drop months we already have
        data["cpi"] = dict(sorted(data["cpi"].items()))
        print(f"cpi: {name} ok, latest {max(data['cpi'])} (was {before})")
        return
    print("cpi: all sources failed; keeping existing values", file=sys.stderr)


def supply_at(height):
    sats = 0
    for era in range(64):
        start = era * 210000
        if start > height:
            break
        sats += (min(height, start + 209999) - start + 1) * (50 * 10**8 >> era)
    return sats / 1e8


def update_snapshot(data):
    snap = data.setdefault("snapshot", {})
    last_date, last_price = data["prices"][-1]
    snap["date"] = last_date
    try:
        height = int(get("https://mempool.space/api/blocks/tip/height"))
        snap["supply"] = supply_at(height)
        snap["height"] = height
        hr = json.loads(get("https://mempool.space/api/v1/mining/hashrate/3d"))
        snap["hashRate"] = hr["currentHashrate"] / 1e12  # TH/s, same unit as Coin Metrics
    except Exception as exc:  # noqa: BLE001
        print(f"snapshot: mempool.space failed ({exc}); keeping supply", file=sys.stderr)
    snap["marketCap"] = snap["supply"] * last_price
    data["sources"] = {
        "prices": "Coin Metrics Community Data through 2026-05-23, then Coinbase Exchange daily closes (UTC)",
        "cpi": "BLS CUUR0000SA0 (FRED CPIAUCNS as fallback)",
        "updated": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
    }


def main():
    data = json.loads(DATA.read_text())
    try:
        update_prices(data)
    except Exception as exc:  # noqa: BLE001
        print(f"prices: Coinbase failed ({exc}); keeping existing history", file=sys.stderr)
    update_cpi(data)
    update_snapshot(data)
    DATA.write_text(json.dumps(data, separators=(",", ":")))
    print(f"wrote {DATA.relative_to(ROOT)} ({DATA.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
