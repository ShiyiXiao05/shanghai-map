import { api } from './api.js';
import { loadAmap, createMapView } from './map.js';
import { compressPhoto } from './photos.js';

// 深色霓虹底下用的亮色分类色板（色值与 css/style.css 的 --cat-* 保持一致）
const CATEGORIES = [
  { id: '景点', emoji: '📍', color: '#34d399' },
  { id: '美食', emoji: '🍜', color: '#fb923c' },
  { id: '展馆', emoji: '🖼️', color: '#60a5fa' },
  { id: '购物', emoji: '🛍️', color: '#f472b6' },
  { id: '娱乐', emoji: '🎡', color: '#a78bfa' },
  { id: '其他', emoji: '✨', color: '#94a3b8' },
];

const MAPS_KEY = 'wish-maps';
const CURRENT_MAP_KEY = 'wish-current-map';
const NICKNAME_KEY = 'shanghai-wish-nickname';
const NEW_MAP_OPTION = '__new__';

const state = {
  map: null, // { code, name }
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
  saveJoinedMap(map);
  localStorage.setItem(CURRENT_MAP_KEY, map.code);
  history.replaceState(null, '', `?map=${encodeURIComponent(map.code)}`);
  renderMapSelect();
}

function renderMapSelect() {
  const select = $('#map-select');
  select.replaceChildren();

  if (!state.map) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '🗺 选择地图…';
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);
  } else {
    const current = document.createElement('option');
    current.value = state.map.code;
    current.textContent = state.map.name;
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
    if (value && (!state.map || value !== state.map.code)) {
      const map = joinedMaps().find((m) => m.code === value);
      if (map) {
        setCurrentMap(map);
        state.mapView?.closeInfo();
        closeDetail();
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
  // 首访或清空过会话：直接进地图页空状态，不弹任何整页引导
  renderMapSelect();
  renderAll();
}

/* ---------- 数据加载与渲染 ---------- */

async function loadPlaces() {
  if (!state.map) {
    renderAll();
    return;
  }
  try {
    state.places = await api.listPlaces(state.map.code);
  } catch (err) {
    if (err.status === 404) {
      toast('这张地图不存在了，换一个邀请码吧', 'error');
      openMapEntry();
      return;
    }
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

function renderList() {
  const list = $('#place-list');
  list.replaceChildren();

  const places = filteredPlaces();
  const empty = $('#empty-state');
  const newMapBtn = $('#btn-empty-new');

  if (!state.map) {
    empty.hidden = false;
    empty.querySelector('.empty-title').textContent = '还没有加入地图';
    $('#empty-hint').textContent = '创建一张新地图，或用同学的邀请码加入';
    newMapBtn.hidden = false;
    return;
  }
  newMapBtn.hidden = true;

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

    const actions = document.createElement('div');
    actions.className = 'place-actions';
    const btnToggle = document.createElement('button');
    btnToggle.type = 'button';
    btnToggle.title = place.visited ? '取消打卡' : '标记为已去过';
    btnToggle.setAttribute('aria-label', btnToggle.title);
    btnToggle.textContent = place.visited ? '↩️' : '✅';
    btnToggle.addEventListener('click', () => toggleVisited(place));
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
    actions.append(btnToggle, btnDetail, btnEdit, btnDelete);

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
    state.mapView = createMapView($('#map'));
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
  if (!state.map) {
    openMapEntry();
    return;
  }
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
  if (payload.added_by) {
    localStorage.setItem(NICKNAME_KEY, payload.added_by);
  }

  try {
    if (editingId) {
      await api.updatePlace(state.map.code, editingId, {
        ...payload,
        visited: form.elements.visited.checked,
      });
      toast('已保存修改');
    } else {
      if (!dialogCoords) {
        toast('还没有选择位置：先搜索地点或在地图上选点', 'error');
        return;
      }
      await api.createPlace(state.map.code, {
        ...payload,
        lng: dialogCoords.lng,
        lat: dialogCoords.lat,
      });
      toast('已添加，出现在列表和地图上了');
    }
    closePlaceDialog();
    await loadPlaces();
  } catch (err) {
    toast(`保存失败：${err.message}`, 'error');
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

async function removePlace(place) {
  if (!state.map) return;
  if (!confirm(`确定删除「${place.name}」吗？照片和留言会一起删除。`)) return;
  try {
    await api.deletePlace(state.map.code, place.id);
    if (detailPlace?.id === place.id) closeDetail();
    toast(`已删除「${place.name}」`);
    await loadPlaces();
  } catch (err) {
    toast(`删除失败：${err.message}`, 'error');
  }
}

/* ---------- 地点详情：照片与留言 ---------- */

let detailPlace = null;

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
  $('#btn-detail-toggle').textContent = place.visited ? '↩️ 取消打卡' : '✅ 打卡';
}

async function openDetail(place) {
  detailPlace = place;
  syncDetailHeader();
  $('#comment-input').value = '';
  $('#detail-dialog').showModal();
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
    cell.title = '查看大图';
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
      $('#lightbox').showModal();
    });
    grid.appendChild(cell);
  }
}

async function deletePhoto(photoId) {
  if (!state.map || !detailPlace) return;
  if (!confirm('删除这张照片？')) return;
  try {
    await api.deletePhoto(state.map.code, photoId);
    toast('照片已删除');
    await Promise.all([refreshPhotos(), loadPlaces()]);
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
    await Promise.all([refreshPhotos(), loadPlaces()]);
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
  if (!confirm('删除这条留言？')) return;
  try {
    await api.deleteComment(state.map.code, commentId);
    await Promise.all([refreshComments(), loadPlaces()]);
  } catch (err) {
    toast(`删除失败：${err.message}`, 'error');
  }
}

function bindDetailDialog() {
  $('#btn-detail-close').addEventListener('click', closeDetail);
  $('#detail-dialog').addEventListener('close', () => {
    detailPlace = null;
    $('#lightbox').close();
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
    try {
      await api.addComment(state.map.code, detailPlace.id, {
        author: localStorage.getItem(NICKNAME_KEY) ?? '',
        body,
      });
      input.value = '';
      await Promise.all([refreshComments(), loadPlaces()]);
    } catch (err) {
      toast(`发送失败：${err.message}`, 'error');
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

/* ---------- 启动 ---------- */

function bindStaticEvents() {
  $('#btn-pick').addEventListener('click', () => {
    if (!state.map) {
      openMapEntry();
      return;
    }
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
  $('#toggle-unvisited').addEventListener('change', (event) => {
    state.hideUnvisitedOnly = event.target.checked;
    renderAll();
  });
}

async function boot() {
  fillCategorySelect();
  renderChips();
  bindStaticEvents();
  bindSearch();
  bindMapEntry();
  bindDetailDialog();
  await Promise.all([initMap(), restoreMapSession()]);
}

boot();
