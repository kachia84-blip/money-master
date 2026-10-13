"""GitHub Actions용: PC 없이 갱신. Gemini API(키는 환경변수 GEMINI_API_KEY)로 뉴스 후보를 고르고 해설을 쓴다. push는 워크플로가 한다."""
import json, os, re, sys, time, urllib.request
import daily_update as du

KEY = os.environ.get("GEMINI_API_KEY", "")
MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")

def api_pick(n, chunk):
    cands = [{"idx": i, **{k: c[k] for k in ("title", "source", "date", "snippet")}} for i, c in enumerate(chunk)]
    prompt = du.prompt_for(n, chunk)
    prompt = (prompt.replace(f"data/cand_{n}.json에는", "아래 후보 JSON에는").replace(f"data/pick_{n}.json에 JSON 배열로 써라", "JSON 배열만 출력하라(설명·코드펜스 없이)")
              .replace("파일 도구와 웹 검색만 쓰고 read_url·셸 금지.", "웹 검색을 쓸 수 있다.").replace("파일 도구만 쓰고 read_url·셸 금지.", "").replace("끝나면 한 줄 보고.", "")
              + "\n\n후보 JSON:\n" + json.dumps(cands, ensure_ascii=False))
    body = json.dumps({"contents": [{"parts": [{"text": prompt}]}], "tools": [{"google_search": {}}], "generationConfig": {"temperature": 0.4}}).encode()
    for attempt in range(3):
        try:
            req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent", body,
                                         {"Content-Type": "application/json", "x-goog-api-key": KEY})
            r = json.load(urllib.request.urlopen(req, timeout=300))
            text = "".join(p.get("text", "") for p in r["candidates"][0]["content"]["parts"])
            return json.loads(text[text.index("["): text.rindex("]") + 1])
        except Exception as e:
            du.log(f"chunk {n} API 시도{attempt + 1} 실패: {repr(e)[:150]}"); time.sleep(20 * (attempt + 1))
    return []

if __name__ == "__main__":
    if not KEY:
        print("GEMINI_API_KEY 없음"); sys.exit(0)
    du.run(api_pick, workers=1)
