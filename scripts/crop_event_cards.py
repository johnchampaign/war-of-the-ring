#!/usr/bin/env python3
"""crop_event_cards.py — Crop all 96 base event cards (from assets/event-cards.json)
to local high-res PNGs for DEV-ONLY vision reading of card text. Sheets cache by
URL (the cards share a few publisher sheets); crops go to tmp_cards/event/ — both
gitignored, nothing committed/redistributed.

Usage: python scripts/crop_event_cards.py [--scale 4] [--only fp-char-01,...]
"""
import argparse, json, urllib.request
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SHEETS = ROOT / "tmp_sheets"; CROPS = ROOT / "tmp_cards" / "event"
SHEETS.mkdir(parents=True, exist_ok=True); CROPS.mkdir(parents=True, exist_ok=True)

asset = json.loads((ROOT / "assets" / "asset-urls.json").read_text(encoding="utf-8"))
sheets = asset["sheets"]
cards = json.loads((ROOT / "assets" / "event-cards.json").read_text(encoding="utf-8"))["cards"]

ap = argparse.ArgumentParser()
ap.add_argument("--scale", type=float, default=4.0)
ap.add_argument("--only", default="")
args = ap.parse_args()
only = set(s.strip() for s in args.only.split(",") if s.strip())

url_cache = {}
def sheet_by_url(url):
    if url not in url_cache:
        safe = url.rstrip("/").split("/")[-1][:16]
        p = SHEETS / f"u_{safe}.png"
        if not p.exists():
            print(f"  downloading {safe} ...")
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            p.write_bytes(urllib.request.urlopen(req, timeout=90).read())
        url_cache[url] = Image.open(p).convert("RGB")
    return url_cache[url]

picks = [c for c in cards if not only or c["id"] in only]
print(f"{len(picks)} cards")
for c in picks:
    url = sheets[c["sheetId"]]["url"]
    img = sheet_by_url(url)
    W, H = img.size
    x, y, w, h = c["region"]
    pad = 0.003
    box = (max(0, int((x - pad) * W)), max(0, int((y - pad) * H)),
           min(W, int((x + w + pad) * W)), min(H, int((y + h + pad) * H)))
    crop = img.crop(box)
    crop = crop.resize((int(crop.width * args.scale), int(crop.height * args.scale)), Image.LANCZOS)
    crop.save(CROPS / f"{c['id']}.png")
print(f"crops in {CROPS}")
