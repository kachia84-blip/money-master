"""매일 갱신: 뉴스 수집(fetch_news) → Gemini가 후보에서 골라 해설 작성(병렬) → 검증·병합 → GitHub push.
실행: pythonw daily_update.py  (로그 update.log). 기사 URL·날짜·언론사·사진은 수집기 값을 그대로 쓴다(AI가 못 바꿈)."""
import socket, json, subprocess, sys, datetime, hashlib, traceback, concurrent.futures as cf
from pathlib import Path
import fetch_news, fetch_essays

HERE = Path(__file__).parent
DATA = HERE / "data" / "insights.json"
CAND = HERE / "data" / "candidates.json"
ECAND = HERE / "data" / "essay_candidates.json"
LOG = HERE / "update.log"
DELEGATE = r"C:/Users/kachi/.claude/skills/delegate/delegate.py"
CATS = {"tax", "asset", "policy", "mindset", "essay"}
MAX_ITEMS, KEEP_DAYS, ESSAY_KEEP_DAYS, CHUNK, PICK = 600, 60, 365, 35, 12
E_CHUNK, E_PICK = 25, 9
TODAY = datetime.date.today().isoformat()
socket.setdefaulttimeout(30)

def log(m):
    with LOG.open("a", encoding="utf-8") as f:
        f.write(f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S} {m}\n")

PROMPT = """data/cand_{n}.json에는 최근 뉴스 후보 {size}건(idx,title,source,date,snippet)이 있다. 오늘은 {today}. 한국 직장인에게 '돈'에 관한 새로운 제도·절세·새 자산 형태·정책 변화의 시사점을 주는 한국 기사를 최대 {pick}개 골라, data/pick_{n}.json에 JSON 배열로 써라.
고르는 기준: 새롭거나 놀라운 제도/구조/자산 형태, 내 돈에 실제로 영향이 있는 것. 제외: 종목·코인 매수 추천, 주가 전망, 광고, 연예·사건사고, 해외 제도 소개, 같은 사건의 중복 기사(하나만).
각 원소: {{"idx":후보 번호, "category":"tax|asset|policy|mindset", "country":"KR", "oneliner":"이 기사가 내 돈에 뜻하는 것 한 줄(45자 이내, 낚시 금지)", "summary":"무슨 일인지 2~3문장", "insight":"한 차원 높은 시각: 제도의 설계 의도·숨은 구조·남들이 놓치는 점 3~5문장", "who":"누가 해당되나(소득·나이·직업 조건) 1~2문장", "when":"시행일·신청기간·마감 1문장(모르면 '확인 필요')", "facts":[{{"label":"","value":""}}] 3~5개 핵심 수치·조건, "steps":["내가 실제로 하려면 어디서 무엇을"] 3~4단계, "example":"숫자 계산 예시 1개", "caution":"한계·위험·확인할 것 1~2문장", "level":1|2|3}}
규칙: 웹 검색으로 수치를 확인하고 확인 안 되면 지어내지 말고 '확인 필요'. 파일 도구와 웹 검색만 쓰고 read_url·셸 금지. 쉬운 존댓말. {pick}개를 채우기 전에는 끝내지 마라. 끝나면 한 줄 보고."""

PROMPT_ESSAY = """data/cand_{n}.json에는 유명 투자·돈 에세이스트들의 최근 글 {size}건(idx,title,source=필자,date,snippet=본문 발췌)이 있다. 오늘은 {today}. 돈·투자·부·행동심리·인생과 자산 관리에 대한 통찰이 있는 글을 최대 {pick}개 골라(링크 모음, 광고, 단순 시황·종목 추천, 돈과 무관한 글은 제외), data/pick_{n}.json에 JSON 배열로 써라. 필자가 다양하게 섞이게 하고 한 필자당 최대 2개.
각 원소: {{"idx":후보 번호, "category":"essay", "title_ko":"원제의 자연스러운 한국어 제목(25자 내외)", "oneliner":"이 글의 핵심 주장 한 줄(45자 이내)", "summary":"글의 요지를 한국어 3~4문장으로(원문 문장을 그대로 옮기지 말고 네 말로)", "insight":"이 글이 돈에 대해 알려주는 한 차원 높은 통찰 4~5문장(왜 사람들이 놓치는지, 숨은 구조)", "facts":[{{"label":"핵심 아이디어 1","value":"한 문장"}}] 3~4개, "steps":["내 돈·삶에 적용해볼 질문이나 행동"] 2~3개, "who":"이 글이 특히 도움 되는 사람 1문장", "when":"원문은 영어(또는 한국어), 필자 소개 한 줄(누구인지)", "example":"글 속 대표 사례·비유 1개를 한국어로 간단히", "caution":"필자의 관점일 뿐 정답은 아니라는 점과 한계 1문장", "level":1|2|3}}
규칙: snippet에 있는 내용과 필자가 아는 범위에서만 쓰고 지어내지 마라. 원문 문장을 길게 인용하지 마라. 파일 도구만 쓰고 read_url·셸 금지. 쉬운 존댓말. {pick}개를 채우기 전에는 끝내지 마라. 끝나면 한 줄 보고."""

def prompt_for(n, chunk):
    t = PROMPT_ESSAY if chunk and chunk[0].get("hint") == "essay" else PROMPT
    return t.format(n=n, size=len(chunk), today=TODAY, pick=E_PICK if t is PROMPT_ESSAY else PICK)

def pick(n, chunk):
    (HERE / "data" / f"cand_{n}.json").write_text(json.dumps(
        [{"idx": i, **{k: c[k] for k in ("title", "source", "date", "snippet")}} for i, c in enumerate(chunk)], ensure_ascii=False), encoding="utf-8")
    out = HERE / "data" / f"pick_{n}.json"; out.unlink(missing_ok=True)
    r = subprocess.run([sys.executable, DELEGATE, "--ai", "gemini", "--role", "research", "--folder", str(HERE), "--write", "--max-chars", "200",
                        prompt_for(n, chunk)], capture_output=True, text=True, timeout=1500, encoding="utf-8", errors="replace")
    try:
        return json.loads(out.read_text(encoding="utf-8"))
    except Exception:
        log(f"chunk {n} 실패: " + (r.stdout + r.stderr)[-200:]); return []
    finally:
        out.unlink(missing_ok=True); (HERE / "data" / f"cand_{n}.json").unlink(missing_ok=True)

def build(c, p):
    need = ("oneliner", "summary", "insight", "who", "when", "caution", "example") + (("title_ko",) if p.get("category") == "essay" else ())
    if not all(p.get(k) for k in need) or p.get("category") not in CATS: return None
    if len(p.get("facts") or []) < 2 or len(p.get("steps") or []) < 2: return None
    it = {k: p.get(k, "") for k in need + ("category", "country", "facts", "steps")}
    it.update(id=hashlib.md5(c["url"].encode()).hexdigest()[:12], title=c["title"], url=c["url"], source=c["source"], date=c["date"],
              image=c["image"], level=p.get("level") if p.get("level") in (1, 2, 3) else 2, sources=[{"name": c["source"] or "기사 원문", "url": c["url"]}])
    it["apply"] = p["steps"][0]
    if p["category"] == "essay": it["author"] = c["source"]
    return it

def run(picker=None, workers=None):
    picker = picker or pick
    d = json.loads(DATA.read_text(encoding="utf-8"))
    cut = (datetime.date.today() - datetime.timedelta(days=KEEP_DAYS)).isoformat()
    ecut = (datetime.date.today() - datetime.timedelta(days=ESSAY_KEEP_DAYS)).isoformat()
    d["items"] = [x for x in d["items"] if x.get("category") != "world" and x["date"] >= (ecut if x.get("category") == "essay" else cut)]
    have = {x.get("url") for x in d["items"]}
    fetch_news.main(); fetch_essays.main()
    cands = [c for c in json.loads(CAND.read_text(encoding="utf-8")) if c["url"] not in have]
    chunks = [cands[i:i + CHUNK] for i in range(0, len(cands), CHUNK)][:4]
    ec = [c for c in json.loads(ECAND.read_text(encoding="utf-8")) if c["url"] not in have]
    chunks += [ec[i:i + E_CHUNK] for i in range(0, len(ec), E_CHUNK)][:4]
    log(f"새 후보 뉴스 {len(cands)}건·에세이 {len(ec)}건, 묶음 {len(chunks)}개")
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
