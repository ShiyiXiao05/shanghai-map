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

export function createPlaceStore(pool, { generateCode = generateMapCode } = {}) {
  // 轻量探针：/api/ready 用它区分"进程活着"与"数据库可用"
  // 记录一次服务端错误/失败请求（尽力而为：自身失败只打日志，绝不影响请求处理）
  async function recordServerError({ ref, method, path, status, message, detail } = {}) {
    try {
      await pool.query(
        `INSERT INTO server_errors (ref, method, path, status, message, detail)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          String(ref ?? '').slice(0, 20),
          String(method ?? '').slice(0, 10),
          String(path ?? '').slice(0, 300),
          Number(status) || 0,
          String(message ?? '').slice(0, 500),
          String(detail ?? '').slice(0, 4000),
        ]
      );
      // 顺手清理：只留最近 300 条
      await pool.query(
        'DELETE FROM server_errors WHERE id < (SELECT COALESCE(MAX(id), 0) - 300 FROM server_errors)'
      );
    } catch (err) {
      console.warn('[store] 错误落库失败：', err?.message ?? err);
    }
  }

  async function ping() {
    await pool.query('SELECT 1');
  }

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
    await pool.query("ALTER TABLE public.places ADD COLUMN IF NOT EXISTS emoji TEXT NOT NULL DEFAULT ''");
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
    // 内容举报（UGC 平台的处置入口）：owner 凭邀请码查看与处理
    await pool.query(`
      CREATE TABLE IF NOT EXISTS content_reports (
        id SERIAL PRIMARY KEY,
        target_type TEXT NOT NULL,
        target_id INTEGER NOT NULL,
        map_code TEXT NOT NULL,
        reason TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        reporter TEXT NOT NULL DEFAULT '',
        openid TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        resolved_at TIMESTAMPTZ
      )
    `);
    await pool.query(
      'CREATE INDEX IF NOT EXISTS idx_reports_map ON content_reports (map_code, status)'
    );
    // 照片审核状态：none=未送审 / pending=审核中 / pass=通过 / risky=违规（列表隐藏）
    await pool.query(
      "ALTER TABLE place_photos ADD COLUMN IF NOT EXISTS moderation TEXT NOT NULL DEFAULT 'none'"
    );
    await pool.query(
      "ALTER TABLE place_photos ADD COLUMN IF NOT EXISTS trace_id TEXT NOT NULL DEFAULT ''"
    );
    await pool.query(
      'CREATE INDEX IF NOT EXISTS idx_photos_trace ON place_photos (trace_id)'
    );
    // 服务端错误落库（诊断用）：云托管控制台不便查看时，可直接查这张表定位线上问题。
    // 只保留最近 300 条，避免无限增长。
    await pool.query(`
      CREATE TABLE IF NOT EXISTS server_errors (
        id SERIAL PRIMARY KEY,
        ref TEXT NOT NULL DEFAULT '',
        method TEXT NOT NULL DEFAULT '',
        path TEXT NOT NULL DEFAULT '',
        status INTEGER NOT NULL DEFAULT 0,
        message TEXT NOT NULL DEFAULT '',
        detail TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // 审核结果暂存：微信回调可能早于 trace_id 落库，先存这里，等照片写入后再补关联
    await pool.query(`
      CREATE TABLE IF NOT EXISTS media_check_results (
        trace_id TEXT PRIMARY KEY,
        moderation TEXT NOT NULL,
        raw TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
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
    // 迁移清单：行程/推送订阅/举报都必须跟着走，否则换码后行程丢失、旧码仍能收到通知
    const CHILD_TABLES = [
      'public.places',
      'place_photos',
      'place_comments',
      'place_wishes',
      'itinerary_stops',
      'push_subscriptions',
      'content_reports',
    ];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const newCode = generateCode();
      if (newCode === code) continue;
      try {
        // 顺序很关键：先改主表。maps.code 的唯一约束就是"抢占新码"的原子锁——
        // 若新码已属于地图 B，这一步直接失败，此时子表一根都没动。
        // （旧写法先迁子表：一旦撞上 B 的码，补偿回迁会把 B 的子表记录也搬到 A，
        //   造成跨地图数据污染，见二次复核 P1-2）
        const { rows } = await pool.query(
          'UPDATE maps SET code = $1 WHERE code = $2 RETURNING code, name, created_by',
          [newCode, code]
        );
        if (!rows[0]) return null; // 地图不存在

        const migrated = [];
        try {
          for (const table of CHILD_TABLES) {
            await pool.query(`UPDATE ${table} SET map_code = $1 WHERE map_code = $2`, [
              newCode,
              code,
            ]);
            migrated.push(table);
          }
        } catch (childErr) {
          // 主表已改成功 ⇒ 新码此刻被本图独占，回迁只会影响本次迁移的行，安全
          for (const table of migrated) {
            await pool.query(`UPDATE ${table} SET map_code = $1 WHERE map_code = $2`, [
              code,
              newCode,
            ]).catch(() => {});
          }
          await pool
            .query('UPDATE maps SET code = $1 WHERE code = $2', [code, newCode])
            .catch(() => {});
          throw childErr;
        }
        // 照片缓存的键含邀请码：换码后旧键必须失效，否则旧码仍能读到照片
        cacheClear();
        return rows[0];
      } catch (err) {
        if (attempt === 4) throw err; // 换个码重试
      }
    }
    throw new Error('邀请码生成失败，请重试');
  }

  async function deleteMap(code) {
    // 顺序：先子表、最后 maps。中途失败只会留下"地图还在、部分内容已删"，
    // 不会出现"地图没了、子数据成孤儿"这种更难收拾的状态（无事务可用时的取舍）
    if (!(await getMapByCode(code))) return false;
    const photoRows = await pool.query(
      'DELETE FROM place_photos WHERE map_code = $1 RETURNING public_id',
      [code]
    );
    await pool.query('DELETE FROM public.places WHERE map_code = $1', [code]);
    await pool.query('DELETE FROM place_comments WHERE map_code = $1', [code]);
    await pool.query('DELETE FROM place_wishes WHERE map_code = $1', [code]);
    await pool.query('DELETE FROM itinerary_stops WHERE map_code = $1', [code]);
    await pool.query('DELETE FROM push_subscriptions WHERE map_code = $1', [code]);
    await pool.query('DELETE FROM content_reports WHERE map_code = $1', [code]);
    const { rows } = await pool.query('DELETE FROM maps WHERE code = $1 RETURNING code', [code]);
    cacheClear();
    if (rows.length === 0) return false;
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
                visited, is_public, price_hint, hours, tags, emoji, created_at, visited_at
         FROM public.places WHERE map_code = $1 AND deleted_at IS NULL ORDER BY id ASC`,
        [code]
      ),
      pool.query(
        `SELECT id, place_id, url, thumb_url, full_b64, added_by, created_at
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
      itinerary: await listItinerary(code),
      places: placeRows.rows.map((row) => ({
        ...row,
        photos: (photosBy.get(row.id) ?? []).map((p) => ({
          id: p.id,
          url: p.url,
          thumb_url: p.thumb_url,
          // 未走 CDN 的照片只存在数据库里：导出带上内容，否则备份无法还原图片
          content_b64: p.url ? '' : p.full_b64 || '',
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
        `SELECT place_id, count(*) AS n FROM place_photos
         WHERE map_code = $1 AND moderation <> 'risky' GROUP BY place_id`,
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

  // 同一张地图内的重复地点检测：**按名称判定**（忽略大小写与首尾空格）。
  //
  // 为什么不用坐标判定：真实数据里相距十几米的两个地点往往是不同的地方
  // （例如「武康大楼」与「酷矿冰淇淋(武康大楼店)」），按坐标拦会误伤正常添加。
  // 而重复添加的典型来源（同一地点被搜两次、粘贴高德分享两次）名称必然相同。
  //
  // 返回 { duplicate, trashed }：duplicate 是仍在图上的同名地点（命中则拒绝新增），
  // trashed 是回收站里的同名条目（用于给用户"可去回收站恢复"的提示）。
  async function findDuplicatePlace(mapCode, { name } = {}) {
    const normalized = String(name ?? '')
      .trim()
      .toLowerCase();
    if (!normalized) return { duplicate: null, trashed: null };
    const { rows } = await pool.query(
      'SELECT id, name, deleted_at FROM public.places WHERE map_code = $1 ORDER BY id ASC',
      [mapCode]
    );
    let duplicate = null;
    let trashed = null;
    for (const row of rows) {
      if (String(row.name ?? '').trim().toLowerCase() !== normalized) continue;
      if (row.deleted_at) {
        trashed = { id: Number(row.id), name: row.name };
        continue;
      }
      if (!duplicate) duplicate = { id: Number(row.id), name: row.name };
    }
    return { duplicate, trashed };
  }

  async function create(data) {
    const { rows } = await pool.query(
      `INSERT INTO public.places
         (name, description, category, lng, lat, address, added_by, visited,
          map_code, price_hint, hours, tags, emoji)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
        data.emoji ?? '',
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
         emoji = COALESCE($14, emoji),
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
        provided('emoji'),
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
    if (rows.length === 0) return false;
    // 软删后照片不应再可读：清掉进程内缓存（缓存键含邀请码，不清就会继续返回 200）
    const photos = await pool.query(
      'SELECT id FROM place_photos WHERE place_id = $1 AND map_code = $2',
      [id, mapCode]
    );
    for (const row of photos.rows) cacheDelete(`${Number(row.id)}:${mapCode}`);
    return true;
  }

  // 回收站列表（最近删除的在前）
  async function listTrash(mapCode) {
    const { rows } = await pool.query(
      'SELECT * FROM public.places WHERE map_code = $1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC, id DESC',
      [mapCode]
    );
    return rows;
  }

  // 恢复：清空 deleted_at，连带行程/照片/留言全部回来。
  // 超过 30 天窗口的软删地点不可恢复，与"打开回收站时惰性彻底清理"的语义保持一致
  async function restorePlace(id, mapCode) {
    const { rows } = await pool.query(
      `UPDATE public.places SET deleted_at = NULL, updated_at = now()
       WHERE id = $1 AND map_code = $2 AND deleted_at IS NOT NULL
         AND deleted_at > now() - interval '30 days'
       RETURNING *`,
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
    if (expired.rows.length > 0) cacheClear();
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
    let valid = [];
    if (ordered.length > 0) {
      // 不用 ANY($2::int[])：pg-mem 对数组参数的 cast 匹配不上；IN + 纯占位符两端都稳
      const placeholders = ordered.map((_, i) => `$${i + 2}`).join(', ');
      const { rows } = await pool.query(
        `SELECT id FROM public.places WHERE map_code = $1 AND deleted_at IS NULL AND id IN (${placeholders})`,
        [mapCode, ...ordered]
      );
      // pg-mem 会把整数列按字符串返回，统一 Number 规避双端差异
      const validSet = new Set(rows.map((r) => Number(r.id)));
      valid = ordered.filter((id) => validSet.has(id));
    }

    // 顺序：先把新顺序逐条 UPSERT，全部成功后再删除不在列表中的站点。
    // 中途失败最坏是"多留了几站/部分站点仍是旧位置"，而不是旧写法那样
    // "先 DELETE 全部、再逐条 INSERT"导致行程被截断（审计 F-11）。
    // 注：不用多行 VALUES + ON CONFLICT —— pg-mem 只保留最后一行，会让本地测试失真。
    if (valid.length > 0) {
      for (let i = 0; i < valid.length; i += 1) {
        await pool.query(
          `INSERT INTO itinerary_stops (map_code, place_id, position) VALUES ($1, $2, $3)
           ON CONFLICT (map_code, place_id) DO UPDATE SET position = EXCLUDED.position`,
          [mapCode, valid[i], i + 1]
        );
      }
      const keep = valid.map((_, i) => `$${i + 2}`).join(', ');
      await pool.query(
        `DELETE FROM itinerary_stops WHERE map_code = $1 AND place_id NOT IN (${keep})`,
        [mapCode, ...valid]
      );
    } else {
      await pool.query('DELETE FROM itinerary_stops WHERE map_code = $1', [mapCode]);
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
      `SELECT id, mime, thumb_b64, thumb_url, url, full_b64, added_by, created_at
       FROM place_photos
       WHERE place_id = $1 AND map_code = $2 AND moderation <> 'risky'
       ORDER BY id ASC`,
      [placeId, mapCode]
    );
    return rows.map(({ thumb_b64, thumb_url, url, mime, full_b64, ...rest }) => ({
      ...rest,
      // 缩略图缺失（图床上线前的存量数据）时退回原图，但只在小图时内联，避免响应体失控
      thumb:
        thumb_url ||
        (thumb_b64
          ? `data:${mime};base64,${thumb_b64}`
          : canInlineThumb(full_b64)
            ? `data:${mime};base64,${full_b64}`
            : ''),
      // CDN 原图直链：小程序大图预览直接走 Cloudinary，不依赖后端域名；存量 DB 照片为 null
      full: url || null,
    }));
  }

  // 超出上限时按 id 顺序裁掉多出来的照片（幂等、并发安全）。
  // 与"插入后 count 再删自己"的补偿式写法不同：并发场景下所有调用者都会收敛到
  // 同一组"id 最小的 keep 张"，不会互相把对方删掉。返回被删除的行。
  async function trimPhotos(placeId, mapCode, keep) {
    // 只裁剪可见照片：违规照片保持原样（既保留审核证据，也不占用用户配额）
    const { rows } = await pool.query(
      `SELECT id FROM place_photos
       WHERE place_id = $1 AND map_code = $2 AND moderation <> 'risky'
       ORDER BY id ASC LIMIT $3`,
      [placeId, mapCode, keep]
    );
    const keepIds = rows.map((r) => Number(r.id));
    let removed = [];
    if (keepIds.length >= keep) {
      const placeholders = keepIds.map((_, i) => `$${i + 3}`).join(', ');
      const deleted = await pool.query(
        `DELETE FROM place_photos
         WHERE place_id = $1 AND map_code = $2 AND moderation <> 'risky'
           AND id NOT IN (${placeholders})
         RETURNING id, public_id`,
        [placeId, mapCode, ...keepIds]
      );
      removed = deleted.rows;
    }
    // 关键：把"保留集合"一并返回。并发上传时另一路可能已经把本行删掉，
    // 只看 removed 会误判成功（实测会出现两个 201 但实际只剩 9 张）。
    return { removed, keepIds };
  }

  // 计入配额的是"可见照片"：被判违规的照片已隐藏，不该继续占用户的名额
  async function countPhotos(placeId, mapCode) {
    const { rows } = await pool.query(
      `SELECT count(*) AS n FROM place_photos
       WHERE place_id = $1 AND map_code = $2 AND moderation <> 'risky'`,
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

  // 单张缩略图允许内联的上限（base64 长度）：未配图床的存量照片没有缩略图时
  // 只能用原图兜底，但必须限量，否则一次列表就可能撑爆响应体（二次复核 P2-10）
  const MAX_INLINE_THUMB_B64 = Math.ceil((64 * 1024 * 4) / 3);
  const canInlineThumb = (b64) =>
    typeof b64 === 'string' && b64.length > 0 && b64.length <= MAX_INLINE_THUMB_B64;

  // 原图内容不可变，进程内 LRU；键含邀请码，避免绕过鉴权直接命中。
  // 按"字节"计容而不是按条数：单张原图最大 1.5MB，若只限 200 条最坏占约 300MB，
  // 而云托管容器只有 0.5G（审计 F-42）。CDN 直链条目只存一个 URL，按 512B 计。
  const PHOTO_CACHE_MAX_BYTES =
    Number(process.env.PHOTO_CACHE_MAX_BYTES) > 0
      ? Number(process.env.PHOTO_CACHE_MAX_BYTES)
      : 32 * 1024 * 1024;
  // 缓存条目 TTL：兜住"多实例部署时其它实例缓存未失效"的窗口（云托管最多 2 副本）
  const PHOTO_CACHE_TTL_MS =
    Number(process.env.PHOTO_CACHE_TTL_MS) > 0 ? Number(process.env.PHOTO_CACHE_TTL_MS) : 5 * 60 * 1000;
  const photoCache = new Map(); // key -> { entry, size, expireAt }
  let photoCacheBytes = 0;

  function cacheClear() {
    photoCache.clear();
    photoCacheBytes = 0;
  }

  function cacheDelete(key) {
    const item = photoCache.get(key);
    if (!item) return false;
    photoCacheBytes -= item.size;
    photoCache.delete(key);
    return true;
  }

  function cacheGet(key) {
    const item = photoCache.get(key);
    if (!item) return null;
    if (item.expireAt && item.expireAt <= Date.now()) {
      cacheDelete(key); // 过期即视为未命中，重新回源（审核状态可能已变）
      return null;
    }
    photoCache.delete(key);
    photoCache.set(key, item); // 重新插入到最新位置
    return item.entry;
  }

  function cachePut(key, entry) {
    const size = entry.buf ? entry.buf.length : 512;
    cacheDelete(key);
    photoCache.set(key, { entry, size, expireAt: Date.now() + PHOTO_CACHE_TTL_MS });
    photoCacheBytes += size;
    while (photoCacheBytes > PHOTO_CACHE_MAX_BYTES && photoCache.size > 0) {
      const oldestKey = photoCache.keys().next().value;
      cacheDelete(oldestKey);
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
       WHERE ph.id = $1 AND ph.map_code = $2 AND pl.deleted_at IS NULL
         AND ph.moderation <> 'risky'`,
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
    if (rows.length > 0) {
      cacheDelete(`${id}:${mapCode}`);
      // 照片没了，指向它的举报也失去对象：一并清理，避免留下引用已删除内容的记录
      await pool.query(
        "DELETE FROM content_reports WHERE target_type = 'photo' AND target_id = $1 AND map_code = $2",
        [id, mapCode]
      );
    }
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
              visited, created_at, updated_at, visited_at, is_public, emoji
       FROM public.places
       WHERE is_public = TRUE AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC`
    );
    if (rows.length === 0) return [];
    const [photoRows, commentRows, wishRows] = await Promise.all([
      pool.query(
        "SELECT place_id, count(*) AS n FROM place_photos WHERE moderation <> 'risky' GROUP BY place_id"
      ),
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

  // ---------- 内容举报 ----------

  const REPORT_TARGETS = {
    place: { table: 'public.places', placeColumn: 'id' },
    comment: { table: 'place_comments', placeColumn: 'place_id' },
    photo: { table: 'place_photos', placeColumn: 'place_id' },
  };

  // 定位被举报对象所属地图与地点（用于权限判断与通知）
  async function findReportTarget(targetType, targetId) {
    const config = REPORT_TARGETS[targetType];
    if (!config) return null;
    const { rows } = await pool.query(
      `SELECT map_code, ${config.placeColumn} AS place_id FROM ${config.table} WHERE id = $1`,
      [targetId]
    );
    if (!rows[0]) return null;
    return { mapCode: rows[0].map_code, placeId: Number(rows[0].place_id) };
  }

  // 该地点当前是否公开可见（公共广场语境下的举报只允许针对公开内容）
  async function isPlacePublic(placeId) {
    const { rows } = await pool.query(
      'SELECT 1 FROM public.places WHERE id = $1 AND is_public = TRUE AND deleted_at IS NULL',
      [placeId]
    );
    return rows.length > 0;
  }

  async function createReport({
    targetType,
    targetId,
    mapCode,
    reason,
    detail,
    reporter,
    openid,
  }) {
    const { rows } = await pool.query(
      `INSERT INTO content_reports (target_type, target_id, map_code, reason, detail, reporter, openid)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, target_type, target_id, reason, status, created_at`,
      [targetType, targetId, mapCode, reason, detail ?? '', reporter ?? '', openid ?? '']
    );
    return rows[0];
  }

  async function listReports(mapCode, { status = 'open' } = {}) {
    const { rows } = await pool.query(
      `SELECT id, target_type, target_id, reason, detail, reporter, status, created_at
       FROM content_reports
       WHERE map_code = $1 AND ($2 = '' OR status = $2)
       ORDER BY created_at DESC, id DESC`,
      [mapCode, status]
    );
    return rows;
  }

  async function resolveReport(id, mapCode) {
    const { rows } = await pool.query(
      `UPDATE content_reports SET status = 'resolved', resolved_at = now()
       WHERE id = $1 AND map_code = $2 AND status = 'open' RETURNING id`,
      [id, mapCode]
    );
    return rows.length > 0;
  }

  // ---------- 照片内容审核（mediaCheckAsync）----------

  async function getPhotoForModeration(id, mapCode) {
    const { rows } = await pool.query(
      'SELECT id, map_code, url FROM place_photos WHERE id = $1 AND map_code = $2',
      [id, mapCode]
    );
    return rows[0] ?? null;
  }

  async function setPhotoModeration(id, { moderation, traceId } = {}) {
    const { rows } = await pool.query(
      `UPDATE place_photos
       SET moderation = COALESCE($2, moderation), trace_id = COALESCE($3, trace_id)
       WHERE id = $1 RETURNING map_code`,
      [id, moderation ?? null, traceId ?? null]
    );
    if (rows[0] && moderation && moderation !== 'pass') {
      cacheDelete(`${id}:${rows[0].map_code}`);
    }
  }

  async function setPhotoModerationByTrace(traceId, moderation) {
    const { rows } = await pool.query(
      'UPDATE place_photos SET moderation = $2 WHERE trace_id = $1 RETURNING id, map_code',
      [traceId, moderation]
    );
    if (rows[0] && moderation !== 'pass') {
      // 判违规/待复核的照片必须立刻不可读：否则原图缓存仍会 200/302（二次复核 P1-3）
      cacheDelete(`${Number(rows[0].id)}:${rows[0].map_code}`);
    }
    return rows[0] ?? null;
  }

  // 审核结果暂存（回调早于 trace_id 落库时先存这里，随后补关联）
  async function saveMediaCheckResult(traceId, moderation, raw = '') {
    await pool.query(
      `INSERT INTO media_check_results (trace_id, moderation, raw)
       VALUES ($1, $2, $3)
       ON CONFLICT (trace_id) DO UPDATE SET moderation = EXCLUDED.moderation, raw = EXCLUDED.raw`,
      [traceId, moderation, String(raw).slice(0, 2000)]
    );
  }

  async function getMediaCheckResult(traceId) {
    const { rows } = await pool.query(
      'SELECT trace_id, moderation FROM media_check_results WHERE trace_id = $1',
      [traceId]
    );
    return rows[0] ?? null;
  }

  // 公共广场单个地点：字段与列表视图一致，且绝不返回 map_code
  async function getPublicPlace(id) {
    const { rows } = await pool.query(
      `SELECT id, name, description, category, lng, lat, address, added_by,
              visited, created_at, updated_at, visited_at, is_public, emoji
       FROM public.places
       WHERE id = $1 AND is_public = TRUE AND deleted_at IS NULL`,
      [id]
    );
    if (!rows[0]) return null;
    const [photoRows, commentRows, wishRows] = await Promise.all([
      pool.query(
        "SELECT count(*) AS n FROM place_photos WHERE place_id = $1 AND moderation <> 'risky'",
        [id]
      ),
      pool.query('SELECT count(*) AS n FROM place_comments WHERE place_id = $1', [id]),
      pool.query('SELECT who FROM place_wishes WHERE place_id = $1 ORDER BY id ASC', [id]),
    ]);
    return {
      ...rows[0],
      photo_count: Number(photoRows.rows[0].n),
      comment_count: Number(commentRows.rows[0].n),
      wishes: wishRows.rows.map((r) => r.who),
    };
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
      `SELECT place_id, thumb_url, thumb_b64, full_b64, mime FROM place_photos
       WHERE map_code = $1 AND moderation <> 'risky' ORDER BY id ASC`,
      [mapCode]
    );
    const thumbsByPlace = new Map();
    for (const row of photos.rows) {
      const list = thumbsByPlace.get(row.place_id) ?? [];
      if (list.length < 3) {
        const b64 = canInlineThumb(row.thumb_b64)
          ? row.thumb_b64
          : canInlineThumb(row.full_b64)
            ? row.full_b64
            : '';
        const inline = b64 ? `data:${row.mime};base64,${b64}` : '';
        if (row.thumb_url || inline) {
          list.push(row.thumb_url || inline);
          thumbsByPlace.set(row.place_id, list);
        }
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
    // 仅用于测试断言缓存占用（不暴露内容）
    __photoCacheStats: () => ({ size: photoCache.size, bytes: photoCacheBytes }),
    init,
    createMap,
    getMapByCode,
    renameMap,
    rekeyMap,
    deleteMap,
    listPlaces,
    create,
    findDuplicatePlace,
    recordServerError,
    update,
    remove,
    getPlace,
    listPhotos,
    countPhotos,
    trimPhotos,
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
    getPublicPlace,
    findReportTarget,
    isPlacePublic,
    createReport,
    listReports,
    resolveReport,
    getPhotoForModeration,
    setPhotoModeration,
    setPhotoModerationByTrace,
    saveMediaCheckResult,
    getMediaCheckResult,
    ping,
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
