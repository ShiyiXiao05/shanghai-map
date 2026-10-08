import { createHash } from 'node:crypto';
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Produces a deployable directory served by the existing Express public root.
const android = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apk = path.resolve(process.argv[2] || path.join(android, 'app/build/outputs/apk/debug/app-debug.apk'));
const base = new URL(process.argv[3] || 'https://shanghai-wish-map.onrender.com');
if (base.protocol !== 'https:') throw new Error('Update hosting must use HTTPS');
const metadata = JSON.parse(await readFile(path.join(path.dirname(apk), 'output-metadata.json'), 'utf8'));
if (metadata.applicationId !== 'com.modu.explore' || metadata.elements.length !== 1) throw new Error('Unexpected package or split APK');
const { versionCode, versionName } = metadata.elements[0];
const bytes = await readFile(apk);
const filename = `modu-explore-${versionName}.apk`;
const directory = path.resolve(android, '../public/android');
await mkdir(directory, { recursive: true });
await copyFile(apk, path.join(directory, filename));
await writeFile(path.join(directory, 'update.json'), JSON.stringify({
    packageName: metadata.applicationId, versionCode, versionName,
    apkUrl: new URL(`/android/${filename}`, base).href,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    notes: process.argv[4] || '地图标记更清晰；点击地点先显示简介；支持应用内检查和下载更新。',
}, null, 2) + '\n');
console.log(`Ready for deployment: ${directory}`);
