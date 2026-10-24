"""Copy finished episodes (and dubs) from the engine into site/media and update site/episodes.json.
Run from anywhere:  python site/tools/publish.py            (re-runnable: only files that exist are published)
Episode 1 lives at the engine root (thinking-radio*.mp4); episodes 2.. live in episodes/ep0N-<slug>/ (<slug>.mp4, <slug>-reel.mp4, ...).
Dubs (hi, ta): thinking-radio-<lang>.mp4 / -reel-<lang>.mp4 / .srt for episode 1; <slug>-<lang>.mp4, <slug>-reel-<lang>.mp4, <slug>-<lang>.srt for the others."""
import io, json, os, shutil, subprocess, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); ROOT = os.path.dirname(SITE)
J = os.path.join(SITE, 'episodes.json'); data = json.load(io.open(J, encoding='utf-8'))

def dur(p):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p], capture_output=True, text=True)
    return int(round(float(r.stdout.strip())))

def put(src, dst_dir, name):
    if not os.path.exists(src): return None
    os.makedirs(dst_dir, exist_ok=True); dst = os.path.join(dst_dir, name)
    if not os.path.exists(dst) or os.path.getsize(dst) != os.path.getsize(src) or os.path.getmtime(src) > os.path.getmtime(dst):
        shutil.copy2(src, dst); print('  copied', name)
    return f'media/{os.path.basename(dst_dir)}/{name}'

for ep in data['episodes']:
    n = ep['num']; mdir = os.path.join(SITE, 'media', f'ep{n:02d}')
    if n == 1:
        base, src = 'thinking-radio', ROOT
        files = dict(wide='thinking-radio.mp4', reel='thinking-radio-reel.mp4', poster='poster.jpg', posterReel='poster-reel.jpg', srt='thinking-radio.srt')
    else:
        folder = os.path.join(ROOT, 'episodes', ep['slug']); base = ep['slug'].split('-', 1)[1]; src = folder
        files = dict(wide=f"{ep['slug']}.mp4", reel=f"{ep['slug']}-reel.mp4", poster='poster.jpg', posterReel='poster-reel.jpg', srt=f"{ep['slug']}.srt")
    print(f"episode {n}: {ep['title']}")
    wide = put(os.path.join(src, files['wide']), mdir, f'{base}.mp4')
    if not wide: print('  (film not built yet)'); continue
    reel = put(os.path.join(src, files['reel']), mdir, f'{base}-reel.mp4')
    poster = put(os.path.join(src, files['poster']), mdir, 'poster.jpg')
    posterReel = put(os.path.join(src, files['posterReel']), mdir, 'poster-reel.jpg')
    srt = put(os.path.join(src, files['srt']), mdir, f'{base}.srt')
    m = ep.setdefault('media', {}); m['wide'] = wide
    if reel: m['reel'] = reel
    if poster: m['poster'] = poster
    if posterReel: m['posterReel'] = posterReel
    dubs = m.setdefault('dubs', {}); audio = ep.setdefault('audio', {'en': True, 'hi': False, 'ta': False}); burned = ep.setdefault('burnedIn', {})
    audio['en'] = True; burned['en'] = 'en'
    ep['status'] = 'out'; ep['duration'] = dur(os.path.join(src, files['wide']))
    ep['subtitles'] = {'en': f'media/ep{n:02d}/{base}.vtt'} if srt else {}
    ep.setdefault('alt', f"Greyscale 1930s cartoon still from {ep['title']}: the pie-eyed Thinking Radio and the bowler-hatted man in their living room.")
    for L in ('hi', 'ta'):   # dubs: whatever has been built
        if n == 1: fw, fr, fs = f'thinking-radio-{L}.mp4', f'thinking-radio-reel-{L}.mp4', f'thinking-radio-{L}.srt'
        else: fw, fr, fs = f"{ep['slug']}-{L}.mp4", f"{ep['slug']}-reel-{L}.mp4", f"{ep['slug']}-{L}.srt"
        w = put(os.path.join(src, fw), mdir, f'{base}-{L}.mp4')
        if not w: continue
        r = put(os.path.join(src, fr), mdir, f'{base}-reel-{L}.mp4')
        s_ = put(os.path.join(src, fs), mdir, f'{base}-{L}.srt')
        dubs[L] = {'wide': w, 'reel': r, 'subtitles': s_}; audio[L] = True; burned[L] = L
        print(f'  dub {L}: published' + (' (with a vertical cut)' if r else ''))
io.open(J, 'w', encoding='utf-8').write(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
subprocess.run(['node', os.path.join(SITE, 'tools', 'srt2vtt.mjs')], check=False)
print('episodes.json updated')
