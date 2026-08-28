// 一次性脚本：把数据库里的存量照片迁移到 Cloudinary，并清空 base64 释放 Neon 存储。
// 用法：在 server/ 目录下配好 CLOUDINARY_URL（.env / .env.local 或环境变量）后运行
//   node scripts/migrate-photos.mjs
import '../env.js';
import pg from 'pg';
import { createCloudinaryUploader } from '../uploader.js';

const uploader = createCloudinaryUploader(process.env.CLOUDINARY_URL);
if (!uploader.configured) {
  console.error('未配置 CLOUDINARY_URL，无法迁移');
  process.exit(1);
}

const { Pool } = pg;
const needsSsl = /sslmode=require|\.neon\.tech/.test(process.env.DATABASE_URL ?? '');
const conn = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(needsSsl ? { ssl: { rejectUnauthorized: true } } : {}),
});

const { rows } = await conn.query(
  "SELECT id, mime, full_b64 FROM place_photos WHERE url = '' AND full_b64 <> ''"
);
console.log(`待迁移照片：${rows.length} 张`);

for (const row of rows) {
  const dataUrl = `data:${row.mime};base64,${row.full_b64}`;
  const uploaded = await uploader.upload(dataUrl, { folder: 'shanghai-map' });
  await conn.query(
    `UPDATE place_photos
       SET public_id = $1, url = $2, thumb_url = $3, full_b64 = '', thumb_b64 = ''
     WHERE id = $4`,
    [uploaded.publicId, uploaded.url, uploaded.thumbUrl, row.id]
  );
  console.log(`已迁移 #${row.id} → ${uploaded.url}`);
}

await conn.end();
console.log('迁移完成');
