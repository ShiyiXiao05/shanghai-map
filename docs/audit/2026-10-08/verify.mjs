import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const compilerRoot = process.env.WECHAT_COMPILER_ROOT || '/Applications/wechatwebdevtools.app/Contents/Resources/app.asar.unpacked/node_modules/wcc-exec';
const files = [];
for (const directory of ['server', 'miniprogram', 'public']) {
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(path.relative(root, full));
    }
  }
  walk(path.join(root, directory));
}
const javascript = files.filter((name) => name.endsWith('.js') || name.endsWith('.mjs'));
const json = files.filter((name) => name.endsWith('.json'));
const syntaxFailures = javascript.flatMap((name) => {
  const r = spawnSync(process.execPath, ['--check', path.join(root, name)], { encoding: 'utf8' });
  return r.status === 0 ? [] : [{ file: name, error: r.stderr }];
});
const jsonFailures = json.flatMap((name) => {
  try { JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')); return []; }
  catch (e) { return [{ file: name, error: e.message }]; }
});
const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json')));
const missingPageFiles = appConfig.pages.flatMap((page) => ['js', 'json', 'wxml', 'wxss'].filter((extension) => !fs.existsSync(path.join(root, 'miniprogram', `${page}.${extension}`))).map((extension) => `${page}.${extension}`));
const wxml = files.filter((name) => name.startsWith('miniprogram/') && name.endsWith('.wxml')).map((name) => name.slice('miniprogram/'.length));
const wxss = files.filter((name) => name.startsWith('miniprogram/') && name.endsWith('.wxss')).map((name) => name.slice('miniprogram/'.length));
function compile(binary, entries) {
  if (!fs.existsSync(path.join(compilerRoot, binary))) return { available: false };
  const r = spawnSync(path.join(compilerRoot, binary), entries, { cwd: path.join(root, 'miniprogram'), encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  return { available: true, status: r.status, stderr: r.stderr, outputBytes: Buffer.byteLength(r.stdout), outputSha256: crypto.createHash('sha256').update(r.stdout).digest('hex') };
}
const wxmlResult = compile('wcc', wxml);
const wxssPages = wxss.map((name) => ({ file: name, ...compile('wcsc', [name]) }));
const wxssResult = { available: wxssPages.every((p) => p.available), status: wxssPages.some((p) => p.status !== 0) ? 1 : 0, fileCount: wxssPages.length, files: wxssPages };
let templateRuntime;
if (wxmlResult.status === 0) {
  const r = spawnSync(path.join(compilerRoot, 'wcc'), ['pages/index/index.wxml'], { cwd: path.join(root, 'miniprogram'), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const warnings = [];
  const context = { window: {}, console: { warn: (...args) => warnings.push(args.join(' ')), log() {}, error() {} } };
  vm.createContext(context);
  vm.runInContext(r.stdout, context);
  const render = context.$gwx('pages/index/index.wxml');
  const tree = render({ categories: [{ id: '景点', emoji: 'X', color: '#123456' }], activeCategories: ['景点'], filtered: [], places: [], loading: false }, {});
  const chips = [];
  function walk(node) {
    if (node?.attr?.class?.startsWith('chip ')) chips.push({ class: node.attr.class, style: node.attr.style });
    for (const child of node?.children || []) walk(child);
  }
  walk(tree);
  templateRuntime = { scope: 'compiler-generated WXML renderer in Node VM; not a simulator screenshot', categoryIndexOfWorks: chips[0]?.class === 'chip chip-on', chips, warnings };
}
const depResult = spawnSync('npm', ['audit', '--json'], { cwd: path.join(root, 'server'), encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
const prodResult = spawnSync('npm', ['audit', '--omit=dev', '--json'], { cwd: path.join(root, 'server'), encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
let dependencySummary;
try {
  const all = JSON.parse(depResult.stdout);
  const prod = JSON.parse(prodResult.stdout);
  fs.writeFileSync(path.join(here, 'npm-audit-all.json'), JSON.stringify(all, null, 2) + '\n');
  fs.writeFileSync(path.join(here, 'npm-audit-production.json'), JSON.stringify(prod, null, 2) + '\n');
  dependencySummary = { all: all.metadata?.vulnerabilities, production: prod.metadata?.vulnerabilities };
} catch { dependencySummary = { error: depResult.error?.message || prodResult.error?.message || 'npm audit did not return JSON' }; }
const network = [];
for (const endpoint of ['/api/health', '/api/public/places', '/api/push/key']) {
  const start = performance.now();
  try {
    const response = await fetch('https://shanghai-wish-map.onrender.com' + endpoint, { signal: AbortSignal.timeout(20000) });
    const data = await response.json();
    network.push({ endpoint, status: response.status, elapsedMs: Math.round(performance.now() - start), ok: data.ok, placeCount: data.places?.length, pushConfigured: endpoint === '/api/push/key' ? response.status === 200 : undefined, headers: { cacheControl: response.headers.get('cache-control'), hsts: response.headers.get('strict-transport-security'), referrerPolicy: response.headers.get('referrer-policy') } });
  } catch (e) { network.push({ endpoint, elapsedMs: Math.round(performance.now() - start), error: e.name }); }
}
const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
const summary = { auditedAt: new Date().toISOString(), commit, nodeVersion: process.version, sourceSyntax: { fileCount: javascript.length, failures: syntaxFailures }, json: { fileCount: json.length, failures: jsonFailures }, registeredPages: appConfig.pages.length, missingPageFiles, wxml: { fileCount: wxml.length, ...wxmlResult }, wxss: wxssResult, templateRuntime, dependencies: dependencySummary, network, productionRequests: 'three public GETs only; no private data read and no mutations' };
fs.writeFileSync(path.join(here, 'verification-results.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
if (syntaxFailures.length || jsonFailures.length || missingPageFiles.length || (wxmlResult.available && wxmlResult.status !== 0) || (wxssResult.available && wxssResult.status !== 0)) process.exitCode = 1;
