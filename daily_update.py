"""매일 갱신: Gemini가 새 인사이트 3개를 data/new.json에 쓰면 검증 후 insights.json에 합치고 GitHub에 push.
실행: pythonw daily_update.py   (로그: update.log). 항상 정상 종료(예외 삼킴)."""
import json, subprocess, sys, datetime, traceback
from pathlib import Path

HERE = Path(__file__).parent
DATA = HERE / "data" / "insights.json"
NEW = HERE / "data" / "new.json"
LOG = HERE / "update.log"
DELEGATE = r"C:/Users/kachi/.claude/skills/delegate/delegate.py"
CATS = {"world", "tax", "asset", "policy", "mindset"}
KEYS = "id category country title summary insight apply caution date level sources".split()
MAX_ITEMS = 300
TODAY = datetime.date.today().isoformat()

def log(m):
    with LOG.open("a", encoding="utf-8") as f:
        f.write(f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S} {m}\n")

def valid(x, seen):
    if not all(x.get(k) for k in KEYS): return False
    if x["category"] not in CATS or x["id"] in seen or x["level"] not in (1, 2, 3): return False
    for s in x["sources"]:
        u = s.get("url", "")
        if not u.startswith("https://") or "vertexaisearch" in u or "google.com/search" in u: return False
    return True

def run():
    d = json.loads(DATA.read_text(encoding="utf-8"))
    ids = [x["id"] for x in d["items"]]
    recent = [x["title"] for x in sorted(d["items"], key=lambda x: x["date"], reverse=True)[:25]]
    NEW.unlink(missing_ok=True)
    prompt = (
        f"SPEC.md를 읽어라. 오늘은 {TODAY}. 웹 검색 스니펫(read_url·셸 금지)으로 최근 2주 안에 나온 돈 관련 새 소식 중 "
        "한국 직장인에게 의미 있는 것 3개를 골라 SPEC 스키마의 항목 배열(JSON 배열만)을 data/new.json에 써라. "
        "카테고리는 tax/policy/asset/world/mindset 중 다양하게(world는 한국에 올 수 있는 것만). "
        "종목·코인 추천 금지. sources.url은 실제 발행처 정식 주소(구글 중계 주소 금지). 지어낸 숫자 금지, 불확실하면 caution에 '확인 필요'. "
        f"이미 있는 id는 쓰지 마라: {', '.join(ids[-60:])}. 이미 다룬 제목과 겹치지 마라: {' / '.join(recent)}. "
        "3개 다 채우기 전에는 끝내지 마라. 끝나면 한 줄만 보고."
    )
    r = subprocess.run([sys.executable, DELEGATE, "--ai", "gemini", "--role", "research", "--folder", str(HERE),
                        "--write", "--max-chars", "300", prompt], capture_output=True, text=True, timeout=900, encoding="utf-8", errors="replace")
    if not NEW.exists():
        log("new.json 없음 (위임 실패): " + (r.stdout + r.stderr)[-300:]); return False
    items = json.loads(NEW.read_text(encoding="utf-8"))
    seen, add = set(ids), []
    for x in items if isinstance(items, list) else []:
        if valid(x, seen): add.append(x); seen.add(x["id"])
    NEW.unlink(missing_ok=True)
    if not add:
        log("검증 통과 항목 0개 → 변경 없음"); return False
    d["items"] = sorted(d["items"] + add, key=lambda x: x["date"], reverse=True)[:MAX_ITEMS]
    d["updated"] = TODAY
    DATA.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"{len(add)}개 추가: " + ", ".join(x["id"] for x in add))
    return True

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
