import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const miniRoot = path.join(root, 'miniprogram');
const serverRoot = path.join(root, 'server');
const compilerRoot = '/Applications/wechatwebdevtools.app/Contents/Resources/app.asar.unpacked/node_modules/wcc-exec';
const run = (command, args, options = {}) => spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 20 * 1024 * 1024, ...options });
const tracked = run('git', ['ls-files', 'server', 'miniprogram', 'public']).stdout.trim().split('\n');
const javascript = tracked.filter((name) => /\.(js|mjs)$/.test(name));
const json = tracked.filter((name) => name.endsWith('.json'));
const syntaxFailures = javascript.flatMap((name) => {
  const r = run(process.execPath, ['--check', path.join(root, name)]);
  return r.status === 0 ? [] : [{ file: name, error: r.stderr }];
});
const jsonFailures = json.flatMap((name) => {
  try { JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')); return []; }
  catch (error) { return [{ file: name, error: error.message }]; }
});
const app = JSON.parse(fs.readFileSync(path.join(miniRoot, 'app.json'), 'utf8'));
const missingPageFiles = app.pages.flatMap((name) => ['js', 'json', 'wxml', 'wxss'].filter((ext) => !fs.existsSync(path.join(miniRoot, `${name}.${ext}`))).map((ext) => `${name}.${ext}`));
const miniFiles = tracked.filter((name) => name.startsWith('miniprogram/')).map((name) => name.slice('miniprogram/'.length));
function compile(binary, names) {
  const full = path.join(compilerRoot, binary);
  if (!fs.existsSync(full)) return { available: false };
  const r = run(full, names, { cwd: miniRoot });
  return { available: true, status: r.status, stderr: r.stderr, outputBytes: Buffer.byteLength(r.stdout), outputSha256: crypto.createHash('sha256').update(r.stdout).digest('hex') };
}
const wxmlFiles = miniFiles.filter((name) => name.endsWith('.wxml'));
const wxssFiles = miniFiles.filter((name) => name.endsWith('.wxss'));
const wxml = { fileCount: wxmlFiles.length, ...compile('wcc', wxmlFiles) };
const wxss = wxssFiles.map((file) => ({ file, ...compile('wcsc', [file]) }));
const tests = run(process.execPath, ['--test', '--test-reporter=spec'], { cwd: serverRoot });
fs.writeFileSync(path.join(here, 'tests.log'), tests.stdout + tests.stderr);
const auditAll = run('npm', ['audit', '--json'], { cwd: serverRoot });
const auditProduction = run('npm', ['audit', '--omit=dev', '--json'], { cwd: serverRoot });
function auditData(result) {
  try { return { status: result.status, vulnerabilities: JSON.parse(result.stdout).metadata.vulnerabilities }; }
  catch { return { status: result.status, error: result.stderr || result.error?.message }; }
}
console.log('Local compilation, tests, and dependency checks completed.');
const network = [];
for (const endpoint of ['/api/health', '/api/upload-config', '/api/public/places', '/api/admin/wechat-privacy']) {
  const start = performance.now();
  try {
    const response = await fetch(`https://shanghai-wish-map.onrender.com${endpoint}`, { signal: AbortSignal.timeout(20_000) });
    const data = await response.json();
    network.push({ endpoint, status: response.status, elapsedMs: Math.round(performance.now() - start), ok: data.ok, cdn: data.cdn, maxFullBytes: data.maxFullBytes, maxThumbBytes: data.maxThumbBytes, publicPlaceCount: data.places?.length });
  } catch (error) { network.push({ endpoint, elapsedMs: Math.round(performance.now() - start), error: error.message }); }
}
const summary = {
  revision: run('git', ['rev-parse', 'HEAD']).stdout.trim(),
  generatedAt: new Date().toISOString(),
  nodeVersion: process.version,
  syntax: { fileCount: javascript.length, failures: syntaxFailures },
  json: { fileCount: json.length, failures: jsonFailures },
  registeredPages: app.pages.length,
  missingPageFiles,
  wxml,
  wxss,
  tests: { exitCode: tests.status, summary: tests.stdout.split('\n').filter((line) => /tests |suites |pass |fail |cancelled |skipped |duration_ms /.test(line)).slice(-10), error: tests.error?.message },
  dependencies: { all: auditData(auditAll), production: auditData(auditProduction) },
  network,
  productionScope: 'four public GETs; no production writes, private map queries, or external WeChat/Cloudinary calls',
};
fs.writeFileSync(path.join(here, 'checks.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ ...summary, wxss: { fileCount: wxss.length, failed: wxss.filter((item) => item.status !== 0) } }, null, 2));
if (syntaxFailures.length || jsonFailures.length || missingPageFiles.length || tests.status !== 0 || (wxml.available && wxml.status !== 0) || wxss.some((item) => item.available && item.status !== 0)) process.exitCode = 1;
