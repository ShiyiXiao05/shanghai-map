import crypto from 'node:crypto';
import pg from 'pg';
import './env.js';

export const CATEGORIES = ['景点', '美食', '展馆', '购物', '娱乐', '其他'];

// 去掉易混淆字符（0/O、1/I）的邀请码字母表
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const DEFAULT_MAP_CODE = 'SH2026';

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
        map_code TEXT NOT NULL DEFAULT 'SH2026',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      ALTER TABLE public.places ADD COLUMN IF NOT EXISTS map_code
        TEXT NOT NULL DEFAULT 'SH2026'
    `);
    await pool.query(
      `INSERT INTO maps (code, name, created_by)
       VALUES ($1, $2, 'system')
       ON CONFLICT (code) DO NOTHING`,
      [DEFAULT_MAP_CODE, '想去上海 · 主地图']
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
    return rows;
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
    return rows.length > 0;
  }

  return { init, createMap, getMapByCode, listPlaces, create, update, remove };
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
