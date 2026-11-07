#!/usr/bin/env python3
"""Refresh dist/network-snapshot.json from the public mempool.space API.

The browser fetches these endpoints live; this snapshot is only the offline
fallback so the network views never render empty. Run from the repo root:

    python3 scripts/snapshot-network.py
"""
import datetime, json, pathlib, urllib.request

API = "https://mempool.space/api"
OUT = pathlib.Path(__file__).resolve().parent.parent / "dist" / "network-snapshot.json"
BLOCK_KEYS = ("id", "height", "timestamp", "tx_count", "size", "weight", "difficulty")
EXTRA_KEYS = ("reward", "totalFees", "medianFee", "feeRange", "avgFeeRate", "pool")


def get(path):
    req = urllib.request.Request(API + path, headers={"User-Agent": "bitcoin-observatory-snapshot"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def slim_block(b):
    out = {k: b[k] for k in BLOCK_KEYS}
    ex = b.get("extras", {})
    out["extras"] = {k: ex[k] for k in EXTRA_KEYS if k in ex}
    if "pool" in out["extras"]:
        out["extras"]["pool"] = {"name": ex["pool"].get("name"), "slug": ex["pool"].get("slug")}
    return out


def main():
    snap = {
        "fetched": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "fees": get("/v1/fees/precise"),
        "mempool": get("/mempool"),
        "mempoolBlocks": get("/v1/fees/mempool-blocks"),
        "blocks": [slim_block(b) for b in get("/v1/blocks")],
        "difficulty": get("/v1/difficulty-adjustment"),
        "hashrate": get("/v1/mining/hashrate/1y"),
        "pools": get("/v1/mining/pools/1w"),
        "rewards": get("/v1/mining/reward-stats/144"),
        "lightning": get("/v1/lightning/statistics/latest"),
        "lightningHistory": get("/v1/lightning/statistics/1y"),
        "prices": get("/v1/prices"),
    }
    OUT.write_text(json.dumps(snap, separators=(",", ":")))
    print(f"Wrote {OUT} ({OUT.stat().st_size:,} bytes) at block {snap['blocks'][0]['height']}")


if __name__ == "__main__":
    main()
