'use strict';
const $ = (id) => document.getElementById(id);
const CATEGORIES = { all: '전체', tax: '절세', world: '해외제도', asset: '새자산', policy: '정책', mindset: '원리' };
const STORAGE_KEY = 'money-master-saved';
const DATA_URL = new URL('./data/insights.json', location.href).href;
const CACHE_NAME = 'money-master-v5';
const DISCLAIMER = '교육·정보 목적이며 투자·세무 자문이 아닙니다. 세법은 수시로 바뀌니 시행 전 국세청·전문가로 확인하세요.';
let items = [], category = 'all', savedOnly = false, currentItem = null, installPrompt = null;
let saved = new Set(), triggerElement = null, touchStart = null;
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
  const imageURL = safeURL(item.image);
  const row = el('article', `feed-row${imageURL ? ' has-image' : ''}`);
  const open = el('button', 'article-open'); open.type = 'button';
  open.setAttribute('aria-label', `${item.title}, 상세 보기`);
  const meta = el('span', 'article-meta');
  meta.append(el('span', 'article-source', sourceName(item)), el('span', '', '·'), el('span', '', dateLabel(item.date)), el('span', '', '·'), el('span', 'category-label', categoryName(item)));
  open.append(meta, el('h3', 'article-title', item.title));
  if (textValue(item.oneliner)) {
    const line = el('span', 'article-oneliner');
    line.append(el('b', '', '돈 인사이트'), document.createTextNode(textValue(item.oneliner)));
    open.append(line);
  }
  open.addEventListener('click', () => openDetail(item, open));
  const side = el('div', 'row-side');
  if (imageURL) {
    const thumbButton = el('button', 'thumbnail-button'); thumbButton.type = 'button';
    thumbButton.setAttribute('aria-label', `${item.title}, 상세 보기`);
    const img = el('img', 'thumbnail'); img.src = imageURL; img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => { thumbButton.remove(); row.classList.remove('has-image'); }, { once: true });
    thumbButton.append(img); thumbButton.addEventListener('click', () => openDetail(item, thumbButton)); side.append(thumbButton);
  }
  const star = el('button', 'save-button'); star.type = 'button'; star.dataset.save = item.id; star.dataset.title = item.title;
  star.addEventListener('click', () => toggleSave(item)); side.append(star);
  row.append(open, side);
  row.addEventListener('click', (event) => {
    if (!event.target.closest('button')) openDetail(item, open);
  });
  return row;
}
function renderFeed() {
  const query = $('query').value.trim().toLocaleLowerCase('ko');
  const visible = items.filter((item) => (category === 'all' || category === item.category)
    && (!savedOnly || saved.has(item.id))
    && (!query || [item.title, item.oneliner, item.summary].map(textValue).join(' ').toLocaleLowerCase('ko').includes(query)));
  $('feed-label').textContent = `${savedOnly ? '저장한 기사' : '전체 기사'}${category !== 'all' ? ` · ${CATEGORIES[category]}` : ''}${query ? ' · 검색 결과' : ''}`;
  $('count').textContent = `${visible.length}개 · 최신순`;
  const fragment = document.createDocumentFragment();
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
      reset.addEventListener('click', () => { category = 'all'; savedOnly = false; $('query').value = ''; syncChips(); renderFeed(); }); empty.append(reset);
    }
    fragment.append(empty);
  }
  $('feed').replaceChildren(fragment); syncSaved();
}
function syncChips() {
  document.querySelectorAll('[data-category]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.category === category)));
}
Object.entries(CATEGORIES).forEach(([key, label]) => {
  const button = el('button', 'chip', label); button.type = 'button'; button.dataset.category = key;
  button.setAttribute('aria-pressed', String(key === category));
  button.addEventListener('click', () => { category = key; syncChips(); renderFeed(); }); $('categories').append(button);
});
function section(title, value, className = '') {
  const text = textValue(value); if (!text) return null;
  const block = el('section', `detail-section ${className}`); block.append(el('h2', '', title), el('p', '', text)); return block;
}
function externalLink(label, url, className = '') {
  const href = safeURL(url); if (!href) return null;
  const link = el('a', className, label); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; return link;
}
function populateDetail(item) {
  const content = $('detail-content'); content.replaceChildren();
  content.append(el('div', 'detail-kicker', categoryName(item)));
  const title = el('h1', '', item.title); title.id = 'detail-title'; content.append(title);
  content.append(el('p', 'detail-meta', `${sourceName(item)} · ${item.date || '날짜 미상'}`));
  const original = externalLink('원문 기사 보기 ↗', item.url, 'primary-button'); if (original) content.append(original);
  const appendSection = (name, value, className) => { const block = section(name, value, className); if (block) content.append(block); };
  appendSection('한 줄 인사이트', item.oneliner, 'insight-section');
  appendSection('무슨 일인가', item.summary);
  if (Array.isArray(item.facts) && item.facts.some((fact) => fact && (textValue(fact.label) || textValue(fact.value)))) {
    const block = el('section', 'detail-section'); block.append(el('h2', '', '핵심 숫자'));
    const table = el('table', 'facts-table'); const body = el('tbody');
    item.facts.forEach((fact) => {
      if (!fact || (!textValue(fact.label) && !textValue(fact.value))) return;
      const row = el('tr'); const label = el('th', '', textValue(fact.label)); label.scope = 'row';
      row.append(label, el('td', '', textValue(fact.value))); body.append(row);
    }); table.append(body); block.append(table); content.append(block);
  }
  appendSection('나에게 해당되나', item.who);
  appendSection('언제', item.when);
  const steps = Array.isArray(item.steps) ? item.steps.map(textValue).filter(Boolean) : [];
  if (steps.length) {
    const block = el('section', 'detail-section steps-section'); block.append(el('h2', '', '이렇게 하세요'));
    const list = el('ol', 'steps-list'); steps.forEach((step) => list.append(el('li', '', step.replace(/^\s*\d+\s*(?:단계\s*[:：.]|[.)])\s*/, ''))));
    block.append(list); content.append(block);
  } else appendSection('이렇게 하세요', item.apply, 'steps-section');
  appendSection('숫자 예시', item.example, 'example-section');
  appendSection('한 차원 높은 시각', item.insight);
  appendSection('주의', item.caution, 'caution-section');
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
    items = readItems(await response.clone().json());
    offline = response.headers.get('X-Money-Master-Cache') === '1';
    if ('caches' in window && !offline) {
      try { const cache = await caches.open(CACHE_NAME); await cache.put(DATA_URL, response); } catch { /* Caching is optional. */ }
    }
  } catch {
    try {
      const cached = 'caches' in window ? await caches.match(DATA_URL) : null;
      if (!cached) throw new Error('No cache');
      items = readItems(await cached.json()); offline = true;
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
  navigator.serviceWorker.register('./sw.js').catch(() => { /* The feed works without installation. */ });
}
