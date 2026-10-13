"""매일 갱신: 뉴스 수집(fetch_news) → Gemini가 후보에서 골라 해설 작성(병렬) → 검증·병합 → GitHub push.
실행: pythonw daily_update.py  (로그 update.log). 기사 URL·날짜·언론사·사진은 수집기 값을 그대로 쓴다(AI가 못 바꿈)."""
import json, subprocess, sys, datetime, hashlib, traceback, concurrent.futures as cf
from pathlib import Path
import fetch_news

HERE = Path(__file__).parent
DATA = HERE / "data" / "insights.json"
CAND = HERE / "data" / "candidates.json"
LOG = HERE / "update.log"
DELEGATE = r"C:/Users/kachi/.claude/skills/delegate/delegate.py"
CATS = {"world", "tax", "asset", "policy", "mindset"}
MAX_ITEMS, KEEP_DAYS, CHUNK, PICK = 400, 60, 35, 12
TODAY = datetime.date.today().isoformat()

def log(m):
    with LOG.open("a", encoding="utf-8") as f:
        f.write(f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S} {m}\n")

PROMPT = """data/cand_{n}.json에는 최근 뉴스 후보 {size}건(idx,title,source,date,snippet)이 있다. 오늘은 {today}. 한국 직장인에게 '돈'에 관한 새로운 제도·절세·새 자산 형태·정책 변화·해외 제도의 시사점을 주는 기사를 최대 {pick}개 골라, data/pick_{n}.json에 JSON 배열로 써라.
고르는 기준: 새롭거나 놀라운 제도/구조/자산 형태, 내 돈에 실제로 영향이 있는 것, 해외 사례는 한국에 시사점이 있는 것. 제외: 종목·코인 매수 추천, 주가 전망, 광고, 연예·사건사고, 같은 사건의 중복 기사(하나만).
각 원소: {{"idx":후보 번호, "category":"tax|world|asset|policy|mindset", "country":"KR 등 ISO 2글자", "oneliner":"이 기사가 내 돈에 뜻하는 것 한 줄(45자 이내, 낚시 금지)", "summary":"무슨 일인지 2~3문장", "insight":"한 차원 높은 시각: 제도의 설계 의도·숨은 구조·남들이 놓치는 점 3~5문장", "who":"누가 해당되나(소득·나이·직업 조건) 1~2문장", "when":"시행일·신청기간·마감 1문장(모르면 '확인 필요')", "facts":[{{"label":"","value":""}}] 3~5개 핵심 수치·조건, "steps":["내가 실제로 하려면 어디서 무엇을"] 3~4단계(해외 제도면 한국에서 비슷하게 쓰는 방법 또는 '적용 불가+이유'), "example":"숫자 계산 예시 1개", "caution":"한계·위험·확인할 것 1~2문장", "level":1|2|3}}
규칙: 웹 검색으로 수치를 확인하고 확인 안 되면 지어내지 말고 '확인 필요'. 파일 도구와 웹 검색만 쓰고 read_url·셸 금지. 쉬운 존댓말. {pick}개를 채우기 전에는 끝내지 마라. 끝나면 한 줄 보고."""

def pick(n, chunk):
    (HERE / "data" / f"cand_{n}.json").write_text(json.dumps(
        [{"idx": i, **{k: c[k] for k in ("title", "source", "date", "snippet")}} for i, c in enumerate(chunk)], ensure_ascii=False), encoding="utf-8")
    out = HERE / "data" / f"pick_{n}.json"; out.unlink(missing_ok=True)
    r = subprocess.run([sys.executable, DELEGATE, "--ai", "gemini", "--role", "research", "--folder", str(HERE), "--write", "--max-chars", "200",
                        PROMPT.format(n=n, size=len(chunk), today=TODAY, pick=PICK)], capture_output=True, text=True, timeout=1500, encoding="utf-8", errors="replace")
    try:
        return json.loads(out.read_text(encoding="utf-8"))
    except Exception:
        log(f"chunk {n} 실패: " + (r.stdout + r.stderr)[-200:]); return []
    finally:
        out.unlink(missing_ok=True); (HERE / "data" / f"cand_{n}.json").unlink(missing_ok=True)

def build(c, p):
    need = ("oneliner", "summary", "insight", "who", "when", "caution", "example")
    if not all(p.get(k) for k in need) or p.get("category") not in CATS: return None
    if len(p.get("facts") or []) < 2 or len(p.get("steps") or []) < 2: return None
    it = {k: p[k] for k in need + ("category", "country", "facts", "steps")}
    it.update(id=hashlib.md5(c["url"].encode()).hexdigest()[:12], title=c["title"], url=c["url"], source=c["source"], date=c["date"],
              image=c["image"], level=p.get("level") if p.get("level") in (1, 2, 3) else 2, sources=[{"name": c["source"] or "기사 원문", "url": c["url"]}])
    it["apply"] = p["steps"][0]
    return it

def run(picker=None, workers=None):
    picker = picker or pick
    d = json.loads(DATA.read_text(encoding="utf-8"))
    cut = (datetime.date.today() - datetime.timedelta(days=KEEP_DAYS)).isoformat()
    d["items"] = [x for x in d["items"] if x["date"] >= cut]
    have = {x.get("url") for x in d["items"]}
    fetch_news.main()
    cands = [c for c in json.loads(CAND.read_text(encoding="utf-8")) if c["url"] not in have]
    chunks = [cands[i:i + CHUNK] for i in range(0, len(cands), CHUNK)][:4]
    log(f"새 후보 {len(cands)}건, 묶음 {len(chunks)}개")
    add = []
    with cf.ThreadPoolExecutor(workers or len(chunks) or 1) as ex:
        for chunk, picks in zip(chunks, ex.map(lambda a: picker(*a), enumerate(chunks))):
            for p in picks if isinstance(picks, list) else []:
                try: it = build(chunk[int(p["idx"])], p)
                except Exception: it = None
                if it and it["id"] not in {x["id"] for x in d["items"] + add}: add.append(it)
    if not add:
        log("추가 0건 → 변경 없음"); return
    d["items"] = sorted(d["items"] + add, key=lambda x: x["date"], reverse=True)[:MAX_ITEMS]
    d["updated"] = TODAY
    DATA.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"{len(add)}개 추가, 총 {len(d['items'])}개")

def push():
    g = ["git", "-c", "user.name=kachia84-blip", "-c", "user.email=kachia84-blip@users.noreply.github.com"]
    subprocess.run(g + ["add", "-A"], cwd=HERE)
    if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=HERE).returncode == 0:
        log("push할 변경 없음"); return
    subprocess.run(g + ["commit", "-q", "-m", f"update {TODAY}"], cwd=HERE)
    p = subprocess.run(["git", "push", "-q", "origin", "main"], cwd=HERE, capture_output=True, text=True)
    log("push " + ("성공" if p.returncode == 0 else "실패: " + p.stderr[-200:]))

if __name__ == "__main__":
    try:
        run(); push()
    except Exception:
        log("오류: " + traceback.format_exc()[-400:])
