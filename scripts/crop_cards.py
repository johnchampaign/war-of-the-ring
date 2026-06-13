#!/usr/bin/env python3
"""crop_cards.py — Download publisher card sheets (publicly hosted on Steam CDN,
per asset-urls.json) and crop individual cards to local PNGs for DEV-ONLY
reading/verification of card text. Nothing here is committed or redistributed:
sheets cache to tmp_sheets/ and crops go to tmp_cards/ (both gitignored).

Usage:
  python scripts/crop_cards.py --sheet-url 143026705      # all cards on that sheet
  python scripts/crop_cards.py --name "Strider: Dunadan"  # cards whose name matches
  python scripts/crop_cards.py --all                      # everything (large!)

Each crop is upscaled 3x for legible vision reading (framework OCR recipe:
"crop to the field, upscale"). Pad slightly to avoid clipping borders.
"""
import argparse, json, os, re, urllib.request
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SHEETS = ROOT / "tmp_sheets"
CROPS = ROOT / "tmp_cards"
SHEETS.mkdir(exist_ok=True); CROPS.mkdir(exist_ok=True)

data = json.loads((ROOT / "assets" / "asset-urls.json").read_text(encoding="utf-8"))
sheets, cards = data["sheets"], data["cards"]

ap = argparse.ArgumentParser()
ap.add_argument("--sheet-url"); ap.add_argument("--name"); ap.add_argument("--all", action="store_true")
ap.add_argument("--scale", type=float, default=3.0)
args = ap.parse_args()

def want(c):
    if args.all: return True
    if args.sheet_url and args.sheet_url in sheets[c["sheetId"]]["url"]: return True
    if args.name and args.name.lower() in c["name"].lower(): return True
    return False

picks = [c for c in cards if want(c)]
print(f"{len(picks)} cards selected")

def sheet_img(sid):
    p = SHEETS / f"{sid}.png"
    if not p.exists():
        url = sheets[sid]["url"]
        print(f"  downloading sheet {sid} ...")
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        p.write_bytes(urllib.request.urlopen(req, timeout=60).read())
    return Image.open(p).convert("RGB")

def slug(s):
    return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", s.lower()))

cache = {}
for c in picks:
    sid = c["sheetId"]
    if sid not in cache: cache[sid] = sheet_img(sid)
    img = cache[sid]
    W, H = img.size
    x, y, w, h = c["region"]
    pad = 0.004
    L = max(0, int((x - pad) * W)); T = max(0, int((y - pad) * H))
    R = min(W, int((x + w + pad) * W)); B = min(H, int((y + h + pad) * H))
    crop = img.crop((L, T, R, B))
    crop = crop.resize((int(crop.width * args.scale), int(crop.height * args.scale)), Image.LANCZOS)
    name = f"{slug(c['name'])[:40]}__{sid}.png"
    crop.save(CROPS / name)
    print(f"  {name}")
print(f"crops in {CROPS}")
