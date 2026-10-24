// shoot.mjs — screenshot the site in headless Chrome (desktop 1440x900, phone 390x844 and 375x812) and report console errors.
//   node site/tools/shoot.mjs            (puppeteer-core is resolved from ../../node_modules, i.e. the thinking-radio project)
// Output: site/shots/*.png
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { serve, ROOT } from './serve.mjs';

const require = createRequire(path.join(ROOT, '..', 'package.json'));
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.join(ROOT, 'shots');
fs.mkdirSync(OUT, { recursive: true });

const PORT = 8137;
const server = await serve(PORT);
const URL0 = `http://127.0.0.1:${PORT}/`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const problems = [];

async function view(name, w, h, { mobile = false, reduce = false, act = null, full = true, patch = null, expect404 = [] } = {}) {
  const ctx = await browser.createBrowserContext(); // fresh storage per view
  const page = await ctx.newPage();
  if (patch) { // rewrite episodes.json on the fly (e.g. pretend a dub was released)
    await page.setRequestInterception(true);
    page.on('request', async r => {
      if (!r.url().endsWith('/episodes.json')) return r.continue();
      const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'episodes.json'), 'utf8')); patch(data);
      r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
  }
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  if (reduce) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  page.on('console', m => { if (expect404.length && /404/.test(m.text())) return; if (['error', 'warning', 'warn'].includes(m.type())) problems.push(`[${name}] console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => problems.push(`[${name}] pageerror: ${e.message}`));
  // ERR_ABORTED on video is normal: preload=metadata stops after the header, and the page closes mid-stream.
  page.on('requestfailed', r => { if (!(/\.mp4$/.test(r.url()) && /ABORTED/.test(r.failure()?.errorText))) problems.push(`[${name}] request failed: ${r.url()} ${r.failure()?.errorText}`); });
  page.on('response', r => { if (r.status() >= 400 && !expect404.some(x => r.url().endsWith(x))) problems.push(`[${name}] HTTP ${r.status()}: ${r.url()}`); });
  await page.goto(URL0, { waitUntil: 'networkidle2' });
  await page.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 600));
  if (act) await act(page);
  const info = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
    src: document.querySelector('#player')?.getAttribute('src'),
    tracks: [...document.querySelector('#player').textTracks].map(t => `${t.language}:${t.mode}:${t.cues ? t.cues.length : '-'}`),
    status: document.querySelector('#status')?.textContent.trim(),
    cards: document.querySelectorAll('.card').length,
    wide: [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1).map(el => el.tagName + '.' + el.className).slice(0, 8),
  }));
  if (info.scrollW > info.clientW) problems.push(`[${name}] horizontal scroll: ${info.scrollW} > ${info.clientW} ${info.wide.join(', ')}`);
  console.log(name, JSON.stringify(info));
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
  await ctx.close();
}

await view('desktop', 1440, 900);
await view('desktop-fold', 1440, 900, { full: false });
await view('phone', 390, 844, { mobile: true });
await view('phone-375', 375, 812, { mobile: true, reduce: true });
// Hindi selected: no dub/subs yet -> status message; reel toggle on desktop.
await view('desktop-hindi-reel', 1440, 900, { full: false, act: async page => {
  await page.click('.lang button[data-lang="hi"]');
  await page.click('#format-seg button[data-format="reel"]');
  await page.evaluate(() => document.querySelector('#now').scrollIntoView({ behavior: 'instant' }));
  await new Promise(r => setTimeout(r, 800));
}});
// Open episode 1 from its ticket (iris transition), then capture the player mid-film with subtitles toggled on.
await view('phone-playing', 390, 844, { mobile: true, full: false, act: async page => {
  await page.evaluate(() => { try { localStorage.clear(); } catch {} });
  await page.evaluate(() => document.querySelector('#programme').scrollIntoView({ behavior: 'instant' }));
  await page.click('.card.is-out');
  await new Promise(r => setTimeout(r, 1300));
  await page.click('#cc-btn');
  await page.evaluate(async () => { const v = document.querySelector('#player'); v.pause(); v.currentTime = 10.5; await new Promise(r => v.addEventListener('seeked', r, { once: true })); });
  await new Promise(r => setTimeout(r, 500));
}});

// Pretend the Hindi dub was flipped on before its files arrived: the site must fall back to English gracefully.
await view('desktop-hindi-dub-missing', 1440, 900, { full: false, expect404: ['thinking-radio-hi.mp4', 'thinking-radio-hi.srt'],
  patch: d => { d.episodes[0].audio.hi = true; },
  act: async page => {
    await page.click('.lang button[data-lang="hi"]');
    await page.evaluate(() => document.querySelector('#now').scrollIntoView({ behavior: 'instant' }));
    await new Promise(r => setTimeout(r, 1500));
  }});

await browser.close();
server.close();
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'No console errors, failed requests or horizontal scroll.');
