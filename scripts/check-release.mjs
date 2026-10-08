#!/usr/bin/env node
/**
 * Release smoke test: production bundles must not attempt connections to the
 * developer's localhost hot-reload server, and the Chrome manifest version
 * must match the packaged release version.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

if (!fs.existsSync(dist)) {
  console.error('No dist/ directory. Run pnpm build first.');
  process.exit(1);
}

const manifestPath = path.join(dist, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('Missing compiled extension manifest.');
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.version !== pkg.version) {
  console.error(`Manifest version ${manifest.version} does not match package version ${pkg.version}.`);
  process.exit(1);
}

let filesChecked = 0;
const offenders = [];
function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scan(target);
    } else if (entry.isFile() && /\.(js|mjs)$/.test(entry.name)) {
      filesChecked++;
      const contents = fs.readFileSync(target, 'utf8');
      if (contents.includes('127.0.0.1:9090')) {
        offenders.push(path.relative(dist, target));
      }
    }
  }
}
scan(dist);

if (offenders.length) {
  console.error('Development WebSocket URL found in production JavaScript:', offenders.join(', '));
  process.exit(1);
}
console.log(`PASS: ${filesChecked} JS bundles contain no localhost dev reload URL; manifest/package version ${pkg.version}.`);
