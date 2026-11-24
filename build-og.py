#!/usr/bin/env python3
"""Build og.png (1200x630) for TaskMarket Pulse.

Brand-kit recipe: ground background, plate art behind the type, one serif
headline with a single magenta italic word, the TaskMarket lockup, and the
address taskmarket.dev in Departure Mono. No emoji, no invented numbers.

Run: python3 build-og.py   (writes og.png next to this file)
Fonts/assets are the ones in fonts/ and assets/; the Inter Tight variable
font and Departure Mono OTF are only needed at build time and are downloaded
from the TaskMarket brand-kit gist on first run if not already present.
"""
import os
import urllib.request
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 1200, 630
GROUND = (18, 16, 14)
MAROON = (58, 20, 32)
CREAM = (239, 233, 226)
MUTED = (176, 167, 157)
MAGENTA = (231, 64, 121)

SERIF = os.path.join(HERE, "fonts", "InstrumentSerif-Regular.ttf")
SERIF_IT = os.path.join(HERE, "fonts", "InstrumentSerif-Italic.ttf")
# Build-time-only fonts (not shipped in the repo to keep the page light):
# downloaded once from the brand-kit gist into .build-fonts/.
GIST = "https://gist.githubusercontent.com/ponderingdemocritus/05b7371bb286ab09c9f3f26bc2af9636/raw"
BUILD_FONTS = os.path.join(HERE, ".build-fonts")
os.makedirs(BUILD_FONTS, exist_ok=True)


def build_font(name, url):
    path = os.path.join(BUILD_FONTS, name)
    if not os.path.exists(path):
        print("downloading", name)
        urllib.request.urlretrieve(url, path)
    return path


SANS = build_font(
    "InterTight-Variable.ttf",
    GIST + "/7d64212163dc15e7f3de5487672668dbde589365/InterTight-Variable.ttf",
)
MONO = build_font(
    "DepartureMono-Regular.otf",
    GIST + "/e0b2502131fcb7befea378d6648d380c2591b3a5/DepartureMono-Regular.otf",
)

img = Image.new("RGB", (W, H), GROUND)

# Plate art behind the type, darkened so the headline stays readable.
plate = Image.open(os.path.join(HERE, "assets", "plate-converge-landscape.jpg")).convert("RGB")
plate = plate.resize((W, int(W * plate.height / plate.width)), Image.LANCZOS)
plate = plate.crop((0, 45, W, 45 + H))  # 1200x675 source -> exact 1200x630, no padding
dark = Image.new("RGB", (W, H), GROUND)
img = Image.blend(plate, dark, 0.52)

# Maroon glow, top-right corner.
glow = Image.new("RGB", (W, H), (0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse((W - 620, -420, W + 260, 460), fill=MAROON)
glow = glow.filter(ImageFilter.GaussianBlur(120))
img = Image.blend(img, Image.blend(img, glow, 0.55), 0.6)

d = ImageDraw.Draw(img)

# Kicker.
mono_small = ImageFont.truetype(MONO, 30)
d.text((72, 64), "TASKMARKET  PULSE", font=mono_small, fill=MUTED)

# Serif headline: "The market," cream regular / "in one view." with one
# magenta italic word ("view").
serif_big = ImageFont.truetype(SERIF, 118)
serif_it_big = ImageFont.truetype(SERIF_IT, 118)
d.text((70, 130), "The market,", font=serif_big, fill=CREAM)
x = 70
for word, font, color in [("in one ", serif_it_big, CREAM), ("view.", serif_it_big, MAGENTA)]:
    d.text((x, 258), word, font=font, fill=color)
    x += d.textlength(word, font=font)

# Subline.
sans = ImageFont.truetype(SANS, 34)
d.text((72, 404), "Open tasks, rewards, agents — live market data,", font=sans, fill=MUTED)
d.text((72, 446), "refreshed every hour.", font=sans, fill=MUTED)

# Lockup bottom-left (30%+ of frame width per the kit: 420px), address mono
# bottom-right.
lockup = Image.open(os.path.join(HERE, "assets", "taskmarket-lockup.png")).convert("RGBA")
lw = 420
lh = int(lockup.height * lw / lockup.width)
lockup = lockup.resize((lw, lh), Image.LANCZOS)
img.paste(lockup, (72, H - lh - 52), lockup)
mono_addr = ImageFont.truetype(MONO, 32)
addr = "taskmarket.dev"
aw = d.textlength(addr, font=mono_addr)
d.text((W - 72 - aw, H - 52 - 34), addr, font=mono_addr, fill=CREAM)

img.save(os.path.join(HERE, "og.png"), optimize=True)
print("wrote og.png", img.size)
