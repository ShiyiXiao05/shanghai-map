import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Enumerate the test suite explicitly so unrelated skill symlinks are not scanned.
const directory = new URL('../test/', import.meta.url);
const files = (await readdir(directory)).filter((name) => name.endsWith('.test.js')).sort()
  .map((name) => fileURLToPath(new URL(name, directory)));
if (!files.length) throw new Error('No server tests found');
const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
