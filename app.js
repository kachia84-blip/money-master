'use strict';

const categories = { world: '🌏 해외 제도', tax: '🧾 절세', asset: '🪙 새로운 자산', policy: '🏛 정책 변화', mindset: '🧠 돈의 원리' };
const levels = { 1: '기초', 2: '중급', 3: '심화' };
const $ = (id) => document.getElementById(id);
let items = [], category = 'all', view = 'home', storageAvailable = true;
let saved = new Set();
try {
  const stored = JSON.parse(localStorage.getItem('money-master-saved') || '[]');
  if (Array.isArray(stored)) saved = new Set(stored.filter((id) => typeof id === 'string'));
} catch { storageAvailable = false; }

const regionNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['ko'], { type: 'region' }) : null;
function countryLabel(value) {
  return value.split(',').map((part) => {
    const code = part.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return part;
    const flag = [...code].map((char) => String.fromCodePoint(127397 + char.charCodeAt(0))).join('');
    return `${flag} ${regionNames ? regionNames.of(code) : code}`;
  }).join(' · ');
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function safeURL(value) {
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null; }
  catch { return null; }
}
function validItem(item) {
  return item && ['id', 'category', 'country', 'title', 'summary', 'insight', 'apply', 'caution', 'date'].every((key) => typeof item[key] === 'string')
    && item.id.length > 0 && Object.hasOwn(categories, item.category) && [1, 2, 3].includes(item.level)
    && /^\d{4}-\d{2}-\d{2}$/.test(item.date) && Array.isArray(item.sources) && item.sources.length > 0
    && item.sources.every((source) => source && typeof source.name === 'string' && safeURL(source.url));
}
function makeCard(item, featured = false) {
  const card = element('article', `card${featured ? ' featured' : ''}`);
  const top = element('div', 'card-top');
  top.append(element('span', `badge ${item.category}`, categories[item.category]), element('span', 'country', countryLabel(item.country)));
  const star = element('button', 'save', saved.has(item.id) ? '★' : '☆');
  star.type = 'button'; star.dataset.save = item.id;
  star.setAttribute('aria-label', `${item.title} 저장`); star.setAttribute('aria-pressed', String(saved.has(item.id)));
  star.addEventListener('click', () => {
    if (saved.has(item.id)) saved.delete(item.id); else saved.add(item.id);
    try { localStorage.setItem('money-master-saved', JSON.stringify([...saved])); }
    catch { storageAvailable = false; $('status').textContent = '브라우저 저장이 제한되어 현재 화면에서만 저장됩니다.'; }
    document.querySelectorAll('[data-save]').forEach((button) => {
      const active = saved.has(button.dataset.save);
      button.textContent = active ? '★' : '☆'; button.setAttribute('aria-pressed', String(active));
    });
    if (view === 'saved') render();
  });
  top.append(star); card.append(top);
  const details = element('details');
  const summary = element('summary');
  summary.append(element('h3', '', item.title), element('p', 'preview', item.summary), element('span', 'meta', `${item.date} · ${levels[item.level]} · 펼쳐 읽기`));
  details.append(summary);
  const body = element('div', 'detail-body');
  for (const [key, title] of [['insight', '한 차원 높은 시각'], ['apply', '내 생활에 적용하기'], ['caution', '확인할 점']]) {
    const section = element('section', key);
    section.append(element('h4', '', title), element('p', '', item[key])); body.append(section);
  }
  const sources = element('section', 'sources'); sources.append(element('h4', '', '출처'));
  const links = element('ul');
  item.sources.forEach((source) => {
    const li = element('li'); const link = element('a', '', source.name);
    link.href = safeURL(source.url); link.target = '_blank'; link.rel = 'noopener noreferrer'; li.append(link); links.append(li);
  });
  sources.append(links); body.append(sources); details.append(body); card.append(details); return card;
}
function render() {
  $('view-title').textContent = { home: '오늘의 인사이트', search: '궁금한 돈의 이야기', saved: '저장한 인사이트' }[view];
  $('daily-section').hidden = view !== 'home' || items.length === 0;
  document.querySelectorAll('[data-view]').forEach((button) => {
    if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-category]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.category === category)));
  const query = $('query').value.trim().toLocaleLowerCase('ko');
  const visible = items.filter((item) => (category === 'all' || item.category === category)
    && (view !== 'saved' || saved.has(item.id))
    && `${item.title} ${item.summary} ${item.country} ${countryLabel(item.country)}`.toLocaleLowerCase('ko').includes(query));
  $('count').textContent = `${view === 'saved' ? '저장한 이야기' : '전체 이야기'} ${visible.length}개 · 최신순`;
  $('cards').replaceChildren(...visible.map((item) => makeCard(item)));
  if (!visible.length) $('cards').append(element('p', 'empty', view === 'saved' ? '저장한 이야기가 없습니다. 카드의 ☆을 눌러 보세요.' : '표시할 이야기가 없습니다. 검색어나 카테고리를 바꿔 보세요.'));
}
for (const [id, title] of [['all', '전체'], ...Object.entries(categories)]) {
  const button = element('button', '', title); button.type = 'button'; button.dataset.category = id;
  button.addEventListener('click', () => { category = id; render(); }); $('categories').append(button);
}
$('query').addEventListener('input', render);
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
  view = button.dataset.view; category = 'all'; $('query').value = ''; render();
  if (view === 'search') $('query').focus(); else window.scrollTo({ top: 0, behavior: 'smooth' });
}));
async function readData(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data || typeof data.updated !== 'string' || !Array.isArray(data.items)) throw new Error('Invalid data');
  return data;
}
async function init() {
  let data, sample = false;
  try { data = await readData('./data/insights.json'); }
  catch {
    try { data = await readData('./data/sample.json'); sample = true; }
    catch { $('status').textContent = '데이터를 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 새로고침해 주세요.'; render(); return; }
  }
  const ids = new Set();
  items = data.items.filter((item) => { if (!validItem(item) || ids.has(item.id)) return false; ids.add(item.id); return true; }).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  $('status').textContent = `${sample ? '테스트용 샘플 · ' : ''}업데이트 ${data.updated}${items.length !== data.items.length ? ' · 형식이 맞지 않는 항목은 제외했습니다.' : ''}${storageAvailable ? '' : ' · 저장 기능이 제한됩니다.'}`;
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  $('today').textContent = date;
  let hash = 0; for (const char of date) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const stableItems = [...items].sort((a, b) => a.id.localeCompare(b.id));
  if (stableItems.length) $('daily').replaceChildren(makeCard(stableItems[hash % stableItems.length], true));
  render();
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
init();
