/* The Thinking Radio — site logic. Everything comes from episodes.json; no build step, no network beyond this folder. */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const phone = matchMedia('(max-width: 640px)');

  const store = {
    get(k) { try { return localStorage.getItem('tr.' + k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem('tr.' + k) : localStorage.setItem('tr.' + k, v); } catch { /* private mode */ } },
  };

  const state = {
    data: null, ep: null,
    lang: store.get('lang') || 'en',
    format: store.get('format'),   // 'wide' | 'reel' | null (auto: reel on phones)
    cc: null,                      // null = automatic (see ccWanted)
    blobs: {},                     // srt path -> blob URL of converted VTT
  };

  const video = $('#player'), stage = $('#stage'), loader = $('#loader'), statusEl = $('#status');
  const pad = n => String(n).padStart(2, '0');
  const epId = ep => 'ep-' + pad(ep.num);
  const langInfo = code => (state.data?.languages || []).find(l => l.code === code) || { code, label: code, native: code };
  const fmtTime = s => s ? `${Math.floor(s / 60)}:${pad(Math.round(s % 60))}` : '';
  const fmtLong = s => { if (!s) return ''; const m = Math.floor(s / 60), r = Math.round(s % 60); return (m ? `${m} min ` : '') + (r ? `${r} s` : '').trim(); };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- SRT -> WebVTT at runtime (so a dropped-in .srt just works) ---------- */
  const srtToVtt = srt => 'WEBVTT\n\n' + srt.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim()
    .replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2') + '\n';
  async function trackUrl(path) {
    if (!/\.srt$/i.test(path)) return path;
    if (state.blobs[path]) return state.blobs[path];
    const res = await fetch(path); if (!res.ok) throw new Error('subtitle ' + res.status);
    return (state.blobs[path] = URL.createObjectURL(new Blob([srtToVtt(await res.text())], { type: 'text/vtt' })));
  }

  /* ---------- what to play ---------- */
  const isOut = ep => ep.status === 'out' && ep.media && ep.media.wide;
  const dubOf = (ep, lang) => (ep.media && ep.media.dubs && ep.media.dubs[lang]) || null;
  const audioLang = ep => (ep.audio && ep.audio[state.lang] && state.lang !== 'en' ? state.lang : 'en');
  // A dub listed in media.dubs uses exactly the files named there (reel: null = wide only);
  // a dub without an entry follows the naming convention: thinking-radio.mp4 -> thinking-radio-hi.mp4.
  const conv = (path, lang) => path && path.replace(/(\.[a-z0-9]+)$/i, `-${lang}$1`);
  function sourceFor(ep, fmt, lang) {
    if (lang === 'en') return ep.media[fmt] || ep.media.wide;
    const d = dubOf(ep, lang);
    if (d) return d[fmt] || d.wide;
    return conv(ep.media[fmt] || ep.media.wide, lang);
  }
  const hasReel = ep => !!sourceFor(ep, 'reel', audioLang(ep)) && (audioLang(ep) !== 'en' || !!ep.media.reel);
  const format = ep => (hasReel(ep) ? (state.format || (phone.matches ? 'reel' : 'wide')) : 'wide');
  // Subtitles: the plain list, plus each released dub's own subtitles (timed to the dub, so they win for that language).
  function subsOf(ep) {
    const subs = { ...(ep.subtitles || {}) };
    for (const [code, on] of Object.entries(ep.audio || {})) {
      const d = dubOf(ep, code);
      if (on && code !== 'en' && d && d.subtitles) subs[code] = d.subtitles;
    }
    return subs;
  }
  const subLang = ep => { const s = subsOf(ep); return s[state.lang] ? state.lang : (s.en ? 'en' : null); };
  // Captions printed into the picture already? Then don't double them up by default.
  const burned = ep => (ep.burnedIn || {})[audioLang(ep)] || null;
  const ccWanted = ep => (state.cc != null ? state.cc : !!subLang(ep) && burned(ep) !== subLang(ep));

  /* ---------- loader (the radio's valve glowing) ---------- */
  let loaderTimer = 0;
  function showLoader(on) {
    clearTimeout(loaderTimer);
    if (on) loaderTimer = setTimeout(() => loader.classList.add('on'), 120);
    else loader.classList.remove('on');
  }
  video.addEventListener('loadstart', () => { if (video.preload !== 'none') showLoader(true); });
  video.addEventListener('waiting', () => showLoader(true));
  ['loadedmetadata', 'canplay', 'playing', 'pause', 'error', 'emptied'].forEach(e => video.addEventListener(e, () => showLoader(false)));

  let fallbackTried = false;
  video.addEventListener('error', () => {
    const ep = state.ep; if (!ep) return;
    // A dub flagged as ready but its file is missing: fall back to English quietly.
    if (audioLang(ep) !== 'en' && !fallbackTried) {
      fallbackTried = true; loadSource(ep, { forceLang: 'en' });
      say(`The ${langInfo(state.lang).label} dub could not be loaded; playing the English version.`);
      return;
    }
    say('This reel is still at the laboratory. Please try again shortly.');
  });

  function say(html) { statusEl.innerHTML = html || ''; }

  /* ---------- player ---------- */
  async function loadSource(ep, { keepTime = false, forceLang = null } = {}) {
    const fmt = format(ep), lang = forceLang || audioLang(ep);
    const src = sourceFor(ep, fmt, lang);
    const poster = fmt === 'reel' ? (ep.media.posterReel || ep.media.poster) : ep.media.poster;
    stage.dataset.format = fmt;
    $('.now-grid').classList.toggle('is-reel', fmt === 'reel');
    $$('#format-seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.format === fmt)));
    $('#format-seg').hidden = !hasReel(ep);

    const same = video.getAttribute('src') === src;
    if (!same) {
      const t = keepTime ? video.currentTime : 0, playing = keepTime && !video.paused && !video.ended;
      video.pause();
      if (poster) video.poster = poster; else video.removeAttribute('poster');
      video.src = src;
      await buildTracks(ep);
      video.load();
      if (t > 0 || playing) {
        video.addEventListener('loadedmetadata', () => {
          if (t > 0) video.currentTime = Math.min(t, video.duration || t);
          if (playing) video.play().catch(() => {});
        }, { once: true });
      }
    } else {
      await buildTracks(ep);
    }
  }

  async function buildTracks(ep) {
    $$('track', video).forEach(t => t.remove());
    const want = subLang(ep);
    for (const [code, path] of Object.entries(subsOf(ep))) {
      if (!path) continue;
      const tr = document.createElement('track');
      const info = langInfo(code);
      tr.kind = code === audioLang(ep) ? 'captions' : 'subtitles';
      tr.srclang = code; tr.label = info.native === info.label ? info.label : `${info.native} (${info.label})`;
      try { tr.src = await trackUrl(path); } catch { continue; }
      if (code === want) tr.default = true;
      tr.addEventListener('load', () => placeCues(ep, tr.track));
      video.appendChild(tr);
    }
    applyTrackModes(ep);
  }

  // When the film has captions burned in at the bottom, lift a second language to the top of the picture.
  function placeCues(ep, track) {
    if (!burned(ep) || track.language === burned(ep) || !track.cues) return;
    for (const cue of track.cues) { try { cue.snapToLines = false; cue.line = 4; cue.lineAlign = 'start'; } catch { /* old engines */ } }
  }

  function applyTrackModes(ep) {
    const want = subLang(ep), on = ccWanted(ep);
    for (const t of video.textTracks) t.mode = (on && t.language === want) ? 'showing' : 'hidden';
    const btn = $('#cc-btn');
    btn.hidden = !want;
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = `Subtitles: ${on ? 'on' : 'off'}`;
  }
  video.textTracks.addEventListener?.('addtrack', () => state.ep && applyTrackModes(state.ep));

  function updateStatus(ep) {
    const L = state.lang, info = langInfo(L);
    const native = info.soon ? ` <span class="native" lang="${esc(L)}">${esc(info.soon)}</span>` : '';
    const parts = [];
    if (L !== 'en') {
      const dub = audioLang(ep) === L, subs = !!subsOf(ep)[L];
      if (dub && subs) parts.push(`Playing the ${info.label} dub.`);
      else if (dub) parts.push(`Playing the ${info.label} dub. ${info.label} subtitles coming soon.`);
      else if (subs) parts.push(`${info.label} dub coming soon.${native} Showing English audio with ${info.label} subtitles.`);
      else parts.push(`${info.label} dub coming soon.${native} Playing the English version for now.`);
    }
    const b = burned(ep);
    if (b && b === subLang(ep) && !ccWanted(ep)) parts.push(`${langInfo(b).label} captions are printed on the film itself.`);
    say(parts.join(' '));
  }

  function langsSummary(ep) {
    const codes = (state.data.languages || []).map(l => l.code);
    const audio = codes.filter(c => ep.audio && ep.audio[c]).map(c => langInfo(c).label);
    const subs = codes.filter(c => subsOf(ep)[c]).map(c => langInfo(c).label);
    const soon = codes.filter(c => !(ep.audio && ep.audio[c])).map(c => langInfo(c).label);
    return { audio, subs, soon };
  }

  function renderInfo(ep) {
    $('#ep-num').textContent = `No. ${ep.num}`;
    $('#ep-runtime').textContent = ep.duration ? `Running time ${fmtLong(ep.duration)}` : '';
    $('#ep-title').textContent = ep.title;
    $('#now-title').textContent = ep.title;
    $('#ep-subtitle').textContent = ep.subtitle || '';
    $('#ep-logline').textContent = ep.logline || '';
    const s = langsSummary(ep);
    $('#ep-langs').innerHTML =
      `<dt>Sound</dt><dd>${esc(s.audio.join(', ') || 'English')}</dd>` +
      `<dt>Subtitles</dt><dd>${esc(s.subs.join(', ') || 'None yet')}</dd>` +
      (s.soon.length ? `<dt>Dubs</dt><dd>${esc(s.soon.join(' and '))} coming soon</dd>` : '');
    video.setAttribute('aria-label', `The Thinking Radio No. ${ep.num}: ${ep.title}`);
    $('#cta-watch').innerHTML = `&#9654;&ensp;Watch No. ${ep.num}`;
  }

  async function openEpisode(ep, { keepTime = false } = {}) {
    const changed = state.ep !== ep;
    state.ep = ep; fallbackTried = false;
    if (changed) state.cc = null;
    renderInfo(ep);
    await loadSource(ep, { keepTime: keepTime && !changed });
    updateStatus(ep);
    $$('.card').forEach(c => {
      const cur = c.dataset.num === String(ep.num);
      c.classList.toggle('is-current', cur);
      const st = $('.stamp', c); if (st && c.classList.contains('is-out')) st.textContent = cur ? 'Now Showing' : 'Showing';
    });
  }

  /* ---------- programme grid ---------- */
  function leaderSvg(ep) { // placeholder poster: a film-leader countdown with the episode number
    const holes = Array.from({ length: 9 }, (_, i) => `<rect x="${6 + i * 17.5}" y="3" width="7" height="5" rx="1.2"/><rect x="${6 + i * 17.5}" y="82" width="7" height="5" rx="1.2"/>`).join('');
    return `<svg viewBox="0 0 160 90" role="img" aria-label="Film-leader countdown card for No. ${ep.num}; poster coming soon" preserveAspectRatio="xMidYMid slice">
      <rect width="160" height="90" fill="#3a3631"/><rect y="11" width="160" height="68" fill="#4a453f"/>
      <g fill="#1d1b18">${holes}</g>
      <g fill="none" stroke="#d6cfc2" stroke-width=".9"><circle cx="80" cy="45" r="30"/><circle cx="80" cy="45" r="24"/><path d="M0 45h160M80 11v68"/></g>
      <path class="leader-sweep" d="M80 45V15A30 30 0 0 1 110 45z" fill="#f7f3eb" fill-opacity=".14"/>
      <text x="80" y="58" text-anchor="middle" font-family="Shrikhand, Georgia, serif" font-size="36" fill="#f7f3eb" stroke="#141210" stroke-width="1.2" paint-order="stroke">${ep.num}</text>
    </svg>`;
  }

  function renderGrid() {
    const grid = $('#grid');
    grid.innerHTML = state.data.episodes.map(ep => {
      const out = isOut(ep);
      const art = ep.media && ep.media.poster
        ? `<img src="${esc(ep.media.poster)}" alt="${esc(ep.alt || `Poster for No. ${ep.num}, ${ep.title}`)}" decoding="async" width="1920" height="1080">`
        : leaderSvg(ep);
      const s = langsSummary(ep);
      const title = out ? `<a href="#${epId(ep)}" data-open="${ep.num}">${esc(ep.title)}</a>` : esc(ep.title);
      return `<li class="ticket card ${out ? 'is-out' : 'is-coming'}" data-num="${ep.num}" id="card-${epId(ep)}">
        <div class="card-art">${art}<span class="stamp ${out ? '' : 'stamp--soon'}">${out ? 'Showing' : 'Coming Soon'}</span></div>
        <div class="card-body">
          <p class="ticket-row limelight"><span>Admit One</span><span>No. ${ep.num}</span></p>
          <h3 class="card-title">${title}</h3>
          <p class="card-logline">${esc(ep.logline || '')}</p>
          <p class="card-foot">${out
            ? `<span class="play" aria-hidden="true">&#9654; Watch</span><span class="langs">${esc(fmtTime(ep.duration))}${s.audio.length ? ' · ' + esc(s.audio.map(l => l.slice(0, 2).toUpperCase()).join(' ')) : ''}</span>`
            : `<span>In the works</span><span class="langs">EN · HI · TA</span>`}</p>
        </div>
      </li>`;
    }).join('');
  }

  /* ---------- iris transition ---------- */
  const iris = $('#iris');
  function animateIris(cx, cy, from, to, ms) {
    return new Promise(done => {
      const t0 = performance.now();
      const ease = t => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
      const step = now => {
        const k = Math.min(1, (now - t0) / ms), r = from + (to - from) * ease(k);
        const m = `radial-gradient(circle at ${cx}px ${cy}px, transparent ${r}px, #000 ${r + 1.5}px)`;
        iris.style.webkitMaskImage = m; iris.style.maskImage = m;
        k < 1 ? requestAnimationFrame(step) : done();
      };
      requestAnimationFrame(step);
    });
  }
  async function irisSwap(x, y, swap) {
    if (reduceMotion.matches) { await swap(); return; }
    const W = innerWidth, H = innerHeight, far = r => Math.hypot(Math.max(r.x, W - r.x), Math.max(r.y, H - r.y));
    iris.classList.add('on');
    await animateIris(x, y, far({ x, y }), 0, 380);       // iris closes on the ticket
    await swap();
    const b = stage.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    await new Promise(r => setTimeout(r, 90));
    await animateIris(cx, cy, 0, far({ x: cx, y: cy }), 520); // and opens on the screen
    iris.classList.remove('on'); iris.style.maskImage = iris.style.webkitMaskImage = '';
  }

  function playFromCard(ep, x, y) {
    irisSwap(x, y, async () => {
      await openEpisode(ep);
      history.replaceState(null, '', '#' + epId(ep));
      $('#now').scrollIntoView({ behavior: 'instant', block: 'start' });
    }).then(() => { video.play().catch(() => {}); video.focus({ preventScroll: true }); });
  }

  /* ---------- wiring ---------- */
  function setLang(code, persist = true) {
    if (!state.data.languages.some(l => l.code === code)) code = 'en';
    state.lang = code; if (persist) store.set('lang', code);
    $$('.lang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === code)));
    if (state.ep) { state.cc = null; loadSource(state.ep, { keepTime: true }).then(() => updateStatus(state.ep)); }
  }

  function bind() {
    $$('.lang button').forEach(b => b.addEventListener('click', () => setLang(b.dataset.lang)));
    $$('#format-seg button').forEach(b => b.addEventListener('click', () => {
      state.format = b.dataset.format; store.set('format', state.format);
      loadSource(state.ep, { keepTime: true });
    }));
    phone.addEventListener('change', () => { if (!state.format && state.ep) loadSource(state.ep, { keepTime: true }); });
    $('#cc-btn').addEventListener('click', () => {
      state.cc = !ccWanted(state.ep); applyTrackModes(state.ep); updateStatus(state.ep);
    });
    $('#grid').addEventListener('click', e => {
      const card = e.target.closest('.card.is-out'); if (!card) return;
      e.preventDefault();
      const ep = state.data.episodes.find(x => String(x.num) === card.dataset.num);
      const r = card.getBoundingClientRect();
      const x = e.clientX || r.left + r.width / 2, y = e.clientY || r.top + r.height / 2;
      playFromCard(ep, x, y);
    });
    addEventListener('hashchange', () => {
      const ep = fromHash(); if (ep && ep !== state.ep) openEpisode(ep);
    });
  }

  function fromHash() {
    const m = location.hash.match(/^#ep-?(\d+)/i); if (!m) return null;
    const ep = state.data.episodes.find(e => e.num === +m[1]); return ep && isOut(ep) ? ep : null;
  }

  async function init() {
    showLoader(true);
    try {
      const res = await fetch('episodes.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      state.data = await res.json();
    } catch (err) {
      showLoader(false);
      say('The programme could not be loaded. If you opened this file directly, serve the folder instead (see README.md).');
      console.warn('episodes.json:', err);
      return;
    }
    const s = state.data.series || {};
    if (s.tagline) $('#tagline').textContent = s.tagline;
    state.data.languages ||= [{ code: 'en', label: 'English', native: 'English' }];
    state.data.episodes.sort((a, b) => a.num - b.num);
    renderGrid();
    bind();
    setLang(state.lang, false);
    const out = state.data.episodes.filter(isOut);
    const ep = fromHash() || out[out.length - 1];
    if (ep) await openEpisode(ep); else { showLoader(false); say('The first picture is still being drawn. Check back soon.'); }
  }

  init();
})();
