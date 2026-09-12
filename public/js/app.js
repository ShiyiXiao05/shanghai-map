import { api } from './api.js';
import { loadAmap, createMapView } from './map.js';
import { compressPhoto } from './photos.js';
import { generatePoster } from './poster.js';

// 深色霓虹底下用的亮色分类色板（色值与 css/style.css 的 --cat-* 保持一致）
const CATEGORIES = [
  { id: '景点', emoji: '📍', color: '#2fa877' },
  { id: '美食', emoji: '🍜', color: '#e8862e' },
  { id: '展馆', emoji: '🖼️', color: '#4d82d4' },
  { id: '购物', emoji: '🛍️', color: '#e0568f' },
  { id: '娱乐', emoji: '🎡', color: '#8e63d8' },
  { id: '其他', emoji: '✨', color: '#7e8f9c' },
];

const MAPS_KEY = 'wish-maps';
const CURRENT_MAP_KEY = 'wish-current-map';
const NICKNAME_KEY = 'shanghai-wish-nickname';
const SORT_KEY = 'wish-sort';
const NEW_MAP_OPTION = '__new__';
const PUBLIC_OPTION = '__public__';

/* 配色主题：每个主题一套页面色板 + 高德官方底图风格（mapStyle） */
const THEMES = {
  auto: { name: '🌗 跟随系统' },
  celadon: { name: '☀️ 浅色', mapStyle: 'amap://styles/normal' },
  grey: { name: '🌫️ 雾灰', mapStyle: 'amap://styles/grey' },
  tokyo: { name: '🌃 东京夜', mapStyle: 'amap://styles/dark' },
  midnight: { name: '🌌 墨蓝', mapStyle: 'amap://styles/darkblue' },
  wine: { name: '🍷 微醺', mapStyle: 'amap://styles/wine' },
};
const THEME_KEY = 'wish-theme';
const THEME_COLORS = {
  celadon: '#f5f6f8',
  grey: '#f2f3f5',
  tokyo: '#0a0f1e',
  midnight: '#0b1226',
  wine: '#180a10',
};

function resolveThemeId(saved) {
  if (saved && saved !== 'auto' && THEMES[saved]) return saved;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'tokyo' : 'celadon';
}

function applyTheme(saved, { persist } = {}) {
  const themeId = resolveThemeId(saved);
  document.documentElement.dataset.theme = themeId;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = THEME_COLORS[themeId] ?? '#f5f6f8';
  if (persist) localStorage.setItem(THEME_KEY, saved);
  $('#theme-select').value = saved;
  state.mapView?.setMapStyle(THEMES[themeId].mapStyle);
}

function bindThemeSelect() {
  const select = $('#theme-select');
  for (const [id, theme] of Object.entries(THEMES)) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = theme.name;
    select.appendChild(option);
  }
  const stored = localStorage.getItem(THEME_KEY);
  select.value = THEMES[stored] ? stored : 'auto';
  select.addEventListener('change', () => applyTheme(select.value, { persist: true }));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((localStorage.getItem(THEME_KEY) || 'auto') === 'auto') applyTheme('auto');
  });
}

const state = {
  map: null, // { code, name }
  places: [],
  activeCategories: new Set(CATEGORIES.map((c) => c.id)),
  hideUnvisitedOnly: false,
  mapView: null,
  pickMode: false,
  sort: localStorage.getItem(SORT_KEY) || 'newest',
  loading: false,
};

const $ = (selector) => document.querySelector(selector);

function categoryMeta(id) {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${formatDate(iso)} ${hh}:${mm}`;
}

async function currentNickname() {
  let who = localStorage.getItem(NICKNAME_KEY);
  if (!who) who = await askNickname();
  return who || null;
}

function toast(message, type = 'ok') {
  const icons = { ok: '✓', error: '✕', info: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.textContent = icons[type] ?? icons.info;
  icon.setAttribute('aria-hidden', 'true');
  el.appendChild(icon);
  el.appendChild(document.createTextNode(message));
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

function isPublicView() {
  return Boolean(state.map?.isPublic);
}

// 需要真实地图（有邀请码）的操作入口守卫；公共广场只读
function requireRealMap() {
  if (!state.map) {
    openMapEntry();
    return false;
  }
  if (isPublicView()) {
    toast('公共广场是只读的，先创建或加入一张地图', 'info');
    openMapEntry();
    return false;
  }
  return true;
}

/* ---------- 自定义确认 / 昵称弹窗（替代原生 confirm/prompt） ---------- */

function askConfirm({ title, message, okText = '确定', danger = false } = {}) {
  return new Promise((resolve) => {
    const dialog = $('#confirm-dialog');
    const ok = $('#confirm-ok');
    ok.textContent = okText;
    ok.classList.toggle('btn-danger', danger);
    $('#confirm-title').textContent = title;
    $('#confirm-message').textContent = message ?? '';
    dialog.returnValue = '';
    const onClose = () => {
      dialog.removeEventListener('close', onClose);
      resolve(dialog.returnValue === 'ok');
    };
    dialog.addEventListener('close', onClose);
    dialog.showModal();
  });
}

function askNickname() {
  return new Promise((resolve) => {
    const dialog = $('#nickname-dialog');
    const input = $('#nickname-input');
    input.value = localStorage.getItem(NICKNAME_KEY) ?? '';
    dialog.returnValue = '';
    const onClose = () => {
      dialog.removeEventListener('close', onClose);
      const saved = dialog.returnValue === 'ok' ? input.value.trim() : '';
      if (saved) localStorage.setItem(NICKNAME_KEY, saved);
      resolve(saved || null);
    };
    dialog.addEventListener('close', onClose);
    dialog.showModal();
  });
}

/* ---------- 地图会话（邀请码） ---------- */

function joinedMaps() {
  try {
    const parsed = JSON.parse(localStorage.getItem(MAPS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((m) => m && m.code && m.name) : [];
  } catch {
    return [];
  }
}

function saveJoinedMap(map) {
  const maps = joinedMaps().filter((m) => m.code !== map.code);
  maps.unshift(map);
  localStorage.setItem(MAPS_KEY, JSON.stringify(maps));
}

function setCurrentMap(map) {
  state.map = map;
  if (!map.isPublic) {
    saveJoinedMap(map);
    localStorage.setItem(CURRENT_MAP_KEY, map.code);
  }
  const url = new URL(location.href);
  if (map.isPublic) {
    url.searchParams.delete('map'); // 公共广场不写邀请码参数
    url.searchParams.delete('place');
  } else {
    url.searchParams.set('map', map.code); // 保留 place 等其他参数，深链不丢
  }
  history.replaceState(null, '', url);
  renderMapSelect();
}

// 进入公共广场（默认地图）：聚合所有勾选公开的地点，只读
function enterPublicMap() {
  state.map = { code: PUBLIC_OPTION, name: '公共广场', isPublic: true };
  state.mapView?.closeInfo();
  closeDetail();
  closeMapEntry();
  syncUrlPlace(null);
  renderMapSelect();
  loadPlaces();
}

function renderMapSelect() {
  const select = $('#map-select');
  select.replaceChildren();

  // 公共广场固定在首位
  const publicOption = document.createElement('option');
  publicOption.value = PUBLIC_OPTION;
  publicOption.textContent = '🌍 公共广场';
  if (isPublicView()) publicOption.selected = true;
  select.appendChild(publicOption);

  if (!state.map) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '🗺 选择地图…';
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);
  } else if (!isPublicView()) {
    const current = document.createElement('option');
    current.value = state.map.code;
    current.textContent = state.map.name;
    current.selected = true;
    select.appendChild(current);
  }
  for (const map of joinedMaps()) {
    if (state.map && map.code === state.map.code) continue;
    const option = document.createElement('option');
    option.value = map.code;
    option.textContent = map.name;
    select.appendChild(option);
  }
  const newOption = document.createElement('option');
  newOption.value = NEW_MAP_OPTION;
  newOption.textContent = '＋ 新建 / 加入地图…';
  newOption.className = 'map-new-option';
  select.appendChild(newOption);
}

function openMapEntry() {
  $('#map-entry-dialog').showModal();
}

function closeMapEntry() {
  $('#map-entry-dialog').close();
}

async function joinMap(code) {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(normalized)) {
    toast('邀请码格式不对，是 6 位字母数字', 'error');
    return false;
  }
  let map;
  try {
    map = await api.getMap(normalized);
  } catch (err) {
    toast(err.status === 404 ? '邀请码不存在，检查一下' : `加入失败：${err.message}`, 'error');
    return false;
  }
  setCurrentMap(map);
  closeMapEntry();
  await loadPlaces();
  return true;
}

async function createMap(name, nickname) {
  let map;
  try {
    map = await api.createMap({ name, createdBy: nickname });
  } catch (err) {
    toast(`创建失败：${err.message}`, 'error');
    return;
  }
  setCurrentMap(map);
  closeMapEntry();
  $('#map-created-title').textContent = '地图创建好了 🎉';
  $('#invite-code').textContent = map.code;
  $('#map-created-dialog').showModal();
  await loadPlaces();
}

function bindMapEntry() {
  $('#btn-map-entry-close').addEventListener('click', closeMapEntry);

  $('#form-create-map').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = form.elements.name.value.trim();
    const nickname = form.elements.nickname.value.trim();
    if (!name) return;
    if (nickname) localStorage.setItem(NICKNAME_KEY, nickname);
    form.reset();
    await createMap(name, nickname);
  });

  $('#form-join-map').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const code = form.elements.code.value.trim();
    if (!code) return;
    form.reset();
    await joinMap(code);
  });

  $('#map-select').addEventListener('change', async (event) => {
    const value = event.target.value;
    if (value === NEW_MAP_OPTION) {
      renderMapSelect();
      openMapEntry();
      return;
    }
    if (value === PUBLIC_OPTION) {
      if (!isPublicView()) enterPublicMap();
      return;
    }
    if (value && (!state.map || value !== state.map.code)) {
      const map = joinedMaps().find((m) => m.code === value);
      if (map) {
        setCurrentMap(map);
        state.mapView?.closeInfo();
        closeDetail();
        syncUrlPlace(null); // 换地图后旧地点深链失效
        await loadPlaces();
      }
    }
  });

  $('#btn-copy-link').addEventListener('click', async () => {
    const link = `${location.origin}/?map=${state.map?.code ?? ''}`;
    try {
      await navigator.clipboard.writeText(`「${state.map?.name}」邀请码：${state.map?.code}\n${link}`);
      toast('邀请码和链接已复制，发给同学吧');
    } catch {
      toast(link, 'error');
    }
  });
  $('#btn-created-done').addEventListener('click', () => $('#map-created-dialog').close());
}

async function restoreMapSession() {
  const fromUrl = new URLSearchParams(location.search).get('map');
  if (fromUrl) {
    if (await joinMap(fromUrl)) return;
  }
  const savedCode = localStorage.getItem(CURRENT_MAP_KEY);
  const saved = joinedMaps().find((m) => m.code === savedCode) ?? joinedMaps()[0];
  if (saved) {
    setCurrentMap(saved);
    await loadPlaces();
    return;
  }
  // 无会话（新访客/清过存储）：默认进公共广场
  enterPublicMap();
}

/* ---------- 数据加载与渲染 ---------- */

async function loadPlaces() {
  if (!state.map) {
    renderAll();
    return;
  }
  state.loading = true;
  renderList(); // 先出骨架屏
  try {
    state.places = isPublicView()
      ? await api.publicPlaces()
      : await api.listPlaces(state.map.code);
  } catch (err) {
    state.loading = false;
    if (err.status === 404) {
      toast('这张地图不存在了，换一个邀请码吧', 'error');
      openMapEntry();
      return;
    }
    toast(`地点列表加载失败：${err.message}`, 'error');
    return;
  }
  state.loading = false;
  renderAll();
  tryOpenDetailFromUrl();
}

// ?map=码&place=id 深链：加载完直达地点详情
function tryOpenDetailFromUrl() {
  const id = Number(new URLSearchParams(location.search).get('place'));
  if (!id) return;
  const place = state.places.find((p) => p.id === id);
  if (place) openDetail(place);
}

function syncUrlPlace(placeId) {
  const url = new URL(location.href);
  if (placeId == null) url.searchParams.delete('place');
  else url.searchParams.set('place', String(placeId));
  history.replaceState(null, '', url);
}

function renderAll() {
  renderMarkers();
  renderList();
}

function filteredPlaces() {
  const filtered = state.places.filter(
    (place) =>
      state.activeCategories.has(place.category) &&
      !(state.hideUnvisitedOnly && place.visited)
  );
  const sorted = [...filtered];
  if (state.sort === 'name') {
    sorted.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  } else if (state.sort === 'wishes') {
    sorted.sort((a, b) => (b.wishes?.length ?? 0) - (a.wishes?.length ?? 0));
  } else {
    sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  return sorted;
}

function renderMarkers() {
  state.mapView?.setPlaces(filteredPlaces(), categoryMeta, {
    onMarkerClick: (place) => {
      state.mapView.focus(place);
      openInfoFor(place);
    },
  });
}

function openInfoFor(place) {
  state.mapView.openInfo(place, categoryMeta, {
    onEdit: (p) => openPlaceDialog({ editing: p }),
    onDetail: (p) => openDetail(p),
  });
}

function renderSkeletons(list) {
  list.replaceChildren();
  for (let i = 0; i < 4; i += 1) {
    const li = document.createElement('li');
    li.className = 'skeleton-item';
    const avatar = document.createElement('span');
    avatar.className = 'sk sk-avatar';
    const lines = document.createElement('div');
    lines.className = 'sk-lines';
    const line1 = document.createElement('span');
    line1.className = 'sk sk-line w60';
    const line2 = document.createElement('span');
    line2.className = 'sk sk-line w85';
    lines.append(line1, line2);
    li.append(avatar, lines);
    list.appendChild(li);
  }
}

function renderList() {
  const list = $('#place-list');
  const empty = $('#empty-state');
  const newMapBtn = $('#btn-empty-new');
  const countEl = $('#list-count');

  if (state.loading) {
    empty.hidden = true;
    newMapBtn.hidden = true;
    countEl.textContent = '加载中…';
    renderSkeletons(list);
    return;
  }

  list.replaceChildren();

  const places = filteredPlaces();

  if (!state.map) {
    empty.hidden = false;
    countEl.textContent = '';
    empty.querySelector('.empty-title').textContent = '还没有加入地图';
    $('#empty-hint').textContent = '创建一张新地图，或用同学的邀请码加入';
    newMapBtn.hidden = false;
    return;
  }
  newMapBtn.hidden = true;
  countEl.textContent =
    places.length === state.places.length
      ? `${state.places.length} 个地点`
      : `${places.length} / ${state.places.length} 个地点`;

  if (places.length === 0) {
    empty.hidden = false;
    empty.querySelector('.empty-title').textContent =
      state.places.length === 0 ? '这张地图还没有地点' : '这个筛选下没有地点';
    $('#empty-hint').innerHTML = '用上方搜索，或在地图上点选一个位置，<br />把大家想去的地方都记下来。';
    return;
  }
  empty.hidden = true;

  for (const place of places) {
    const meta = categoryMeta(place.category);
    const item = document.createElement('li');
    item.className = `place-item${place.visited ? ' is-visited' : ''}`;
    item.tabIndex = 0;

    const emoji = document.createElement('span');
    emoji.className = 'place-emoji';
    emoji.style.setProperty('--emoji-color', meta.color);
    emoji.textContent = meta.emoji;

    const head = document.createElement('div');
    head.className = 'place-head';
    const name = document.createElement('span');
    name.className = 'place-name';
    name.textContent = place.name;
    head.appendChild(name);
    if (place.visited) {
      const stamp = document.createElement('span');
      stamp.className = 'stamp';
      stamp.title = '已去过';
      head.appendChild(stamp);
    }
    const wishBtn = document.createElement('button');
    wishBtn.type = 'button';
    wishBtn.className = 'wish-chip';
    const myName = localStorage.getItem(NICKNAME_KEY) ?? '';
    const wished = myName && place.wishes?.includes(myName);
    wishBtn.classList.toggle('is-wished', Boolean(wished));
    wishBtn.textContent = `${wished ? '♥' : '♡'} ${place.wishes?.length ?? 0}`;
    wishBtn.title = place.wishes?.length
      ? `${place.wishes.join('、')} 想去这里`
      : '还没有人投票，点一下表达想去';
    wishBtn.setAttribute('aria-label', '我也想去');
    wishBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleWish(place);
    });
    if (!isPublicView()) head.appendChild(wishBtn); // 公共广场只读

    const actions = document.createElement('div');
    actions.className = 'place-actions';
    const btnToggle = document.createElement('button');
    btnToggle.type = 'button';
    btnToggle.title = place.visited ? '取消打卡' : '标记为已去过';
    btnToggle.setAttribute('aria-label', btnToggle.title);
    btnToggle.textContent = place.visited ? '↩️' : '✅';
    btnToggle.addEventListener('click', () => toggleVisited(place));
    const btnPublic = document.createElement('button');
    btnPublic.type = 'button';
    btnPublic.textContent = '🌍';
    btnPublic.title = place.is_public ? '从公共广场撤下' : '公开到公共广场（所有人可见）';
    btnPublic.setAttribute('aria-label', btnPublic.title);
    btnPublic.classList.toggle('is-public', Boolean(place.is_public));
    btnPublic.addEventListener('click', () => togglePublic(place));
    const btnDetail = document.createElement('button');
    btnDetail.type = 'button';
    btnDetail.title = '照片与留言';
    btnDetail.setAttribute('aria-label', '照片与留言');
    btnDetail.textContent = '💬';
    btnDetail.addEventListener('click', () => openDetail(place));
    const btnEdit = document.createElement('button');
    btnEdit.type = 'button';
    btnEdit.title = '编辑';
    btnEdit.setAttribute('aria-label', '编辑');
    btnEdit.textContent = '✏️';
    btnEdit.addEventListener('click', () => openPlaceDialog({ editing: place }));
    const btnDelete = document.createElement('button');
    btnDelete.type = 'button';
    btnDelete.title = '删除';
    btnDelete.setAttribute('aria-label', '删除');
    btnDelete.textContent = '🗑️';
    btnDelete.addEventListener('click', () => removePlace(place));
    actions.append(btnToggle, btnPublic, btnDetail, btnEdit, btnDelete);
    if (isPublicView()) {
      // 公共广场只读：仅保留查看详情入口
      btnToggle.remove();
      btnPublic.remove();
      btnEdit.remove();
      btnDelete.remove();
    }

    const metaLine = document.createElement('div');
    metaLine.className = 'place-meta';
    const who = [place.added_by, formatDate(place.created_at)].filter(Boolean).join(' · ');
    const counts = [
      place.photo_count > 0 ? `📷 ${place.photo_count}` : '',
      place.comment_count > 0 ? `💬 ${place.comment_count}` : '',
    ].filter(Boolean).join(' ');
    metaLine.textContent = `${place.category}${who ? ` · ${who}` : ''}${place.address ? ` · ${place.address}` : ''}${counts ? `　${counts}` : ''}`;

    item.append(emoji, head, actions, metaLine);
    if (place.description) {
      const desc = document.createElement('div');
      desc.className = 'place-desc';
      desc.textContent = place.description;
      item.appendChild(desc);
    }

    item.addEventListener('click', (event) => {
      if (event.target.closest('.place-actions')) return;
      if (isPublicView()) {
        openDetail(place); // 公共广场只读：点条目直接看详情
        return;
      }
      focusPlace(place);
    });
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        if (isPublicView()) {
          openDetail(place);
          return;
        }
        focusPlace(place);
      }
    });
    item.addEventListener('mouseenter', () => state.mapView?.highlight(place.id));
    item.addEventListener('mouseleave', () => state.mapView?.highlight(null));

    list.appendChild(item);
  }
}

function focusPlace(place) {
  if (!state.mapView) return;
  state.mapView.focus(place);
  openInfoFor(place);
}

/* ---------- 筛选 ---------- */

function renderChips() {
  const wrap = $('#category-chips');
  wrap.replaceChildren();
  for (const category of CATEGORIES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = `${category.emoji} ${category.id}`;
    chip.setAttribute('aria-pressed', String(state.activeCategories.has(category.id)));
    chip.style.setProperty('--chip-color', category.color);
    if (chip.getAttribute('aria-pressed') === 'true') {
      chip.style.background = `color-mix(in srgb, ${category.color} 14%, var(--card))`;
    }
    chip.addEventListener('click', () => {
      if (state.activeCategories.has(category.id)) {
        if (state.activeCategories.size === 1) return;
        state.activeCategories.delete(category.id);
      } else {
        state.activeCategories.add(category.id);
      }
      renderChips();
      renderAll();
    });
    wrap.appendChild(chip);
  }
}

/* ---------- 地图 ---------- */

async function initMap() {
  let config;
  try {
    config = await api.mapConfig();
  } catch {
    showMapFallback();
    return;
  }
  try {
    await loadAmap(config);
    state.mapView = createMapView($('#map'), {
      // 初始底图风格跟随当前主题，避免「先浅后深」闪一下
      mapStyle: THEMES[resolveThemeId(localStorage.getItem(THEME_KEY))].mapStyle,
    });
    $('#map-fallback').hidden = true;
    renderMarkers();
  } catch (err) {
    showMapFallback();
    toast(`地图加载失败：${err.message}`, 'error');
  }
}

function showMapFallback() {
  $('#map-fallback').hidden = false;
}

function setPickMode(on) {
  state.pickMode = on;
  $('#pick-hint').hidden = !on;
  $('#btn-pick').classList.toggle('btn-primary', !on);
  $('#btn-pick').textContent = on ? '选点进行中…' : '＋ 地图选点';
  state.mapView?.setPickMode(on, {
    onPick: (lng, lat) => {
      setPickMode(false);
      handleMapPick(lng, lat);
    },
  });
}

/* ---------- 搜索 ---------- */

let searchTimer = null;
let searchIndex = -1;

function moveSearchSelection(delta) {
  const buttons = [...$('#search-suggest').querySelectorAll('button')];
  if (buttons.length === 0) return;
  searchIndex = (searchIndex + delta + buttons.length) % buttons.length;
  buttons.forEach((btn, i) => btn.classList.toggle('is-active', i === searchIndex));
  buttons[searchIndex].scrollIntoView({ block: 'nearest' });
}

function bindSearch() {
  const input = $('#search-input');
  const suggest = $('#search-suggest');

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchIndex = -1;
    const keyword = input.value.trim();
    // 至少 2 字才搜 + 500ms 防抖：打字过程的中间态不消耗高德搜索配额
    if (keyword.length < 2) {
      suggest.hidden = true;
      return;
    }
    searchTimer = setTimeout(() => runSearch(keyword, suggest), 500);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSearchSelection(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSearchSelection(-1);
    } else if (event.key === 'Enter') {
      const buttons = suggest.querySelectorAll('button');
      if (buttons.length > 0) {
        event.preventDefault();
        buttons[Math.max(searchIndex, 0)].click();
        searchIndex = -1;
      }
    } else if (event.key === 'Escape') {
      suggest.hidden = true;
      input.blur();
    }
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.search-wrap')) suggest.hidden = true;
  });
}

async function runSearch(keyword, suggest) {
  if (!state.mapView) {
    toast('地图未启用，暂时无法搜索定位（见地图区域的说明）', 'error');
    return;
  }
  let pois;
  try {
    pois = await state.mapView.searchPois(keyword);
  } catch (err) {
    suggest.replaceChildren();
    const box = document.createElement('div');
    box.className = 'suggest-empty';
    if (err.message.includes('USER_DAILY_QUERY_OVER_LIMIT')) {
      const line1 = document.createElement('div');
      line1.textContent = '⚠️ 今日搜索次数已用完（高德免费额度，每天零点恢复）';
      const line2 = document.createElement('div');
      line2.textContent = '可以先「＋ 地图选点」点图选位置，或「🔗 导入」粘贴高德分享链接';
      line2.style.marginTop = '6px';
      box.append(line1, line2);
    } else {
      box.textContent = `搜索失败：${err.message}`;
    }
    suggest.appendChild(box);
    suggest.hidden = false;
    return;
  }
  suggest.replaceChildren();

  if (pois.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'suggest-empty';
    empty.textContent = `没有找到「${keyword}」相关的上海地点`;
    suggest.appendChild(empty);
  } else {
    for (const poi of pois) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const name = document.createElement('div');
      name.className = 'suggest-name';
      name.textContent = poi.name;
      const addr = document.createElement('div');
      addr.className = 'suggest-addr';
      addr.textContent = poi.address || poi.pname + poi.cityname + poi.adname;
      btn.append(name, addr);
      btn.addEventListener('click', () => {
        if (!requireRealMap()) return;
        suggest.hidden = true;
        $('#search-input').value = '';
        const { lng, lat } = poi.location;
        state.mapView.map.setZoomAndCenter(15, [lng, lat], true);
        openPlaceDialog({
          coords: { lng, lat },
          prefill: { name: poi.name, address: poi.address ?? '' },
        });
      });
      suggest.appendChild(btn);
    }
  }
  suggest.hidden = false;
}

/* ---------- 添加 / 编辑对话框 ---------- */

let dialogCoords = null;
let editingId = null;

function fillCategorySelect() {
  const select = $('#form-category');
  select.replaceChildren();
  for (const category of CATEGORIES) {
    const option = document.createElement('option');
    option.value = category.id;
    option.textContent = `${category.emoji} ${category.id}`;
    select.appendChild(option);
  }
}

function openPlaceDialog({ coords, prefill, editing } = {}) {
  const form = $('#place-form');
  form.reset();
  state.mapView?.closeInfo(); // 打开表单时收起地图上的信息窗
  editingId = editing?.id ?? null;
  dialogCoords = coords ?? (editing ? { lng: editing.lng, lat: editing.lat } : null);

  $('#place-dialog-title').textContent = editing ? '编辑地点' : '添加地点';
  $('#field-visited').hidden = !editing;
  $('#form-coords').textContent = dialogCoords
    ? `${dialogCoords.lng.toFixed(5)}, ${dialogCoords.lat.toFixed(5)}`
    : '未选择（搜索或地图选点后自动填入）';

  if (prefill) {
    form.elements.name.value = prefill.name ?? '';
    form.elements.address.value = prefill.address ?? '';
  }
  if (editing) {
    form.elements.name.value = editing.name;
    form.elements.category.value = editing.category;
    form.elements.description.value = editing.description;
    form.elements.address.value = editing.address;
    form.elements.visited.checked = editing.visited;
    form.elements.price_hint.value = editing.price_hint ?? '';
    form.elements.hours.value = editing.hours ?? '';
    form.elements.tags.value = editing.tags ?? '';
  }
  form.elements.added_by.value = editing?.added_by ?? localStorage.getItem(NICKNAME_KEY) ?? '';

  $('#place-dialog').showModal();
}

function closePlaceDialog() {
  $('#place-dialog').close();
}

async function submitPlace(event) {
  event.preventDefault();
  if (!requireRealMap()) return;
  const form = event.currentTarget;
  const name = form.elements.name.value.trim();
  if (!name) {
    toast('地点名称不能为空', 'error');
    return;
  }
  const payload = {
    name,
    category: form.elements.category.value,
    description: form.elements.description.value.trim(),
    address: form.elements.address.value.trim(),
    added_by: form.elements.added_by.value.trim(),
    price_hint: form.elements.price_hint.value.trim(),
    hours: form.elements.hours.value.trim(),
    tags: form.elements.tags.value.trim(),
  };
  if (payload.added_by) {
    localStorage.setItem(NICKNAME_KEY, payload.added_by);
  }

  const saveBtn = $('#btn-place-save');
  saveBtn.disabled = true;
  saveBtn.textContent = '保存中…';
  try {
    if (editingId) {
      const updated = await api.updatePlace(state.map.code, editingId, {
        ...payload,
        visited: form.elements.visited.checked,
      });
      // 接口返回的是裸记录，保留本地计数与 wishes
      const index = state.places.findIndex((p) => p.id === editingId);
      if (index >= 0) state.places[index] = { ...state.places[index], ...updated };
      if (detailPlace?.id === editingId) {
        detailPlace = state.places[index]; // 详情弹层若开着，同步到编辑后的数据
        syncDetailHeader();
      }
      toast('已保存修改');
    } else {
      if (!dialogCoords) {
        toast('还没有选择位置：先搜索地点或在地图上选点', 'error');
        return;
      }
      const created = await api.createPlace(state.map.code, {
        ...payload,
        lng: dialogCoords.lng,
        lat: dialogCoords.lat,
      });
      state.places.unshift({
        ...created,
        photo_count: 0,
        comment_count: 0,
        wishes: [],
      });
      toast('已添加，出现在列表和地图上了');
    }
    closePlaceDialog();
    renderAll();
  } catch (err) {
    toast(`保存失败：${err.message}`, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '保存';
  }
}

/* ---------- 编辑类操作 ---------- */

async function toggleVisited(place) {
  if (!state.map) return;
  try {
    await api.updatePlace(state.map.code, place.id, { visited: !place.visited });
    place.visited = !place.visited;
    if (detailPlace?.id === place.id) {
      $('#btn-detail-toggle').textContent = place.visited ? '↩️ 取消打卡' : '✅ 打卡';
    }
    renderAll();
  } catch (err) {
    toast(`操作失败：${err.message}`, 'error');
  }
}

/* ---------- 我也想去 ---------- */

async function toggleWish(place) {
  if (!state.map) return;
  const who = await currentNickname();
  if (!who) return;
  try {
    const { wished, wishes } = await api.toggleWish(state.map.code, place.id, who);
    place.wishes = wishes;
    toast(wished ? `已标记「${place.name}」想去 ♥` : '已取消想去');
    renderList();
    if (detailPlace?.id === place.id) syncDetailWishes(place);
  } catch (err) {
    toast(`操作失败：${err.message}`, 'error');
  }
}

function syncDetailWishes(place = detailPlace) {
  if (!place) return;
  const wishes = place.wishes ?? [];
  const myName = localStorage.getItem(NICKNAME_KEY) ?? '';
  const wished = Boolean(myName) && wishes.includes(myName);
  const btn = $('#btn-detail-wish');
  btn.textContent = wished ? '♥ 想去' : '♡ 想去';
  btn.classList.toggle('is-wished', wished);
  const wrap = $('#detail-wishes');
  wrap.hidden = wishes.length === 0;
  wrap.textContent = wishes.length ? `♥ ${wishes.join('、')} 想去这里` : '';
}

async function removePlace(place) {
  if (!state.map) return;
  const confirmed = await askConfirm({
    title: `删除「${place.name}」？`,
    message: '照片和留言会一起删除，无法恢复。',
    okText: '删除',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await api.deletePlace(state.map.code, place.id);
    if (detailPlace?.id === place.id) closeDetail();
    state.places = state.places.filter((p) => p.id !== place.id);
    toast(`已删除「${place.name}」`);
    renderAll();
  } catch (err) {
    toast(`删除失败：${err.message}`, 'error');
  }
}

/* ---------- 公开到公共广场 ---------- */

async function togglePublic(place) {
  if (!state.map || isPublicView()) return;
  try {
    const { is_public } = await api.togglePublic(state.map.code, place.id);
    place.is_public = is_public;
    toast(is_public ? `「${place.name}」已公开到公共广场 🌍` : `「${place.name}」已从公共广场撤下`);
    renderList();
    if (detailPlace?.id === place.id) syncDetailHeader();
  } catch (err) {
    toast(`操作失败：${err.message}`, 'error');
  }
}

/* ---------- 地点详情：照片与留言 ---------- */

let detailPlace = null;

// 写操作后就地更新计数并重渲染列表，避免整表拉取
function bumpCount(place, field, delta) {
  place[field] = Math.max(0, (place[field] ?? 0) + delta);
  renderList();
}

function closeDetail() {
  $('#detail-dialog').close();
}

function syncDetailHeader() {
  const place = detailPlace;
  if (!place) return;
  const meta = categoryMeta(place.category);
  $('#detail-title').textContent = `${meta.emoji} ${place.name}`;
  const who = [place.category, place.added_by, formatDate(place.created_at)].filter(Boolean);
  $('#detail-meta').textContent = [who.join(' · '), place.address].filter(Boolean).join(' · ');
  const desc = $('#detail-desc');
  desc.hidden = !place.description;
  desc.textContent = place.description ?? '';
  const badges = $('#detail-badges');
  const badgeItems = [
    place.price_hint ? `💰 ${place.price_hint}` : '',
    place.hours ? `🕐 ${place.hours}` : '',
    ...(place.tags ?? '')
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => `🏷️ ${t}`),
  ].filter(Boolean);
  badges.hidden = badgeItems.length === 0;
  badges.replaceChildren(
    ...badgeItems.map((text) => {
      const span = document.createElement('span');
      span.className = 'detail-badge';
      span.textContent = text;
      return span;
    })
  );
  $('#btn-detail-toggle').textContent = place.visited ? '↩️ 取消打卡' : '✅ 打卡';
  syncDetailWishes(place);
  // 公开开关（公共广场只读视图下由 openDetail 统一隐藏）
  const pubBtn = $('#btn-detail-public');
  pubBtn.hidden = isPublicView();
  pubBtn.textContent = place.is_public ? '🌐 取消公开' : '🌍 公开';
  pubBtn.classList.toggle('is-public', Boolean(place.is_public));
  pubBtn.title = place.is_public
    ? '从公共广场撤下这个地点'
    : '公开后所有人都能在公共广场看到这个地点';
  // 高德官方 URI API：桌面打开网页版，手机（callnative=1）尝试拉起高德 App
  const amapLink = $('#btn-detail-amap');
  amapLink.hidden = false;
  amapLink.href =
    `https://uri.amap.com/marker?position=${place.lng},${place.lat}` +
    `&name=${encodeURIComponent(place.name)}&src=moduExplore&callnative=1&coordinate=gaode`;
}

async function openDetail(place) {
  detailPlace = place;
  state.mapView?.closeInfo(); // 打开详情时收起地图上的信息窗
  syncDetailHeader();
  $('#comment-input').value = '';
  $('#detail-dialog').showModal();
  syncUrlPlace(place.id);
  if (isPublicView()) {
    // 公共广场只读：互动按钮与照片/留言区需要邀请码，统一隐藏
    for (const id of ['btn-detail-toggle', 'btn-detail-edit', 'btn-detail-wish', 'btn-detail-share', 'btn-detail-public']) {
      $(`#${id}`).hidden = true;
    }
    $('#detail-wishes').hidden = true;
    $('#section-photos').hidden = true;
    $('#section-comments').hidden = true;
    $('#detail-readonly').hidden = false;
    return;
  }
  $('#detail-readonly').hidden = true;
  $('#section-photos').hidden = false;
  $('#section-comments').hidden = false;
  await Promise.all([refreshPhotos(), refreshComments()]);
}

async function refreshPhotos() {
  if (!state.map || !detailPlace) return;
  const grid = $('#photo-grid');
  const empty = $('#photo-empty');
  let photos = [];
  try {
    photos = await api.listPhotos(state.map.code, detailPlace.id);
  } catch (err) {
    toast(`照片加载失败：${err.message}`, 'error');
  }
  $('#detail-photo-count').textContent = photos.length > 0 ? `· ${photos.length}` : '';
  grid.replaceChildren();
  empty.hidden = photos.length > 0;
  for (const photo of photos) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'photo-cell';
    const who = photo.added_by || '同学';
    cell.title = `${who} · ${formatDateTime(photo.created_at)}`;
    const img = document.createElement('img');
    img.src = photo.thumb;
    img.alt = `${detailPlace.name}的照片`;
    img.loading = 'lazy';
    const del = document.createElement('span');
    del.className = 'photo-del';
    del.textContent = '✕';
    del.title = '删除照片';
    cell.append(img, del);
    cell.addEventListener('click', (event) => {
      if (event.target === del) {
        event.stopPropagation();
        deletePhoto(photo.id);
        return;
      }
      $('#lightbox-img').src = api.photoUrl(state.map.code, photo.id);
      $('#lightbox-caption').textContent = `${detailPlace.name} · ${who} · ${formatDateTime(photo.created_at)}`;
      $('#lightbox').showModal();
    });
    grid.appendChild(cell);
  }
}

async function deletePhoto(photoId) {
  if (!state.map || !detailPlace) return;
  if (!(await askConfirm({ title: '删除这张照片？', okText: '删除', danger: true }))) return;
  try {
    await api.deletePhoto(state.map.code, photoId);
    toast('照片已删除');
    await refreshPhotos();
    bumpCount(detailPlace, 'photo_count', -1);
    syncDetailHeader();
  } catch (err) {
    toast(`删除失败：${err.message}`, 'error');
  }
}

async function uploadPhotos(files) {
  if (!state.map || !detailPlace) return;
  let ok = 0;
  for (const file of files) {
    try {
      const { full, thumb } = await compressPhoto(file);
      await api.addPhoto(state.map.code, detailPlace.id, {
        full,
        thumb,
        added_by: localStorage.getItem(NICKNAME_KEY) ?? '',
      });
      ok += 1;
    } catch (err) {
      toast(`「${file.name}」上传失败：${err.message}`, 'error');
    }
  }
  if (ok > 0) {
    toast(ok === 1 ? '照片已添加' : `已添加 ${ok} 张照片`);
    await refreshPhotos();
    bumpCount(detailPlace, 'photo_count', ok);
    syncDetailHeader();
  }
}

async function refreshComments() {
  if (!state.map || !detailPlace) return;
  const list = $('#comment-list');
  const empty = $('#comment-empty');
  let comments = [];
  try {
    comments = await api.listComments(state.map.code, detailPlace.id);
  } catch (err) {
    toast(`留言加载失败：${err.message}`, 'error');
  }
  list.replaceChildren();
  empty.hidden = comments.length > 0;
  for (const comment of comments) {
    const item = document.createElement('li');
    item.className = 'comment-item';
    const main = document.createElement('div');
    main.className = 'comment-main';
    const head = document.createElement('div');
    head.className = 'comment-head';
    const author = document.createElement('span');
    author.className = 'comment-author';
    author.textContent = comment.author || '同学';
    const time = document.createElement('span');
    time.textContent = formatDate(comment.created_at);
    head.append(author, time);
    const body = document.createElement('div');
    body.className = 'comment-body';
    body.textContent = comment.body;
    main.append(head, body);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'comment-del';
    del.textContent = '✕';
    del.title = '删除留言';
    del.setAttribute('aria-label', '删除留言');
    del.addEventListener('click', () => deleteComment(comment.id));
    item.append(main, del);
    list.appendChild(item);
  }
}

async function deleteComment(commentId) {
  if (!state.map || !detailPlace) return;
  if (!(await askConfirm({ title: '删除这条留言？', okText: '删除', danger: true }))) return;
  try {
    await api.deleteComment(state.map.code, commentId);
    await refreshComments();
    bumpCount(detailPlace, 'comment_count', -1);
  } catch (err) {
    toast(`删除失败：${err.message}`, 'error');
  }
}

function bindDetailDialog() {
  $('#btn-detail-close').addEventListener('click', closeDetail);
  $('#detail-dialog').addEventListener('close', () => {
    detailPlace = null;
    if ($('#lightbox').open) $('#lightbox').close(); // close() 对已关闭对话框会抛错
    syncUrlPlace(null);
  });
  $('#btn-detail-share').addEventListener('click', async () => {
    if (!detailPlace || !state.map) return;
    const link = `${location.origin}/?map=${state.map.code}&place=${detailPlace.id}`;
    try {
      await navigator.clipboard.writeText(`「${detailPlace.name}」 ${link}`);
      toast('地点链接已复制，发给同学直达这里');
    } catch {
      toast(link, 'info');
    }
  });
  $('#btn-detail-edit').addEventListener('click', () => {
    if (!detailPlace) return;
    closeDetail();
    openPlaceDialog({ editing: detailPlace });
  });
  $('#btn-detail-toggle').addEventListener('click', () => {
    if (detailPlace) toggleVisited(detailPlace);
  });
  $('#btn-add-photo').addEventListener('click', () => $('#photo-input').click());
  $('#photo-input').addEventListener('change', async (event) => {
    const files = [...event.target.files];
    event.target.value = '';
    if (files.length > 0) await uploadPhotos(files);
  });
  $('#comment-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.map || !detailPlace) return;
    const input = $('#comment-input');
    const body = input.value.trim();
    if (!body) return;
    const sendBtn = event.currentTarget.querySelector('button[type="submit"]');
    sendBtn.disabled = true;
    try {
      await api.addComment(state.map.code, detailPlace.id, {
        author: localStorage.getItem(NICKNAME_KEY) ?? '',
        body,
      });
      input.value = '';
      await refreshComments();
      bumpCount(detailPlace, 'comment_count', 1);
    } catch (err) {
      toast(`发送失败：${err.message}`, 'error');
    } finally {
      sendBtn.disabled = false;
    }
  });
  $('#lightbox').addEventListener('click', () => {
    $('#lightbox').close();
  });
}

/* ---------- 吸附选点 ---------- */

let pendingPickCoords = null;

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '';
  if (meters < 1000) return `${Math.round(meters)} 米`;
  return `${(meters / 1000).toFixed(1)} 公里`;
}

async function handleMapPick(lng, lat) {
  pendingPickCoords = { lng, lat };
  state.mapView.showPickMarker([lng, lat]);

  const dialog = $('#pick-dialog');
  $('#pick-raw-hint').textContent = `你点击的位置：${lng.toFixed(5)}, ${lat.toFixed(5)}`;
  const list = $('#pick-candidates');
  const loading = document.createElement('div');
  loading.className = 'pick-loading';
  loading.textContent = '正在匹配附近的地点…';
  list.replaceChildren(loading);
  dialog.showModal();

  let result = { formattedAddress: '', pois: [] };
  try {
    result = await state.mapView.reverseGeocode([lng, lat]);
  } catch (err) {
    if (err.message.includes('USER_DAILY_QUERY_OVER_LIMIT')) {
      toast('地址匹配今日额度已用完，已直接用你点击的位置', 'info');
    }
    /* 其他失败按无候选处理 */
  }
  if (!dialog.open) return;

  if (result.pois.length === 0) {
    const coords = pendingPickCoords;
    closePickDialog();
    openPlaceDialog({ coords, prefill: { address: result.formattedAddress } });
    toast('附近没有匹配的地点，已用你点击的位置');
    return;
  }

  list.replaceChildren();
  for (const poi of result.pois) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'pick-candidate';
    const main = document.createElement('span');
    const name = document.createElement('div');
    name.className = 'candidate-name';
    name.textContent = poi.name;
    const addr = document.createElement('div');
    addr.className = 'candidate-addr';
    addr.textContent = poi.address;
    main.append(name, addr);
    const dist = document.createElement('span');
    dist.className = 'candidate-distance';
    dist.textContent = formatDistance(poi.distance);
    row.append(main, dist);
    row.addEventListener('click', () => {
      closePickDialog();
      state.mapView.map.setZoomAndCenter(16, [poi.lng, poi.lat], true);
      openPlaceDialog({
        coords: { lng: poi.lng, lat: poi.lat },
        prefill: { name: poi.name, address: poi.address },
      });
    });
    list.appendChild(row);
  }
}

function closePickDialog() {
  $('#pick-dialog').close();
}

function cleanupPick() {
  state.mapView?.clearPickMarker();
  pendingPickCoords = null;
}

/* ---------- 从高德分享导入 ---------- */

// 解析高德分享文本/链接，返回：
//   { lng, lat, name?, address? }  坐标齐全，可直接导入
//   { keyword }                    只有名称，走搜索候选
//   { error }                      无法解析（附指引）
function parseAmapShare(raw) {
  const text = (raw ?? '').trim();
  if (!text) return { error: '还没有粘贴内容' };

  // 1) uri.amap.com/marker?position=lng,lat&name=..&addr=..（官方 URI 链接，坐标为 GCJ-02）
  const marker = text.match(/uri\.amap\.com\/marker\?([^\s"']+)/);
  if (marker) {
    const params = new URLSearchParams(marker[1].replace(/&amp;/g, '&'));
    const [lngStr, latStr] = (params.get('position') ?? '').split(',');
    const lng = Number(lngStr);
    const lat = Number(latStr);
    if (Number.isFinite(lng) && Number.isFinite(lat) && lng !== 0 && lat !== 0) {
      return {
        lng,
        lat,
        name: params.get('name')?.trim() ?? '',
        address: params.get('addr')?.trim() ?? '',
      };
    }
  }

  // 2) 文本中的坐标对（高德分享常见「位置：121.4375,31.2054」，兼容中文逗号）
  const coord = text.match(/(\d{1,3}\.\d{4,})\s*[,，]\s*(\d{1,2}\.\d{4,})/);
  const bracket = text.match(/【(.+?)】|「(.+?)」|『(.+?)』/);
  if (coord) {
    const lng = Number(coord[1]);
    const lat = Number(coord[2]);
    if (Math.abs(lng) <= 180 && Math.abs(lat) <= 90) {
      return { lng, lat, name: bracket?.[1] ?? bracket?.[2] ?? bracket?.[3] ?? '' };
    }
  }

  // 3) 只有名称（【外滩源】等）→ 用名称搜索候选
  const name = bracket?.[1] ?? bracket?.[2] ?? bracket?.[3];
  if (name) return { keyword: name };

  // 4) 纯地点页链接（只有 POI ID，拿不到坐标和名称）
  if (/amap\.com\/(place|detail|p)\/[A-Za-z0-9]+/i.test(text)) {
    return { error: '这个链接里只有地点编号。请粘贴高德 App 分享出来的完整文本（含地点名或「位置：经度,纬度」），或改用搜索。' };
  }

  return { error: '没有识别出坐标或地点名。确认粘贴的是高德 App 分享的文本/链接。' };
}

function showImportPreview(result) {
  const box = $('#import-preview');
  box.replaceChildren();
  if (result.error) {
    box.hidden = false;
    box.textContent = `⚠️ ${result.error}`;
    return;
  }
  box.hidden = false;
  if (result.lng !== undefined) {
    box.textContent = `✓ 已识别：${result.name || '未命名地点'}（${result.lng.toFixed(5)}, ${result.lat.toFixed(5)}）`;
  } else {
    box.textContent = `✓ 已识别地点名：${result.keyword}，稍后从搜索结果中选一个`;
  }
}

function handleImportSubmit(event) {
  event.preventDefault();
  const result = parseAmapShare($('#import-input').value);
  showImportPreview(result);
  if (result.error) return;

  $('#import-dialog').close();
  $('#import-input').value = '';
  $('#import-preview').hidden = true;

  if (result.lng !== undefined) {
    if (!state.map) {
      openMapEntry();
      return;
    }
    openPlaceDialog({
      coords: { lng: result.lng, lat: result.lat },
      prefill: { name: result.name ?? '', address: result.address ?? '' },
    });
    toast('已从高德导入位置，补全信息后保存');
    return;
  }

  // 只有名称：塞进搜索框走候选选择流程
  const input = $('#search-input');
  input.value = result.keyword;
  runSearch(result.keyword, $('#search-suggest'));
  toast(`已用「${result.keyword}」搜索，点选结果完成导入`);
}

function bindImport() {
  $('#btn-import').addEventListener('click', () => {
    if (!requireRealMap()) return;
    $('#import-input').value = '';
    $('#import-preview').hidden = true;
    $('#import-dialog').showModal();
  });
  $('#btn-import-cancel').addEventListener('click', () => $('#import-dialog').close());
  $('#import-form').addEventListener('submit', handleImportSubmit);
}

/* ---------- 地图设置：改名 / 换邀请码 / 删除 ---------- */

function forgetMap(code) {
  localStorage.setItem(MAPS_KEY, JSON.stringify(joinedMaps().filter((m) => m.code !== code)));
  if (localStorage.getItem(CURRENT_MAP_KEY) === code) {
    localStorage.removeItem(CURRENT_MAP_KEY);
  }
}

function openMapSettings() {
  if (!state.map || isPublicView()) {
    toast('公共广场没有设置，先选择一张自己的地图', 'info');
    return;
  }
  $('#map-name-input').value = state.map.name;
  $('#map-settings-dialog').showModal();
}

async function renameCurrentMap() {
  if (!state.map || isPublicView()) return;
  const name = $('#map-name-input').value.trim();
  if (!name) {
    toast('地图名称不能为空', 'error');
    return;
  }
  try {
    await api.renameMap(state.map.code, name);
    state.map.name = name;
    saveJoinedMap(state.map);
    renderMapSelect();
    toast('地图名称已更新');
    $('#map-settings-dialog').close();
  } catch (err) {
    toast(`保存失败：${err.message}`, 'error');
  }
}

async function rekeyCurrentMap() {
  if (!state.map || isPublicView()) return;
  const confirmed = await askConfirm({
    title: '更换邀请码？',
    message: '旧邀请码立即失效，之前分享的链接和邀请码都无法再打开这张地图。',
    okText: '换码',
  });
  if (!confirmed) return;
  try {
    const newMap = await api.rekeyMap(state.map.code);
    forgetMap(state.map.code);
    setCurrentMap(newMap);
    $('#map-settings-dialog').close();
    $('#map-created-title').textContent = '邀请码已更换 🔑';
    $('#invite-code').textContent = newMap.code;
    $('#map-created-dialog').showModal();
  } catch (err) {
    toast(`换码失败：${err.message}`, 'error');
  }
}

async function deleteCurrentMap() {
  if (!state.map || isPublicView()) return;
  const confirmed = await askConfirm({
    title: `删除地图「${state.map.name}」？`,
    message: '所有地点、照片、留言会一并删除，无法恢复。请确认这是你想要的操作。',
    okText: '永久删除',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await api.deleteMap(state.map.code);
    forgetMap(state.map.code);
    toast(`已删除「${state.map.name}」`);
    enterPublicMap();
  } catch (err) {
    toast(`删除失败：${err.message}`, 'error');
  }
}

function bindMapSettings() {
  $('#btn-map-settings').addEventListener('click', openMapSettings);
  $('#btn-map-settings-close').addEventListener('click', () => $('#map-settings-dialog').close());
  $('#btn-map-rename').addEventListener('click', renameCurrentMap);
  $('#btn-map-rekey').addEventListener('click', rekeyCurrentMap);
  $('#btn-map-delete').addEventListener('click', deleteCurrentMap);
}

/* ---------- 启动 ---------- */

function bindStaticEvents() {
  $('#btn-pick').addEventListener('click', () => {
    if (!requireRealMap()) return;
    if (!state.mapView) {
      toast('地图未启用，无法选点（需要配置高德 key）', 'error');
      return;
    }
    setPickMode(!state.pickMode);
  });
  $('#btn-pick-cancel').addEventListener('click', () => setPickMode(false));
  $('#btn-pick-cancel-dialog').addEventListener('click', closePickDialog);
  $('#btn-pick-raw').addEventListener('click', () => {
    const coords = pendingPickCoords;
    closePickDialog();
    if (coords) openPlaceDialog({ coords });
  });
  $('#pick-dialog').addEventListener('close', cleanupPick);
  $('#btn-place-cancel').addEventListener('click', closePlaceDialog);
  $('#place-form').addEventListener('submit', submitPlace);
  $('#btn-empty-new').addEventListener('click', openMapEntry);
  $('#sort-select').value = state.sort;
  $('#sort-select').addEventListener('change', (event) => {
    state.sort = event.target.value;
    localStorage.setItem(SORT_KEY, state.sort);
    renderAll();
  });
  $('#panel-handle').addEventListener('click', () => {
    const collapsed = $('#sidebar').classList.toggle('is-collapsed');
    $('#panel-handle').setAttribute('aria-expanded', String(!collapsed));
  });
  $('#toggle-unvisited').addEventListener('change', (event) => {
    state.hideUnvisitedOnly = event.target.checked;
    renderAll();
  });
}

/* ---------- 回忆时间线 ---------- */

async function openMemories() {
  if (!requireRealMap()) return;
  $('#memories-dialog').showModal();
  let memories = [];
  try {
    memories = await api.memories(state.map.code);
  } catch (err) {
    toast(`回忆加载失败：${err.message}`, 'error');
  }
  renderMemories(memories);
}

function renderMemories(memories) {
  const list = $('#memories-list');
  list.replaceChildren();
  $('#memories-empty').hidden = memories.length > 0;

  let currentMonth = '';
  for (const memory of memories) {
    const date = memory.visited_at ? new Date(memory.visited_at) : null;
    const monthKey = date ? `${date.getFullYear()}年${date.getMonth() + 1}月` : '更早';
    if (monthKey !== currentMonth) {
      currentMonth = monthKey;
      const heading = document.createElement('h3');
      heading.className = 'memory-month';
      heading.textContent = monthKey;
      list.appendChild(heading);
    }

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'memory-card';

    const strip = document.createElement('div');
    strip.className = 'memory-photos';
    if (memory.photos.length === 0) {
      const placeholder = document.createElement('span');
      placeholder.className = 'memory-no-photo';
      placeholder.textContent = '📷';
      strip.appendChild(placeholder);
    } else {
      for (const thumb of memory.photos.slice(0, 4)) {
        const img = document.createElement('img');
        img.src = thumb;
        img.alt = memory.name;
        img.loading = 'lazy';
        strip.appendChild(img);
      }
    }

    const info = document.createElement('div');
    info.className = 'memory-info';
    const meta = categoryMeta(memory.category);
    const nameLine = document.createElement('span');
    nameLine.className = 'memory-name';
    nameLine.textContent = `${meta.emoji} ${memory.name}`;
    const sub = document.createElement('span');
    sub.className = 'memory-sub';
    sub.textContent = [
      date ? formatDate(memory.visited_at) : '去过',
      `${memory.added_by || '同学'} 标记`,
    ].join(' · ');
    info.append(nameLine, sub);

    card.append(strip, info);
    card.addEventListener('click', () => {
      $('#memories-dialog').close();
      const place = state.places.find((p) => p.id === memory.id);
      if (place) openDetail(place);
    });
    list.appendChild(card);
  }
}

/* ---------- 分享海报 ---------- */

async function openPoster() {
  if (!requireRealMap()) return;
  $('#poster-dialog').showModal();
  await renderPoster();
}

async function renderPoster() {
  const canvas = $('#poster-canvas');
  let photos = [];
  try {
    photos = (await api.memories(state.map.code)).flatMap((m) => m.photos);
  } catch {
    /* 拿不到照片也照样生成 */
  }
  try {
  await generatePoster(canvas, {
    mapName: state.map.name,
    code: state.map.code,
    places: state.places,
    photos: photos.slice(0, 6),
  });
  } catch (err) {
    console.error(err);
    toast('海报生成失败，请重试', 'error');
  }
}

function savePoster() {
  const canvas = $('#poster-canvas');
  canvas.toBlob((blob) => {
    if (!blob) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `魔都Explore-${state.map?.name ?? '地图'}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    toast('海报已保存，发给同学吧');
  }, 'image/png');
}

// ---------- 行程单 ----------

const WALK_KMH = 4.5; // 步行速度，用于估算站间耗时

let itineraryIds = []; // 当前行程的地点 id 顺序（服务端为准）

function haversineKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(s));
}

function fmtKm(km) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

function fmtWalk(km) {
  const minutes = Math.max(1, Math.round((km / WALK_KMH) * 60));
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

function itineraryPlaces() {
  const byId = new Map(state.places.map((p) => [p.id, p]));
  return itineraryIds.map((id) => byId.get(id)).filter(Boolean);
}

async function openItinerary() {
  if (!requireRealMap()) return;
  $('#itinerary-dialog').showModal();
  try {
    itineraryIds = (await api.itinerary(state.map.code)).map((s) => s.id);
  } catch {
    itineraryIds = []; // 拉取失败按空行程展示，下一次保存会整体重建
  }
  renderItinerary();
}

function renderItinerary() {
  const stops = itineraryPlaces();
  const list = $('#itinerary-list');
  list.textContent = '';

  let totalKm = 0;
  stops.forEach((place, i) => {
    const li = document.createElement('li');
    li.className = 'itinerary-stop';

    const no = document.createElement('span');
    no.className = 'itinerary-no';
    no.textContent = i + 1;
    li.append(no);

    const main = document.createElement('div');
    main.className = 'itinerary-stop-main';
    const name = document.createElement('span');
    name.className = 'itinerary-stop-name';
    name.textContent = place.name;
    if (place.visited) name.classList.add('is-visited');
    main.append(name);

    const next = stops[i + 1];
    if (next) {
      const km = haversineKm(place, next);
      totalKm += km;
      const leg = document.createElement('span');
      leg.className = 'itinerary-leg';
      leg.textContent = `↳ ${fmtKm(km)} · 步行约 ${fmtWalk(km)}`;
      main.append(leg);
    }
    li.append(main);

    const ops = document.createElement('div');
    ops.className = 'itinerary-ops';
    const mk = (text, cls, disabled, onClick) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = cls;
      btn.textContent = text;
      btn.disabled = disabled;
      btn.addEventListener('click', onClick);
      return btn;
    };
    ops.append(
      mk('↑', 'btn btn-small', i === 0, () => moveItinerary(i, -1)),
      mk('↓', 'btn btn-small', !next, () => moveItinerary(i, 1)),
      mk('✕', 'btn btn-small btn-danger', false, () => {
        itineraryIds.splice(i, 1);
        saveItinerary();
      })
    );
    li.append(ops);
    list.append(li);
  });

  $('#itinerary-empty').hidden = stops.length > 0;
  $('#itinerary-summary').textContent =
    stops.length > 1
      ? `${stops.length} 站 · 全程步行 ${fmtKm(totalKm)} · 约 ${fmtWalk(totalKm)}`
      : `${stops.length} 站`;

  const inTrip = new Set(itineraryIds);
  const rest = state.places.filter((p) => !inTrip.has(p.id)).slice(0, 60);
  const addList = $('#itinerary-add-list');
  addList.textContent = '';
  for (const place of rest) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'btn btn-small itinerary-chip';
    chip.textContent = `＋ ${place.name}`;
    chip.addEventListener('click', () => {
      itineraryIds.push(place.id);
      saveItinerary();
    });
    addList.append(chip);
  }
  $('.itinerary-add').hidden = rest.length === 0 && stops.length === 0;

  const nav = $('#btn-itinerary-nav');
  if (stops.length >= 2) {
    nav.hidden = false;
    nav.href = buildItineraryNavUrl(stops);
  } else {
    nav.hidden = true;
  }
}

function moveItinerary(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= itineraryIds.length) return;
  [itineraryIds[index], itineraryIds[target]] = [itineraryIds[target], itineraryIds[index]];
  saveItinerary();
}

async function saveItinerary() {
  try {
    const { stops } = await api.setItinerary(state.map.code, itineraryIds);
    itineraryIds = stops.map((s) => s.id);
    renderItinerary();
  } catch (err) {
    toast(err.message);
  }
}

// 高德多点步行导航：首站起点、末站终点、中间走 via
function buildItineraryNavUrl(stops) {
  const pt = (p) => `${p.lng},${p.lat},${encodeURIComponent(p.name)}`;
  const parts = [
    `from=${pt(stops[0])}`,
    `to=${pt(stops[stops.length - 1])}`,
  ];
  if (stops.length > 2) parts.push(`via=${stops.slice(1, -1).map(pt).join(';')}`);
  parts.push('mode=walk', 'coordinate=gaode', 'src=moduExplore', 'callnative=1');
  return `https://uri.amap.com/navigation?${parts.join('&')}`;
}

function buildItineraryText() {
  const stops = itineraryPlaces();
  if (stops.length === 0) return '';
  const lines = [`《${state.map?.name ?? '魔都Explore'}》行程单`, ''];
  stops.forEach((p, i) => lines.push(`${i + 1}. ${p.name}${p.visited ? '（已去过）' : ''}`));
  if (stops.length > 1) {
    let totalKm = 0;
    for (let i = 1; i < stops.length; i += 1) totalKm += haversineKm(stops[i - 1], stops[i]);
    lines.push('', `全程步行 ${fmtKm(totalKm)}，约 ${fmtWalk(totalKm)}`);
  }
  return lines.join('\n');
}

async function copyItinerary() {
  const text = buildItineraryText();
  if (!text) {
    toast('行程还是空的');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('行程已复制，发给同学吧');
  } catch {
    toast('复制失败，可手动截图分享');
  }
}

function bindExtras() {
  $('#btn-detail-wish').addEventListener('click', () => {
    if (detailPlace) toggleWish(detailPlace);
  });
  $('#btn-memories').addEventListener('click', openMemories);
  $('#btn-memories-close').addEventListener('click', () => $('#memories-dialog').close());
  $('#btn-poster').addEventListener('click', openPoster);
  $('#btn-poster-close').addEventListener('click', () => $('#poster-dialog').close());
  $('#btn-poster-refresh').addEventListener('click', renderPoster);
  $('#btn-poster-save').addEventListener('click', savePoster);
  $('#btn-itinerary').addEventListener('click', openItinerary);
  $('#btn-itinerary-close').addEventListener('click', () => $('#itinerary-dialog').close());
  $('#btn-itinerary-copy').addEventListener('click', copyItinerary);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {
    /* 注册失败不影响功能 */
  });
}

function bindCommentFocusScroll() {
  document.addEventListener('focusin', (event) => {
    if (event.target?.id !== 'comment-input') return;
    setTimeout(() => event.target.scrollIntoView({ block: 'nearest' }), 250);
  });
}

async function boot() {
  bindCommentFocusScroll();
  bindThemeSelect();
  fillCategorySelect();
  renderChips();
  bindStaticEvents();
  bindSearch();
  bindImport();
  bindMapEntry();
  bindMapSettings();
  bindDetailDialog();
  bindExtras();
  registerServiceWorker();
  await Promise.all([initMap(), restoreMapSession()]);
}

boot();
