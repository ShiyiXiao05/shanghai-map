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
    await pool.query(
      'ALTER TABLE public.places ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE'
    );
    await pool.query(
      "ALTER TABLE public.places ADD COLUMN IF NOT EXISTS price_hint TEXT NOT NULL DEFAULT ''"
    );
    await pool.query(
      "ALTER TABLE public.places ADD COLUMN IF NOT EXISTS hours TEXT NOT NULL DEFAULT ''"
    );
    await pool.query(
      "ALTER TABLE public.places ADD COLUMN IF NOT EXISTS tags TEXT NOT NULL DEFAULT ''"
    );
    await pool.query('ALTER TABLE public.places ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        map_code TEXT NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        who TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(
      'CREATE INDEX IF NOT EXISTS idx_push_map ON push_subscriptions (map_code)'
    );
    await pool.query(
      'CREATE INDEX IF NOT EXISTS idx_places_public ON public.places (is_public) WHERE is_public'
    );
    await pool.query(`
      CREATE TABLE IF NOT EXISTS place_photos (
        id SERIAL PRIMARY KEY,
        place_id INTEGER NOT NULL,
        map_code TEXT NOT NULL,
        mime TEXT NOT NULL,
        full_b64 TEXT NOT NULL DEFAULT '',
        thumb_b64 TEXT NOT NULL DEFAULT '',
        public_id TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        thumb_url TEXT NOT NULL DEFAULT '',
        added_by TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(
      "ALTER TABLE place_photos ADD COLUMN IF NOT EXISTS full_b64 TEXT NOT NULL DEFAULT ''"
    );
    await pool.query(
      "ALTER TABLE place_photos ADD COLUMN IF NOT EXISTS thumb_b64 TEXT NOT NULL DEFAULT ''"
    );
    await pool.query(
      "ALTER TABLE place_photos ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ''"
    );
    await pool.query(
      "ALTER TABLE place_photos ADD COLUMN IF NOT EXISTS url TEXT NOT NULL DEFAULT ''"
    );
    await pool.query(
      "ALTER TABLE place_photos ADD COLUMN IF NOT EXISTS thumb_url TEXT NOT NULL DEFAULT ''"
    );
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        openid TEXT PRIMARY KEY,
        nickname TEXT NOT NULL DEFAULT '',
        avatar_url TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS itinerary_stops (
        id SERIAL PRIMARY KEY,
        map_code TEXT NOT NULL,
        place_id INTEGER NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_itinerary_map_place ON itinerary_stops (map_code, place_id)'
    );
    await pool.query(
      'CREATE INDEX IF NOT EXISTS idx_itinerary_map_pos ON itinerary_stops (map_code, position)'
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

  async function renameMap(code, name) {
    const { rows } = await pool.query(
      'UPDATE maps SET name = $2 WHERE code = $1 RETURNING code, name, created_by',
      [code, name]
    );
    return rows[0] ?? null;
  }

  // 换邀请码（权限重置）：子表 map_code 一并迁移；唯一冲突时迁回旧码并重试
  async function rekeyMap(code) {
    const CHILD_TABLES = ['public.places', 'place_photos', 'place_comments', 'place_wishes'];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const newCode = generateMapCode();
      if (newCode === code) continue;
      try {
        for (const table of CHILD_TABLES) {
          await pool.query(`UPDATE ${table} SET map_code = $1 WHERE map_code = $2`, [
            newCode,
            code,
          ]);
        }
        const { rows } = await pool.query(
          'UPDATE maps SET code = $1 WHERE code = $2 RETURNING code, name, created_by',
          [newCode, code]
        );
        if (rows[0]) return rows[0];
        return null; // 地图不存在
      } catch (err) {
        // 新码撞唯一约束：把子表迁回旧码后重试
        for (const table of CHILD_TABLES) {
          await pool.query(`UPDATE ${table} SET map_code = $1 WHERE map_code = $2`, [
            code,
            newCode,
          ]);
        }
        if (attempt === 4) throw err;
      }
    }
    throw new Error('邀请码生成失败，请重试');
  }

  async function deleteMap(code) {
    const { rows } = await pool.query('DELETE FROM maps WHERE code = $1 RETURNING code', [code]);
    if (rows.length === 0) return false;
    const photoRows = await pool.query(
      'DELETE FROM place_photos WHERE map_code = $1 RETURNING public_id',
      [code]
    );
    await pool.query('DELETE FROM public.places WHERE map_code = $1', [code]);
    await pool.query('DELETE FROM place_comments WHERE map_code = $1', [code]);
    await pool.query('DELETE FROM place_wishes WHERE map_code = $1', [code]);
    await pool.query('DELETE FROM itinerary_stops WHERE map_code = $1', [code]);
    await pool.query('DELETE FROM push_subscriptions WHERE map_code = $1', [code]);
    photoCache.clear();
    return { photoPublicIds: photoRows.rows.map((r) => r.public_id).filter(Boolean) };
  }

  // ---------- Web Push 订阅 ----------

  async function saveSubscription({ mapCode, endpoint, p256dh, auth, who }) {
    await pool.query(
      `INSERT INTO push_subscriptions (map_code, endpoint, p256dh, auth, who)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE SET map_code = $1, p256dh = $3, auth = $4, who = $5`,
      [mapCode, endpoint, p256dh, auth, who ?? '']
    );
  }

  async function removeSubscription(endpoint) {
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
  }

  async function listSubscriptions(mapCode) {
    const { rows } = await pool.query(
      'SELECT endpoint, p256dh, auth, who FROM push_subscriptions WHERE map_code = $1',
      [mapCode]
    );
    return rows;
  }

  // ---------- 小程序登录用户 ----------

  async function getUser(openid) {
    const { rows } = await pool.query('SELECT openid, nickname FROM users WHERE openid = $1', [
      openid,
    ]);
    return rows[0] ?? null;
  }

  // 登录即建档（幂等）：已有用户返回现昵称，新用户昵称为空待补填
  async function ensureUser(openid) {
    const inserted = await pool.query(
      `INSERT INTO users (openid) VALUES ($1)
       ON CONFLICT (openid) DO NOTHING RETURNING openid, nickname`,
      [openid]
    );
    if (inserted.rows[0]) return inserted.rows[0];
    return getUser(openid);
  }

  async function setNickname(openid, nickname) {
    const { rows } = await pool.query(
      'UPDATE users SET nickname = $2, updated_at = now() WHERE openid = $1 RETURNING openid, nickname',
      [openid, nickname]
    );
    return rows[0] ?? null;
  }

  // 全量导出：map 元信息 + 每个地点（含新字段）的照片链接/留言/想去
  async function exportMap(code) {
    const map = await getMapByCode(code);
    if (!map) return null;
    const [placeRows, photoRows, commentRows, wishRows] = await Promise.all([
      pool.query(
        `SELECT id, name, description, category, lng, lat, address, added_by,
                visited, is_public, price_hint, hours, tags, created_at, visited_at
         FROM public.places WHERE map_code = $1 AND deleted_at IS NULL ORDER BY id ASC`,
        [code]
      ),
      pool.query(
        `SELECT id, place_id, url, thumb_url, added_by, created_at
         FROM place_photos WHERE map_code = $1 ORDER BY id ASC`,
        [code]
      ),
      pool.query(
        'SELECT id, place_id, author, body, created_at FROM place_comments WHERE map_code = $1 ORDER BY id ASC',
        [code]
      ),
      pool.query(
        'SELECT place_id, who FROM place_wishes WHERE map_code = $1 ORDER BY id ASC',
        [code]
      ),
    ]);
    const byPlace = (rows, key = 'place_id') => {
      const map = new Map();
      for (const row of rows) {
        const list = map.get(row[key]) ?? [];
        list.push(row);
        map.set(row[key], list);
      }
      return map;
    };
    const photosBy = byPlace(photoRows.rows);
    const commentsBy = byPlace(commentRows.rows);
    const wishesBy = byPlace(wishRows.rows);
    return {
      map: { ...map, exported_at: new Date().toISOString() },
      places: placeRows.rows.map((row) => ({
        ...row,
        photos: (photosBy.get(row.id) ?? []).map((p) => ({
          id: p.id,
          url: p.url,
          thumb_url: p.thumb_url,
          added_by: p.added_by,
          created_at: p.created_at,
        })),
        comments: (commentsBy.get(row.id) ?? []).map((c) => ({
          id: c.id,
          author: c.author,
          body: c.body,
          created_at: c.created_at,
        })),
        wishes: (wishesBy.get(row.id) ?? []).map((w) => w.who),
      })),
    };
  }

  async function listPlaces(mapCode) {
    const { rows } = await pool.query(
      'SELECT * FROM public.places WHERE map_code = $1 AND deleted_at IS NULL ORDER BY created_at DESC, id DESC',
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
         (name, description, category, lng, lat, address, added_by, visited,
          map_code, price_hint, hours, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
        data.price_hint ?? '',
        data.hours ?? '',
        data.tags ?? '',
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
         price_hint = COALESCE($9, price_hint),
         hours = COALESCE($10, hours),
         tags = COALESCE($11, tags),
         updated_at = now()
       WHERE id = $12 AND map_code = $13 AND deleted_at IS NULL
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
        provided('price_hint'),
        provided('hours'),
        provided('tags'),
        id,
        mapCode,
      ]
    );
    return rows[0] ?? null;
  }

  // 软删除：地点进回收站，30 天内可恢复（照片/留言/想去原样保留，CDN 不动）
  async function remove(id, mapCode) {
    const { rows } = await pool.query(
      `UPDATE public.places SET deleted_at = now(), is_public = FALSE, updated_at = now()
       WHERE id = $1 AND map_code = $2 AND deleted_at IS NULL RETURNING id`,
      [id, mapCode]
    );
    return rows.length > 0;
  }

  // 回收站列表（最近删除的在前）
  async function listTrash(mapCode) {
    const { rows } = await pool.query(
      'SELECT * FROM public.places WHERE map_code = $1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC, id DESC',
      [mapCode]
    );
    return rows;
  }

  // 恢复：清空 deleted_at，连带行程/照片/留言全部回来
  async function restorePlace(id, mapCode) {
    const { rows } = await pool.query(
      `UPDATE public.places SET deleted_at = NULL, updated_at = now()
       WHERE id = $1 AND map_code = $2 AND deleted_at IS NOT NULL RETURNING *`,
      [id, mapCode]
    );
    return rows[0] ?? null;
  }

  // 彻底清理软删超 30 天的地点（打开回收站时惰性触发），返回待销毁的 CDN public_id
  async function purgeExpired(mapCode) {
    const expired = await pool.query(
      'SELECT id FROM public.places WHERE map_code = $1 AND deleted_at IS NOT NULL AND deleted_at < now() - interval \'30 days\'',
      [mapCode]
    );
    const publicIds = [];
    for (const row of expired.rows) {
      const id = Number(row.id);
      const photoRows = await pool.query(
        'DELETE FROM place_photos WHERE place_id = $1 AND map_code = $2 RETURNING public_id',
        [id, mapCode]
      );
      publicIds.push(...photoRows.rows.map((r) => r.public_id).filter(Boolean));
      await pool.query('DELETE FROM place_comments WHERE place_id = $1 AND map_code = $2', [id, mapCode]);
      await pool.query('DELETE FROM place_wishes WHERE place_id = $1 AND map_code = $2', [id, mapCode]);
      await pool.query('DELETE FROM itinerary_stops WHERE place_id = $1 AND map_code = $2', [id, mapCode]);
      await pool.query('DELETE FROM public.places WHERE id = $1 AND map_code = $2', [id, mapCode]);
    }
    if (expired.rows.length > 0) photoCache.clear();
    return publicIds;
  }

  // 行程单：按 position 顺序返回站点（JOIN 过滤掉已删除的地点）
  async function listItinerary(mapCode) {
    const { rows } = await pool.query(
      `SELECT s.place_id AS id, s.position, p.name, p.category, p.lng, p.lat,
              p.address, p.visited
       FROM itinerary_stops s
       JOIN public.places p ON p.id = s.place_id AND p.map_code = s.map_code AND p.deleted_at IS NULL
       WHERE s.map_code = $1
       ORDER BY s.position, s.place_id`,
      [mapCode]
    );
    return rows;
  }

  // 全量替换式保存：place_ids 的新顺序即最终顺序；不属本地图或重复的 id 静默丢弃
  async function setItinerary(mapCode, placeIds) {
    const seen = new Set();
    const ordered = [];
    for (const raw of placeIds) {
      if (!seen.has(raw)) {
        seen.add(raw);
        ordered.push(raw);
      }
    }
    let valid = new Set();
    if (ordered.length > 0) {
      // 不用 ANY($2::int[])：pg-mem 对数组参数的 cast 匹配不上；IN + 纯占位符两端都稳
      const placeholders = ordered.map((_, i) => `$${i + 2}`).join(', ');
      const { rows } = await pool.query(
        `SELECT id FROM public.places WHERE map_code = $1 AND deleted_at IS NULL AND id IN (${placeholders})`,
        [mapCode, ...ordered]
      );
      // pg-mem 会把整数列按字符串返回，统一 Number 规避双端差异
      valid = new Set(rows.map((r) => Number(r.id)));
    }
    await pool.query('DELETE FROM itinerary_stops WHERE map_code = $1', [mapCode]);
    let position = 0;
    for (const id of ordered) {
      if (!valid.has(id)) continue;
      position += 1;
      await pool.query(
        'INSERT INTO itinerary_stops (map_code, place_id, position) VALUES ($1, $2, $3)',
        [mapCode, id, position]
      );
    }
    return listItinerary(mapCode);
  }

  async function getPlace(id, mapCode) {
    const { rows } = await pool.query(
      'SELECT * FROM public.places WHERE id = $1 AND map_code = $2 AND deleted_at IS NULL',
      [id, mapCode]
    );
    return rows[0] ?? null;
  }

  async function listPhotos(placeId, mapCode) {
    const { rows } = await pool.query(
      `SELECT id, mime, thumb_b64, thumb_url, url, added_by, created_at
       FROM place_photos WHERE place_id = $1 AND map_code = $2 ORDER BY id ASC`,
      [placeId, mapCode]
    );
    return rows.map(({ thumb_b64, thumb_url, url, mime, ...rest }) => ({
      ...rest,
      thumb: thumb_url || `data:${mime};base64,${thumb_b64}`,
      // CDN 原图直链：小程序大图预览直接走 Cloudinary，不依赖后端域名；存量 DB 照片为 null
      full: url || null,
    }));
  }

  async function countPhotos(placeId, mapCode) {
    const { rows } = await pool.query(
      'SELECT count(*) AS n FROM place_photos WHERE place_id = $1 AND map_code = $2',
      [placeId, mapCode]
    );
    return Number(rows[0].n);
  }

  async function createPhoto({ placeId, mapCode, mime, fullB64, thumbB64, addedBy, publicId, url, thumbUrl }) {
    const { rows } = await pool.query(
      `INSERT INTO place_photos
         (place_id, map_code, mime, full_b64, thumb_b64, public_id, url, thumb_url, added_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        placeId,
        mapCode,
        mime,
        fullB64 ?? '',
        thumbB64 ?? '',
        publicId ?? '',
        url ?? '',
        thumbUrl ?? '',
        addedBy ?? '',
      ]
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
    // 软删除的地点照片不可访问（随地点一起进回收站）
    const { rows } = await pool.query(
      `SELECT ph.mime, ph.full_b64, ph.url
       FROM place_photos ph
       JOIN public.places pl ON pl.id = ph.place_id AND pl.map_code = ph.map_code
       WHERE ph.id = $1 AND ph.map_code = $2 AND pl.deleted_at IS NULL`,
      [id, mapCode]
    );
    if (!rows[0]) return null;
    const entry = rows[0].url
      ? { url: rows[0].url }
      : { mime: rows[0].mime, buf: Buffer.from(rows[0].full_b64, 'base64') };
    cachePut(key, entry);
    return entry;
  }

  async function removePhoto(id, mapCode) {
    const { rows } = await pool.query(
      'DELETE FROM place_photos WHERE id = $1 AND map_code = $2 RETURNING id, public_id',
      [id, mapCode]
    );
    if (rows.length > 0) photoCache.delete(`${id}:${mapCode}`);
    return rows[0] ?? null;
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
    // 软删除的地点留言不可操作
    const { rows } = await pool.query(
      `DELETE FROM place_comments
       WHERE id = $1 AND map_code = $2
         AND place_id IN (SELECT id FROM public.places WHERE map_code = $2 AND deleted_at IS NULL)
       RETURNING id`,
      [id, mapCode]
    );
    return rows.length > 0;
  }

  // 公共广场：所有勾选公开的地点聚合。绝不返回 map_code，避免泄露各地图邀请码
  async function listPublicPlaces() {
    const { rows } = await pool.query(
      `SELECT id, name, description, category, lng, lat, address, added_by,
              visited, created_at, updated_at, visited_at, is_public
       FROM public.places
       WHERE is_public = TRUE AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC`
    );
    if (rows.length === 0) return [];
    const [photoRows, commentRows, wishRows] = await Promise.all([
      pool.query('SELECT place_id, count(*) AS n FROM place_photos GROUP BY place_id'),
      pool.query('SELECT place_id, count(*) AS n FROM place_comments GROUP BY place_id'),
      pool.query('SELECT place_id, who FROM place_wishes ORDER BY id ASC'),
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

  async function togglePublic(id, mapCode) {
    const { rows } = await pool.query(
      `UPDATE public.places SET is_public = NOT is_public, updated_at = now()
       WHERE id = $1 AND map_code = $2 AND deleted_at IS NULL RETURNING is_public`,
      [id, mapCode]
    );
    return rows[0] ?? null;
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
       WHERE map_code = $1 AND visited = TRUE AND deleted_at IS NULL`,
      [mapCode]
    );
    if (rows.length === 0) return [];
    const photos = await pool.query(
      'SELECT place_id, thumb_url, thumb_b64, mime FROM place_photos WHERE map_code = $1 ORDER BY id ASC',
      [mapCode]
    );
    const thumbsByPlace = new Map();
    for (const row of photos.rows) {
      const list = thumbsByPlace.get(row.place_id) ?? [];
      if (list.length < 3) {
        list.push(row.thumb_url || `data:${row.mime};base64,${row.thumb_b64}`);
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
    renameMap,
    rekeyMap,
    deleteMap,
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
    listPublicPlaces,
    togglePublic,
    listItinerary,
    setItinerary,
    exportMap,
    listTrash,
    restorePlace,
    purgeExpired,
    saveSubscription,
    removeSubscription,
    listSubscriptions,
    getUser,
    ensureUser,
    setNickname,
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
