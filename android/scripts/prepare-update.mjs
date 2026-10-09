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
const channel = process.argv[5] || 'stable';
if (!['stable', 'preview'].includes(channel)) throw new Error('Channel must be stable or preview');
if (versionName.endsWith('-preview') !== (channel === 'preview')) throw new Error('Build RELEASE_CHANNEL must match the publication channel');
const bytes = await readFile(apk);
const filename = `modu-explore-${versionName}.apk`;
const directory = path.resolve(android, '../public/android');
const catalogPath = path.join(directory, 'releases.json');
let catalog;
try { catalog = JSON.parse(await readFile(catalogPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; catalog = { releases: [] }; }
if (!Array.isArray(catalog.releases)) throw new Error('Invalid release catalog');
if (catalog.releases.some((release) => release.versionCode >= versionCode)) throw new Error('Use a new, higher versionCode for every stable or preview release');
const release = {
    packageName: metadata.applicationId, versionCode, versionName, channel,
    publishedAt: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date()),
    apkUrl: new URL(`/android/${filename}`, base).href,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    notes: process.argv[4] || '维护与体验改进',
};
await mkdir(directory, { recursive: true });
await copyFile(apk, path.join(directory, filename));
// Until the first stable launch, legacy clients must also receive preview updates.
if (channel === 'stable' || !catalog.releases.some((item) => item.channel === 'stable')) {
    await writeFile(path.join(directory, 'update.json'), JSON.stringify(release, null, 2) + '\n');
}
await writeFile(catalogPath, JSON.stringify({ releases: [release, ...catalog.releases] }, null, 2) + '\n');
console.log(`Ready for deployment: ${directory}`);
