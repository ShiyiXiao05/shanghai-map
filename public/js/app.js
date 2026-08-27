import { api, ApiError, getAccessCode, setAccessCode } from './api.js';
import { loadAmap, createMapView } from './map.js';

const CATEGORIES = [
  { id: '景点', emoji: '📍', color: '#3e8e63' },
  { id: '美食', emoji: '🍜', color: '#d97b29' },
  { id: '展馆', emoji: '🖼️', color: '#5b7fc4' },
  { id: '购物', emoji: '🛍️', color: '#cc5f8f' },
  { id: '娱乐', emoji: '🎡', color: '#9a6fc9' },
  { id: '其他', emoji: '✨', color: '#7a8a94' },
];

/* 主题：色值见 css/style.css 的 html[data-theme] 块（来自 StudyPlan 的配色方案） */
const THEMES = {
  auto: { name: '🌗 自动（跟随系统）' },
  celadon: { name: '🍵 青瓷', mapStyle: 'amap://styles/fresh' },
  ink: { name: '🌑 墨夜', mapStyle: 'amap://styles/dark' },
  berry: { name: '🫐 莓果暗', mapStyle: 'amap://styles/grape' },
  onedark: { name: '💠 奥德暗', mapStyle: 'amap://styles/darkblue' },
  pudding: { name: '🐾 布丁紫', mapStyle: 'amap://styles/grape' },
  tokyo: { name: '🌃 东京夜', mapStyle: 'amap://styles/darkblue' },
};

const THEME_KEY = 'wish-theme';

function resolveThemeId(saved) {
  if (saved !== 'auto' && THEMES[saved]) return saved;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'tokyo' : 'celadon';
}

function applyTheme(saved, { persist } = {}) {
  const themeId = resolveThemeId(saved);
  document.documentElement.dataset.theme = themeId;
  const mapStyle = THEMES[themeId]?.mapStyle;
  if (mapStyle) state.mapView?.map.setMapStyle(mapStyle);
  if (persist) localStorage.setItem(THEME_KEY, saved);
  $('#theme-select').value = saved;
}

const NICKNAME_KEY = 'shanghai-wish-nickname';

const state = {
  places: [],
  activeCategories: new Set(CATEGORIES.map((c) => c.id)),
  hideUnvisitedOnly: false,
  mapView: null,
  pickMode: false,
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

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' toast-error' : ''}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

/* ---------- 数据加载与渲染 ---------- */

async function loadPlaces() {
  try {
    state.places = await api.listPlaces();
  } catch (err) {
    toast(`地点列表加载失败：${err.message}`, 'error');
    return;
  }
  renderAll();
}

function renderAll() {
  renderMarkers();
  renderList();
}

function filteredPlaces() {
  return state.places.filter(
    (place) =>
      state.activeCategories.has(place.category) &&
      !(state.hideUnvisitedOnly && place.visited)
  );
}

function renderMarkers() {
  state.mapView?.setPlaces(filteredPlaces(), categoryMeta, {
    onMarkerClick: (place) => {
      state.mapView.focus(place);
      state.mapView.openInfo(place, categoryMeta, {
        onEdit: (p) => openPlaceDialog({ editing: p }),
      });
    },
  });
}

function renderList() {
  const list = $('#place-list');
  list.replaceChildren();

  const places = filteredPlaces();
  const empty = $('#empty-state');

  if (places.length === 0) {
    empty.hidden = false;
    empty.querySelector('.empty-title').textContent =
      state.places.length === 0 ? '还没有标记任何地点' : '这个筛选下没有地点';
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

    const actions = document.createElement('div');
    actions.className = 'place-actions';
    const btnToggle = document.createElement('button');
    btnToggle.type = 'button';
    btnToggle.title = place.visited ? '取消打卡' : '标记为已去过';
    btnToggle.setAttribute('aria-label', btnToggle.title);
    btnToggle.textContent = place.visited ? '↩️' : '✅';
    btnToggle.addEventListener('click', () => toggleVisited(place));
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
    actions.append(btnToggle, btnEdit, btnDelete);

    const metaLine = document.createElement('div');
    metaLine.className = 'place-meta';
    const who = [place.added_by, formatDate(place.created_at)].filter(Boolean).join(' · ');
    metaLine.textContent = `${place.category}${who ? ` · ${who}` : ''}${place.address ? ` · ${place.address}` : ''}`;

    item.append(emoji, head, actions, metaLine);
    if (place.description) {
      const desc = document.createElement('div');
      desc.className = 'place-desc';
      desc.textContent = place.description;
      item.appendChild(desc);
    }

    item.addEventListener('click', (event) => {
      if (event.target.closest('.place-actions')) return;
      focusPlace(place);
    });
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') focusPlace(place);
    });

    list.appendChild(item);
  }
}

function focusPlace(place) {
  if (!state.mapView) return;
  state.mapView.focus(place);
  state.mapView.openInfo(place, categoryMeta, {
    onEdit: (p) => openPlaceDialog({ editing: p }),
  });
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
      chip.style.background = category.color;
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
    state.mapView = createMapView($('#map'));
    $('#map-fallback').hidden = true;
    applyTheme(localStorage.getItem(THEME_KEY) || 'auto');
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
  } catch {
    /* 匹配失败按无候选处理 */
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
      state.mapView.map.setZoomAndCenter(16, [poi.lng, poi.lat]);
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

/* ---------- 搜索 ---------- */

let searchTimer = null;

function bindSearch() {
  const input = $('#search-input');
  const suggest = $('#search-suggest');

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const keyword = input.value.trim();
    if (!keyword) {
      suggest.hidden = true;
      return;
    }
    searchTimer = setTimeout(() => runSearch(keyword, suggest), 300);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
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
    toast(`搜索失败：${err.message}`, 'error');
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
        suggest.hidden = true;
        $('#search-input').value = '';
        const { lng, lat } = poi.location;
        state.mapView.map.setZoomAndCenter(15, [lng, lat]);
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
  }
  form.elements.added_by.value = editing?.added_by ?? localStorage.getItem(NICKNAME_KEY) ?? '';

  $('#place-dialog').showModal();
}

function closePlaceDialog() {
  $('#place-dialog').close();
}

async function submitPlace(event) {
  event.preventDefault();
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
  };
  if (form.elements.added_by.value.trim()) {
    localStorage.setItem(NICKNAME_KEY, form.elements.added_by.value.trim());
  }

  try {
    if (editingId) {
      await withAuthRetry(() =>
        api.updatePlace(editingId, { ...payload, visited: form.elements.visited.checked })
      );
      toast('已保存修改');
    } else {
      if (!dialogCoords) {
        toast('还没有选择位置：先搜索地点或在地图上选点', 'error');
        return;
      }
      await withAuthRetry(() =>
        api.createPlace({ ...payload, lng: dialogCoords.lng, lat: dialogCoords.lat })
      );
      toast('已添加，出现在列表和地图上了');
    }
    closePlaceDialog();
    await loadPlaces();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    toast(`保存失败：${err.message}`, 'error');
  }
}

/* ---------- 编辑类操作 ---------- */

async function toggleVisited(place) {
  try {
    await withAuthRetry(() => api.updatePlace(place.id, { visited: !place.visited }));
    place.visited = !place.visited;
    renderAll();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    toast(`操作失败：${err.message}`, 'error');
  }
}

async function removePlace(place) {
  if (!confirm(`确定删除「${place.name}」吗？`)) return;
  try {
    await withAuthRetry(() => api.deletePlace(place.id));
    toast(`已删除「${place.name}」`);
    await loadPlaces();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    toast(`删除失败：${err.message}`, 'error');
  }
}

/* ---------- 口令 ---------- */

let pendingCodeResolve = null;

function promptForCode(hint) {
  return new Promise((resolve, reject) => {
    const dialog = $('#code-dialog');
    dialog.querySelector('.dialog-hint').textContent =
      hint ?? '添加和修改地点需要共享口令，问一下建站的同学就有。';
    dialog.showModal();
    dialog.querySelector('input[name="code"]').focus();
    pendingCodeResolve = { resolve, reject };
  });
}

function bindCodeDialog() {
  const dialog = $('#code-dialog');
  dialog.addEventListener('close', () => {
    if (dialog.returnValue !== 'ok' && pendingCodeResolve) {
      pendingCodeResolve.reject(new ApiError(401, '未输入口令'));
      pendingCodeResolve = null;
    }
  });
  dialog.addEventListener('submit', (event) => {
    event.preventDefault();
    const code = dialog.querySelector('input[name="code"]').value.trim();
    if (!code) return;
    setAccessCode(code);
    dialog.returnValue = 'ok';
    dialog.close();
    if (pendingCodeResolve) {
      pendingCodeResolve.resolve(code);
      pendingCodeResolve = null;
    }
  });
  $('#btn-code-cancel').addEventListener('click', () => dialog.close());

  $('#btn-code').addEventListener('click', async () => {
    try {
      await promptForCode('输入新的编辑口令，保存后立即生效。');
      toast('口令已更新');
    } catch {
      /* 取消 */
    }
  });
}

async function withAuthRetry(action) {
  try {
    return await action();
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) throw err;
    await promptForCode('口令错误或缺失，请重新输入编辑口令。');
    return await action();
  }
}

/* ---------- 启动 ---------- */

function bindStaticEvents() {
  $('#btn-pick').addEventListener('click', () => {
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
  $('#toggle-unvisited').addEventListener('change', (event) => {
    state.hideUnvisitedOnly = event.target.checked;
    renderAll();
  });
}

function bindThemeSelect() {
  const select = $('#theme-select');
  for (const [id, theme] of Object.entries(THEMES)) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = theme.name;
    select.appendChild(option);
  }
  select.value = localStorage.getItem(THEME_KEY) || 'auto';
  select.addEventListener('change', () => applyTheme(select.value, { persist: true }));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((localStorage.getItem(THEME_KEY) || 'auto') === 'auto') applyTheme('auto');
  });
}

async function boot() {
  bindThemeSelect();
  fillCategorySelect();
  renderChips();
  bindStaticEvents();
  bindSearch();
  bindCodeDialog();
  if (getAccessCode()) $('#btn-code').textContent = '修改编辑口令';
  await Promise.all([initMap(), loadPlaces()]);
}

boot();
