import crypto from 'node:crypto';
import pg from 'pg';
import './env.js';

export const CATEGORIES = ['景点', '美食', '展馆', '购物', '娱乐', '其他'];

// 去掉易混淆字符（0/O、1/I）的邀请码字母表
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateMapCode() {
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

export function createPlaceStore(pool) {
  async function init() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS maps (
        id SERIAL PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_by TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.places (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL,
        lng DOUBLE PRECISION NOT NULL,
        lat DOUBLE PRECISION NOT NULL,
        address TEXT NOT NULL DEFAULT '',
        added_by TEXT NOT NULL DEFAULT '',
        visited BOOLEAN NOT NULL DEFAULT FALSE,
        map_code TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        visited_at TIMESTAMPTZ
      )
    `);
    await pool.query(
      'ALTER TABLE public.places ADD COLUMN IF NOT EXISTS map_code TEXT NOT NULL'
    );
    await pool.query(
      'ALTER TABLE public.places ADD COLUMN IF NOT EXISTS visited_at TIMESTAMPTZ'
    );
    await pool.query(`
      CREATE TABLE IF NOT EXISTS place_photos (
        id SERIAL PRIMARY KEY,
        place_id INTEGER NOT NULL,
        map_code TEXT NOT NULL,
        mime TEXT NOT NULL,
        full_b64 TEXT NOT NULL,
        thumb_b64 TEXT NOT NULL,
        added_by TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS place_comments (
        id SERIAL PRIMARY KEY,
        place_id INTEGER NOT NULL,
        map_code TEXT NOT NULL,
        author TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS place_wishes (
        id SERIAL PRIMARY KEY,
        place_id INTEGER NOT NULL,
        map_code TEXT NOT NULL,
        who TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_wishes_place_who ON place_wishes (place_id, who)'
    );
    await pool.query(
      'CREATE INDEX IF NOT EXISTS idx_places_map_created ON public.places (map_code, created_at DESC)'
    );
    await pool.query(
      'CREATE INDEX IF NOT EXISTS idx_photos_place ON place_photos (place_id)'
    );
    await pool.query(
      'CREATE INDEX IF NOT EXISTS idx_comments_place ON place_comments (place_id)'
    );
    await pool.query(
      'CREATE INDEX IF NOT EXISTS idx_wishes_place ON place_wishes (place_id)'
    );
  }

  async function createMap({ name, createdBy }) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateMapCode();
      const { rows } = await pool.query(
        `INSERT INTO maps (code, name, created_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (code) DO NOTHING
         RETURNING code, name, created_by`,
        [code, name, createdBy ?? '']
      );
      if (rows[0]) return rows[0];
    }
    throw new Error('邀请码生成失败，请重试');
  }

  async function getMapByCode(code) {
    const { rows } = await pool.query('SELECT code, name, created_by FROM maps WHERE code = $1', [
      code,
    ]);
    return rows[0] ?? null;
  }

  async function listPlaces(mapCode) {
    const { rows } = await pool.query(
      'SELECT * FROM public.places WHERE map_code = $1 ORDER BY created_at DESC, id DESC',
      [mapCode]
    );
    if (rows.length === 0) return [];
    // 分组计数后内存合并，避免在每行上做关联子查询
    const [photoRows, commentRows, wishRows] = await Promise.all([
      pool.query(
        'SELECT place_id, count(*) AS n FROM place_photos WHERE map_code = $1 GROUP BY place_id',
        [mapCode]
      ),
      pool.query(
        'SELECT place_id, count(*) AS n FROM place_comments WHERE map_code = $1 GROUP BY place_id',
        [mapCode]
      ),
      pool.query('SELECT place_id, who FROM place_wishes WHERE map_code = $1 ORDER BY id ASC', [
        mapCode,
      ]),
    ]);
    const photoCounts = new Map(photoRows.rows.map((r) => [r.place_id, Number(r.n)]));
    const commentCounts = new Map(commentRows.rows.map((r) => [r.place_id, Number(r.n)]));
    const wishesByPlace = new Map();
    for (const row of wishRows.rows) {
      const list = wishesByPlace.get(row.place_id) ?? [];
      list.push(row.who);
      wishesByPlace.set(row.place_id, list);
    }
    return rows.map((row) => ({
      ...row,
      photo_count: photoCounts.get(row.id) ?? 0,
      comment_count: commentCounts.get(row.id) ?? 0,
      wishes: wishesByPlace.get(row.id) ?? [],
    }));
  }

  async function create(data) {
    const { rows } = await pool.query(
      `INSERT INTO public.places
         (name, description, category, lng, lat, address, added_by, visited, map_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        data.name,
        data.description ?? '',
        data.category,
        data.lng,
        data.lat,
        data.address ?? '',
        data.added_by ?? '',
        data.visited ?? false,
        data.map_code,
      ]
    );
    return rows[0];
  }

  async function update(id, mapCode, patch) {
    const provided = (key) => (patch[key] === undefined ? null : patch[key]);
    const { rows } = await pool.query(
      `UPDATE public.places SET
         name = COALESCE($1, name),
         description = COALESCE($2, description),
         category = COALESCE($3, category),
         lng = COALESCE($4, lng),
         lat = COALESCE($5, lat),
         address = COALESCE($6, address),
         added_by = COALESCE($7, added_by),
         visited = COALESCE($8, visited),
         visited_at = CASE
           WHEN COALESCE($8, visited) THEN COALESCE(visited_at, now())
           ELSE NULL
         END,
         updated_at = now()
       WHERE id = $9 AND map_code = $10
       RETURNING *`,
      [
        provided('name'),
        provided('description'),
        provided('category'),
        provided('lng'),
        provided('lat'),
        provided('address'),
        provided('added_by'),
        provided('visited'),
        id,
        mapCode,
      ]
    );
    return rows[0] ?? null;
  }

  async function remove(id, mapCode) {
    const { rows } = await pool.query(
      'DELETE FROM public.places WHERE id = $1 AND map_code = $2 RETURNING id',
      [id, mapCode]
    );
    if (rows.length === 0) return false;
    await pool.query('DELETE FROM place_photos WHERE place_id = $1 AND map_code = $2', [
      id,
      mapCode,
    ]);
    await pool.query('DELETE FROM place_comments WHERE place_id = $1 AND map_code = $2', [
      id,
      mapCode,
    ]);
    await pool.query('DELETE FROM place_wishes WHERE place_id = $1 AND map_code = $2', [
      id,
      mapCode,
    ]);
    photoCache.clear(); // 级联删除绕过了 removePhoto，直接整表清空最稳妥
    return true;
  }

  async function getPlace(id, mapCode) {
    const { rows } = await pool.query(
      'SELECT * FROM public.places WHERE id = $1 AND map_code = $2',
      [id, mapCode]
    );
    return rows[0] ?? null;
  }

  async function listPhotos(placeId, mapCode) {
    const { rows } = await pool.query(
      'SELECT id, mime, thumb_b64, added_by, created_at FROM place_photos WHERE place_id = $1 AND map_code = $2 ORDER BY id ASC',
      [placeId, mapCode]
    );
    return rows.map(({ thumb_b64, mime, ...rest }) => ({
      ...rest,
      thumb: `data:${mime};base64,${thumb_b64}`,
    }));
  }

  async function countPhotos(placeId, mapCode) {
    const { rows } = await pool.query(
      'SELECT count(*) AS n FROM place_photos WHERE place_id = $1 AND map_code = $2',
      [placeId, mapCode]
    );
    return Number(rows[0].n);
  }

  async function createPhoto({ placeId, mapCode, mime, fullB64, thumbB64, addedBy }) {
    const { rows } = await pool.query(
      `INSERT INTO place_photos (place_id, map_code, mime, full_b64, thumb_b64, added_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [placeId, mapCode, mime, fullB64, thumbB64, addedBy ?? '']
    );
    return rows[0];
  }

  // 原图内容不可变，进程内 LRU；键含邀请码，避免绕过鉴权直接命中
  const photoCache = new Map();
  const PHOTO_CACHE_MAX = 200;

  function cacheGet(key) {
    if (!photoCache.has(key)) return null;
    const entry = photoCache.get(key);
    photoCache.delete(key);
    photoCache.set(key, entry); // 重新插入到最新位置
    return entry;
  }

  function cachePut(key, entry) {
    if (photoCache.has(key)) photoCache.delete(key);
    photoCache.set(key, entry);
    if (photoCache.size > PHOTO_CACHE_MAX) {
      photoCache.delete(photoCache.keys().next().value);
    }
  }

  async function getPhoto(id, mapCode) {
    const key = `${id}:${mapCode}`;
    const cached = cacheGet(key);
    if (cached) return cached;
    const { rows } = await pool.query(
      'SELECT mime, full_b64 FROM place_photos WHERE id = $1 AND map_code = $2',
      [id, mapCode]
    );
    if (!rows[0]) return null;
    const entry = { mime: rows[0].mime, buf: Buffer.from(rows[0].full_b64, 'base64') };
    cachePut(key, entry);
    return entry;
  }

  async function removePhoto(id, mapCode) {
    const { rows } = await pool.query(
      'DELETE FROM place_photos WHERE id = $1 AND map_code = $2 RETURNING id',
      [id, mapCode]
    );
    if (rows.length > 0) photoCache.delete(`${id}:${mapCode}`);
    return rows.length > 0;
  }

  async function listComments(placeId, mapCode) {
    const { rows } = await pool.query(
      'SELECT id, author, body, created_at FROM place_comments WHERE place_id = $1 AND map_code = $2 ORDER BY created_at ASC, id ASC',
      [placeId, mapCode]
    );
    return rows;
  }

  async function createComment({ placeId, mapCode, author, body }) {
    const { rows } = await pool.query(
      `INSERT INTO place_comments (place_id, map_code, author, body)
       VALUES ($1, $2, $3, $4) RETURNING id, author, body, created_at`,
      [placeId, mapCode, author ?? '', body]
    );
    return rows[0];
  }

  async function removeComment(id, mapCode) {
    const { rows } = await pool.query(
      'DELETE FROM place_comments WHERE id = $1 AND map_code = $2 RETURNING id',
      [id, mapCode]
    );
    return rows.length > 0;
  }

  async function toggleWish(placeId, mapCode, who) {
    const del = await pool.query(
      'DELETE FROM place_wishes WHERE place_id = $1 AND map_code = $2 AND who = $3 RETURNING id',
      [placeId, mapCode, who]
    );
    if (del.rows.length > 0) return { wished: false };
    await pool.query(
      'INSERT INTO place_wishes (place_id, map_code, who) VALUES ($1, $2, $3)',
      [placeId, mapCode, who]
    );
    return { wished: true };
  }

  async function listWishes(placeId, mapCode) {
    const { rows } = await pool.query(
      'SELECT who FROM place_wishes WHERE place_id = $1 AND map_code = $2 ORDER BY id ASC',
      [placeId, mapCode]
    );
    return rows.map((r) => r.who);
  }

  async function listMemories(mapCode) {
    const { rows } = await pool.query(
      `SELECT id, name, category, added_by, address, visited_at
       FROM public.places
       WHERE map_code = $1 AND visited = TRUE`,
      [mapCode]
    );
    if (rows.length === 0) return [];
    const photos = await pool.query(
      'SELECT place_id, mime, thumb_b64 FROM place_photos WHERE map_code = $1 ORDER BY id ASC',
      [mapCode]
    );
    const thumbsByPlace = new Map();
    for (const row of photos.rows) {
      const list = thumbsByPlace.get(row.place_id) ?? [];
      if (list.length < 3) {
        list.push(`data:${row.mime};base64,${row.thumb_b64}`);
        thumbsByPlace.set(row.place_id, list);
      }
    }
    const memories = rows.map((row) => ({
      ...row,
      photos: thumbsByPlace.get(row.id) ?? [],
    }));
    // visited_at 为空的旧数据排在最后；pg-mem 返回 Date 对象，须用 getTime 保留毫秒
    const ts = (v) => (v instanceof Date ? v.getTime() : v ? Date.parse(v) : 0);
    memories.sort((a, b) => ts(b.visited_at) - ts(a.visited_at));
    return memories;
  }

  return {
    init,
    createMap,
    getMapByCode,
    listPlaces,
    create,
    update,
    remove,
    getPlace,
    listPhotos,
    countPhotos,
    createPhoto,
    getPhoto,
    removePhoto,
    listComments,
    createComment,
    removeComment,
    toggleWish,
    listWishes,
    listMemories,
  };
}

function createProductionStore() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  const needsSsl = /sslmode=require|\.neon\.tech/.test(connectionString);
  const pool = new pg.Pool({
    connectionString,
    ...(needsSsl ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  return createPlaceStore(pool);
}

export const placeStore = createProductionStore();
