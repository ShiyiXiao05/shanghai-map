function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function loadAmap({ key, securityJsCode }) {
  return new Promise((resolve, reject) => {
    if (typeof key !== 'string' || key === '') {
      reject(new Error('缺少高德 key'));
      return;
    }
    window._AMapSecurityConfig = { securityJsCode: securityJsCode ?? '' };
    if (window.AMap) {
      resolve(window.AMap);
      return;
    }
    const script = document.createElement('script');
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;
    script.onload = () => {
      if (window.AMap) resolve(window.AMap);
      else reject(new Error('高德脚本加载异常'));
    };
    script.onerror = () => reject(new Error('高德脚本加载失败，请检查网络或 key 白名单'));
    document.head.appendChild(script);
  });
}

export function createMapView(container) {
  const map = new AMap.Map(container, {
    viewMode: '2D',
    zoom: 12,
    center: [121.4737, 31.2304],
    mapStyle: 'amap://styles/dark',
  });

  let markers = [];
  let infoWindow = null;
  let pickHandler = null;

  function markerContent(place, meta) {
    const visited = place.visited ? ' is-visited' : '';
    return `<div class="marker-chip${visited}" style="--chip-color:${meta.color}" title="${escapeHtml(place.name)}">${meta.emoji}</div>`;
  }

  function setPlaces(places, categoryMeta, { onMarkerClick } = {}) {
    markers.forEach((marker) => map.remove(marker));
    markers = places.map((place) => {
      const meta = categoryMeta(place.category);
      const marker = new AMap.Marker({
        position: [place.lng, place.lat],
        content: markerContent(place, meta),
        anchor: 'center',
        title: place.name,
      });
      marker.on('click', () => onMarkerClick?.(place));
      map.add(marker);
      return marker;
    });
  }

  function openInfo(place, categoryMeta, { onEdit, onDetail } = {}) {
    closeInfo();
    const meta = categoryMeta(place.category);
    const desc = place.description
      ? `<p class="iw-desc">${escapeHtml(place.description)}</p>`
      : '';
    const visited = place.visited ? '<span class="stamp" title="已去过"></span>' : '';
    const feedback = [
      place.photo_count > 0 ? `📷 ${place.photo_count}` : '',
      place.comment_count > 0 ? `💬 ${place.comment_count}` : '',
    ].filter(Boolean).join(' ');
    const content = document.createElement('div');
    content.className = 'info-window';
    content.innerHTML = `
      <button type="button" class="iw-close" aria-label="关闭">✕</button>
      <p class="iw-title"><span>${meta.emoji} ${escapeHtml(place.name)}</span>${visited}</p>
      ${desc}
      <p class="iw-meta">${escapeHtml([place.added_by, place.address].filter(Boolean).join(' · '))}</p>
      <p class="iw-links">
        <a href="#" class="iw-detail" data-detail="${place.id}">照片 · 留言${feedback ? `（${feedback}）` : ''}</a>
        <span class="iw-sep">·</span>
        <a href="#" class="iw-edit" data-edit="${place.id}">编辑 / 删除</a>
      </p>
    `;
    content.querySelector('.iw-close').addEventListener('click', () => closeInfo());
    content.querySelector('[data-edit]').addEventListener('click', (event) => {
      event.preventDefault();
      onEdit?.(place);
    });
    content.querySelector('[data-detail]').addEventListener('click', (event) => {
      event.preventDefault();
      onDetail?.(place);
    });
    infoWindow = new AMap.InfoWindow({
      content,
      isCustom: true,
      anchor: 'bottom-center',
      offset: new AMap.Pixel(0, -18),
    });
    infoWindow.open(map, [place.lng, place.lat]);
  }

  function closeInfo() {
    infoWindow?.close();
    infoWindow = null;
  }

  function focus(place) {
    map.setZoomAndCenter(15, [place.lng, place.lat]);
  }

  function setPickMode(on, { onPick } = {}) {
    if (pickHandler) {
      map.off('click', pickHandler);
      pickHandler = null;
    }
    container.style.cursor = on ? 'crosshair' : '';
    if (on) {
      pickHandler = (event) => {
        const { lng, lat } = event.lnglat;
        onPick?.(lng, lat);
      };
      map.on('click', pickHandler);
    }
  }

  async function searchPois(keyword) {
    await new Promise((resolve, reject) => {
      if (AMap.PlaceSearch) return resolve();
      AMap.plugin('AMap.PlaceSearch', (ok) => (ok === false ? reject(new Error('搜索插件加载失败')) : resolve()));
    });
    const placeSearch = new AMap.PlaceSearch({ city: '上海', citylimit: true, pageSize: 8 });
    return new Promise((resolve) => {
      placeSearch.search(keyword, (status, result) => {
        if (status === 'complete') {
          resolve(result.poiList?.pois ?? []);
        } else {
          resolve([]);
        }
      });
    });
  }

  async function reverseGeocode(lnglat) {
    await new Promise((resolve, reject) => {
      if (AMap.Geocoder) return resolve();
      AMap.plugin('AMap.Geocoder', (ok) => (ok === false ? reject(new Error('逆地理插件加载失败')) : resolve()));
    });
    const geocoder = new AMap.Geocoder({ city: '上海', extensions: 'all' });
    return new Promise((resolve) => {
      geocoder.getAddress(lnglat, (status, result) => {
        if (status !== 'complete' || !result?.regeocode) {
          resolve({ formattedAddress: '', pois: [] });
          return;
        }
        const regeo = result.regeocode;
        const pois = (regeo.pois ?? [])
          .slice(0, 6)
          .map((poi) => ({
            name: poi.name ?? '',
            address: poi.address || regeo.formattedAddress || '',
            lng: Number(poi.location?.lng),
            lat: Number(poi.location?.lat),
            distance: Number(poi.distance),
          }))
          .filter((poi) => poi.name && Number.isFinite(poi.lng) && Number.isFinite(poi.lat));
        resolve({ formattedAddress: regeo.formattedAddress ?? '', pois });
      });
    });
  }

  let pickMarker = null;

  function showPickMarker(lnglat) {
    clearPickMarker();
    pickMarker = new AMap.Marker({
      position: lnglat,
      content: '<div class="pick-dot"></div>',
      anchor: 'center',
      zIndex: 130,
    });
    map.add(pickMarker);
  }

  function clearPickMarker() {
    if (pickMarker) {
      map.remove(pickMarker);
      pickMarker = null;
    }
  }

  return { map, setPlaces, openInfo, closeInfo, focus, setPickMode, searchPois, reverseGeocode, showPickMarker, clearPickMarker };
}
