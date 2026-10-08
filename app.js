const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const CATS = { portfolio: 'Портфолио', katyushi: 'Катюши', restaurant: 'Ресторан' };
const CAT_ORDER = Object.keys(CATS);
const S = {
  items: [], next: Object.fromEntries(CAT_ORDER.map(k => [k, null])), loaded: new Set(),
  filter: 'all', limit: 18, step: 18, drawn: 0, expanded: false, lbItems: [], cur: -1,
  favorites: new Map(), loading: false, menuOpen: false, favOpen: false
};

const FAV_KEY = 'maesun-favorites-v3';
const LEGACY_FAV_KEYS = ['maesun-favorites-v2','maesun-favorites-v1','maesun-favorites'];
const DRAFT_KEY = 'maesun-booking-draft-v2';
const KEY = (window.CONFIG || {}).GOOGLE_DRIVE_API_KEY || '';
const DRIVE_PAGE_SIZE = 36;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const PREFER_PROXY_API = /^https?:$/.test(location.protocol) && !LOCAL_HOSTS.has(location.hostname);
const toast = (message) => {
  const el = $('#toast'); if (!el) return;
  el.textContent = message; el.classList.add('on');
  clearTimeout(toast._timer); toast._timer = setTimeout(() => el.classList.remove('on'), 2400);
};

const escapeHtml = (s = '') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
const isReduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const smoothTo = (selector) => $(selector)?.scrollIntoView({ behavior: isReduce() ? 'auto' : 'smooth', block: 'start' });
const copyText = async (value) => {
  try { await navigator.clipboard.writeText(value); return true; }
  catch {
    const area = document.createElement('textarea'); area.value = value; area.setAttribute('readonly',''); area.style.position='fixed'; area.style.opacity='0';
    document.body.append(area); area.select(); const ok = document.execCommand('copy'); area.remove(); return ok;
  }
};
const focusables = (root) => $$('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])', root).filter(el => !el.hidden && el.offsetParent !== null);
function trapDialog(dialog, closeFn){
  const onKey = (e) => {
    if (dialog.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); closeFn(); return; }
    if (e.key !== 'Tab') return;
    const list = focusables(dialog); if (!list.length) return;
    const first=list[0], last=list[list.length-1];
    if (e.shiftKey && document.activeElement===first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement===last) { e.preventDefault(); first.focus(); }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

/* Loader */
const PL = (() => {
  const el = $('#preload'), bar = $('#plBar');
  let done = false;
  const set = (value) => { if (bar) bar.style.transform = `scaleX(${Math.max(.06, Math.min(1, value))})`; };
  const finish = () => {
    if (done) return; done = true; set(1);
    setTimeout(() => { el?.classList.add('off'); document.documentElement.classList.remove('is-loading'); setTimeout(() => el?.remove(), 500); }, 220);
  };
  window.addEventListener('load', () => setTimeout(finish, 250));
  setTimeout(finish, 6000);
  return { set, finish };
})();

/* Favorites */
function readFavorites() {
  try {
    // Не подхватываем избранное из старых версий сайта: оно не должно
    // внезапно появляться как новые референсы, если пользователь ничего
    // не добавлял в этой версии.
    LEGACY_FAV_KEYS.forEach(key => localStorage.removeItem(key));
    const raw = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
    if (Array.isArray(raw)) S.favorites = new Map(raw.map(x => typeof x === 'string' ? [x, {id:x, cat:''}] : [x.id, x]).filter(([id]) => id));
  } catch {
    S.favorites.clear();
  }
  syncFavoriteUi();
}
function pruneFavoritesToLoadedItems() {
  if (!S.favorites.size || !S.items.length) return;
  const valid = new Set(S.items.map(f => f.id));
  let changed = false;
  for (const id of S.favorites.keys()) {
    if (!valid.has(id)) { S.favorites.delete(id); changed = true; }
  }
  if (changed) saveFavorites();
  syncFavoriteUi();
}
function saveFavorites() {
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...S.favorites.values()])); } catch {}
  syncFavoriteUi();
  $$('.fav-toggle').forEach(btn => {
    const id = btn.closest('.ph')?.dataset.id;
    const yes = !!id && S.favorites.has(id);
    btn.setAttribute('aria-pressed', String(yes)); btn.textContent = yes ? '♥' : '♡';
  });
}
function syncFavoriteUi() {
  // Источник истины — только реально отмеченные кадры в текущей версии.
  const n = S.favorites.size;
  if ($('#favCount')) $('#favCount').textContent = n;
  if ($('#favN')) $('#favN').textContent = n;
  const opt = $('#favOpt');
  if (opt) {
    // hidden is the single source of truth for the reference checkbox.
    // The .check class uses display:flex!important, so CSS explicitly
    // handles .check[hidden] to guarantee the row cannot reappear at 0.
    opt.hidden = n === 0;
    if (n === 0 && $('#withFav')) $('#withFav').checked = false;
    else if (n > 0 && $('#withFav')) $('#withFav').checked = true;
  }
}
function favoriteItems() {
  return [...S.favorites.values()].map(v => S.items.find(f => f.id === v.id) || null).filter(Boolean);
}
function toggleFavorite(id) {
  const item = S.items.find(f => f.id === id) || S.lbItems.find(f => f.id === id);
  if (!item && !S.favorites.has(id)) return;
  if (S.favorites.has(id)) { S.favorites.delete(id); toast('Кадр убран из избранного'); }
  else { S.favorites.set(id, { id, cat: item?.cat || '' }); toast('Кадр добавлен в избранное'); }
  saveFavorites();
  if (!$('#favPanel')?.hidden) renderFavorites();
  if (item) updateLbFavorite(item);
}
function favoritesLink() {
  const base = location.protocol.startsWith('http') ? location.origin + location.pathname : 'https://maesun.ru/';
  const ids = [...S.favorites.keys()].slice(0, 40).join(',');
  return base + '#fav=' + encodeURIComponent(ids);
}
function renderFavorites() {
  const grid = $('#favGrid'); if (!grid) return;
  const items = favoriteItems(); grid.innerHTML = '';
  if (!items.length) {
    grid.innerHTML = '<div class="fav-empty"><div><div style="font-size:48px;margin-bottom:10px">♡</div><h3>Пока пусто</h3><p style="color:var(--muted);margin-top:8px">Отмечайте сердечком понравившиеся кадры в галерее.</p></div></div>';
  } else {
    items.forEach((f, i) => {
      const card = document.createElement('button'); card.type = 'button'; card.className = 'fav-item';
      card.innerHTML = `<img src="${escapeHtml(f.srcSmall)}" alt="" loading="lazy"><span>${escapeHtml(CATS[f.cat] || 'Кадр')}</span><b class="fav-remove" aria-label="Убрать из избранного">✕</b>`;
      card.addEventListener('click', () => openLb(S.items.findIndex(x => x.id === f.id), S.items.filter(x => S.filter === 'all' || x.cat === S.filter)));
      card.querySelector('.fav-remove').addEventListener('click', (e) => { e.stopPropagation(); toggleFavorite(f.id); });
      grid.append(card);
    });
  }
}

/* Google Drive */
const FOLDERS = {
  katyushi: '1RAhjazW8RAhgIBCfDnspZFNWou5NF3IX',
  restaurant: '1UoH1K-ZVfDbShyuUymApT9C42jY2gsmk',
  portfolio: '1TcSm3kFP45uS_zAOpHIlyYEJsO8o5uUA'
};
function asset(file, cat) {
  const id = file.id;
  const resourceKey = file.resourceKey ? `&resourcekey=${encodeURIComponent(file.resourceKey)}` : '';
  const thumb = width => `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${width}${resourceKey}`;
  return {
    id, cat, name: file.name || '', createdTime: file.createdTime || '',
    width: file.width || file.imageMediaMetadata?.width || 0,
    height: file.height || file.imageMediaMetadata?.height || 0,
    srcSmall: file.srcSmall || thumb(480), src: file.src || thumb(760),
    srcLarge: file.srcLarge || thumb(1100), large: file.large || thumb(1800),
    download: file.download || `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}${resourceKey}`
  };
}
async function fetchDrivePage(cat, pageToken = '') {
  const folderId = FOLDERS[cat];
  if (!folderId) throw new Error('Неизвестная папка');
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`,
    fields: 'nextPageToken,files(id,name,mimeType,createdTime,modifiedTime,resourceKey,imageMediaMetadata(width,height))',
    orderBy: 'createdTime desc', pageSize: String(DRIVE_PAGE_SIZE), includeItemsFromAllDrives: 'true', supportsAllDrives: 'true'
  });
  if (pageToken) params.set('pageToken', pageToken);

  const proxyUrl = `/api/drive?folder=${encodeURIComponent(cat)}&pageSize=${DRIVE_PAGE_SIZE}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
  const directUrl = `https://www.googleapis.com/drive/v3/files?${params.toString()}`;
  const urls = PREFER_PROXY_API ? [proxyUrl, directUrl] : (KEY ? [directUrl, proxyUrl] : [proxyUrl]);
  let lastStatus = 0;
  for (const url of urls) {
    try {
      const response = await fetch(url, KEY && url === directUrl ? { headers: { 'x-goog-api-key': KEY } } : undefined);
      lastStatus = response.status;
      if (!response.ok) continue;
      const data = await response.json();
      return {
        items: (data.files || []).map(file => asset(file, cat)),
        next: data.nextPageToken || null
      };
    } catch {}
  }
  throw new Error(`Drive: ${lastStatus || 'network error'}`);
}
function byDate(a,b){ return (b.createdTime || '').localeCompare(a.createdTime || ''); }
async function loadCategory(cat) {
  if (S.loadingCategory?.has(cat)) return;
  if (!S.loadingCategory) S.loadingCategory = new Set();
  S.loadingCategory.add(cat);
  try {
    const {items, next} = await fetchDrivePage(cat, S.next[cat] || '');
    S.next[cat] = next; S.items.push(...items); S.loaded.add(cat); S.items.sort(byDate);
    return items;
  } finally { S.loadingCategory.delete(cat); }
}
async function ensureForFilter(filter, { initial = false } = {}) {
  const cats = filter === 'all' ? CAT_ORDER : [filter];
  let missing = cats.filter(cat => !S.loaded.has(cat));
  if (!missing.length) return;
  $('#status').textContent = 'Загружаем фотографии…';

  // На первом экране достаточно набрать один viewport галереи.
  // Остальные категории догружаем в фоне, чтобы не блокировать первый рендер.
  if (initial && filter === 'all') {
    while (missing.length && visible().length < INITIAL_GALLERY_LIMIT) {
      const cat = missing.shift();
      try { await loadCategory(cat); }
      catch { toast('Некоторые фотографии временно недоступны'); }
    }
    $('#status').textContent = '';
    if (missing.length) {
      Promise.allSettled(missing.map(loadCategory)).then(() => {
        S.items.sort(byDate);
        syncFavoriteUi();
      });
    }
    return;
  }

  const result = await Promise.allSettled(missing.map(loadCategory));
  if (result.some(x => x.status === 'rejected')) toast('Некоторые фотографии временно недоступны');
  $('#status').textContent = '';
}
async function loadMoreData() {
  const cats = S.filter === 'all' ? CAT_ORDER : [S.filter];
  const available = cats.filter(c => S.next[c]);
  if (!available.length) return false;
  const result = await Promise.allSettled(available.map(loadCategory));
  return result.some(x => x.status === 'fulfilled');
}
function visible() { return S.items.filter(x => S.filter === 'all' || x.cat === S.filter); }

/* Gallery */
const INITIAL_GALLERY_LIMIT = 18;
const GALLERY_BREAKPOINTS = { desktop: 981, tablet: 761 };
function galleryColumns() {
  if (innerWidth <= GALLERY_BREAKPOINTS.tablet) return 2;
  if (innerWidth <= GALLERY_BREAKPOINTS.desktop) return 3;
  return 4;
}
function galleryGap() { return innerWidth <= GALLERY_BREAKPOINTS.tablet ? 7 : 10; }
function galleryRatio(f) {
  const ratio = Number(f.width) > 0 && Number(f.height) > 0 ? Number(f.width) / Number(f.height) : 0;
  return ratio > 0 ? ratio : 4 / 5;
}
function layoutGallery() {
  const gallery = $('#gallery'); if (!gallery) return;
  const items = $$('.ph', gallery);
  if (!items.length) { gallery.style.height = '0px'; return; }
  const columns = galleryColumns();
  const gap = galleryGap();
  const width = gallery.clientWidth;
  if (!width) return;
  const colWidth = (width - gap * (columns - 1)) / columns;
  const heights = Array(columns).fill(0);

  // Плотная masonry-раскладка: каждый кадр получает реальную высоту
  // из своих пропорций и всегда отправляется в самую низкую колонку.
  // Никаких искусственных span/рядов, которые создают белые «дыры».
  items.forEach((item, index) => {
    const ratio = Number(item.dataset.ratio) > 0 ? Number(item.dataset.ratio) : 4 / 5;
    const itemWidth = colWidth;
    const itemHeight = itemWidth / ratio;
    let startCol = 0;
    for (let c = 1; c < columns; c++) {
      if (heights[c] < heights[startCol]) startCol = c;
    }
    const top = heights[startCol];
    heights[startCol] = top + itemHeight + gap;
    item.style.width = `${itemWidth}px`;
    item.style.height = `${itemHeight}px`;
    item.style.left = `${startCol * (colWidth + gap)}px`;
    item.style.top = `${top}px`;
    item.dataset.galleryIndex = String(index);
    item.dataset.galleryBottom = String(top + itemHeight);
  });
  const totalHeight = Math.max(0, Math.max(...heights) - gap);
  gallery.style.height = `${totalHeight}px`;
}
function galleryHeightForCount(count) {
  const items = $$('#gallery .ph').slice(0, Math.max(0, count));
  if (!items.length) return 0;
  return Math.max(...items.map(item => Number(item.dataset.galleryBottom) || 0));
}
function setGalleryA11y() {
  const hidden = !S.expanded;
  $$('#gallery .ph').forEach((item, index) => {
    const isHidden = hidden && index >= INITIAL_GALLERY_LIMIT;
    item.inert = isHidden;
    item.setAttribute('aria-hidden', String(isHidden));
  });
}
function updateGalleryViewport({ animate = true } = {}) {
  const viewport = $('#galleryViewport'); const gallery = $('#gallery'); if (!viewport || !gallery) return;
  const target = S.expanded ? gallery.offsetHeight : galleryHeightForCount(INITIAL_GALLERY_LIMIT);
  const reduced = isReduce();
  if (!animate || reduced) viewport.style.height = `${target}px`;
  else {
    const current = viewport.getBoundingClientRect().height;
    viewport.style.height = `${current}px`;
    requestAnimationFrame(() => { viewport.style.height = `${target}px`; });
  }
  setGalleryA11y();
}
function updateMoreButton(list) {
  const more = $('#more'); if (!more) return;
  const hasMoreLoaded = S.drawn < list.length;
  const hasMoreRemote = (S.filter === 'all' ? CAT_ORDER : [S.filter]).some(cat => S.next[cat]);
  const canCollapse = S.expanded && S.drawn > INITIAL_GALLERY_LIMIT;
  const canExpand = !S.expanded && S.drawn > INITIAL_GALLERY_LIMIT;
  more.hidden = !(hasMoreLoaded || hasMoreRemote || canCollapse || canExpand);
  more.disabled = false;
  if (canCollapse && !hasMoreLoaded && !hasMoreRemote) more.innerHTML = 'Свернуть <span>↑</span>';
  else more.innerHTML = 'Показать ещё <span>↓</span>';
  const visibleCount = S.expanded ? S.drawn : Math.min(INITIAL_GALLERY_LIMIT, S.drawn);
  $('#count').textContent = list.length ? `${visibleCount} / ${list.length}${hasMoreRemote ? '+' : ''}` : '—';
}
function projectCopy(f) {
  const year = f.createdTime ? new Date(f.createdTime).getFullYear() : '—';
  const info = {
    portfolio: { role: 'Фотография', format: 'Портрет / личная история', approach: 'Естественный свет · эмоция · спокойный режиссёрский подход' },
    katyushi: { role: 'Фотография', format: 'Репортаж / портрет', approach: 'Движение · живые реакции · атмосфера' },
    restaurant: { role: 'Фотография', format: 'Контент / ресторан', approach: 'Детали · подача · визуальный ритм' }
  }[f.cat] || { role: 'Фотография', format: 'Авторский кадр', approach: 'Свет · композиция · цвет' };
  return { year, ...info, description: `Кадр из раздела «${CATS[f.cat] || 'Фото'}». Сцена построена вокруг света, человека и деталей, которые создают настроение снимка.` };
}
function card(f, index, list) {
  const b = document.createElement('article'); b.className = 'ph'; b.tabIndex = 0; b.dataset.id = f.id; b.dataset.ratio = String(galleryRatio(f));
  b.setAttribute('aria-label', `Открыть фото ${index + 1}`);
  const img = new Image(); img.alt = `${CATS[f.cat] || 'Фотография'} — ${f.name || 'кадр'}`; img.loading = index < 6 ? 'eager' : 'lazy'; img.decoding = 'async';
  img.srcset = `${f.srcSmall} 480w, ${f.src} 760w, ${f.srcLarge} 1100w`;
  img.sizes = '(max-width:760px) 98vw, (max-width:980px) 66vw, 50vw';
  img.src = f.srcSmall;
  img.addEventListener('load', () => img.classList.add('on'), { once: true }); if (img.complete) img.classList.add('on');
  b.append(img);
  const cap = document.createElement('div'); cap.className = 'ph-caption';
  const year = f.createdTime ? new Date(f.createdTime).getFullYear() : '';
  cap.innerHTML = `<span>${escapeHtml(CATS[f.cat] || 'Фото')}</span><span>${year || ''}</span>`;
  const info = document.createElement('button'); info.type='button'; info.className='project-info'; info.textContent='Подробнее'; info.setAttribute('aria-label', `Подробнее о кадре ${index + 1}`);
  info.addEventListener('click', e => { e.stopPropagation(); openProjectDrawer(f, index, list); }); cap.append(info); b.append(cap);
  const fav = document.createElement('button'); fav.type = 'button'; fav.className = 'fav-toggle'; fav.textContent = S.favorites.has(f.id) ? '♥' : '♡'; fav.setAttribute('aria-pressed', String(S.favorites.has(f.id))); fav.setAttribute('aria-label', S.favorites.has(f.id) ? 'Убрать из избранного' : 'Добавить в избранное');
  fav.addEventListener('click', e => { e.stopPropagation(); toggleFavorite(f.id); }); b.append(fav);
  const open = () => openLb(index, list);
  b.addEventListener('click', open); b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  return b;
}
function renderGallery({ animate = false, enteringFrom = 0 } = {}) {
  const gallery = $('#gallery'); const viewport = $('#galleryViewport'); if (!gallery || !viewport) return;
  const list = visible();
  const shown = list.slice(0, S.limit);
  const previousHeight = viewport.getBoundingClientRect().height;
  gallery.innerHTML = '';
  shown.forEach((f, i) => gallery.append(card(f, i, shown)));
  S.drawn = shown.length;
  const raf = requestAnimationFrame(() => {
    layoutGallery();
    const entering = animate && enteringFrom < shown.length ? $$('.ph', gallery).slice(enteringFrom) : [];
    entering.forEach(el => el.classList.add('is-entering'));
    setGalleryA11y();
    const target = S.expanded ? gallery.offsetHeight : galleryHeightForCount(INITIAL_GALLERY_LIMIT);
    if (!animate || isReduce()) viewport.style.height = `${target}px`;
    else {
      viewport.style.height = `${previousHeight}px`;
      requestAnimationFrame(() => { entering.forEach(el => el.classList.remove('is-entering')); viewport.style.height = `${target}px`; });
    }
    updateMoreButton(list);
  });
  return raf;
}
function animateCollapse() {
  const viewport = $('#galleryViewport'); const work = $('#work'); const btn = $('#more');
  if (!viewport || !work) return;
  const target = galleryHeightForCount(INITIAL_GALLERY_LIMIT);
  const reduce = isReduce();
  S.expanded = false;
  setGalleryA11y();
  if (btn) { btn.classList.add('is-collapsing'); btn.disabled = true; }

  // Фиксируем исходную точку раздела до изменения высоты галереи.
  // Прокрутка запускается одновременно со схлопыванием, поэтому нет
  // задержки и последующего рывка вниз/вверх.
  const targetScroll = Math.max(0, work.getBoundingClientRect().top + window.scrollY - 8);
  const currentHeight = viewport.getBoundingClientRect().height;
  viewport.style.height = `${currentHeight}px`;
  if (!reduce) {
    requestAnimationFrame(() => {
      window.scrollTo({ top: targetScroll, behavior: 'smooth' });
      viewport.style.height = `${target}px`;
    });
  } else {
    window.scrollTo({ top: targetScroll, behavior: 'auto' });
    viewport.style.height = `${target}px`;
  }

  const finish = () => {
    updateMoreButton(visible());
    if (btn) { btn.classList.remove('is-collapsing'); btn.disabled = false; }
  };
  if (reduce) finish();
  else setTimeout(finish, 600);
}
function renderInitialGallery() {
  S.expanded = false;
  S.limit = INITIAL_GALLERY_LIMIT;
  renderGallery({ animate: false });
  syncFavoriteUi();
}
async function applyFilter(filter) {
  S.filter = filter; S.limit = INITIAL_GALLERY_LIMIT; S.drawn = 0; S.expanded = false;
  $$('#chips button').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.k === filter)));
  try { await ensureForFilter(filter); } catch (err) { console.error(err); toast('Не удалось загрузить галерею'); }
  renderGallery({ animate: false });
  const hash = filter === 'all' ? '#work' : '#work/' + filter;
  history.replaceState(null, '', hash);
}
function setupGalleryControls() {
  const box = $('#chips');
  [['all','Все'], ...CAT_ORDER.map(k => [k,CATS[k]])].forEach(([key,name]) => {
    const btn = document.createElement('button'); btn.type = 'button'; btn.dataset.k = key; btn.setAttribute('aria-pressed', String(key === 'all')); btn.textContent = name;
    btn.addEventListener('click', () => applyFilter(key)); box.append(btn);
  });
  $('#more').addEventListener('click', async () => {
    const btn = $('#more'); if (btn.disabled) return;
    const list = visible();
    const hasMoreLoaded = S.drawn < list.length;
    const hasMoreRemote = (S.filter === 'all' ? CAT_ORDER : [S.filter]).some(cat => S.next[cat]);
    if (!S.expanded && S.drawn > INITIAL_GALLERY_LIMIT) {
      btn.disabled = true;
      S.expanded = true;
      updateGalleryViewport({ animate: true });
      setGalleryA11y();
      updateMoreButton(list);
      setTimeout(() => { btn.disabled = false; }, isReduce() ? 0 : 600);
      return;
    }
    if (S.expanded && !hasMoreLoaded && !hasMoreRemote && S.drawn > INITIAL_GALLERY_LIMIT) {
      btn.disabled = true;
      animateCollapse();
      setTimeout(() => { btn.disabled = false; }, isReduce() ? 0 : 600);
      return;
    }
    btn.disabled = true;
    if (hasMoreLoaded) {
      const oldDrawn = S.drawn;
      S.limit = Math.min(S.limit + S.step, list.length);
      S.expanded = true;
      renderGallery({ animate: true, enteringFrom: oldDrawn });
    } else {
      btn.textContent = 'Загружаем…';
      try {
        await loadMoreData();
        const nextList = visible();
        const oldDrawn = S.drawn;
        S.limit = Math.min(S.limit + S.step, nextList.length);
        S.expanded = true;
        renderGallery({ animate: true, enteringFrom: oldDrawn });
      } catch { toast('Не удалось загрузить следующую страницу'); }
    }
    btn.disabled = false;
  });
  $('#galleryTop')?.addEventListener('click', () => smoothTo('#work'));
  addEventListener('resize', () => { layoutGallery(); updateGalleryViewport({ animate: false }); });
}

/* Project drawer */
const projectDrawer = $('#projectDrawer');
let projectCurrent = null;
let projectReturnFocus = null;
let releaseProjectTrap = null;
function openProjectDrawer(f, index, list) {
  if (!projectDrawer) return;
  projectCurrent = { f, index, list }; projectReturnFocus = document.activeElement;
  const meta = projectCopy(f);
  $('#projectDrawerImg').src = f.srcLarge || f.src; $('#projectDrawerImg').alt = `${CATS[f.cat] || 'Фотография'} — ${f.name || 'кадр'}`;
  $('#projectDrawerCategory').textContent = CATS[f.cat] || 'PHOTO'; $('#projectDrawerYear').textContent = meta.year;
  $('#projectDrawerTitle').textContent = f.name || `${meta.format}`; $('#projectDrawerDescription').textContent = meta.description;
  $('#projectDrawerSpecs').innerHTML = `<div><span>РОЛЬ</span><b>${escapeHtml(meta.role)}</b></div><div><span>ФОРМАТ</span><b>${escapeHtml(meta.format)}</b></div><div><span>ПОДХОД</span><b>${escapeHtml(meta.approach)}</b></div>`;
  const fav=$('#projectFav'), yes=S.favorites.has(f.id); fav.textContent = yes ? '♥ В избранном' : '♡ В избранное'; fav.setAttribute('aria-pressed', String(yes));
  projectDrawer.hidden=false; document.body.style.overflow='hidden'; releaseProjectTrap?.(); releaseProjectTrap=trapDialog(projectDrawer, closeProjectDrawer); $('#projectClose').focus();
}
function closeProjectDrawer() {
  if (!projectDrawer || projectDrawer.hidden) return; projectDrawer.hidden=true; document.body.style.overflow=''; releaseProjectTrap?.(); releaseProjectTrap=null; projectReturnFocus?.focus?.(); projectReturnFocus=null;
}
$('#projectClose')?.addEventListener('click', closeProjectDrawer);
$$('[data-project-close]').forEach(el=>el.addEventListener('click', closeProjectDrawer));
$('#projectOpenFrame')?.addEventListener('click', () => { if(projectCurrent){ const {index,list}=projectCurrent; closeProjectDrawer(); openLb(index,list); } });
$('#projectFav')?.addEventListener('click', () => { if(projectCurrent?.f){ toggleFavorite(projectCurrent.f.id); openProjectDrawer(projectCurrent.f,projectCurrent.index,projectCurrent.list); } });

/* Lightbox */
const lb = $('#lb');
let lbReturnFocus = null; let releaseLbTrap = null;
function openLb(index, list = visible().slice(0,S.limit)) {
  if (!list.length || index < 0) return;
  lbReturnFocus = document.activeElement;
  S.lbItems = list; S.cur = index; lb.hidden = false; document.body.style.overflow = 'hidden';
  releaseLbTrap?.(); releaseLbTrap = trapDialog(lb, closeLb);
  $('#strip').innerHTML = '';
  list.forEach((f, i) => { const t = new Image(); t.src = f.srcSmall; t.alt = ''; t.loading = 'lazy'; t.addEventListener('click', () => showLb(i)); $('#strip').append(t); });
  showLb(index); $('#lbClose').focus();
}
function showLb(index) {
  const list = S.lbItems; if (!list.length) return;
  S.cur = (index + list.length) % list.length;
  const f = list[S.cur];
  $('#lbImg').src = f.large; $('#lbImg').alt = CATS[f.cat] || 'Фотография';
  $('#lbCount').textContent = `${String(S.cur + 1).padStart(2,'0')} / ${String(list.length).padStart(2,'0')}`;
  $('#lbCategory').textContent = CATS[f.cat] || 'PHOTO'; $('#lbName').textContent = f.name || '';
  $('#lbDl').href = f.download; updateLbFavorite(f);
  [1,-1].forEach(d => { const next = list[(S.cur + d + list.length) % list.length]; if (next) new Image().src = next.large; });
  $$('#strip img').forEach((t, i) => t.classList.toggle('cur', i === S.cur));
  $('#strip img')?.parentElement?.querySelector('.cur')?.scrollIntoView({inline:'center', block:'nearest'});
  history.replaceState(null, '', '#photo=' + encodeURIComponent(f.id));
}
function updateLbFavorite(f) { const yes = S.favorites.has(f.id); const b = $('#lbFav'); b.textContent = yes ? '♥' : '♡'; b.setAttribute('aria-pressed', String(yes)); }
function closeLb() { if(lb.hidden) return; lb.hidden = true; document.body.style.overflow = ''; releaseLbTrap?.(); releaseLbTrap=null; history.replaceState(null, '', S.filter === 'all' ? '#work' : '#work/' + S.filter); lbReturnFocus?.focus?.(); lbReturnFocus=null; }
$('#lbClose').addEventListener('click', closeLb); $('#lbPrev').addEventListener('click', () => showLb(S.cur - 1)); $('#lbNext').addEventListener('click', () => showLb(S.cur + 1));
$('#lbFav').addEventListener('click', () => { const f=S.lbItems[S.cur]; if(f) toggleFavorite(f.id); });
$('#lbShare').addEventListener('click', async () => { try { await navigator.clipboard.writeText(location.href); toast('Ссылка на кадр скопирована'); } catch { toast('Скопируйте ссылку из адресной строки'); } });
lb.addEventListener('click', e => { if (e.target === lb) closeLb(); });
window.addEventListener('keydown', e => { if (!lb.hidden) { if (e.key === 'Escape') closeLb(); if (e.key === 'ArrowLeft') showLb(S.cur - 1); if (e.key === 'ArrowRight') showLb(S.cur + 1); } if (e.key === 'Escape' && !$('#favPanel').hidden) closeFavorites(); });
let touchX = 0; lb.addEventListener('touchstart', e => touchX=e.touches[0].clientX, {passive:true}); lb.addEventListener('touchend', e => { const dx=e.changedTouches[0].clientX-touchX; if(Math.abs(dx)>50) showLb(S.cur+(dx<0?1:-1)); }, {passive:true});

/* Favorites dialog */
let favReturnFocus = null; let releaseFavTrap = null;
function openFavorites(){ favReturnFocus=document.activeElement; $('#favPanel').hidden=false; S.favOpen=true; document.body.style.overflow='hidden'; renderFavorites(); releaseFavTrap?.(); releaseFavTrap=trapDialog($('#favPanel'), closeFavorites); $('#favClose').focus(); }
function closeFavorites(){ if($('#favPanel').hidden) return; $('#favPanel').hidden=true; S.favOpen=false; document.body.style.overflow=''; releaseFavTrap?.(); releaseFavTrap=null; favReturnFocus?.focus?.(); favReturnFocus=null; }
$('#favoritesOpen').addEventListener('click', openFavorites); $('#favClose').addEventListener('click', closeFavorites);
$('#favPanel').addEventListener('click', e => { if(e.target === $('#favPanel')) closeFavorites(); });
$('#favShare').addEventListener('click', async () => { if(!S.favorites.size) return toast('Сначала добавьте кадры в избранное'); try { await navigator.clipboard.writeText(favoritesLink()); toast('Ссылка на подборку скопирована'); } catch { toast('Скопируйте ссылку из адресной строки'); } });
$('#favClear').addEventListener('click', () => { S.favorites.clear(); saveFavorites(); renderFavorites(); toast('Избранное очищено'); });
$('#favBook').addEventListener('click', () => closeFavorites());

/* Availability */
function renderAvailability(){
  const box=$('#availability'); if(!box) return;
  const dates=Array.isArray(window.CONFIG?.AVAILABLE_DATES)?[...window.CONFIG.AVAILABLE_DATES].sort():[];
  if(!dates.length){ box.innerHTML='<div class="availability-empty"><span>OPEN DATES</span><strong>По запросу</strong><p>Не увидели нужный день? Напишите дату в заявке — проверю доступность.</p><a class="btn btn-fill" href="#book">Запросить дату <span>↗</span></a></div>'; return; }
  box.innerHTML='<div class="availability-title">Свободные даты</div>';
  const grid=document.createElement('div'); grid.className='date-chips';
  dates.forEach(raw=>{ const d=new Date(raw+'T12:00:00'); if(Number.isNaN(d.getTime())) return; const b=document.createElement('button'); b.type='button'; b.className='date-chip'; b.innerHTML=`<strong>${String(d.getDate()).padStart(2,'0')}</strong><span>${d.toLocaleDateString('ru-RU',{month:'long'})}</span><small>${d.toLocaleDateString('ru-RU',{weekday:'short'})}</small>`; b.addEventListener('click',()=>{ $('#form input[name="date"]').value=raw; smoothTo('#book'); $('#form input[name="date"]').focus(); updatePreview(); }); grid.append(b); }); box.append(grid);
}

/* Booking form */
const form=$('#form');
function loadDraft(){ try { const raw=JSON.parse(localStorage.getItem(DRAFT_KEY)||'null'); if(!raw) return; ['type','date','name','contact','msg'].forEach(k=>{ if(raw[k]!=null && form.elements[k]) form.elements[k].value=raw[k]; }); } catch {} }
function saveDraft(){ try { const d=new FormData(form); localStorage.setItem(DRAFT_KEY, JSON.stringify(Object.fromEntries(['type','date','name','contact','msg'].map(k=>[k,d.get(k)])))); } catch {} }
function favoriteLines(){ const n = favoriteItems().length; if(!n || !$('#withFav')?.checked) return ''; return `Понравились кадры (${n}):\n${favoritesLink()}`; }
function message(){ const d=new FormData(form); const date=d.get('date'); return ['Здравствуйте, Максим!','Хочу заказать съёмку: '+d.get('type')+'.',date?'Желаемая дата: '+new Date(date+'T12:00:00').toLocaleDateString('ru-RU')+'.':'',d.get('msg')?'Задача: '+d.get('msg'):'',favoriteLines(),'Меня зовут '+d.get('name')+', связь: '+d.get('contact')+'.'].filter(Boolean).join('\n'); }
function valid(){ const err=$('#formErr'), name=String(form.elements.name.value||'').trim(), contact=String(form.elements.contact.value||'').trim(); const msg=!name?'Напишите ваше имя.':!contact?'Оставьте Telegram, телефон или почту.':''; err.textContent=msg; err.hidden=!msg; return !msg; }
function updatePreview(){ const name=String(form.elements.name.value||'').trim(); const type=form.elements.type.value; const date=form.elements.date.value; const msg=String(form.elements.msg.value||'').trim(); let preview=`Здравствуйте, Максим! Хочу заказать ${type.toLowerCase()}.`; if(name) preview+=` Я — ${name}.`; if(date) preview+=` Дата — ${new Date(date+'T12:00:00').toLocaleDateString('ru-RU')}.`; if(msg) preview+=` ${msg}`; $('#briefPreview').textContent=preview; saveDraft(); }
['input','change'].forEach(evt=>form.addEventListener(evt,updatePreview));
$$('#quickChoices button').forEach(btn=>btn.addEventListener('click',()=>{ const box=form.elements.msg; const value=btn.dataset.q; box.value=box.value?box.value+' '+value+'.':value+'.'; box.focus(); updatePreview(); }));
$$('[data-booking]').forEach(a=>a.addEventListener('click',()=>{ const type=form.elements.type; if(type) type.value=a.dataset.booking || 'Другое'; updatePreview(); }));
function setFormStatus(message, kind='success') { const el=$('#formStatus'); if(!el) return; el.textContent=message; el.dataset.kind=kind; el.hidden=false; }
form.addEventListener('submit',e=>{ e.preventDefault(); if(!valid()) { setFormStatus('Проверьте обязательные поля и попробуйте ещё раз.','error'); return; } const text=message(); copyText(text).catch(()=>{}); const win=window.open('https://t.me/maesun_live?text='+encodeURIComponent(text),'_blank','noopener'); if(win) setFormStatus('Готово — Telegram открыт с подготовленным сообщением.','success'); else setFormStatus('Браузер заблокировал новое окно. Откройте Telegram по кнопке ещё раз.','error'); toast('Сообщение подготовлено для Telegram'); saveDraft(); });
$('#copy').addEventListener('click',async()=>{ if(!valid()) { setFormStatus('Сначала заполните имя и контакт.','error'); return; } if(await copyText(message())) { setFormStatus('Текст заявки скопирован в буфер обмена.','success'); toast('Текст заявки скопирован'); } else { setFormStatus('Не удалось скопировать автоматически.','error'); toast('Не удалось скопировать автоматически'); } });
$$('.contact-copy').forEach(btn=>btn.addEventListener('click',async()=>{ const ok=await copyText(btn.dataset.copy||''); if(ok){ btn.textContent='COPIED'; btn.classList.add('is-copied'); toast('Контакт скопирован'); setTimeout(()=>{btn.textContent='COPY';btn.classList.remove('is-copied')},1600); } else toast('Не удалось скопировать'); }));

/* Mobile menu */
const mobileMenu=$('#mobileMenu'); let menuReturnFocus=null; let releaseMenuTrap=null;
function setMenu(open){ S.menuOpen=open; if(open){ menuReturnFocus=document.activeElement; mobileMenu.hidden=false; document.body.style.overflow='hidden'; $('#menu').setAttribute('aria-expanded','true'); releaseMenuTrap?.(); releaseMenuTrap=trapDialog(mobileMenu,()=>setMenu(false)); $('#menuClose').focus(); } else { mobileMenu.hidden=true; document.body.style.overflow=''; $('#menu').setAttribute('aria-expanded','false'); releaseMenuTrap?.(); releaseMenuTrap=null; menuReturnFocus?.focus?.(); menuReturnFocus=null; } }
$('#menu').addEventListener('click',()=>setMenu(!S.menuOpen)); $('#menuClose').addEventListener('click',()=>setMenu(false));
$$('#mobileMenu a').forEach(a=>a.addEventListener('click',()=>setMenu(false)));

/* Hero slideshow */
(() => { const imgs=$$('#slides img'); let i=0,timer; const go=()=>{imgs[i].classList.remove('on'); i=(i+1)%imgs.length; imgs[i].classList.add('on'); $('#heroIndex').textContent=`${String(i+1).padStart(2,'0')} / ${String(imgs.length).padStart(2,'0')}`}; const start=()=>{clearInterval(timer); if(!isReduce()) timer=setInterval(go,5000)}; start(); document.addEventListener('visibilitychange',()=>document.hidden?clearInterval(timer):start()); })();

/* Theme + clock */
function setTheme(theme){ document.documentElement.dataset.theme=theme; try{localStorage.setItem('theme',theme)}catch{}; }
$('#theme').addEventListener('click',()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
const tick=()=>{$('#clock').textContent=new Date().toLocaleTimeString('ru-RU',{timeZone:'Asia/Yakutsk',hour:'2-digit',minute:'2-digit'});}; tick(); setInterval(tick,15000);

/* top button + mobile CTA */
const topBtn=$('#toTop'), mobileBook=$('#mobileBook');
const scrollProgress=$('#scrollProgress span');
window.addEventListener('scroll',()=>{
  topBtn.classList.toggle('on',scrollY>700);
  const bookTop=$('#book')?.getBoundingClientRect().top ?? Infinity;
  mobileBook.classList.toggle('on',innerWidth<761 && scrollY>520 && bookTop>innerHeight*.78);
  if(scrollProgress){ const max=document.documentElement.scrollHeight-innerHeight; scrollProgress.style.transform=`scaleX(${max>0?scrollY/max:0})`; }
},{passive:true});
topBtn.addEventListener('click',()=>window.scrollTo({top:0,behavior:isReduce()?'auto':'smooth'}));
if(scrollProgress){ const max=document.documentElement.scrollHeight-innerHeight; scrollProgress.style.transform=`scaleX(${max>0?scrollY/max:0})`; }

/* Date minimum + scroll spy */
const dateInput=form.elements.date; dateInput.min=new Date().toISOString().slice(0,10);
const sections=['work','services','process','dates','book'].map(id=>$('#'+id));
const navLinks=$$('.desktop-nav a');
const navObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{ if(entry.isIntersecting){ navLinks.forEach(a=>{ const active=a.getAttribute('href')==='#'+entry.target.id; a.classList.toggle('active',active); if(active) a.setAttribute('aria-current','location'); else a.removeAttribute('aria-current'); }); }}),{rootMargin:'-45% 0px -45% 0px',threshold:0}); sections.forEach(s=>s&&navObserver.observe(s));

/* URL state */
async function hydrateFromHash(){
  const hash=decodeURIComponent(location.hash);
  const fav=hash.match(/^#fav=(.+)$/); if(fav){ fav[1].split(',').slice(0,40).forEach(id=>{ if(id && !S.favorites.has(id)) S.favorites.set(id,{id,cat:''}); }); saveFavorites(); openFavorites(); return; }
  const filter=hash.match(/^#work\/(\w+)$/); if(filter && CATS[filter[1]]) await applyFilter(filter[1]);
}

/* Start */
(async()=>{
  readFavorites(); loadDraft(); updatePreview(); setupGalleryControls(); renderAvailability();
  await hydrateFromHash();
  try { await ensureForFilter(S.filter, { initial: true }); pruneFavoritesToLoadedItems(); syncFavoriteUi(); renderInitialGallery(); syncFavoriteUi(); } catch(err) { console.error(err); $('#status').textContent='Не удалось загрузить галерею. Проверьте подключение и Google Drive.'; toast('Галерея не загрузилась'); }
  const first=$$('#gallery img').slice(0,5); await Promise.race([Promise.all(first.map(img=>img.complete?Promise.resolve():new Promise(r=>{img.addEventListener('load',r,{once:true});img.addEventListener('error',r,{once:true})}))),new Promise(r=>setTimeout(r,1800))]);
  PL.finish();
  const photo=location.hash.match(/^#photo=(.+)$/); if(photo){ const id=photo[1]; let list=visible(); let idx=list.findIndex(f=>f.id===id); if(idx<0){ await ensureForFilter('all'); list=visible(); idx=list.findIndex(f=>f.id===id); } if(idx>=0){ if(idx>=S.limit){S.limit=idx+1; S.expanded=true; renderGallery({animate:false})} openLb(idx,list.slice(0,S.limit)); } }
})();


/* Creative interaction layer */
(() => {
  if (isReduce()) return;
  const magnetic = $$('[data-magnetic], .btn, .text-link, .saved-pill, .round-btn');
  magnetic.forEach(el => {
    if (el.closest('.lightbox') || el.id==='theme') return;
    el.dataset.magneticReady='1';
    let tx=0,ty=0,rx=0,ry=0,anim=0;
    const tick=()=>{anim=0;rx+=(tx-rx)*.18;ry+=(ty-ry)*.18;el.style.transform=`translate3d(${rx}px,${ry}px,0)`;if(Math.abs(tx-rx)+Math.abs(ty-ry)>.1)anim=requestAnimationFrame(tick)};
    el.addEventListener('pointermove',e=>{const r=el.getBoundingClientRect();tx=(e.clientX-(r.left+r.width/2))*0.12;ty=(e.clientY-(r.top+r.height/2))*0.12;if(!anim)anim=requestAnimationFrame(tick)});
    el.addEventListener('pointerleave',()=>{tx=0;ty=0;if(!anim)anim=requestAnimationFrame(tick)});
  });

  const tilts = $$('[data-tilt]');
  tilts.forEach(el => {
    if (matchMedia('(max-width: 760px)').matches) return;
    let raf=0, rx=0, ry=0, cx=0, cy=0;
    el.addEventListener('pointermove',e=>{
      const r=el.getBoundingClientRect(), px=(e.clientX-r.left)/r.width-.5, py=(e.clientY-r.top)/r.height-.5;
      cx=py*-4.5; cy=px*6;
      if(!raf) raf=requestAnimationFrame(()=>{raf=0; el.style.transform=`perspective(1100px) rotateX(${cx}deg) rotateY(${cy}deg)`});
    });
    el.addEventListener('pointerleave',()=>{el.style.transform='perspective(1100px) rotateX(0deg) rotateY(0deg)';});
  });

  const hero=$('.hero-visual');
  const orbA=$('.fx-orb-a'), orbB=$('.fx-orb-b');
  let sx=scrollY, tickRaf=0;
  const scrollFX=()=>{
    tickRaf=0; const y=scrollY; const delta=y-sx; sx=y;
    if(hero && innerWidth>760){ const rect=hero.getBoundingClientRect(); const p=Math.max(-.5,Math.min(.8,(innerHeight*.65-rect.top)/Math.max(1,innerHeight))); hero.style.setProperty('--scroll-depth',p.toFixed(3)); }
    if(orbA) orbA.style.marginTop=(y*.035)+'px';
    if(orbB) orbB.style.marginBottom=(y*.02)+'px';
    if(delta && !tickRaf) tickRaf=requestAnimationFrame(scrollFX);
  };
  addEventListener('scroll',()=>{if(!tickRaf)tickRaf=requestAnimationFrame(scrollFX)},{passive:true}); scrollFX();

  const revealObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('is-visible');revealObserver.unobserve(entry.target)}}),{threshold:.12,rootMargin:'0px 0px -8% 0px'});
  const lab=$('.visual-lab');
  if(lab){
    const labObserver=new IntersectionObserver(entries=>entries.forEach(entry=>lab.classList.toggle('is-in-view',entry.isIntersecting)),{rootMargin:'120px 0px'});
    labObserver.observe(lab);
  }
  $$('.service-card,.steps li,.date-chips,.book-copy,.booking-form,.services-intro,.process-sticky,.dates-layout').forEach((el,i)=>{el.style.setProperty('--reveal-delay',Math.min(i,7)*55+'ms');el.classList.add('fx-reveal');revealObserver.observe(el)});

})();
