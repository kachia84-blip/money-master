"""유명 돈 블로거 에세이 수집(RSS/Atom) → data/essay_candidates.json. 원문 URL·날짜·본문 발췌는 피드 값 그대로."""
import json, re, sys, datetime, html, urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from pathlib import Path

OUT = Path(__file__).parent / "data" / "essay_candidates.json"
FEEDS = {  # 표시 이름: 피드 주소
    "Morgan Housel · Collab Fund": "https://collabfund.com/feed.xml", "Aswath Damodaran": "https://aswathdamodaran.blogspot.com/feeds/posts/default",
    "Ben Carlson": "https://awealthofcommonsense.com/feed/", "Nick Maggiulli": "https://ofdollarsanddata.com/feed/", "Barry Ritholtz": "https://ritholtz.com/feed/",
    "Shane Parrish · Farnam Street": "https://fs.blog/feed/", "Jason Zweig": "https://jasonzweig.com/feed/", "Matt Levine": "https://www.bloomberg.com/opinion/authors/ARbTQlRLRjE/matthew-s-levine.rss",
    "Naval Ravikant": "https://nav.al/feed", "Mark Cuban": "https://blogmaverick.com/feed/", "Seth Godin": "https://seths.blog/feed/", "Derek Sivers": "https://sive.rs/en.atom",
    "Noah Smith": "https://www.noahpinion.blog/feed", "Packy McCormick": "https://www.notboring.co/feed", "Humble Dollar": "https://humbledollar.com/feed/",
    "Mr. Money Mustache": "https://www.mrmoneymustache.com/feed/", "Early Retirement Now": "https://earlyretirementnow.com/feed/", "Tim Ferriss": "https://tim.blog/feed/",
    "Bogleheads": "https://www.bogleheads.org/blog/feed/", "Safal Niveshak": "https://www.safalniveshak.com/feed/", "Brad Feld": "https://feld.com/feed",
}
DAYS, PER_FEED, TEXT = 120, 6, 1800

def clean(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()

def main():
    now = datetime.datetime.now(datetime.timezone.utc); out = []
    for name, url in FEEDS.items():
        try:
            root = ET.fromstring(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=25).read())
        except Exception as e:
            print("실패", name, repr(e)[:60], file=sys.stderr); continue
        n = 0
        for it in [e for e in root.iter() if e.tag.split("}")[-1] in ("item", "entry")]:
            t = {}
            for c in it:
                k = c.tag.split("}")[-1]
                if k == "link" and c.get("href"): t.setdefault("link", c.get("href"))
                elif k not in t or (k in ("encoded", "content") and len(c.text or "") > len(t[k])): t[k] = c.text or ""
            raw = t.get("pubDate") or t.get("published") or t.get("updated") or ""
            try: dt = parsedate_to_datetime(raw) if "," in raw else datetime.datetime.fromisoformat(raw.replace("Z", "+00:00"))
            except Exception: continue
            if dt.tzinfo is None: dt = dt.replace(tzinfo=datetime.timezone.utc)
            body = t.get("encoded") or t.get("content") or t.get("description") or t.get("summary") or ""
            img = re.search(r'<img[^>]+src="(https?://[^"]+)"', body)
            if re.search(r"(reads|links|podcast|weekly|roundup|newsletter)|sponsor", t.get("title", ""), re.I): continue
            if (now - dt).days > DAYS or not t.get("link") or not t.get("title") or n >= PER_FEED or len(clean(body)) < 200: continue
            n += 1
            out.append({"title": clean(t["title"]), "url": t["link"].strip(), "date": dt.date().isoformat(), "source": name,
                        "snippet": clean(body)[:TEXT], "image": img.group(1) if img else "", "hint": "essay", "lang": "en"})
    out.sort(key=lambda x: x["date"], reverse=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(len(out), "건 에세이 후보")

if __name__ == "__main__":
    main()
