"""Builds media/otari-icons.woff: the Otari mark as one glyph, U+E000, for the status bar's $(otari-logo) icon.

Run with `uvx --from fonttools python scripts/build-icon-font.py`. VS Code shows a contributed icon only from a
font, and draws the glyph in the status bar's own foreground color, so the mark's fill is ignored.
"""

import re
import sys
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.svgLib.path import parse_path

ROOT = Path(__file__).resolve().parent.parent
svg = (ROOT / "media" / "otari-mark.svg").read_text()
path = re.search(r'<path[^>]*\sd="([^"]+)"', svg)
viewbox = re.search(r'viewBox="([\d.\s-]+)"', svg)
if not path or not viewbox:
    sys.exit("No path or viewBox in the mark")
_, _, width, height = (float(value) for value in viewbox.group(1).split())

UPM = 1000
# Fit the mark in the em box with a little margin, centered, with the y axis flipped (fonts grow upward).
scale = UPM * 0.9 / max(width, height)
dx = (UPM - width * scale) / 2
dy = (UPM - height * scale) / 2 - UPM * 0.1  # sit slightly below center, as codicons do relative to the baseline

glyph_pen = TTGlyphPen(None)
pen = TransformPen(Cu2QuPen(glyph_pen, max_err=1.0, reverse_direction=True), (scale, 0, 0, -scale, dx, UPM - dy - UPM * 0.1))
parse_path(path.group(1), pen)

builder = FontBuilder(UPM, isTTF=True)
builder.setupGlyphOrder([".notdef", "otari"])
builder.setupCharacterMap({0xE000: "otari"})
builder.setupGlyf({".notdef": TTGlyphPen(None).glyph(), "otari": glyph_pen.glyph()})
builder.setupHorizontalMetrics({".notdef": (UPM, 0), "otari": (UPM, 0)})
builder.setupHorizontalHeader(ascent=int(UPM * 0.9), descent=-int(UPM * 0.1))
builder.setupNameTable({"familyName": "Otari Icons", "styleName": "Regular"})
builder.setupOS2(sTypoAscender=int(UPM * 0.9), sTypoDescender=-int(UPM * 0.1), usWinAscent=int(UPM * 0.9), usWinDescent=int(UPM * 0.1))
builder.setupPost()
builder.font.flavor = "woff"
builder.save(ROOT / "media" / "otari-icons.woff")
print("Wrote media/otari-icons.woff")
