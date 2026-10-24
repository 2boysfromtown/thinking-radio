// srt2vtt.mjs — convert every .srt under site/media/ into a .vtt next to it (WebVTT for <track>).
//   node site/tools/srt2vtt.mjs            (from anywhere; paths are resolved from this file)
// The site can also read .srt directly (app.js converts at runtime), but .vtt is faster and works without JS tricks.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MEDIA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'media');

export function srtToVtt(srt) {
  const body = srt.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim()
    // 00:00:01,234 --> 00:00:02,345  =>  00:00:01.234 --> 00:00:02.345
    .replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return 'WEBVTT\n\n' + body + '\n';
}

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (name.toLowerCase().endsWith('.srt')) {
      const out = p.slice(0, -4) + '.vtt';
      fs.writeFileSync(out, srtToVtt(fs.readFileSync(p, 'utf8')), 'utf8');
      console.log('wrote', path.relative(MEDIA, out));
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) walk(MEDIA);
