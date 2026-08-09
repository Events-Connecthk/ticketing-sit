# -*- coding: utf-8 -*-
from pathlib import Path
import re

p = Path("app/sit-admin/page.tsx")
t = p.read_text(encoding="utf-8", errors="replace")

t = t.replace("\ufffd - ", "x")
t = t.replace("\ufffd -", "x")
t = t.replace("\ufffd", "")

t = re.sub(
    r'e\.g\. "Weekend[^"]*"',
    'e.g. "Weekend x1, Day 2 x1"',
    t,
)
t = re.sub(
    r"return q > 1 \? `\$\{name\}[^`]*` : name;",
    "return q > 1 ? `${name} x${q}` : name;",
    t,
)

t = t.replace('return "—"', 'return "-"')
t = t.replace("return '—'", "return '-'")
t = t.replace('|| "—"', '|| "-"')
t = t.replace("|| '—'", "|| '-'")
t = t.replace("|| \"\u2014\"", '|| "-"')
t = t.replace("|| '\u2014'", "|| '-'")

t = t.replace(" — ", " - ")
t = t.replace("—", " - ")
t = t.replace(" – ", " - ")
t = t.replace("–", "-")

# split time on hyphen / en / em
split_repl = "ev.time.split(/[-\\u2013\\u2014]/)"
# write as real unicode in TS source:
split_repl = "ev.time.split(/[-–—]/)"
t = re.sub(r"ev\.time\.split\([^)]+\)", lambda m: split_repl, t, count=1)

t = re.sub(
    r"`\$\{startTime\}[^`]*\$\{endTime\}`",
    "${startTime} - ${endTime}",
    t,
)
# fix missing backticks
t = t.replace(
    "timeValue = ${startTime} - ${endTime};",
    "timeValue = `${startTime} - ${endTime}`;",
)

t = re.sub(
    r"(removeDiscount\(t\.id, d\.id\)[^>]*>)\s*[^<\n]*",
    r"\1x",
    t,
)

t = re.sub(r"design at 842[^1\n]*1190", "design at 842 x 1190", t)

t = t.replace("Loading events…", "Loading events...")
t = t.replace("Select event…", "Select event...")

p.write_text(t, encoding="utf-8")
print("Wrote", p)
for i, line in enumerate(t.splitlines(), 1):
    if "\ufffd" in line or "—" in line or "–" in line:
        # allow en dash only inside split regex char class
        if "split(" in line and "–" in line:
            print(f"SPLIT {i}: {line.strip()}")
            continue
        print(f"{i}: {line[:120]!r}")
print("scan done")
for i, line in enumerate(t.splitlines(), 1):
    if "x${q}" in line or ("removeDiscount" in line and "hover:text-red" in line):
        print(f"OK {i}: {line.strip()[:110]}")
    if "timeValue =" in line and "startTime" in line:
        print(f"TIME {i}: {line.strip()}")
    if "ev.time.split" in line:
        print(f"SPLIT {i}: {line.strip()}")
    if "dash-glass-shell" in line:
        print(f"GLASS {i}")
