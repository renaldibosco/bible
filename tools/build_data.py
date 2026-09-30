#!/usr/bin/env python3
"""
Builds the Bible text files the app reads.

Output: app/src/main/assets/data/<lang>/<NN>.json   (NN = 01..66)
Each file is a list of chapters; each chapter is a list of [label, text]
pairs, e.g. [["1", "In the beginning..."], ["2-3", "..."]].

  python3 tools/build_data.py kjv  <folder with aruljohn/Bible-kjv json files>
  python3 tools/build_data.py usfm <lang> <folder or .zip of USFM files>
  python3 tools/build_data.py check
"""
import io
import json
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "app", "src", "main", "assets", "data")

CODES = ("GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB "
         "PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG "
         "ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT "
         "PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV").split()

KJV_FILES = ["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua",
             "Judges", "Ruth", "1 Samuel", "2 Samuel", "1 Kings", "2 Kings",
             "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther", "Job",
             "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon", "Isaiah",
             "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos",
             "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai",
             "Zechariah", "Malachi", "Matthew", "Mark", "Luke", "John", "Acts",
             "Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians",
             "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians",
             "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews", "James",
             "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude", "Revelation"]


def tidy(s):
    s = s.replace("\u00a0", " ").replace("~", "\u00a0")
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"\s+([,.;:!?\u0964\u0965])", r"\1", s)   # no space before punctuation
    s = re.sub(r"([\u201c\u2018(\[])\s+", r"\1", s)
    s = re.sub(r"\s+([\u201d\u2019)\]])", r"\1", s)
    return s


def write_book(lang, index, chapters):
    folder = os.path.join(OUT, lang)
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, f"{index + 1:02d}.json"), "w", encoding="utf-8") as f:
        json.dump(chapters, f, ensure_ascii=False, separators=(",", ":"))


# ---------------------------------------------------------------- KJV ----
def build_kjv(src):
    total = 0
    for i, name in enumerate(KJV_FILES):
        with open(os.path.join(src, name.replace(" ", "") + ".json"), encoding="utf-8-sig") as f:
            book = json.load(f)
        chapters = []
        for ch in sorted(book["chapters"], key=lambda c: int(c["chapter"])):
            verses = sorted(ch["verses"], key=lambda v: int(v["verse"]))
            chapters.append([[str(int(v["verse"])), tidy(v["text"])] for v in verses])
            total += len(verses)
        write_book("en", i, chapters)
    print(f"en: {total} verses")


# --------------------------------------------------------------- USFM ----
# Whole lines we never show (titles, headings, intro material, notes).
SKIP_LINE = re.compile(
    r"^\\(id|ide|usfm|h|toc\d?|toca\d?|mt\d?|mte\d?|ms\d?|mr|s\d?|sr|r|d|sp|sd\d?|"
    r"cl|cd|rem|sts|restore|periph|is\d?|ip|ipi|im|imi|ipq|imq|ipr|iq\d?|ib|ili\d?|"
    r"iot|io\d?|ior|iqt|iex|imt\d?|imte\d?|ie|lit|qa|qc|qd|cp|ca)\b")
# Notes, cross-references, figures and alternate numbering: drop with contents.
DROP_SPAN = re.compile(r"\\(f|fe|ef|x|ex|fig|rq|va|vp|ca)\s.*?\\\1\*", re.S)
LEFTOVER_NOTE = re.compile(r"\\(f|fe|x)\s.*?(?=\\[cv]\s|$)", re.S)


def clean_usfm_text(s):
    s = re.sub(r"\|[^\\]*?(?=\\\+?[\w\d]+\*)", "", s)          # \w word|strong="H1"\w*
    s = re.sub(r"\\\+?[a-z]+\d*\*", "", s)                        # closing markers
    s = re.sub(r"\\\+?[a-z]+\d*(?:-[se])?\b\s?", " ", s)          # opening/paragraph markers
    s = s.replace("//", " ").replace("*", "")                    # glossary asterisks
    return tidy(s)


def parse_usfm(text):
    code = None
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        m = re.match(r"^\\id\s+(\S+)", stripped)
        if m:
            code = m.group(1).upper()
            continue
        if not stripped:
            continue
        if SKIP_LINE.match(stripped):
            # a heading line can still carry a verse after it: keep from there on
            m = re.search(r"\\[cv]\s+\d", stripped)
            if not m:
                continue
            stripped = stripped[m.start():]
        lines.append(stripped)
    body = " ".join(lines)
    body = DROP_SPAN.sub(" ", body)
    body = LEFTOVER_NOTE.sub(" ", body)

    chapters = {}
    chapter = None
    for tok in re.split(r"(\\c\s+\d+|\\v\s+[\d\-\u2013a-z,]+)", body):
        if not tok:
            continue
        mc = re.match(r"\\c\s+(\d+)", tok)
        mv = re.match(r"\\v\s+([\d\-\u2013a-z,]+)", tok)
        if mc:
            chapter = int(mc.group(1))
            chapters.setdefault(chapter, [])
        elif mv:
            if chapter is None:
                continue
            label = mv.group(1).replace("\u2013", "-").rstrip(",")
            label = re.sub(r"[a-z]", "", label) or label
            chapters[chapter].append([label, ""])
        elif chapter is not None and chapters[chapter]:
            chapters[chapter][-1][1] += " " + tok
    result = []
    for n in sorted(chapters):
        verses = []
        for label, raw in chapters[n]:
            t = clean_usfm_text(raw)
            if verses and verses[-1][0] == label:      # split verse "3a" / "3b"
                verses[-1][1] = tidy(verses[-1][1] + " " + t)
            else:
                verses.append([label, t])
        result.append(verses)
    return code, result


def read_usfm_sources(src):
    if src.endswith(".zip"):
        with zipfile.ZipFile(src) as z:
            for name in z.namelist():
                if name.lower().endswith((".usfm", ".sfm", ".txt")):
                    yield name, z.read(name).decode("utf-8-sig", errors="replace")
    else:
        for name in sorted(os.listdir(src)):
            if name.lower().endswith((".usfm", ".sfm")):
                with open(os.path.join(src, name), encoding="utf-8-sig", errors="replace") as f:
                    yield name, f.read()


def build_usfm(lang, src):
    found = {}
    for name, text in read_usfm_sources(src):
        code, chapters = parse_usfm(text)
        if code in CODES and chapters:
            found[code] = chapters
    missing = [c for c in CODES if c not in found]
    if missing:
        sys.exit(f"{lang}: missing books {missing}")
    total = 0
    for i, c in enumerate(CODES):
        write_book(lang, i, found[c])
        total += sum(len(ch) for ch in found[c])
    print(f"{lang}: {total} verse entries")


# -------------------------------------------------------------- check ----
def check():
    """Compare every language with the KJV: book and chapter counts, empty verses."""
    ok = True
    en = [json.load(open(os.path.join(OUT, "en", f"{i + 1:02d}.json"), encoding="utf-8"))
          for i in range(66)]
    for lang in sorted(os.listdir(OUT)):
        empty = 0
        words = 0
        for i in range(66):
            path = os.path.join(OUT, lang, f"{i + 1:02d}.json")
            if not os.path.exists(path):
                print(f"FAIL {lang}: {CODES[i]} missing"); ok = False; continue
            book = json.load(open(path, encoding="utf-8"))
            if len(book) != len(en[i]):
                print(f"note {lang}: {CODES[i]} has {len(book)} chapters (KJV {len(en[i])})")
            for ch in book:
                for label, t in ch:
                    if not t:
                        empty += 1
                    words += len(t.split())
                    if "\\" in t or "|" in t:
                        print(f"FAIL {lang}: leftover markup in {CODES[i]}: {t[:80]}"); ok = False
        entries = sum(len(ch) for i in range(66)
                      for ch in json.load(open(os.path.join(OUT, lang, f"{i + 1:02d}.json"), encoding="utf-8")))
        print(f"{lang}: {entries} verses, {empty} empty, {words} words")
        if entries < 30000 or empty > 200:
            print(f"FAIL {lang}: text looks incomplete"); ok = False
    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "kjv":
        build_kjv(sys.argv[2])
    elif cmd == "usfm":
        build_usfm(sys.argv[2], sys.argv[3])
    elif cmd == "check":
        check()
