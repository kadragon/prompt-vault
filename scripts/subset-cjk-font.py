#!/usr/bin/env python3
"""Rebuild public/fonts/PromptVaultCJK-{Regular,Bold}.otf from Noto Sans CJK JP.

The PDF exporter draws Hangul and Latin with Jetendard; everything Jetendard lacks
that a ja/zh conversation needs — kana, CJK punctuation, full-width forms, and the
common hanzi/kanji — comes from this subset of Noto Sans CJK (SIL OFL 1.1, see
public/fonts/OFL-NotoSansCJK.txt). The full faces are ~16 MB each; the subset keeps
the repertoire of three national standard character sets instead:

  - JIS X 0208 (levels 1 + 2, via the euc_jp codec)  — Japanese
  - GB 2312 (via the gb2312 codec)                   — Simplified Chinese
  - Big5 (via the big5 codec)                        — Traditional Chinese
  - Jōyō kanji (Unihan kJoyoKanji)                   — Japanese school/official set,
                                                       incl. ones outside JIS X 0208 (塡)
  - Tongyong Guifan Hanzi Biao level 1 (Unihan kTGH 1–3500) — the PRC's common
                                                       characters, incl. GBK-only ones (啰)

plus the whole kana / CJK-symbol / half- and full-width-form blocks, minus every code
point Jetendard already draws (those never reach the CJK face). Characters outside the
subset keep exporting as tofu boxes and are reported to the user as before.

Usage (fonttools is a build-time tool only; nothing here ships):

  python3 -m venv .venv && .venv/bin/pip install fonttools
  curl -LO https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf
  curl -LO https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansCJKjp-Bold.otf
  curl -LO https://www.unicode.org/Public/16.0.0/ucd/Unihan.zip
  .venv/bin/python scripts/subset-cjk-font.py <dir holding the two .otf files and Unihan.zip>
  node scripts/gen-pdf-charmap.mjs

The source hashes are pinned so a re-run on an updated upstream release is a
deliberate change, not a silent one.
"""

import hashlib
import sys
import zipfile
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

REPO = Path(__file__).resolve().parent.parent
FONTS = REPO / "public" / "fonts"

SOURCES = {
    "Regular": ("NotoSansCJKjp-Regular.otf", "68a3fc98800b2a27b371f2fb79991daf3633bd89309d4ffaa6946fd587f375b5"),
    "Bold": ("NotoSansCJKjp-Bold.otf", "e53dcb0dcb2922e45d01aae1ebd2f382bb81d4229b18b6b883bd170678af1f76"),
}

UNIHAN = ("Unihan.zip", "b8f000df69de7828d21326a2ffea462b04bc7560022989f7cc704f10521ef3e0")  # Unicode 16.0.0

# Whole blocks a ja/zh conversation leans on regardless of the codec repertoires.
BLOCKS = [
    (0x3000, 0x303F),  # CJK Symbols and Punctuation
    (0x3040, 0x309F),  # Hiragana
    (0x30A0, 0x30FF),  # Katakana
    (0x31F0, 0x31FF),  # Katakana Phonetic Extensions
    (0xFF00, 0xFFEF),  # Halfwidth and Fullwidth Forms
]


def codec_repertoire(codec: str) -> set[int]:
    """Every non-ASCII code point a two-byte sequence of `codec` decodes to."""
    found: set[int] = set()
    for lead in range(0x81, 0xFF):
        for trail in range(0x40, 0xFF):
            try:
                text = bytes([lead, trail]).decode(codec)
            except UnicodeDecodeError:
                continue
            found.update(ord(c) for c in text if ord(c) >= 0x80)
    return found


def unihan_lists(path: Path) -> set[int]:
    """The jōyō kanji and level-1 Tongyong Guifan characters, from Unihan_OtherMappings.txt.

    A kJoyoKanji value is either the list year or `U+XXXX`, the form the list itself prints
    when the field's own code point is a variant of it (剝 → 剥); both are wanted.
    A kTGH value is `2013:<index>`; indices 1–3500 are level 1.
    """
    found: set[int] = set()
    with zipfile.ZipFile(path) as archive:
        text = archive.read("Unihan_OtherMappings.txt").decode("utf-8")
    for line in text.splitlines():
        if line.startswith("#") or not line.strip():
            continue
        code, field, value = line.split("\t")
        if field == "kJoyoKanji":
            found.add(int(code[2:], 16))
            found.update(int(v[2:], 16) for v in value.split() if v.startswith("U+"))
        elif field == "kTGH" and any(int(v.split(":")[1]) <= 3500 for v in value.split()):
            found.add(int(code[2:], 16))
    return found


def verified(path: Path, digest: str) -> Path:
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != digest:
        sys.exit(f"{path.name}: sha256 {actual} does not match the pinned {digest}")
    return path


def jetendard_coverage() -> set[int]:
    """Code points BOTH Jetendard faces draw — the set src/export/pdf.ts keeps on Jetendard."""
    faces = [TTFont(FONTS / f"Jetendard-{w}.ttf") for w in ("Regular", "Bold")]
    sets = [set(face.getBestCmap()) for face in faces]
    return sets[0] & sets[1]


def main(source_dir: Path) -> None:
    wanted: set[int] = set()
    for codec in ("euc_jp", "gb2312", "big5"):
        wanted |= codec_repertoire(codec)
    wanted |= unihan_lists(verified(source_dir / UNIHAN[0], UNIHAN[1]))
    for start, end in BLOCKS:
        wanted.update(range(start, end + 1))
    wanted -= jetendard_coverage()

    for weight, (name, digest) in SOURCES.items():
        path = verified(source_dir / name, digest)
        options = subset.Options()
        # No GSUB closure: locl/aalt/vert would pull in the TC/SC/KR alternates of every glyph
        # (roughly doubling the file) and the exporter lays text out horizontally, unlocalized.
        options.layout_features = []
        options.name_IDs = ["*"]
        options.notdef_outline = True
        options.hinting = False  # print-only output; CFF hints add bytes for no PDF benefit
        options.desubroutinize = False
        font = TTFont(path)
        subsetter = subset.Subsetter(options)
        subsetter.populate(unicodes=wanted)
        subsetter.subset(font)
        out = FONTS / f"PromptVaultCJK-{weight}.otf"
        font.save(out)
        covered = len(font.getBestCmap())
        print(f"{out.relative_to(REPO)}: {out.stat().st_size:,} bytes, {covered:,} code points")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: subset-cjk-font.py <dir holding NotoSansCJKjp-{Regular,Bold}.otf and Unihan.zip>")
    main(Path(sys.argv[1]))
