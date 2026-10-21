'use strict';
const $ = (id) => document.getElementById(id);
const CATEGORIES = { all: '전체', essay: '에세이', tax: '절세', policy: '정책', asset: '새자산', mindset: '원리' };
const STORAGE_KEY = 'money-master-saved';
const DATA_URL = new URL('./data/insights.json', location.href).href;
const CACHE_NAME = 'money-master-v6';
const DISCLAIMER = '교육·정보 목적이며 투자·세무 자문이 아닙니다. 세법은 수시로 바뀌니 시행 전 국세청·전문가로 확인하세요.';
let threads = [], items = [], category = 'all', savedOnly = false, currentItem = null, installPrompt = null;
let saved = new Set(), triggerElement = null, touchStart = null;
let authorFilter = '';
// A reload starts on the feed, without leaving a stale detail history entry.
if (history.state?.moneyMasterDetail) {
  const state = { ...history.state }; delete state.moneyMasterDetail;
  history.replaceState(state, '', location.href);
}
try {
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  if (Array.isArray(stored)) saved = new Set(stored.map(String));
} catch { /* Saving remains available for this session. */ }

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function safeURL(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, location.href);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
function textValue(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join('\n');
  return '';
}
function categoryName(item) { return CATEGORIES[item.category] || '돈 이야기'; }
function sourceName(item) {
  return textValue(item.source) || (Array.isArray(item.sources) && textValue(item.sources[0]?.name)) || '돈의 달인';
}
function authorName(item) { return textValue(item.author) || '필자 미상'; }
function essayByline(item) { const a = authorName(item), s = sourceName(item); return s && !a.includes(s) && !s.includes(a) ? `${a} · ${s}` : a; }
function displayTitle(item) { return item.category === 'essay' ? textValue(item.title_ko) || item.title : item.title; }
function authorInitials(item) {
  const words = authorName(item).split(/\s+/);
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : Array.from(words[0]).slice(0, 2).join('')).toLocaleUpperCase();
}
function dateObject(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}
function dateLabel(value) {
  const date = dateObject(value);
  if (!date) return '날짜 미상';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  if (date.getTime() === today.getTime()) return '오늘';
  if (date.getTime() === yesterday.getTime()) return '어제';
  return `${date.getFullYear() === today.getFullYear() ? '' : `${date.getFullYear()}년 `}${date.getMonth() + 1}월 ${date.getDate()}일`;
}
function syncSaved() {
  $('saved-badge').textContent = String(saved.size);
  $('saved-badge').hidden = saved.size === 0;
  $('saved-toggle').setAttribute('aria-pressed', String(savedOnly));
  $('saved-toggle').setAttribute('aria-label', `저장 ${saved.size}개, ${savedOnly ? '전체 기사 보기' : '저장한 기사만 보기'}`);
  document.querySelectorAll('[data-save]').forEach((button) => {
    const active = saved.has(button.dataset.save);
    button.textContent = active ? '★' : '☆';
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', `${active ? '저장 해제' : '기사 저장'}: ${button.dataset.title}`);
  });
  if (currentItem) {
    const active = saved.has(currentItem.id);
    $('detail-save').textContent = active ? '★' : '☆';
    $('detail-save').setAttribute('aria-pressed', String(active));
    $('detail-save').setAttribute('aria-label', active ? '기사 저장 해제' : '기사 저장');
  }
}
function toggleSave(item) {
  if (saved.has(item.id)) saved.delete(item.id); else saved.add(item.id);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...saved])); }
  catch { $('status').textContent = '브라우저 저장이 제한되어 이번 이용 중에만 저장됩니다.'; $('status').hidden = false; }
  if (savedOnly) renderFeed();
  syncSaved();
}
function makeRow(item) {
  const essay = item.category === 'essay';
  const title = displayTitle(item);
  const imageURL = safeURL(item.image);
  const row = el('article', `feed-row${imageURL ? ' has-image' : ''}${essay ? ' essay-row' : ''}`);
  const open = el('button', 'article-open'); open.type = 'button';
  open.setAttribute('aria-label', `${title}, 상세 보기`);
  const meta = el('span', 'article-meta');
  meta.append(el('span', 'article-source', essay ? essayByline(item) : sourceName(item)), el('span', '', '·'), el('span', '', dateLabel(item.date)), el('span', '', '·'), el('span', 'category-label', categoryName(item)));
  open.append(meta, el('h3', 'article-title', title));
  if (essay) open.append(el('span', 'article-original-title', item.title));
  if (textValue(item.oneliner)) {
    const line = el('span', 'article-oneliner');
    line.append(el('b', '', essay ? '핵심 주장' : '돈 인사이트'), document.createTextNode(essay ? `“${textValue(item.oneliner)}”` : textValue(item.oneliner)));
    open.append(line);
  }
  open.addEventListener('click', () => openDetail(item, open));
  const side = el('div', 'row-side');
  const avatar = () => {
    const button = el('button', 'author-avatar', authorInitials(item)); button.type = 'button';
    button.setAttribute('aria-label', `${authorName(item)}, ${title}, 상세 보기`);
    button.addEventListener('click', () => openDetail(item, button)); return button;
  };
  if (imageURL) {
    const thumbButton = el('button', 'thumbnail-button'); thumbButton.type = 'button';
    thumbButton.setAttribute('aria-label', `${title}, 상세 보기`);
    const img = el('img', 'thumbnail'); img.src = imageURL; img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => { if (essay) thumbButton.replaceWith(avatar()); else thumbButton.remove(); row.classList.remove('has-image'); }, { once: true });
    thumbButton.append(img); thumbButton.addEventListener('click', () => openDetail(item, thumbButton)); side.append(thumbButton);
  } else if (essay) side.append(avatar());
  const star = el('button', 'save-button'); star.type = 'button'; star.dataset.save = item.id; star.dataset.title = title;
  star.addEventListener('click', () => toggleSave(item)); side.append(star);
  row.append(open, side);
  row.addEventListener('click', (event) => {
    if (!event.target.closest('button')) openDetail(item, open);
  });
  return row;
}
function makeThreads() {
  const box = el('section', 'threads');
  box.append(el('h2', 'threads-title', '오늘의 연결고리'), el('p', 'threads-sub', '기사 하나로는 안 보이고, 묶어야 보이는 것'));
  threads.forEach((t, i) => {
    const d = el('details', 'thread'); if (i === 0) d.open = true;
    const sum = el('summary', ''); sum.append(el('span', 'thread-kind', textValue(t.kind) || '연결'), document.createTextNode(textValue(t.title)));
    d.append(sum, el('p', 'thread-thesis', textValue(t.thesis)));
    if (textValue(t.question)) d.append(el('p', 'thread-q', '❓ ' + textValue(t.question)));
    const list = el('div', 'thread-items');
    (t.ids || []).map((id) => items.find((x) => x.id === id)).filter(Boolean).forEach((item) => {
      const b = el('button', 'thread-item', displayTitle(item)); b.type = 'button'; b.addEventListener('click', () => openDetail(item, b)); list.append(b);
    });
    d.append(list); box.append(d);
  });
  return box;
}
function renderFeed() {
  syncAuthorChips();
  const query = $('query').value.trim().toLocaleLowerCase('ko');
  const visible = items.filter((item) => item.category !== 'world' && (category === 'all' || category === item.category)
    && (category !== 'essay' || !authorFilter || authorName(item) === authorFilter)
    && (!savedOnly || saved.has(item.id))
    && (!query || [item.title, item.title_ko, item.author, item.oneliner, item.summary].map(textValue).join(' ').toLocaleLowerCase('ko').includes(query)));
  $('feed-label').textContent = `${savedOnly ? '저장한 기사' : '전체 기사'}${category !== 'all' ? ` · ${CATEGORIES[category]}` : ''}${query ? ' · 검색 결과' : ''}`;
  $('count').textContent = `${visible.length}개 · 최신순`;
  const fragment = document.createDocumentFragment();
  if (category === 'all' && !query && !savedOnly && threads.length) fragment.append(makeThreads());
  let lastDate = null;
  visible.forEach((item) => {
    if (item.date !== lastDate) { fragment.append(el('h2', 'date-divider', dateLabel(item.date))); lastDate = item.date; }
    fragment.append(makeRow(item));
  });
  if (!visible.length) {
    const empty = el('div', 'empty');
    empty.append(el('p', '', savedOnly ? '저장한 기사가 없습니다.' : '표시할 기사가 없습니다.'), el('p', '', savedOnly ? '기사 옆 ☆을 눌러 나중에 읽어보세요.' : '검색어나 카테고리를 바꿔보세요.'));
    if (category !== 'all' || query || savedOnly) {
      const reset = el('button', '', '전체 기사 보기'); reset.type = 'button';
      reset.addEventListener('click', () => { category = 'all'; authorFilter = ''; savedOnly = false; $('query').value = ''; syncChips(); renderFeed(); }); empty.append(reset);
    }
    fragment.append(empty);
  }
  $('feed').replaceChildren(fragment); syncSaved();
}
function syncChips() {
  document.querySelectorAll('[data-category]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.category === category)));
}
function syncAuthorChips() {
  const bar = $('authors'); bar.hidden = category !== 'essay';
  if (bar.hidden) return;
  const names = [...new Set(items.filter((item) => item.category === 'essay').map(authorName))];
  if (authorFilter && !names.includes(authorFilter)) authorFilter = '';
  const labels = ['전체 필자', ...names];
  const values = ['', ...names];
  // Keep focused chips and the horizontal scroll position while filtering.
  if (bar.children.length !== labels.length || values.some((value, index) => bar.children[index]?.dataset.author !== value)) {
    bar.replaceChildren(...labels.map((label, index) => {
      const button = el('button', 'chip author-chip', label); button.type = 'button'; button.dataset.author = values[index];
      button.addEventListener('click', () => { authorFilter = button.dataset.author; renderFeed(); }); return button;
    }));
  }
  [...bar.children].forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.author === authorFilter)));
}
Object.entries(CATEGORIES).forEach(([key, label]) => {
  const button = el('button', 'chip', label); button.type = 'button'; button.dataset.category = key;
  button.setAttribute('aria-pressed', String(key === category));
  button.addEventListener('click', () => { if (category !== key) authorFilter = ''; category = key; syncChips(); renderFeed(); }); $('categories').append(button);
});
// 피드를 좌우로 밀면 분류가 옆 칸으로 이동 (칩 줄·상세 시트·검색창에서 시작한 터치는 제외)
// 안드로이드가 터치를 스크롤로 가로채 touchcancel이 와도 마지막 위치로 판정한다.
(() => {
  const keys = Object.keys(CATEGORIES); let sx = null, sy = 0, lx = 0, ly = 0, done = false;
  const go = () => {
    if (sx === null || done) return; done = true;
    const dx = lx - sx, dy = ly - sy; sx = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    const next = keys.indexOf(category) + (dx < 0 ? 1 : -1);
    if (next < 0 || next >= keys.length) return;
    authorFilter = ''; category = keys[next]; syncChips(); renderFeed();
    document.querySelector(`[data-category="${category}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    $('feed').animate([{ opacity: 0.4, transform: `translateX(${dx < 0 ? 24 : -24}px)` }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'ease-out' });
  };
  document.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1 || event.target.closest('#categories, #authors, #detail-sheet, input')) { sx = null; return; }
    sx = lx = event.touches[0].clientX; sy = ly = event.touches[0].clientY; done = false;
  }, { passive: true });
  document.addEventListener('touchmove', (event) => {
    if (sx === null) return; lx = event.touches[0].clientX; ly = event.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchend', (event) => { if (sx !== null) { lx = event.changedTouches[0].clientX; ly = event.changedTouches[0].clientY; } go(); }, { passive: true });
  document.addEventListener('touchcancel', go, { passive: true });
})();
function section(title, value, className = '') {
  const text = textValue(value); if (!text) return null;
  const block = el('section', `detail-section ${className}`); block.append(el('h2', '', title), el('p', '', text)); return block;
}
function externalLink(label, url, className = '') {
  const href = safeURL(url); if (!href) return null;
  const link = el('a', className, label); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; return link;
}
function populateDetail(item) {
  const essay = item.category === 'essay';
  const content = $('detail-content'); content.replaceChildren();
  content.append(el('div', 'detail-kicker', categoryName(item)));
  const title = el('h1', '', displayTitle(item)); title.id = 'detail-title'; content.append(title);
  if (essay) content.append(el('p', 'detail-original-title', item.title));
  content.append(el('p', 'detail-meta', `${essay ? essayByline(item) : sourceName(item)} · ${item.date || '날짜 미상'}`));
  const original = externalLink(essay ? '원문 읽기 (영어)' : '원문 기사 보기 ↗', item.url, 'primary-button'); if (original) content.append(original);
  const appendSection = (name, value, className) => { const block = section(name, value, className); if (block) content.append(block); };
  appendSection(essay ? '핵심 주장' : '한 줄 인사이트', item.oneliner, 'insight-section');
  appendSection('무슨 일인가', item.summary);
  if (essay) {
    const ideas = (Array.isArray(item.facts) ? item.facts : [item.facts]).map((fact) => {
      if (!fact) return '';
      return textValue(fact) || [textValue(fact.label), textValue(fact.value)].filter(Boolean).join(': ');
    }).filter(Boolean);
    if (ideas.length) {
      const block = el('section', 'detail-section'); block.append(el('h2', '', '핵심 아이디어'));
      const list = el('ol', 'ideas-list'); ideas.forEach((idea) => list.append(el('li', '', idea)));
      block.append(list); content.append(block);
    }
  } else if (Array.isArray(item.facts) && item.facts.some((fact) => fact && (textValue(fact.label) || textValue(fact.value)))) {
    const block = el('section', 'detail-section'); block.append(el('h2', '', '핵심 숫자'));
    const table = el('table', 'facts-table'); const body = el('tbody');
    item.facts.forEach((fact) => {
      if (!fact || (!textValue(fact.label) && !textValue(fact.value))) return;
      const row = el('tr'); const label = el('th', '', textValue(fact.label)); label.scope = 'row';
      row.append(label, el('td', '', textValue(fact.value))); body.append(row);
    }); table.append(body); block.append(table); content.append(block);
  }
  appendSection(essay ? '이런 분께 도움이 돼요' : '나에게 해당되나', item.who);
  appendSection(essay ? '필자·원문' : '언제', essay ? item.when || essayByline(item) : item.when);
  const steps = Array.isArray(item.steps) ? item.steps.map(textValue).filter(Boolean) : [];
  if (steps.length) {
    const block = el('section', 'detail-section steps-section'); block.append(el('h2', '', essay ? '곱씹어 볼 질문·행동' : '이렇게 하세요'));
    const list = el('ol', 'steps-list'); steps.forEach((step) => list.append(el('li', '', step.replace(/^\s*\d+\s*(?:단계\s*[:：.]|[.)])\s*/, ''))));
    block.append(list); content.append(block);
  } else appendSection(essay ? '곱씹어 볼 질문·행동' : '이렇게 하세요', essay ? item.steps || item.apply : item.apply, 'steps-section');
  appendSection(essay ? '글 속 대표 사례' : '숫자 예시', item.example, 'example-section');
  appendSection('통념 뒤집기', item.twist, 'twist-section');
  appendSection('한 차원 높은 시각', item.insight);
  appendSection('다른 분야와 연결', item.connect);
  appendSection(essay ? '내 상황에 적용하면' : '두 사람에게 적용하면', item.scenario, 'example-section');
  appendSection(essay ? '읽을 때 주의' : '주의', item.caution, 'caution-section');
  if (Array.isArray(item.sources)) {
    const links = item.sources.map((source) => source && externalLink(textValue(source.name) || '출처 보기 ↗', source.url)).filter(Boolean);
    if (links.length) {
      const block = el('section', 'detail-section'); block.append(el('h2', '', '출처 링크')); const list = el('ul', 'sources-list');
      links.forEach((link) => { const li = el('li'); li.append(link); list.append(li); }); block.append(list); content.append(block);
    }
  }
  content.append(el('p', 'detail-disclaimer', DISCLAIMER));
}
function openDetail(item, trigger) {
  currentItem = item; triggerElement = trigger; populateDetail(item); syncSaved();
  history.pushState({ moneyMasterDetail: item.id }, '', location.href);
  $('detail-sheet').showModal(); document.body.classList.add('sheet-open'); $('detail-scroll').scrollTop = 0; $('detail-back').focus();
}
function hideDetail() {
  if (!$('detail-sheet').open) return;
  $('detail-sheet').close(); document.body.classList.remove('sheet-open'); currentItem = null;
  if (triggerElement?.isConnected) triggerElement.focus({ preventScroll: true }); else $('saved-toggle').focus({ preventScroll: true });
}
function closeDetail() {
  if (!$('detail-sheet').open) return;
  if (history.state?.moneyMasterDetail) history.back(); else hideDetail();
}
window.addEventListener('popstate', (event) => {
  const item = items.find((candidate) => candidate.id === event.state?.moneyMasterDetail);
  if (!item) { hideDetail(); return; }
  currentItem = item; populateDetail(item); syncSaved();
  if (!$('detail-sheet').open) $('detail-sheet').showModal();
  document.body.classList.add('sheet-open'); $('detail-scroll').scrollTop = 0;
});
$('detail-back').addEventListener('click', closeDetail);
$('detail-sheet').addEventListener('cancel', (event) => { event.preventDefault(); closeDetail(); });
$('detail-save').addEventListener('click', () => { if (currentItem) toggleSave(currentItem); });
// A downward swipe at the top or on the toolbar dismisses the sheet.
$('detail-sheet').addEventListener('touchstart', (event) => {
  const touch = event.touches[0];
  touchStart = event.touches.length === 1 && (event.target.closest('#detail-toolbar') || $('detail-scroll').scrollTop <= 0)
    ? { x: touch.clientX, y: touch.clientY } : null;
}, { passive: true });
$('detail-sheet').addEventListener('touchmove', (event) => {
  if (!touchStart || event.touches.length !== 1) return;
  const touch = event.touches[0];
  if (touch.clientY - touchStart.y > 14 && Math.abs(touch.clientX - touchStart.x) < 50) event.preventDefault();
}, { passive: false });
$('detail-sheet').addEventListener('touchend', (event) => {
  if (!touchStart) return;
  const touch = event.changedTouches[0];
  if (touch.clientY - touchStart.y > 90 && Math.abs(touch.clientX - touchStart.x) < 70) closeDetail();
  touchStart = null;
}, { passive: true });
$('detail-sheet').addEventListener('touchcancel', () => { touchStart = null; });
$('search-toggle').addEventListener('click', () => {
  const open = $('search-panel').hidden; $('search-panel').hidden = !open;
  $('search-toggle').setAttribute('aria-expanded', String(open)); $('search-toggle').setAttribute('aria-label', open ? '검색창 닫기' : '검색창 열기');
  if (open) $('query').focus(); else { $('query').value = ''; renderFeed(); }
});
$('query').addEventListener('input', renderFeed);
$('search-clear').addEventListener('click', () => { $('query').value = ''; renderFeed(); $('query').focus(); });
$('saved-toggle').addEventListener('click', () => { savedOnly = !savedOnly; renderFeed(); });
window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  try { const value = JSON.parse(event.newValue || '[]'); saved = new Set(Array.isArray(value) ? value.map(String) : []); renderFeed(); } catch { /* Ignore invalid storage. */ }
});
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function syncInstall() { $('install-button').hidden = standalone(); }
window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); installPrompt = event; syncInstall(); });
window.addEventListener('appinstalled', () => { installPrompt = null; $('install-button').hidden = true; });
matchMedia('(display-mode: standalone)').addEventListener('change', syncInstall);
$('install-button').addEventListener('click', async () => {
  if (!installPrompt) { $('install-sheet').showModal(); return; }
  const prompt = installPrompt; installPrompt = null;
  try { await prompt.prompt(); await prompt.userChoice; } catch { $('install-sheet').showModal(); }
  syncInstall();
});
$('install-sheet').addEventListener('click', (event) => {
  if (event.target !== $('install-sheet')) return;
  const box = $('install-sheet').getBoundingClientRect();
  if (event.clientY < box.top || event.clientX < box.left || event.clientX > box.right) $('install-sheet').close();
});
function readItems(data) {
  const list = Array.isArray(data) ? data : data?.items;
  if (!Array.isArray(list)) throw new Error('Invalid data');
  const ids = new Set();
  return list.filter((item) => item && typeof item === 'object' && item.id != null && textValue(item.title))
    .map((item) => ({ ...item, id: String(item.id), title: textValue(item.title), date: dateObject(item.date) ? item.date : '' }))
    .filter((item) => { if (ids.has(item.id)) return false; ids.add(item.id); return true; })
    .sort((a, b) => b.date.localeCompare(a.date));
}
async function loadData() {
  let offline = false;
  try {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000);
    let response;
    try { response = await fetch(DATA_URL, { cache: 'no-store', signal: controller.signal }); }
    finally { clearTimeout(timer); }
    if (!response.ok) throw new Error('Network response');
    { const j = await response.clone().json(); items = readItems(j); threads = Array.isArray(j?.threads?.items) ? j.threads.items : []; }
    offline = response.headers.get('X-Money-Master-Cache') === '1';
    if ('caches' in window && !offline) {
      try { const cache = await caches.open(CACHE_NAME); await cache.put(DATA_URL, response); } catch { /* Caching is optional. */ }
    }
  } catch {
    try {
      const cached = 'caches' in window ? await caches.match(DATA_URL) : null;
      if (!cached) throw new Error('No cache');
      { const j = await cached.json(); items = readItems(j); threads = Array.isArray(j?.threads?.items) ? j.threads.items : []; offline = true; }
    } catch {
      $('status').replaceChildren(document.createTextNode('기사를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요. '));
      const retry = el('button', '', '다시 시도'); retry.type = 'button'; retry.addEventListener('click', () => { $('status').textContent = '기사를 불러오는 중입니다…'; loadData(); }); $('status').append(retry);
      $('status').hidden = false; renderFeed(); return;
    }
  }
  $('status').textContent = offline ? '오프라인 · 마지막으로 저장된 기사를 보여드립니다.' : '';
  $('status').hidden = !offline; renderFeed();
}
syncSaved(); syncInstall(); loadData();
if ('serviceWorker' in navigator && ['https:', 'http:'].includes(location.protocol)) {
  const hadController = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
  navigator.serviceWorker.register('./sw.js').catch(() => { /* The feed works without installation. */ });
}
