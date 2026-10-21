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
각 원소: {{"idx":후보 번호, "category":"tax|asset|policy|mindset", "country":"KR", "oneliner":"이 기사가 내 돈에 뜻하는 것 한 줄(45자 이내, 낚시 금지)", "summary":"무슨 일인지 2~3문장", "insight":"한 차원 높은 시각: 제도의 설계 의도·숨은 구조·남들이 놓치는 점 3~5문장", "who":"누가 해당되나(소득·나이·직업 조건) 1~2문장", "when":"시행일·신청기간·마감 1문장(모르면 '확인 필요')", "facts":[{{"label":"","value":""}}] 3~5개 핵심 수치·조건, "steps":["내가 실제로 하려면 어디서 무엇을"] 3~4단계, "example":"숫자 계산 예시 1개", "caution":"한계·위험·확인할 것 1~2문장", "twist":"다들 이렇게 알지만 사실은…: 통념을 뒤집는 반전 포인트 1~2문장", "connect":"전혀 다른 분야(역사·물리·게임이론·행동심리·다른 업종)의 원리와 이어 설명하는 비유 2문장", "scenario":"서로 다른 두 사람(예: 월 실수령 300만원 30대 직장인 / 프리랜서·자영업자 / 은퇴 직전 50대) 중 둘에게 적용하면 결과가 어떻게 갈리는지 숫자로 2~3문장", "level":1|2|3}}
차별화 규칙: 고른 항목끼리 설명 각도가 겹치면 안 된다(어떤 건 구조, 어떤 건 인센티브, 어떤 건 역사, 어떤 건 숫자 중심). '꼼꼼히 확인하세요'·'중요합니다' 같은 일반론 금지, 구체적 숫자·이름·구조·제도명으로 써라. insight는 기사에 없는 네 해석(왜 지금, 누가 이득, 다음 수)을 반드시 포함.
규칙: 웹 검색으로 수치를 확인하고 확인 안 되면 지어내지 말고 '확인 필요'. 파일 도구와 웹 검색만 쓰고 read_url·셸 금지. 쉬운 존댓말. {pick}개를 채우기 전에는 끝내지 마라. 끝나면 한 줄 보고."""

PROMPT_ESSAY = """data/cand_{n}.json에는 유명 투자·돈 에세이스트들의 최근 글 {size}건(idx,title,source=필자,date,snippet=본문 발췌)이 있다. 오늘은 {today}. 돈·투자·부·행동심리·인생과 자산 관리에 대한 통찰이 있는 글을 최대 {pick}개 골라(링크 모음, 광고, 단순 시황·종목 추천, 돈과 무관한 글은 제외), data/pick_{n}.json에 JSON 배열로 써라. 필자가 다양하게 섞이게 하고 한 필자당 최대 2개.
각 원소: {{"idx":후보 번호, "category":"essay", "title_ko":"원제의 자연스러운 한국어 제목(25자 내외)", "oneliner":"이 글의 핵심 주장 한 줄(45자 이내)", "summary":"글의 요지를 한국어 3~4문장으로(원문 문장을 그대로 옮기지 말고 네 말로)", "insight":"이 글이 돈에 대해 알려주는 한 차원 높은 통찰 4~5문장(왜 사람들이 놓치는지, 숨은 구조)", "facts":[{{"label":"핵심 아이디어 1","value":"한 문장"}}] 3~4개, "steps":["내 돈·삶에 적용해볼 질문이나 행동"] 2~3개, "who":"이 글이 특히 도움 되는 사람 1문장", "when":"원문은 영어(또는 한국어), 필자 소개 한 줄(누구인지)", "example":"글 속 대표 사례·비유 1개를 한국어로 간단히", "caution":"필자의 관점일 뿐 정답은 아니라는 점과 한계 1문장", "twist":"이 글이 정면으로 반박하는 흔한 통념과 그 이유 1~2문장", "connect":"다른 거장·다른 글·다른 분야(예: 하우절↔버핏, 행동심리, 진화, 역사)와 이어 보는 연결 2문장", "scenario":"이 통찰을 한국 직장인(월 실수령 350만원, 전세·적금·연금저축 보유)이 실제로 쓰면 달라지는 행동을 숫자·구체 장면으로 2문장", "level":1|2|3}}
차별화 규칙: 고른 글끼리 각도가 겹치면 안 된다. 일반론('장기투자가 중요하다') 금지, 글에만 있는 독특한 주장·비유·사례를 살려라. insight에는 필자가 말하지 않은 네 해석(한국 상황에 놓으면?)을 넣어라.
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
    it = {k: p.get(k, "") for k in need + ("category", "country", "facts", "steps", "twist", "connect", "scenario")}
    it.update(id=hashlib.md5(c["url"].encode()).hexdigest()[:12], title=c["title"], url=c["url"], source=c["source"], date=c["date"],
              image=c["image"], level=p.get("level") if p.get("level") in (1, 2, 3) else 2, sources=[{"name": c["source"] or "기사 원문", "url": c["url"]}])
    it["apply"] = p["steps"][0]
    if p["category"] == "essay": it["author"] = c["source"]
    return it

THREAD_PROMPT = """아래는 '돈의 달인' 앱의 최근 항목 목록이다(id, 분류, 제목, 한 줄). 오늘은 {today}.
이 항목들을 가로질러 **개별 기사에는 없는, 항목들을 묶어야만 보이는 통찰** 3개를 찾아라. 각 통찰은 서로 다른 유형이어야 한다: ①공통 패턴(서로 달라 보이는 일이 같은 원리) ②모순·충돌(두 항목이 서로 반대로 말하는 지점) ③앞으로의 예측(여러 신호를 합치면 다음에 일어날 일).
가능하면 뉴스와 에세이를 섞어 연결하고(예: 정책 뉴스 ↔ 에세이스트의 원리), 한 통찰에 3~4개 항목 id를 쓴다. id는 목록에 있는 것만. 일반론 금지, 구체적으로.
출력은 JSON 객체 하나만: {{"threads":[{{"kind":"공통 패턴|모순|예측","title":"20자 내외 제목","thesis":"통찰 3~4문장(쉬운 존댓말)","question":"독자가 스스로에게 던질 질문 1개","ids":["id",...]}}]}}
항목:
{items}"""

def thread_input(d):
    pool = [x for x in d["items"]][:60]
    return pool, json.dumps([{"id": x["id"], "cat": x["category"], "title": x.get("title_ko") or x["title"], "line": x.get("oneliner", "")} for x in pool], ensure_ascii=False)

def make_threads(d, synth):
    pool, blob = thread_input(d)
    out = synth(THREAD_PROMPT.format(today=TODAY, items=blob))
    ok = {x["id"] for x in pool}; res = []
    for t in (out or {}).get("threads", []) if isinstance(out, dict) else []:
        ids = [i for i in t.get("ids", []) if i in ok]
        if len(ids) >= 2 and t.get("title") and t.get("thesis"):
            res.append({"kind": t.get("kind", ""), "title": t["title"], "thesis": t["thesis"], "question": t.get("question", ""), "ids": ids[:4]})
    if res: d["threads"] = {"date": TODAY, "items": res[:3]}; log(f"연결고리 {len(res[:3])}개")
    else: log("연결고리 생성 실패(기존 유지)")

def run(picker=None, workers=None, synth=None):
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
    if synth:
        try: make_threads(d, synth)
        except Exception as e: log("연결고리 오류: " + repr(e)[:150])
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
