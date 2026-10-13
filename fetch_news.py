"""뉴스 후보 수집: Bing News RSS 여러 주제 → data/candidates.json (제목·실제 기사 URL·날짜·언론사·요약)."""
import json, re, sys, datetime, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from pathlib import Path

OUT = Path(__file__).parent / "data" / "candidates.json"
# (검색어, 지역/언어 설정, 분류 힌트)
QUERIES = [
    ("절세 새로 도입 제도", "ko-KR", "tax"), ("세법개정안 공제 신설", "ko-KR", "tax"), ("연금 개편 퇴직연금 IRP ISA 개선", "ko-KR", "tax"),
    ("상속세 증여세 개편", "ko-KR", "tax"), ("토큰증권 조각투자 신상품", "ko-KR", "asset"), ("스테이블코인 디지털자산 법안", "ko-KR", "asset"),
    ("금융당국 신상품 출시 계좌", "ko-KR", "policy"), ("해외 연금 제도 개혁 도입", "ko-KR", "world"), ("부자들 자산 관리 방식 달라졌다", "ko-KR", "mindset"),
    ("new tax-free savings account government launch", "en-US", "world"), ("pension reform new retirement scheme country", "en-US", "world"),
    ("tokenized assets real world assets launch regulation", "en-US", "asset"), ("new tax law loophole deduction change 2026", "en-US", "tax"),
    ("sovereign wealth fund citizens dividend baby bonds", "en-US", "world"), ("wealth tax inheritance tax reform country", "en-US", "world"),
    ("연금저축 IRP 세액공제 방법", "ko-KR", "tax"), ("해외주식 양도세 절세 방법", "ko-KR", "tax"), ("청년 주택 청약 저축 혜택 신설", "ko-KR", "policy"),
    ("금융위원회 발표 가상자산 ETF 허용", "ko-KR", "asset"), ("국세청 세무조사 신고 안내 달라지는", "ko-KR", "tax"), ("달라지는 제도 내달부터 시행 금융", "ko-KR", "policy"),
    ("싱가포르 일본 영국 연금 ISA 제도", "ko-KR", "world"), ("부동산 세금 양도세 종부세 개편", "ko-KR", "tax"), ("건강보험료 국민연금 개편 직장인", "ko-KR", "policy"),
    ("ISA account UK Japan NISA changes", "en-US", "world"), ("Singapore CPF retirement new scheme", "en-US", "world"), ("tokenized treasury fund bonds launch bank", "en-US", "asset"),
    ("estate planning tax strategy new rules billionaires", "en-US", "mindset"), ("digital euro CBDC launch date", "en-US", "asset"),
    ("stablecoin law central bank digital currency new rules", "en-US", "asset"), ("how the wealthy use trust family office strategy", "en-US", "mindset"),
]
DAYS = 21

def real_url(link):
    q = urllib.parse.urlparse(link).query
    u = urllib.parse.parse_qs(q).get("url")
    return u[0] if u else link

def fetch(q, mkt):
    url = "https://www.bing.com/news/search?" + urllib.parse.urlencode({"q": q, "format": "rss", "mkt": mkt, "setlang": mkt[:2]})
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    root = ET.fromstring(urllib.request.urlopen(req, timeout=25).read())
    for it in root.iter("item"):
        t = {c.tag.split("}")[-1]: (c.text or "") for c in it}
        img = t.get("Image", "")
        img = img.replace("http://", "https://") + "&w=320&h=200&c=14" if img else ""
        yield t.get("title", ""), real_url(t.get("link", "")), t.get("pubDate", ""), t.get("description", ""), t.get("Source", ""), img

def main():
    now = datetime.datetime.now(datetime.timezone.utc)
    seen, items = set(), []
    for q, mkt, cat in QUERIES:
        try:
            for title, link, pub, desc, src, img in fetch(q, mkt):
                try: dt = parsedate_to_datetime(pub)
                except Exception: continue
                if (now - dt).days > DAYS or link in seen or not link.startswith("http"): continue
                seen.add(link)
                items.append({"title": re.sub(r"\s+", " ", title).strip(), "url": link, "date": dt.date().isoformat(),
                              "source": src, "snippet": re.sub(r"<[^>]+>", "", desc)[:300], "image": img, "hint": cat, "lang": mkt[:2]})
        except Exception as e:
            print("실패", q, repr(e)[:80], file=sys.stderr)
    items.sort(key=lambda x: x["date"], reverse=True)
    OUT.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
    print(len(items), "건 저장")

if __name__ == "__main__":
    main()
