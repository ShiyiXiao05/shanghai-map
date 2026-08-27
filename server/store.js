import pg from 'pg';
import './env.js';

export const CATEGORIES = ['景点', '美食', '展馆', '购物', '娱乐', '其他'];

export function createPlaceStore(pool) {
  async function init() {
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
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  async function list() {
    const { rows } = await pool.query(
      'SELECT * FROM public.places ORDER BY created_at DESC, id DESC'
    );
    return rows;
  }

  async function create(data) {
    const { rows } = await pool.query(
      `INSERT INTO public.places
         (name, description, category, lng, lat, address, added_by, visited)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
      ]
    );
    return rows[0];
  }

  async function update(id, patch) {
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
       WHERE id = $9
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
      ]
    );
    return rows[0] ?? null;
  }

  async function remove(id) {
    const { rows } = await pool.query(
      'DELETE FROM public.places WHERE id = $1 RETURNING id',
      [id]
    );
    return rows.length > 0;
  }

  return { init, list, create, update, remove };
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
