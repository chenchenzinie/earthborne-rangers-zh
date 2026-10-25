/* ============================================================
   v34：原声音乐系统（第四子系统）
   —— 官方 OST（Tom Figgins《Earthborne Rangers Original Soundtrack》）
   音频由 _extract/build_bgm_v34.py 把 FLAC 转成 128kbps MP3（bgm/tNN.mp3）
   曲目清单在 data/data-bgm.js（window.BGM）

   设计要点：
   · <audio> 单例挂在 body 上，不随子系统切换销毁 —— 切到卡牌 / 战役 / 文本时音乐继续播放
   · 底部迷你播放条（#mini-player）跨系统常驻，可收起
   · 播放进度 / 音量 / 播放模式 / 上次听到哪首都记在本机

   v36：专辑封面显示形状（圆形旋转 / 圆形固定 / 方形固定 / 方形旋转）
   封面由「占位层 .mu-coverwrap > 裁切外框 .mu-coverbox > 图片 .mu-cover」三层组成：
   · 圆形旋转 = 外框不动、框内图片转 —— 唱片效果，中间轴孔留在正中
   · 方形旋转（v39b 改回）= 整个外框连着图片一起转，占位层按对角线放大，转 45° 也不溢出面板
   旋转角度用累计毫秒数记录，切形状 / 重绘时不会跳回 0；暂停时停在原角度。

   设计要点：
   · <audio> 单例挂在 body 上，不随子系统切换销毁 —— 切到卡牌 / 战役 / 文本时音乐继续播放
   · 底部迷你播放条（#mini-player）跨系统常驻，可收起
   · 播放进度 / 音量 / 播放模式 / 封面形状 / 上次听到哪首都记在本机

   静态站做不到「技术上无法下载」—— 能播就一定到了用户机器上。目标是抬高门槛 + 留痕：
   ① 音源文件名随机化（_extract/obscure_bgm_v35.py），无法按 t01…t68 猜路径批量拉
   ② 播放前校验登录会话，未登录 / 会话未确认一律不取音源
   ③ 音频改由 fetch 取回转成内存临时地址（blob:）再交给 <audio>，
      页面源码、DOM、下载列表里都拿不到 mp3 直链（代价：要先缓冲完才能拖进度）
   ④ 页面浮动水印（站点域名 + 账号专属 ID + 时间），录屏也会带上
   ⑤ 禁右键 / 禁拖拽 / 禁另存为、播放器无下载入口
   ⑥ robots.txt 禁止抓取 /bgm/ 与 /books/
   后台「功能开关 → 原声音乐 → 音源保护」可整体关闭（排障用）。
   ============================================================ */
(function () {
  const $ = id => document.getElementById(id);
  function el(tag, cls, txt) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const mmss = s => {
    s = Math.max(0, Math.floor(s || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };

  /* ---------------- 状态 ---------------- */
  const K_VOL = 'eb_music_vol', K_MODE = 'eb_music_mode',
        K_LAST = 'eb_music_last', K_MINI = 'eb_music_mini',
        K_SHAPE = 'eb_music_shape';                     // v36：封面显示形状
  const MODES = [
    { k: 'loop',  icon: '🔁', name: '列表循环' },
    { k: 'one',   icon: '🔂', name: '单曲循环' },
    { k: 'shuf',  icon: '🔀', name: '随机播放' },
    { k: 'seq',   icon: '➡️', name: '顺序播放' },
  ];
  /* v36：封面显示形状 —— 形状 + 是否旋转，共四种 */
  const SHAPES = [
    { k: 'circle-spin',   icon: '◉', name: '圆形旋转', tip: '唱片效果：圆形裁切，边转边放' },
    { k: 'circle-static', icon: '●', name: '圆形固定', tip: '圆形裁切，封面不转' },
    { k: 'square-static', icon: '■', name: '方形固定', tip: '圆角方形，封面不转' },
    { k: 'square-spin',   icon: '▣', name: '方形旋转', tip: '圆角方形，封面缓慢旋转' },
  ];
  const DEF_SHAPE = 'circle-spin';

  let album = {}, tracks = [];
  let curId = null;               // 当前曲目 id（曲目表里的 id，如 t01）
  let audio = null;
  let booted = false;
  let dragging = false;           // 是否正在拖进度条
  let mixOn = 'all', kw = '';
  let mode = 'loop', vol = 0.8;
  let miniHidden = false;
  let coverShape = DEF_SHAPE;         // v36

  const data = () => (window.BGM || (typeof BGM !== 'undefined' ? BGM : null));
  const byId = id => tracks.find(t => t.id === id) || null;
  const MIX_NAME = { stereo: '立体声', binaural: '双耳' };

  /* ---------------- v35：音源保护 ---------------- */
  const BLOB_MAX = 3;                 // 内存里最多留 3 首的临时地址
  const blobCache = new Map();        // 曲目 id -> blob: 地址
  let pendingResume = 0;              // 上次听到哪秒（等用户点播放时再续上）

  /* 后台可整体关掉保护（排障用）：功能开关 → 原声音乐 → 音源保护 */
  function guardOn() {
    try { return typeof featureSelfOn === 'function' ? featureSelfOn('music.guard') : true; }
    catch (e) { return true; }
  }
  /* 必须是「已登录且会话被云端确认」—— 仅本机缓存的乐观身份不算，离线降级也不算 */
  function signedIn() {
    try {
      if (typeof isSignedIn === 'function' && !isSignedIn()) return false;
      if (typeof userRole === 'function' && userRole() === 'guest') return false;
      if (typeof SESSION_CONFIRMED !== 'undefined' && SESSION_CONFIRMED === false) return false;
      return true;
    } catch (e) { return false; }
  }
  function setBuf(p) {                // p: 0~1 进度；-1 = 隐藏
    const b = $('mu-buf');
    if (!b) return;
    if (p < 0) { b.classList.add('hidden'); return; }
    b.classList.remove('hidden');
    const bar = b.firstElementChild, tx = b.lastElementChild;
    if (bar) bar.style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%';
    if (tx) tx.textContent = p >= 1 ? '缓冲完成，开始播放' : '缓冲中 ' + Math.round(p * 100) + '%';
  }
  function trimCache(keepId) {
    const keep = new Set([keepId, curId]);
    Array.from(blobCache.keys()).slice(-BLOB_MAX).forEach(k => keep.add(k));
    for (const [k, u] of Array.from(blobCache)) {
      if (!keep.has(k)) { try { URL.revokeObjectURL(u); } catch (e) { /* 忽略 */ } blobCache.delete(k); }
    }
  }
  /* 取音源：保护开启时走「拉取 → 内存临时地址」，关闭时退回直链 */
  async function srcFor(t) {
    if (!guardOn()) return t.file;
    if (blobCache.has(t.id)) return blobCache.get(t.id);
    const res = await fetch(t.file, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const total = +(res.headers.get('content-length') || 0);
    const parts = [];
    let got = 0;
    if (res.body && res.body.getReader) {
      const rd = res.body.getReader();
      for (;;) {
        const r = await rd.read();
        if (r.done) break;
        parts.push(r.value); got += r.value.length;
        if (total) setBuf(got / total);
      }
    } else {
      const bl = await res.blob();
      parts.push(bl); got = bl.size;
    }
    const url = URL.createObjectURL(new Blob(parts, { type: 'audio/mpeg' }));
    blobCache.set(t.id, url);
    trimCache(t.id);
    return url;
  }

  /* ---------------- v35：页面水印（防录屏外传） ---------------- */
  function wmText() {
    let who = '';
    try { if (typeof userPublicId === 'function') who = userPublicId() || ''; } catch (e) { /* 忽略 */ }
    if (!who) {
      try {
        if (typeof isSignedIn === 'function' && isSignedIn() && typeof userEmail === 'function')
          who = String(userEmail() || '').split('@')[0];
      } catch (e) { /* 忽略 */ }
    }
    if (!who) who = '未登录访问';
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `earthborne-deck.app.workbuddy.host · ${who} · `
      + `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function drawWM() {
    const box = $('mu-wm');
    if (!box) return;
    const txt = wmText();
    const c = document.createElement('canvas');
    c.width = 460; c.height = 160;
    const g = c.getContext('2d');
    let dark = true;
    try {
      const m = /(\d+)[,\s)]+\s*(\d+)[,\s)]+\s*(\d+)/.exec(getComputedStyle(document.body).backgroundColor || '');
      if (m) dark = (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) < 128;
    } catch (e) { /* 忽略 */ }
    g.translate(c.width / 2, c.height / 2);
    g.rotate(-16 * Math.PI / 180);
    g.font = '600 15px system-ui, "Microsoft YaHei", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = dark ? 'rgba(255,255,255,.075)' : 'rgba(0,0,0,.085)';
    g.fillText(txt, 0, 0);
    box.style.backgroundImage = 'url(' + c.toDataURL('image/png') + ')';
    box.dataset.txt = txt;
  }

  /* ---------------- 本机记忆 ---------------- */
  function loadPrefs() {
    try {
      const v = parseFloat(localStorage.getItem(K_VOL));
      if (!isNaN(v)) vol = Math.min(1, Math.max(0, v));
      const m = localStorage.getItem(K_MODE);
      if (MODES.some(x => x.k === m)) mode = m;
      miniHidden = localStorage.getItem(K_MINI) === '0';
      const sp = localStorage.getItem(K_SHAPE);                  // v36
      if (SHAPES.some(x => x.k === sp)) coverShape = sp;
    } catch (e) { /* 忽略 */ }
  }
  function saveLast() {
    try {
      localStorage.setItem(K_LAST, JSON.stringify(
        { id: curId, t: audio ? Math.floor(audio.currentTime) : 0 }));
    } catch (e) { /* 忽略 */ }
  }

  /* ---------------- audio 单例 ---------------- */
  function A() {
    if (audio) return audio;
    audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.volume = vol;
    audio.style.display = 'none';
    audio.controls = false;                       // v35：不出现原生控件（也就没有下载菜单）
    audio.setAttribute('controlsList', 'nodownload');
    audio.setAttribute('disablepictureinpicture', '');
    document.body.appendChild(audio);
    audio.addEventListener('timeupdate', () => { if (!dragging) syncProgress(); saveLastThrottled(); });
    audio.addEventListener('loadedmetadata', () => { syncProgress(); renderNow(); });
    audio.addEventListener('play', () => { rotStart(); renderNow(); renderMini(); renderList(); applyCover(true); });
    audio.addEventListener('pause', () => { rotStop(); renderNow(); renderMini(); applyCover(false); });
    audio.addEventListener('ended', () => {
      if (mode === 'one') { audio.currentTime = 0; audio.play().catch(() => {}); return; }
      go(1, true);
    });
    audio.addEventListener('error', () => {
      const t = byId(curId);
      if (t && window.toast) window.toast('音频加载失败：' + t.title, 3200);
    });
    return audio;
  }
  let lastSave = 0;
  function saveLastThrottled() {
    const now = Date.now();
    if (now - lastSave > 4000) { lastSave = now; saveLast(); }
  }
  /* ---------- v36 / v39b：封面（占位层 + 裁切外框 + 内部图片） ---------- */
  const nowMs = () => (window.performance && performance.now) ? performance.now() : Date.now();
  let rotMs = 0, rotSince = 0, rotRun = false;     // 累计旋转时长 / 本次起转时刻 / 是否在转
  function rotStart() { if (rotRun) return; rotRun = true; rotSince = nowMs(); }
  function rotStop() { if (!rotRun) return; rotMs += nowMs() - rotSince; rotRun = false; }
  function rotTotal() { return rotMs + (rotRun ? nowMs() - rotSince : 0); }

  let coverEl = null;
  function coverBox() {                             // 持久节点：重绘不重建，旋转角度不跳回 0
    if (coverEl) return coverEl;
    /* 三层：.mu-coverwrap 负责占位（方形整体旋转时按对角线放大，防止转角溢出面板）
             .mu-coverbox 负责圆角与裁切（方形旋转时它整体转）
             .mu-cover 图片（圆形旋转时它转 —— 唱片效果，轴孔留在中间不动） */
    const w = el('div', 'mu-coverwrap');
    w.id = 'mu-coverwrap';
    const b = el('div', 'mu-coverbox');
    b.id = 'mu-coverbox';
    const img = document.createElement('img');
    img.className = 'mu-cover'; img.id = 'mu-cover'; img.alt = '';
    img.draggable = false;
    img.src = album.cover || '';
    b.appendChild(img);
    b.appendChild(el('span', 'mu-hole'));          // 唱片轴孔（仅圆形显示）
    w.appendChild(b);
    coverEl = w;
    return w;
  }
  function shapeParts() {
    const p = String(coverShape || DEF_SHAPE).split('-');
    return { shape: p[0] === 'square' ? 'square' : 'circle', spin: p[1] === 'spin' };
  }
  function applyCover(playing) {
    const b = $('mu-coverbox');
    if (!b) return;
    const w = $('mu-coverwrap');
    const s = shapeParts();
    /* 方形旋转 = 整个外框连图一起转；圆形旋转 = 框内图片转（唱片效果，轴孔居中不动） */
    const outer = s.shape === 'square' && s.spin;
    b.className = 'mu-coverbox sh-' + s.shape + ' sp-' + (outer ? 'outer' : 'inner')
      + (s.spin ? ' spin' : '') + (playing && s.spin ? '' : ' paused');
    if (w) w.className = 'mu-coverwrap' + (outer ? ' w-spin' : '');
    /* 用负 delay 把旋转角度接回去，重绘 / 切形状时角度连续（谁在转就作用在谁身上） */
    const d = '-' + (rotTotal() / 1000).toFixed(3) + 's';
    b.style.animationDelay = d;
    const img = b.querySelector('.mu-cover');
    if (img) img.style.animationDelay = d;
    const m = $('mp-cover');                        // 迷你条封面跟着变圆 / 变方（不旋转）
    if (m) { m.classList.remove('sh-circle', 'sh-square'); m.classList.add('sh-' + s.shape); }
    $$('#mu-shapes .mu-shape').forEach(x => x.classList.toggle('on', x.dataset.shape === coverShape));
  }
  function setShape(k) {
    if (!SHAPES.some(x => x.k === k)) return coverShape;
    coverShape = k;
    try { localStorage.setItem(K_SHAPE, k); } catch (e) { /* 忽略 */ }
    const a = audio;
    applyCover(!!(a && !a.paused && !a.ended));
    return coverShape;
  }
  function buildShapes() {
    const box = el('div', 'mu-shapes');
    box.id = 'mu-shapes';
    SHAPES.forEach(s => {
      const b = el('button', 'mu-shape' + (s.k === coverShape ? ' on' : ''), s.icon + ' ' + s.name);
      b.type = 'button'; b.dataset.shape = s.k; b.title = s.tip;
      b.addEventListener('click', () => setShape(s.k));
      box.appendChild(b);
    });
    return box;
  }

  /* ---------------- 播放队列（= 当前筛选结果） ---------------- */
  function filtered() {
    const k = kw.trim().toLowerCase();
    return tracks.filter(t => {
      if (mixOn !== 'all' && t.mix !== mixOn) return false;
      if (!k) return true;
      return String(t.title).toLowerCase().includes(k)
        || String(t.zh || '').toLowerCase().includes(k)
        || String(t.n).includes(k);
    });
  }
  /* 播放用的列表：当前曲目在筛选结果里就用筛选结果，否则退回全集 */
  function queue() {
    const f = filtered();
    if (curId && f.length && !f.some(t => t.id === curId)) return tracks;
    return f.length ? f : tracks;
  }

  /* ---------------- 播放控制 ---------------- */
  function playTrack(id, resumeAt) {
    const t = byId(id);
    if (!t) return Promise.resolve(null);
    /* v35：未登录不给音源（功能开关层面能进音乐页 ≠ 能取音频） */
    if (guardOn() && !signedIn()) {
      if (window.toast) toast('请先登录后再试听原声带 —— 未登录不会加载音源', 3200);
      curId = id;
      renderAll();
      return Promise.resolve(null);
    }
    const a = A();
    /* 保护开启时，只有当现有音源已经是临时地址才算「同一首可复用」——
       否则管理员刚把保护打开、或之前用的是直链，都会继续走直链播放 */
    const same = curId === id && !!a.src && (!guardOn() || /^blob:/.test(a.src));
    curId = id;
    renderList(); renderNow();
    const done = url => {
      if (a.src !== url) { a.src = url; a.load(); }
      if (resumeAt != null) { try { a.currentTime = resumeAt; } catch (e) { /* 忽略 */ } }
      a.play().then(() => { showMini(); }).catch(err => {
        if (window.toast && err && err.name === 'NotAllowedError')
          toast('浏览器拦截了自动播放，再点一次播放即可', 2600);
      });
      renderAll();
      mediaSession(t);
      saveLast();
    };
    if (same) { done(a.src); return Promise.resolve(a.src); }
    setBuf(0.01);
    return srcFor(t).then(url => {
      setBuf(1);
      setTimeout(() => setBuf(-1), 800);
      done(url);
      return url;
    }).catch(e => {
      setBuf(-1);
      if (window.toast) toast('音频载入失败：' + ((e && e.message) || e), 3200);
      renderNow();
      return null;
    });
  }
  /* 用户手势入口：把「上次听到哪秒」接上 */
  function requestPlay(id) {
    let at = 0;
    if (id === curId && pendingResume) at = pendingResume;
    pendingResume = 0;
    return playTrack(id, at);
  }
  function toggle() {
    const a = A();
    if (!curId) { const q = queue(); if (q.length) requestPlay(q[0].id); return; }
    if (a.paused) {
      if (!a.src) { requestPlay(curId); return; }
      a.play().then(() => showMini()).catch(() => {});
    } else a.pause();
  }
  function go(dir, auto) {
    const q = queue();
    if (!q.length) return;
    let i = q.findIndex(t => t.id === curId);
    if (i < 0) i = 0;
    let n;
    if (mode === 'shuf' && q.length > 1) {
      do { n = Math.floor(Math.random() * q.length); } while (n === i);
    } else {
      n = i + dir;
      if (n >= q.length) {
        if (mode === 'seq' && auto) { renderNow(); renderMini(); return; }   // 顺序播放：播完停
        n = 0;
      }
      if (n < 0) n = q.length - 1;
    }
    playTrack(q[n].id);
  }
  function seekTo(sec) {
    const a = A();
    if (!a.duration || isNaN(a.duration)) return;
    a.currentTime = Math.min(a.duration - 0.2, Math.max(0, sec));
    syncProgress();
  }
  function setVol(v) {
    vol = Math.min(1, Math.max(0, v));
    A().volume = vol;
    try { localStorage.setItem(K_VOL, String(vol)); } catch (e) { /* 忽略 */ }
    const s = $('mu-vol'); if (s) s.value = String(Math.round(vol * 100));
  }
  function cycleMode() {
    const i = MODES.findIndex(m => m.k === mode);
    mode = MODES[(i + 1) % MODES.length].k;
    try { localStorage.setItem(K_MODE, mode); } catch (e) { /* 忽略 */ }
    renderNow();
  }
  function mediaSession(t) {
    if (!('mediaSession' in navigator) || !t) return;
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: t.title, artist: album.artist || 'Tom Figgins',
        album: album.title || 'Earthborne Rangers Original Soundtrack',
        artwork: album.cover ? [{ src: album.cover, sizes: '512x512', type: 'image/webp' }] : [],
      });
      navigator.mediaSession.setActionHandler('play', () => A().play().catch(() => {}));
      navigator.mediaSession.setActionHandler('pause', () => A().pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => go(-1));
      navigator.mediaSession.setActionHandler('nexttrack', () => go(1));
    } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 渲染：曲目表 ---------------- */
  function renderList() {
    const box = $('mu-list');
    if (!box) return;
    const list = filtered();
    box.textContent = '';
    if (!list.length) {
      box.appendChild(el('div', 'mu-empty', tracks.length ? '没有匹配的曲目' : '尚未载入曲目数据'));
      const st = $('mu-stat');
      if (st) st.textContent = tracks.length ? `0 / ${tracks.length} 首` : '曲目数据未载入';
      return;
    }
    list.forEach(t => {
      const row = el('button', 'mu-row' + (t.id === curId ? ' on' : ''));
      row.type = 'button';
      row.dataset.id = t.id;
      row.appendChild(el('span', 'mu-num', String(t.n).padStart(2, '0')));
      const mid = el('span');
      mid.appendChild(el('div', 'mu-t1', t.title));
      if (t.zh) mid.appendChild(el('div', 'mu-t2', t.zh));
      else if (album.title) mid.appendChild(el('div', 'mu-t2', '—'));
      row.appendChild(mid);
      row.appendChild(el('span', 'mu-tag', MIX_NAME[t.mix] || t.mix || ''));
      row.appendChild(el('span', 'mu-dur', mmss(t.dur)));
      row.addEventListener('click', () => requestPlay(t.id));
      box.appendChild(row);
    });
    const st = $('mu-stat');
    if (st) {
      const total = list.reduce((n, t) => n + (t.dur || 0), 0);
      st.textContent = `${list.length} / ${tracks.length} 首 · 共 ${Math.round(total / 60)} 分钟`;
    }
  }

  /* ---------------- 渲染：右侧当前播放 ---------------- */
  function renderNow() {
    const box = $('mu-now');
    if (!box) return;
    const t = byId(curId);
    const a = audio;
    const playing = !!(a && !a.paused && !a.ended);
    box.textContent = '';

    /* v36：封面（持久节点，重绘不重置旋转角度）+ 形状切换 */
    box.appendChild(coverBox());
    box.appendChild(buildShapes());
    applyCover(playing);
    box.appendChild(el('div', 'mu-now-t', t ? t.title : '未选择曲目'));
    box.appendChild(el('div', 'mu-now-z', t ? (t.zh || '') : '点左侧任意一首开始播放'));
    box.appendChild(el('div', 'mu-now-a',
      `${album.artist || 'Tom Figgins'}${album.year ? ' · ' + album.year : ''}`));

    const seek = document.createElement('input');
    seek.type = 'range'; seek.className = 'mu-seek'; seek.id = 'mu-seek';
    seek.min = '0'; seek.max = '1000'; seek.value = '0'; seek.disabled = !t;
    seek.addEventListener('input', () => {
      dragging = true;
      if (a && a.duration) {
        const p = +seek.value / 1000;
        $('mu-cur').textContent = mmss(p * a.duration);
      }
    });
    seek.addEventListener('change', () => {
      dragging = false;
      if (a && a.duration) seekTo(+seek.value / 1000 * a.duration);
    });
    box.appendChild(seek);

    const tm = el('div', 'mu-times');
    tm.appendChild(el('span', '', '')).id = 'mu-cur';
    tm.lastChild.id = 'mu-cur';
    tm.appendChild(el('span', '', '')).id = 'mu-tot';
    tm.lastChild.id = 'mu-tot';
    box.appendChild(tm);

    const ctrl = el('div', 'mu-ctrl');
    const mk = (ico, cls, title, fn) => {
      const b = el('button', 'mu-btn' + (cls ? ' ' + cls : ''), ico);
      b.type = 'button'; b.title = title; b.addEventListener('click', fn);
      return b;
    };
    ctrl.appendChild(mk('⏮', '', '上一首', () => go(-1)));
    ctrl.appendChild(mk(playing ? '⏸' : '▶', 'play', playing ? '暂停' : '播放', toggle));
    ctrl.appendChild(mk('⏭', '', '下一首', () => go(1)));
    box.appendChild(ctrl);

    const ex = el('div', 'mu-extra');
    const m = MODES.find(x => x.k === mode) || MODES[0];
    const mb = el('button', 'mu-mode', m.icon + ' ' + m.name);
    mb.type = 'button';
    mb.id = 'mu-mode-btn';
    mb.title = '切换播放模式';
    mb.addEventListener('click', cycleMode);
    ex.appendChild(mb);

    const vw = el('span', '', '🔊');
    vw.style.fontSize = '.9rem';
    ex.appendChild(vw);
    const v = document.createElement('input');
    v.type = 'range'; v.className = 'mu-vol'; v.id = 'mu-vol';
    v.min = '0'; v.max = '100'; v.value = String(Math.round(vol * 100));
    v.title = '音量';
    v.addEventListener('input', () => setVol(+v.value / 100));
    ex.appendChild(v);
    box.appendChild(ex);

    box.appendChild(el('div', 'mu-tip',
      '快捷键：空格 播放/暂停 · ← → 快退/快进 5 秒 · Ctrl + ← → 切上一首/下一首'));
    if (album.note) box.appendChild(el('div', 'mu-tip', album.note));

    syncProgress();
  }

  function syncProgress() {
    const a = audio, sk = $('mu-seek');
    if (!a) return;
    const d = a.duration || (byId(curId) ? byId(curId).dur : 0) || 0;
    const cur = $('mu-cur'), tot = $('mu-tot');
    if (cur) cur.textContent = mmss(a.currentTime);
    if (tot) tot.textContent = mmss(d);
    if (sk && !dragging && d) sk.value = String(Math.round(a.currentTime / d * 1000));
    /* 迷你条 */
    const f = $('mp-fill');
    if (f && d) f.style.width = (a.currentTime / d * 100).toFixed(1) + '%';
    const mt = $('mp-time');
    if (mt) mt.textContent = mmss(a.currentTime);
  }

  /* ---------------- 渲染：底部迷你条 ---------------- */
  function showMini() {
    miniHidden = false;
    try { localStorage.setItem(K_MINI, '1'); } catch (e) { /* 忽略 */ }
    const m = $('mini-player');
    if (m) m.classList.remove('hidden');
  }
  function hideMini() {
    miniHidden = true;
    try { localStorage.setItem(K_MINI, '0'); } catch (e) { /* 忽略 */ }
    const m = $('mini-player');
    if (m) m.classList.add('hidden');
  }
  function renderMini() {
    const m = $('mini-player');
    if (!m) return;
    if (!curId) { m.classList.add('hidden'); return; }
    if (!miniHidden) m.classList.remove('hidden');
    const t = byId(curId), a = audio;
    const c = $('mp-cover');
    if (c && album.cover) c.src = album.cover;
    applyCover(!!(a && !a.paused && !a.ended));     // v36：迷你条封面跟着当前形状
    const tt = $('mp-t'), ss = $('mp-s');
    if (tt) tt.textContent = t ? t.title : '';
    if (ss) ss.textContent = t ? ((t.zh ? t.zh + ' · ' : '') + (MIX_NAME[t.mix] || '')) : '';
    const pb = $('mp-play');
    if (pb) pb.textContent = (a && !a.paused && !a.ended) ? '⏸' : '▶';
    syncProgress();
  }

  /* ---------------- 骨架 ---------------- */
  function build() {
    const root = $('music-root');
    if (!root) return;
    root.textContent = '';
    const wrap = el('div', 'mu-wrap');

    const left = el('div');
    const head = el('div', 'mu-head');
    head.appendChild(el('span', 'mu-title-lg', '🎵 ' + (album.zh || '官方原声带')));
    head.appendChild(el('span', 'mu-sub',
      `${album.artist || ''}${album.year ? ' · ' + album.year : ''} · ${tracks.length} 首`));
    const q = document.createElement('input');
    q.className = 'mu-search'; q.id = 'mu-q';
    q.type = 'search';
    q.placeholder = '搜索曲名 / 中文译名…';
    q.addEventListener('input', () => { kw = q.value; renderList(); });
    head.appendChild(q);
    const chips = el('div', 'mu-chips');
    chips.id = 'mu-mix';
    [['all', '全部'], ['stereo', '立体声混音'], ['binaural', '双耳混音']].forEach(([k, lbl]) => {
      const b = el('button', 'mu-chip' + (k === mixOn ? ' on' : ''), lbl);
      b.type = 'button'; b.dataset.mix = k;
      b.addEventListener('click', () => {
        mixOn = k;
        $$('#mu-mix .mu-chip').forEach(x => x.classList.toggle('on', x.dataset.mix === k));
        renderList();
      });
      chips.appendChild(b);
    });
    head.appendChild(chips);
    left.appendChild(head);
    left.appendChild(el('div', 'mu-stat', '')).id = 'mu-stat';
    /* v35：缓冲进度条（临时地址方式要先取完才能播 / 才能拖进度） */
    const buf = el('div', 'mu-buf hidden');
    buf.id = 'mu-buf';
    buf.appendChild(el('i'));
    buf.appendChild(el('span', '', '缓冲中 0%'));
    left.appendChild(buf);
    left.appendChild(el('div', 'mu-list')).id = 'mu-list';
    wrap.appendChild(left);

    wrap.appendChild(el('div', 'mu-now')).id = 'mu-now';
    root.appendChild(wrap);

    /* v35：浮动水印层（不挡点击），配合音源随机化做来源留痕 */
    const wm = el('div', 'mu-wm');
    wm.id = 'mu-wm';
    wm.setAttribute('aria-hidden', 'true');
    root.appendChild(wm);

    /* v35：版权与试听声明 */
    const cr = el('div', 'mu-cr');
    cr.id = 'mu-cr';
    cr.appendChild(el('b', '', '版权与试听声明'));
    cr.appendChild(el('p', '',
      '本原声带为《Earthborne Rangers》官方 OST，作曲 Tom Figgins，版权归 Earthborne Games 与原作者所有。'
      + '本站仅为中文玩家提供在线试听与曲目中文对照，不提供下载，也不授权任何形式的二次分发。'));
    cr.appendChild(el('p', 'mu-cr-s',
      '音频以临时流方式播放（页面里不会出现可复制的文件地址），也请不要录下来外传 —— 喜欢请支持正版。'
      + '如权利人或官方要求下架，我们将立即移除。'));
    root.appendChild(cr);

    /* v35：禁右键 / 禁拖拽 / 禁「网页另存为」 */
    root.addEventListener('contextmenu', e => e.preventDefault());
    root.addEventListener('dragstart', e => e.preventDefault());

    buildMini();
    drawWM();
    if (!wmTimer) wmTimer = setInterval(() => {
      if ($('music-root') && $('music-root').offsetParent) drawWM();
    }, 60000);
  }
  let wmTimer = null;
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function buildMini() {
    let m = $('mini-player');
    if (!m) {
      m = el('div', 'mini-player hidden');
      m.id = 'mini-player';
      document.body.appendChild(m);
    }
    m.textContent = '';
    const cv = document.createElement('img');
    cv.className = 'mp-cover'; cv.id = 'mp-cover'; cv.alt = '';
    m.appendChild(cv);
    const info = el('div', 'mp-info');
    info.appendChild(el('div', 'mp-t')).id = 'mp-t';
    info.appendChild(el('div', 'mp-s')).id = 'mp-s';
    m.appendChild(info);
    const mk = (ico, cls, title, fn) => {
      const b = el('button', 'mp-btn' + (cls ? ' ' + cls : ''), ico);
      b.type = 'button'; b.title = title; b.id = title === '播放/暂停' ? 'mp-play' : '';
      b.addEventListener('click', fn);
      return b;
    };
    m.appendChild(mk('⏮', '', '上一首', () => go(-1)));
    const pb = mk('▶', 'play', '播放/暂停', toggle);
    m.appendChild(pb);
    m.appendChild(mk('⏭', '', '下一首', () => go(1)));
    const bar = el('div', 'mp-bar');
    bar.id = 'mp-bar';
    bar.title = '点击跳转';
    bar.appendChild(el('div', 'mp-bar-fill')).id = 'mp-fill';
    bar.addEventListener('click', e => {
      const a = A();
      if (!a.duration) return;
      const r = bar.getBoundingClientRect();
      seekTo((e.clientX - r.left) / r.width * a.duration);
    });
    m.appendChild(bar);
    m.appendChild(el('span', 'mp-time', '0:00')).id = 'mp-time';
    const open = mk('🎵', '', '打开原声音乐', () => { location.hash = '#music'; });
    open.id = 'mp-open';
    m.appendChild(open);
    const close = mk('✕', '', '关闭', hideMini);
    close.id = 'mp-close';
    m.appendChild(close);
  }

  function renderAll() { renderList(); renderNow(); renderMini(); }

  /* ---------------- 快捷键（仅在本系统可见时响应） ---------------- */
  function bindKeys() {
    document.addEventListener('keydown', e => {
      const root = $('music-root');
      if (!root || !root.offsetParent) return;
      const t = e.target;
      if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
      const a = A();
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); return; }  // v35：禁另存为
      if (e.key === ' ') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) go(-1); else if (a.src) seekTo(a.currentTime - 5);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) go(1); else if (a.src) seekTo(a.currentTime + 5);
      }
    });
  }

  let bootedNow = false;
  window.MusicApp = {
    boot() {
      if (booted) return;
      booted = true;
      const d = data();
      album = (d && d.album) || {};
      tracks = (d && d.tracks) || [];
      loadPrefs();
      build();
      bindKeys();
      renderAll();
      /* 恢复上次听到哪首（不自动播放 —— 浏览器要求用户手势）
         v35：不再预先加载音源，等用户点播放时才取（未登录也就不会碰到音频文件） */
      let last = null;
      try { last = JSON.parse(localStorage.getItem(K_LAST) || 'null'); } catch (e) { /* 忽略 */ }
      if (last && byId(last.id)) {
        curId = last.id;
        pendingResume = +last.t || 0;
        mediaSession(byId(last.id));
        renderAll();
      }
      drawWM();
    },
    get ready() { return booted; },
    /* 供 app.js / 其它系统调用 */
    get state() {
      const a = audio;
      return {
        count: tracks.length, curId,
        playing: !!(a && !a.paused && !a.ended),
        mode, vol, miniHidden, shape: coverShape,
        title: (byId(curId) || {}).title || '',
        t: a ? a.currentTime : 0,
      };
    },
    play(id) { if (id) requestPlay(id); else toggle(); return curId; },
    /* v35：供后台 / 测试查看音源保护状态 */
    get guard() {
      return {
        on: guardOn(), signedIn: signedIn(),
        src: audio ? (audio.src || '') : '',
        isBlob: audio ? /^blob:/.test(audio.src || '') : false,
        cached: blobCache.size,
        watermark: ($('mu-wm') || {}).dataset ? ($('mu-wm').dataset.txt || '') : '',
      };
    },
    redrawWM: drawWM,
    pause() { const a = A(); if (a) a.pause(); },
    next() { go(1); return curId; },
    prev() { go(-1); return curId; },
    setMode(m) { if (MODES.some(x => x.k === m)) { mode = m; renderNow(); } return mode; },
    setVol,
    setMix(m) {
      mixOn = ['all', 'stereo', 'binaural'].includes(m) ? m : 'all';
      $$('#mu-mix .mu-chip').forEach(x => x.classList.toggle('on', x.dataset.mix === mixOn));
      renderList();
      return mixOn;
    },
    search(k) { kw = String(k || ''); const q = $('mu-q'); if (q) q.value = kw; renderList(); return filtered().length; },
    get shape() { return coverShape; },
    setShape,
    get shapes() { return SHAPES.map(s => s.k); },
    render: renderAll,
  };
})();
