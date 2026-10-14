"""GitHub Actions용: PC 없이 갱신. Gemini API(키는 환경변수 GEMINI_API_KEY)로 뉴스 후보를 고르고 해설을 쓴다. push는 워크플로가 한다."""
import json, os, re, sys, time, urllib.request, urllib.error
import daily_update as du
from pathlib import Path
du.LOG = Path(__file__).parent / "data" / "last_run.log"  # 서버 실행 기록(저장소에 커밋되어 원인 확인 가능)
import socket; socket.setdefaulttimeout(30)

KEY = os.environ.get("GEMINI_API_KEY", "")
MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
MODELS = [MODEL, "gemini-flash-lite-latest", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"]

def api_pick(n, chunk):
    cands = [{"idx": i, **{k: c[k] for k in ("title", "source", "date", "snippet")}} for i, c in enumerate(chunk)]
    prompt = du.prompt_for(n, chunk)
    prompt = (prompt.replace(f"data/cand_{n}.json에는", "아래 후보 JSON에는").replace(f"data/pick_{n}.json에 JSON 배열로 써라", "JSON 배열만 출력하라(설명·코드펜스 없이)")
              .replace("파일 도구와 웹 검색만 쓰고 read_url·셸 금지.", "웹 검색을 쓸 수 있다.").replace("파일 도구만 쓰고 read_url·셸 금지.", "").replace("끝나면 한 줄 보고.", "")
              + "\n\n후보 JSON:\n" + json.dumps(cands, ensure_ascii=False))
    prompt = prompt.replace("웹 검색을 쓸 수 있다.", "웹 검색은 못 한다. 후보의 snippet과 네가 확실히 아는 범위에서만 쓰고, 수치·일정이 불확실하면 지어내지 말고 '확인 필요'라고 써라.").replace("웹 검색으로 수치를 확인하고 확인 안 되면", "확인 안 되는 수치는")
    for model in MODELS:  # 한도(429)에 걸리면 다음 모델로
        body = json.dumps({"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"temperature": 0.4}}).encode()
        for attempt in range(2):
            try:
                req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent", body,
                                             {"Content-Type": "application/json", "x-goog-api-key": KEY})
                r = json.load(urllib.request.urlopen(req, timeout=300))
                text = "".join(p.get("text", "") for p in r["candidates"][0]["content"]["parts"])
                out = json.loads(text[text.index("["): text.rindex("]") + 1])
                du.log(f"chunk {n} 성공 모델={model} {len(out)}개"); return out
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", "replace").replace(chr(10), " ")[:220]
                du.log(f"chunk {n} {model} HTTP {e.code}: {detail}")
                if e.code in (400, 403, 404): break  # 모델/권한 문제 → 다음 모델
                if e.code == 503: break  # 모델이 바쁨 → 재시도 없이 다음 모델
                time.sleep(25)
            except Exception as e:
                du.log(f"chunk {n} {model} 실패: {repr(e)[:150]}"); time.sleep(10)
    return []

if __name__ == "__main__":
    if not KEY:
        du.log("GEMINI_API_KEY 환경변수가 비어 있음(비밀값 이름/등록 확인 필요)"); print("GEMINI_API_KEY 없음"); sys.exit(0)
    du.log(f"서버 실행 시작 모델={MODEL}")
    try:
        du.run(api_pick, workers=1)
    except Exception as e:
        du.log("오류: " + repr(e)[:300])
