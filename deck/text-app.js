/* ============================================================
   文本查询系统（第三子系统 · 管理员可用）
   —— 规则书 / 战役书 PDF 原页图片浏览 + 内置全文检索
   图片由 _extract/build_books.py 从 PDF 逐页生成（books/<id>/p*.webp）
   检索用每页文本层（data-books.js 的 text 字段），命中后跳到对应页图
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

  let books = [];
  let curBook = 0, curPage = 0;         // 当前书 / 当前页（0-based）
  let q = '', hits = [], hitIdx = -1;
  let scope = { mode: 'all', kind: '' };  // v31 检索范围：all 全部 / book 本册 / kind 某类别
  let findQ = '', kindOn = '全部';        // 导览侧栏：书名搜索 / 类别筛选
  /* v33：侧栏两大分组 —— PDF 资料 / 卡牌图集，各自可折叠（状态记在本机） */
  const SIDE_GROUPS = [
    { key: 'pdf',   icon: '📄', label: 'PDF 资料' },
    { key: 'cards', icon: '🃏', label: '卡牌图集' },
  ];
  const COLLAPSE_KEY = 'eb_tx_side_collapse';
  let collapsed = { pdf: false, cards: false };
  try {
    const s0 = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}');
    if (s0 && typeof s0 === 'object') for (const g of SIDE_GROUPS) collapsed[g.key] = !!s0[g.key];
  } catch (e) { /* 忽略坏数据 */ }
  function saveCollapsed() {
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed)); } catch (e) { /* 忽略 */ }
  }
  /* 一册属于哪个分组：卡牌图集（data 里 src === 'cards'） / 其余都算 PDF 资料 */
  const groupOf = b => (b && b.src === 'cards') ? 'cards' : 'pdf';
  /* v33：这类卡牌图集对当前用户是否可见（后台「卡牌图集权限」逐类设定） */
  function bookVisible(b) {
    if (groupOf(b) !== 'cards') return true;      // PDF 资料只看文本系统总开关
    if (typeof window.textCardVisible !== 'function') return true;
    return window.textCardVisible(b.id) !== false;
  }
  /* v31 页图缩放：默认 50%（整页完整呈现），每 25% 一档，最大 300% */
  const ZOOM_MIN = 25, ZOOM_MAX = 300, ZOOM_STEP = 25, ZOOM_DEF = 50;
  let zoom = ZOOM_DEF;
  let metaEditing = false;               // v31：是否正在编辑书名 / 类别

  const bookData = () => (window.BOOKS || (typeof BOOKS !== 'undefined' ? BOOKS : []));
  const cur = () => books[curBook] || { title: '（空）', pages: [] };
  const pageCount = () => (cur().pages || []).length;
  const kindOf = b => b.kind || '资料';
  /* v31：书名 / 类别是否可编辑（管理员 + 后台「书籍信息编辑与推送」开关开启） */
  const canEditMeta = () => typeof window.bookMetaEditable === 'function' && window.bookMetaEditable() === true;
  /* 离线版：原页扫描图（books/，约 2.4GB）不随包发布 —— 打包脚本会置
     window.__BOOKS_IMG_OFF__ = true。此时正文只给文字层和一句说明，
     不再为每一页发出注定 404 的图片请求（整本书会刷出上百条 404）。 */
  const NO_SCAN = () => { try { return !!window.__BOOKS_IMG_OFF__; } catch (e) { return false; } };
  /* 只对「PDF 资料」这类生效：卡牌图集用的是 images/*.webp，离线包里本来就有 */
  const noScanBook = b => NO_SCAN() && groupOf(b) === 'pdf';

  /* v31：检索范围（全部 / 本册 / 某个类别） */
  function inScope(bi) {
    if (!bookVisible(books[bi] || {})) return false;   // v33：无权限的卡牌图集不参与检索
    if (scope.mode === 'book') return bi === curBook;
    if (scope.mode === 'kind') return kindOf(books[bi] || {}) === scope.kind;
    return true;
  }
  function scopeLabel() {
    if (scope.mode === 'book') return '本册《' + (cur().title || '？') + '》';
    if (scope.mode === 'kind') return '类别「' + scope.kind + '」';
    return '全部书籍';
  }
  /* ---------- 检索 ---------- */
  function runSearch(key) {
    const k = String(key || '').trim().toLowerCase();
    hits = []; hitIdx = -1;
    if (!k) return;
    books.forEach((b, bi) => {
      if (!inScope(bi)) return;
      (b.pages || []).forEach((pg, pi) => {
        const t = String(pg.text || ''), low = t.toLowerCase();
        let p = low.indexOf(k);
        if (p < 0) return;
        let n = 0;
        while (p >= 0 && n < 99) { n++; p = low.indexOf(k, p + k.length); }
        hits.push({ b: bi, p: pi, n });
      });
    });
    hitIdx = hits.length ? 0 : -1;
  }
  function snippet(text, key, len) {
    const t = String(text || '');
    const p = t.toLowerCase().indexOf(String(key || '').toLowerCase());
    const L = len || 100;
    const start = p < 0 ? 0 : Math.max(0, p - Math.floor(L / 3));
    return (start > 0 ? '…' : '') + t.slice(start, start + L).replace(/\n/g, ' ') + '…';
  }
  function hlHTML(text, key) {
    const t = String(text || '');
    const k = String(key || '').trim();
    if (!k) return esc(t);
    const low = t.toLowerCase(), kk = k.toLowerCase();
    let out = '', i = 0;
    for (;;) {
      const p = low.indexOf(kk, i);
      if (p < 0) { out += esc(t.slice(i)); break; }
      out += esc(t.slice(i, p)) + '<mark>' + esc(t.slice(p, p + kk.length)) + '</mark>';
      i = p + kk.length;
    }
    return out;
  }
  /* 每页命中数：给缩略图打标 */
  function hitMapOf() {
    const m = {};
    hits.forEach(h => { m[h.b + ':' + h.p] = (m[h.b + ':' + h.p] || 0) + h.n; });
    return m;
  }

  /* ---------- 渲染：导览侧栏（搜索 + 类别筛选 + 书籍列表） ---------- */
  /* v33：类别统计只算当前用户看得见的册 */
  function allKinds() {
    const seen = [], n = {};
    books.forEach(b => {
      if (!bookVisible(b)) return;
      const k = kindOf(b); if (!n[k]) { n[k] = 0; seen.push(k); } n[k]++;
    });
    return { order: seen, count: n };
  }
  function matched() {
    const k = findQ.trim().toLowerCase();
    return books.map((b, i) => ({ b, i })).filter(({ b }) => {
      if (!bookVisible(b)) return false;                       // v33：无权限的卡牌图集不出现在侧栏
      if (kindOn !== '全部' && kindOf(b) !== kindOn) return false;
      if (!k) return true;
      return (b.title || '').toLowerCase().includes(k)
        || kindOf(b).toLowerCase().includes(k)
        || (b.note || '').toLowerCase().includes(k);
    });
  }
  function renderFilters() {
    const box = $('tx-filters');
    if (!box) return;
    const { order, count } = allKinds();
    box.textContent = '';
    const chip = (label, n) => {
      const b = el('button', 'tx-fchip' + (kindOn === label ? ' on' : ''),
        n == null ? label : `${label} ${n}`);
      b.type = 'button';
      b.addEventListener('click', () => { kindOn = label; renderFilters(); renderBooks(); });
      return b;
    };
    box.appendChild(chip('全部', books.length));
    order.forEach(k => box.appendChild(chip(k, count[k])));
  }
  /* v33：侧栏按「PDF 资料 / 卡牌图集」两大分组渲染，每组一个可折叠的组头 */
  function renderBooks() {
    const box = $('tx-books');
    box.textContent = '';
    const list = matched();
    if (!list.length) {
      box.appendChild(el('div', 'tx-empty',
        books.length ? '没有匹配的书籍（也可能是你没有查看该类卡牌的权限）' : '没有书籍'));
      return;
    }
    const hidden = books.length - list.length;
    if (hidden > 0) box.appendChild(el('div', 'tx-list-head', `筛选出 ${list.length} / ${books.length} 本`));

    SIDE_GROUPS.forEach(g => {
      const items = list.filter(({ b }) => groupOf(b) === g.key);
      const total = books.filter(b => groupOf(b) === g.key).length;
      if (!total) return;
      const sec = el('div', 'tx-sec');
      sec.dataset.group = g.key;
      const open = !collapsed[g.key];
      const head = el('button', 'tx-sec-head' + (open ? ' open' : ''));
      head.type = 'button';
      head.id = 'tx-sec-' + g.key;
      head.dataset.group = g.key;
      head.title = open ? `收起「${g.label}」` : `展开「${g.label}」`;
      head.appendChild(el('span', 'tx-sec-arrow', open ? '▼' : '▶'));
      head.appendChild(el('span', 'tx-sec-icon', g.icon));
      head.appendChild(el('b', 'tx-sec-label', g.label));
      head.appendChild(el('span', 'tx-sec-n', `${items.length} / ${total}`));
      head.addEventListener('click', () => {
        collapsed[g.key] = !collapsed[g.key];
        saveCollapsed(); renderBooks();
      });
      sec.appendChild(head);
      if (open) {
        const wrap = el('div', 'tx-sec-body');
        wrap.id = 'tx-sec-body-' + g.key;
        if (!items.length) {
          wrap.appendChild(el('div', 'tx-empty', '（这一类当前没有可查看的册）'));
        } else {
          items.forEach(({ b, i }) => wrap.appendChild(bookChip(b, i)));
        }
        sec.appendChild(wrap);
      }
      box.appendChild(sec);
    });
  }
  function bookChip(b, i) {
    const chip = el('button', 'tx-book' + (i === curBook ? ' on' : ''));
    chip.type = 'button';
    chip.dataset.book = b.id;
    chip.appendChild(el('span', 'tx-bk-kind', kindOf(b)));
    chip.appendChild(el('span', 'tx-bk-title', b.title || '未命名'));
    chip.appendChild(el('span', 'tx-bk-n', (b.pages || []).length + ' 页'));
    chip.addEventListener('click', () => {
      curBook = i; curPage = 0;
      runSearch(q);
      renderAll();
    });
    return chip;
  }

  /* ---------- 渲染：缩略图 / 检索结果 ---------- */
  function renderList() {
    const box = $('tx-list');
    box.textContent = '';
    const key = q.trim();
    if (key) {
      box.appendChild(el('div', 'tx-list-head',
        `检索「${key}」· ${hits.length} 页命中 · 范围：${scopeLabel()}`));
      if (!hits.length) {
        box.appendChild(el('div', 'tx-empty', '没有找到匹配的页面'));
        return;
      }
      const curHits = hits.filter(h => h.b === curBook);
      hits.forEach((h, idx) => {
        const b = books[h.b], pg = (b.pages || [])[h.p];
        const row = el('button', 'tx-row' + (idx === hitIdx ? ' on' : ''));
        row.type = 'button';
        row.appendChild(el('span', 'tx-row-book', `${b.title} · 第 ${pg.n} 页 · ${h.n} 处`));
        const sn = el('span', 'tx-row-snip');
        sn.innerHTML = hlHTML(snippet(pg.text, key), key);
        row.appendChild(sn);
        row.addEventListener('click', () => { hitIdx = idx; openHit(idx, false); });
        box.appendChild(row);
      });
      if (!curHits.length) {
        box.appendChild(el('div', 'tx-empty', '当前书没有命中，结果在其它书中'));
      }
      return;
    }
    const b = cur();
    box.appendChild(el('div', 'tx-list-head', `${b.title} · 共 ${pageCount()} 页`));
    const grid = el('div', 'tx-thumbs');
    (b.pages || []).forEach((pg, i) => {
      const cell = el('button', 'tx-thumb' + (i === curPage ? ' on' : ''));
      cell.type = 'button';
      cell.title = '第 ' + pg.n + ' 页';
      if (!noScanBook(b)) {
        const im = el('img', 'tx-thumb-img');
        im.loading = 'lazy';
        im.src = pg.thumb;
        im.alt = '第 ' + pg.n + ' 页';
        cell.appendChild(im);
      }
      cell.appendChild(el('span', 'tx-thumb-n', String(pg.n)));
      cell.addEventListener('click', () => { curPage = i; renderList(); renderDoc(); });
      grid.appendChild(cell);
    });
    box.appendChild(grid);
    if (b.note) box.appendChild(el('div', 'tx-doc-note', b.note));
  }

  /* ---------- v31：检索范围条（全部 / 本册 / 各类别） ---------- */
  function renderScope() {
    const box = $('tx-scope');
    if (!box) return;
    box.textContent = '';
    const { order, count } = allKinds();
    const add = (label, txt, on, fn, title) => {
      const b = el('button', 'tx-schip' + (on ? ' on' : ''), txt);
      b.type = 'button';
      if (title) b.title = title;
      b.dataset.scope = label;
      b.addEventListener('click', fn);
      box.appendChild(b);
    };
    add('all', `全部 ${books.length} 本`, scope.mode === 'all',
      () => { scope = { mode: 'all', kind: '' }; renderScope(); rerun(); }, '在所有书里检索');
    add('book', '本册', scope.mode === 'book',
      () => { scope = { mode: 'book', kind: '' }; renderScope(); rerun(); },
      '只在当前打开的这册里检索');
    order.forEach(k => add('kind:' + k, `${k} ${count[k]}`, scope.mode === 'kind' && scope.kind === k,
      () => { scope = { mode: 'kind', kind: k }; renderScope(); rerun(); }, `只在类别「${k}」里检索`));
  }
  /* 改了范围立刻重跑检索（保留关键词与当前命中位置） */
  function rerun() {
    runSearch(q);
    if (q.trim() && hits.length) openHit(0, false);
    else { renderList(); renderDoc(); renderStat(); }
  }

  /* ---------- v31：书名 / 类别（Tag）编辑条（管理员） ---------- */
  function renderMetaBar() {
    const box = $('tx-meta');
    if (!box) return;
    const b = cur();
    box.textContent = '';
    const editable = canEditMeta();

    if (metaEditing && editable) {
      const f = el('form', 'tx-meta-form');
      f.onsubmit = e => { e.preventDefault(); saveMeta(); };
      const it = el('input', 'tx-meta-in');
      it.id = 'tx-ed-title'; it.type = 'text'; it.maxLength = 40;
      it.value = b.title || ''; it.placeholder = '书名';
      f.appendChild(it);
      const ik = el('input', 'tx-meta-in tx-meta-kind');
      ik.id = 'tx-ed-kind'; ik.type = 'text'; ik.maxLength = 12; ik.setAttribute('list', 'tx-kind-list');
      ik.value = kindOf(b); ik.placeholder = '类别标签';
      f.appendChild(ik);
      const dl = el('datalist');
      dl.id = 'tx-kind-list';
      allKinds().order.forEach(k => { const o = el('option'); o.value = k; dl.appendChild(o); });
      f.appendChild(dl);
      const ok = el('button', 'btn btn-sm btn-primary', '保存并推送');
      ok.type = 'submit';
      f.appendChild(ok);
      const no = el('button', 'btn btn-sm', '取消');
      no.type = 'button';
      no.onclick = () => { metaEditing = false; renderMetaBar(); };
      f.appendChild(no);
      const rs = el('button', 'btn btn-sm', '恢复内置');
      rs.type = 'button';
      rs.title = '清掉云端覆盖，恢复数据文件里的原始书名与类别';
      rs.onclick = async () => {
        if (typeof window.adminClearBookMeta !== 'function') return;
        rs.disabled = true; rs.textContent = '恢复中…';
        const r = await window.adminClearBookMeta(b.id);
        rs.disabled = false; rs.textContent = '恢复内置';
        metaEditing = false;
        if (r.error) { toastText('恢复失败：' + (r.error.message || ''), true); return; }
        toastText('已恢复内置书名 / 类别');
        renderMetaBar(); renderAll();
      };
      f.appendChild(rs);
      box.appendChild(f);
      box.appendChild(el('span', 'tx-meta-tip', '改完点「保存并推送」，所有用户下次打开即看到'));
      return;
    }

    const chip = el('span', 'tx-meta-kind-tag', kindOf(b));
    box.appendChild(chip);
    box.appendChild(el('span', 'tx-meta-title', b.title || '未命名'));
    if (b.note) box.appendChild(el('span', 'tx-meta-note', b.note));
    const spacer = el('span', 'flex-spacer');
    box.appendChild(spacer);
    if (editable) {
      const ed = el('button', 'btn btn-sm', '✎ 改书名 / 类别');
      ed.type = 'button';
      ed.id = 'tx-edit-meta';
      ed.title = '管理员：改这本书的书名与类别标签，保存后推送给所有用户';
      ed.onclick = () => { metaEditing = true; renderMetaBar(); setTimeout(() => { const t = $('tx-ed-title'); if (t) t.focus(); }, 0); };
      box.appendChild(ed);
    }
  }
  async function saveMeta() {
    const b = cur();
    const title = ($('tx-ed-title')?.value || '').trim();
    const kind = ($('tx-ed-kind')?.value || '').trim();
    if (!title && !kind) { toastText('书名和类别不能都为空', true); return; }
    if (typeof window.adminSetBookMeta !== 'function') { toastText('云端未就绪，无法保存', true); return; }
    toastText('正在保存并推送…');
    const r = await window.adminSetBookMeta(b.id, title, kind);
    if (r.error) { toastText('保存失败：' + (r.error.message || ''), true); return; }
    metaEditing = false;
    toastText('已保存并推送：' + (title || b.title));
    renderMetaBar(); renderAll();
  }
  function toastText(msg, bad) {
    if (typeof window.toast === 'function') { window.toast(msg, bad ? 3600 : 2400); return; }
    const t = $('tx-toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'tx-toast' + (bad ? ' bad' : '');
    clearTimeout(toastText._t);
    toastText._t = setTimeout(() => { t.textContent = ''; }, 2600);
  }

  /* ---------- 渲染：页图 ---------- */
  function renderDoc() {
    const box = $('tx-doc');
    box.textContent = '';
    const b = cur();
    const pg = (b.pages || [])[curPage];
    if (!pg) { box.appendChild(el('div', 'tx-empty', '左侧选择一页')); return; }

    /* 命中片段条 */
    const key = q.trim();
    const mine = hits.filter(h => h.b === curBook && h.p === curPage);
    if (key && mine.length) {
      const bar = el('div', 'tx-hitbar');
      bar.appendChild(el('span', 'tx-hitbar-l', `本页 ${mine.reduce((n, h) => n + h.n, 0)} 处命中`));
      const sn = el('span', 'tx-hitbar-snip');
      sn.innerHTML = hlHTML(snippet(pg.text, key, 160), key);
      bar.appendChild(sn);
      const goto = el('button', 'btn btn-sm', '定位到结果');
      goto.type = 'button';
      goto.addEventListener('click', () => {
        const idx = hits.findIndex(h => h.b === curBook && h.p === curPage);
        if (idx >= 0) { hitIdx = idx; renderList(); renderStat(); }
      });
      bar.appendChild(goto);
      box.appendChild(bar);
    }

    const stage = el('div', 'tx-stage');
    if (noScanBook(b)) {
      const ph = el('div', 'tx-noscan');
      ph.innerHTML = `<b>本页扫描图未随离线包发布</b>
        <span>全书文字检索、页码定位、卡牌图集都可用；需要对照原版排版时请打开本地 PDF
        （规则手册 / 先祖遗产 / 引入山谷战役书）。</span>`;
      stage.appendChild(ph);
    } else {
      const img = el('img', 'tx-page');
      img.id = 'tx-page';
      img.src = pg.img;
      img.alt = `${b.title} 第 ${pg.n} 页`;
      img.style.width = zoom + '%';        // v31：默认 50% 整页完整呈现，可 25%~300% 调
      stage.appendChild(img);
    }
    box.appendChild(stage);

    /* 预取前后页，翻页更顺（离线版无扫描图，不用预取） */
    if (!noScanBook(b)) {
      [curPage + 1, curPage - 1].forEach(i => {
        const p2 = (b.pages || [])[i];
        if (p2) { const im = new Image(); im.src = p2.img; }
      });
    }

    renderPager();
  }

  function renderPager() {
    const b = cur(), pg = (b.pages || [])[curPage];
    const bar = $('tx-pager');
    bar.textContent = '';
    const mk = (txt, fn, cls, title) => {
      const btn = el('button', 'btn btn-sm' + (cls ? ' ' + cls : ''), txt);
      btn.type = 'button';
      if (title) btn.title = title;
      btn.addEventListener('click', fn);
      return btn;
    };
    bar.appendChild(mk('◀ 上一页', () => go(-1), '', '键盘 ←'));
    const inp = el('input', 'tx-pnum');
    inp.type = 'number';
    inp.min = 1; inp.max = pageCount();
    inp.value = curPage + 1;
    inp.title = '跳页（原书页码请对照缩略图）';
    inp.addEventListener('change', () => {
      const n = Math.min(pageCount(), Math.max(1, +inp.value || 1));
      curPage = n - 1; renderList(); renderDoc();
    });
    bar.appendChild(inp);
    bar.appendChild(el('span', 'tx-pnum-sep', `/ ${pageCount()}`));
    bar.appendChild(mk('下一页 ▶', () => go(1), '', '键盘 →'));
    const sep = el('span', 'tx-pg-sep');
    bar.appendChild(sep);
    const openOrig = mk('⤢ 原图', () => { if (pg) window.open(pg.img, '_blank'); }, '', '在新标签打开原图');
    if (noScanBook(b)) {
      openOrig.disabled = true;
      openOrig.title = '离线版未包含原页扫描图';
    }
    bar.appendChild(openOrig);
    /* v31 缩放：默认 50%，每档 25%，最大 300% */
    bar.appendChild(el('span', 'tx-pg-sep'));
    bar.appendChild(mk('−', () => setZoom(zoom - ZOOM_STEP), '', '缩小 25%（键盘 -）'));
    const zl = el('span', 'tx-zoom', zoom + '%');
    zl.id = 'tx-zoom';
    zl.addEventListener('click', () => setZoom(ZOOM_DEF));
    zl.title = `点击回到默认 ${ZOOM_DEF}%（整页完整呈现）`;
    bar.appendChild(zl);
    bar.appendChild(mk('＋', () => setZoom(zoom + ZOOM_STEP), '', '放大 25%（键盘 +）'));
    bar.appendChild(mk(`整页 ${ZOOM_DEF}%`, () => setZoom(ZOOM_DEF), '', `回到默认 ${ZOOM_DEF}%`));
    bar.appendChild(el('span', 'tx-pg-title', `${b.title} · 第 ${pg ? pg.n : '-'} 页 · ${zoom}%`));
  }

  /* v31：设置缩放（按 25% 取整，夹在 25%~300% 之间） */
  function setZoom(z) {
    const n = Math.round((Number(z) || ZOOM_DEF) / ZOOM_STEP) * ZOOM_STEP;
    zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n));
    const img = $('tx-page');
    if (img) img.style.width = zoom + '%';
    const zl = $('tx-zoom');
    if (zl) zl.textContent = zoom + '%';
    const t = $('tx-pager .tx-pg-title');
    if (t) t.textContent = `${cur().title} · 第 ${(cur().pages || [])[curPage] ? cur().pages[curPage].n : '-'} 页 · ${zoom}%`;
  }

  function go(step) {
    const n = pageCount();
    if (!n) return;
    curPage = (curPage + step + n) % n;
    renderList(); renderDoc();
  }

  function renderStat() {
    const s = $('tx-stat');
    if (!q.trim()) {
      /* v33：只统计当前用户看得见的册 */
      const vis = books.filter(b => bookVisible(b));
      s.textContent = `${vis.length} 本 / ${vis.reduce((n, b) => n + (b.pages || []).length, 0)} 页`;
      return;
    }
    s.textContent = hits.length ? `${hits.length} 页命中 · 第 ${hitIdx + 1} 处` : '无命中';
  }

  function openHit(idx, scrollList) {
    const h = hits[idx];
    if (!h) return;
    hitIdx = idx;
    if (curBook !== h.b) { curBook = h.b; renderBooks(); }
    if (curPage !== h.p) { curPage = h.p; }
    renderList(); renderDoc(); renderStat();
    if (scrollList) {
      const row = $('tx-list').querySelectorAll('.tx-row')[idx];
      if (row) row.scrollIntoView({ block: 'nearest' });
    }
    const stage = $('tx-doc .tx-stage');
    if (stage) stage.scrollTop = 0;
  }
  function move(step) {
    if (!hits.length) return;
    hitIdx = (hitIdx + step + hits.length) % hits.length;
    openHit(hitIdx, true);
  }

  /* v33：当前书若因权限 / 数据变化不可见，自动切到第一本看得见的 */
  function ensureVisibleBook() {
    if (books[curBook] && bookVisible(books[curBook])) return;
    const i = books.findIndex(b => bookVisible(b));
    curBook = i >= 0 ? i : 0;
    curPage = 0;
  }
  function renderAll() {
    ensureVisibleBook();
    renderCun();                      // v40：顶置栏（权限 / 内容变化后跟着重绘）
    renderFilters(); renderBooks(); renderScope(); renderMetaBar();
    renderList(); renderDoc(); renderStat();
  }

  /* ================= v40：村村通宝典（顶置栏） =================
     - 位置：文本查询系统最顶部，进来第一眼就能看到
     - 权限：查看 / 编辑两个开关（后台「功能开关 → 文本查询系统」里分别设定）
     - 编辑：Word 式富文本（加粗 / 标题 / 列表 / 对齐 / 颜色 / 插入符号…）
     - 内容：本地立即生效，同时经数据包通道推送全站            */
  let cunEditing = false;
  let cunDraft = '';                       // 编辑中的 HTML
  const CUN_COLLAPSE_KEY = 'eb_tx_cun_collapse';
  let cunCollapsed = false;
  try { cunCollapsed = localStorage.getItem(CUN_COLLAPSE_KEY) === '1'; } catch (e) { /* 忽略 */ }
  function saveCunCollapsed() {
    try { localStorage.setItem(CUN_COLLAPSE_KEY, cunCollapsed ? '1' : '0'); } catch (e) { /* 忽略 */ }
  }
  /* 权限由 app.js 提供（未就绪时按「不可见」处理，避免游客误看到管理员内容） */
  const cunCanView = () => typeof window.cunBaodianViewable === 'function' && window.cunBaodianViewable() === true;
  const cunCanEdit = () => typeof window.cunBaodianEditable === 'function' && window.cunBaodianEditable() === true;
  const cunData = () => (typeof window.cunBaodian === 'function' ? window.cunBaodian() : { html: '', updated_at: '' });

  /* —— 白名单清洗：宝典正文允许排版标签，但去掉脚本 / 事件 / 外链脚本协议 —— */
  const CUN_OK_TAGS = new Set(['P', 'BR', 'DIV', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE',
    'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'HR', 'MARK', 'SUB', 'SUP', 'CODE',
    'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'FONT', 'A', 'IMG']);
  const CUN_OK_ATTR = new Set(['style', 'class', 'color', 'size', 'face', 'href', 'target', 'src', 'alt', 'width', 'height']);
  function cunSanitize(html) {
    const doc = new DOMParser().parseFromString('<div id="cun-root">' + String(html || '') + '</div>', 'text/html');
    const root = doc.getElementById('cun-root');
    const walk = node => {
      [...node.children].forEach(ch => {
        if (!CUN_OK_TAGS.has(ch.tagName)) { ch.replaceWith(...ch.childNodes); return; }
        [...ch.attributes].forEach(a => {
          const n = a.name.toLowerCase();
          if (!CUN_OK_ATTR.has(n) || n.startsWith('on')) { ch.removeAttribute(a.name); return; }
          const v = (a.value || '').toLowerCase().replace(/\s/g, '');
          if (/javascript:|expression\(|url\(/.test(v)) ch.removeAttribute(a.name);
        });
        if (ch.tagName === 'A') { try { ch.setAttribute('rel', 'noopener'); ch.setAttribute('target', '_blank'); } catch (e) { /* 忽略 */ } }
        walk(ch);
      });
    };
    walk(root);
    return root.innerHTML;
  }

  /* —— 编辑工具条：一行按钮，仿 Word 常用排版 —— */
  const CUN_SYMBOLS = [
    { g: '常用', list: ['★', '☆', '●', '○', '◆', '◇', '■', '□', '▲', '▼', '※', '〇'] },
    { g: '箭头', list: ['←', '→', '↑', '↓', '↔', '⇒', '⇐', '▶', '◀', '➜'] },
    { g: '判定', list: ['✓', '✗', '✔', '✘', '✅', '❌', '⚠', '❗', '❓'] },
    { g: '花色', list: ['♠', '♥', '♣', '♦', '♤', '♡', '♧', '♢'] },
    { g: '天气', list: ['☀', '☂', '❄', '☁', '⛈', '🌤', '🌧', '🌫'] },
    { g: '标记', list: ['⚔', '🛡', '⚑', '⚙', '✦', '✧', '✚', '☘', '⏳', '🎲'] },
    { g: '数字', list: ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '½', '×', '÷', '±'] },
  ];
  const CUN_COLORS = ['#000000', '#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#2980b9', '#8e44ad', '#7f8c8d'];

  function cunToolbar() {
    const bar = el('div', 'cun-tb');
    const btn = (txt, cmd, val, title, cls) => {
      const b = el('button', 'cun-tb-btn' + (cls ? ' ' + cls : ''), txt);
      b.type = 'button';
      b.title = title || '';
      b.onclick = () => {
        const ed = $('tx-cun-ed');
        if (ed) ed.focus();
        document.execCommand(cmd, false, val);
        cunDraft = ed ? ed.innerHTML : cunDraft;
      };
      return b;
    };
    const grp = (...kids) => { const g = el('span', 'cun-tb-grp'); kids.forEach(k => g.appendChild(k)); return g; };
    bar.appendChild(grp(
      btn('↶', 'undo', null, '撤销（Ctrl+Z）'),
      btn('↷', 'redo', null, '重做（Ctrl+Y）')));
    bar.appendChild(grp(
      btn('正文', 'formatBlock', '<p>', '正文段落', 'cun-tb-w'),
      btn('H1', 'formatBlock', '<h1>', '一级标题'),
      btn('H2', 'formatBlock', '<h2>', '二级标题'),
      btn('H3', 'formatBlock', '<h3>', '三级标题')));
    bar.appendChild(grp(
      btn('B', 'bold', null, '加粗（Ctrl+B）', 'cun-b'),
      btn('I', 'italic', null, '倾斜（Ctrl+I）', 'cun-i'),
      btn('U', 'underline', null, '下划线（Ctrl+U）', 'cun-u'),
      btn('S', 'strikeThrough', null, '删除线', 'cun-s')));
    /* 字体颜色：一组色块 */
    const cg = el('span', 'cun-tb-grp');
    CUN_COLORS.forEach(c => {
      const b = el('button', 'cun-color');
      b.type = 'button';
      b.title = '字体颜色 ' + c;
      b.style.background = c;
      b.onclick = () => {
        const ed = $('tx-cun-ed'); if (ed) ed.focus();
        document.execCommand('foreColor', false, c);
        cunDraft = ed ? ed.innerHTML : cunDraft;
      };
      cg.appendChild(b);
    });
    bar.appendChild(cg);
    bar.appendChild(grp(
      btn('• 列表', 'insertUnorderedList', null, '无序列表'),
      btn('1. 列表', 'insertOrderedList', null, '有序列表'),
      btn('❝ 引用', 'formatBlock', '<blockquote>', '引用段')));
    bar.appendChild(grp(
      btn('⇤', 'justifyLeft', null, '左对齐'),
      btn('⇔', 'justifyCenter', null, '居中'),
      btn('⇥', 'justifyRight', null, '右对齐')));
    bar.appendChild(grp(
      btn('—', 'insertHorizontalRule', null, '插入分割线'),
      btn('⌫ 格式', 'removeFormat', null, '清除所选格式', 'cun-tb-w')));
    /* 插入符号：下拉选择后插到光标处 */
    const sel = el('select', 'cun-tb-sel');
    const o0 = el('option', null, '插入符号…'); o0.value = ''; sel.appendChild(o0);
    CUN_SYMBOLS.forEach(g => {
      const og = el('optgroup'); og.label = g.g;
      g.list.forEach(s => { const o = el('option', null, s + '　' + g.g); o.value = s; og.appendChild(o); });
      sel.appendChild(og);
    });
    sel.onchange = () => {
      const s = sel.value; sel.value = '';
      if (!s) return;
      const ed = $('tx-cun-ed'); if (ed) ed.focus();
      document.execCommand('insertText', false, s);
      cunDraft = ed ? ed.innerHTML : cunDraft;
    };
    bar.appendChild(sel);
    /* v42：编辑中也能直接导入 Word —— 导入的内容接着在编辑器里改
       离线版没有随包发布 mammoth（628KB），按钮一律不出现，
       免得点了只弹「解析组件未加载」。 */
    if (typeof window.mammoth === 'undefined' || !window.mammoth.convertToHtml) return bar;
    const gw = el('span', 'cun-tb-grp');
    const bw = el('button', 'cun-tb-btn cun-tb-w', '📄 导入 Word');
    bw.type = 'button';
    bw.id = 'tx-cun-import';
    bw.title = '用 .docx 文件内容替换当前正文（可继续编辑后再保存）';
    bw.onclick = () => cunFileInput().click();
    gw.appendChild(bw);
    bar.appendChild(gw);
    return bar;
  }

  /* ============================================================
   * v42：把宝典做成「内置 Word 浏览器」
   *   · 有编辑权限：可直接上传 .docx，mammoth 解析成排版 HTML 后进编辑器继续改
   *   · 无编辑权限：只能阅览 —— 禁选中 / 禁右键 / 禁复制剪切，页面上看得到、拿不走
   * ============================================================ */
  const CUN_DOCX_MAX = 8 * 1024 * 1024;       // .docx 体积上限
  const CUN_HTML_WARN = 1.2 * 1024 * 1024;    // 转换后 HTML 超过此值，提示可能含大图

  /* 隐藏的文件选择框（懒创建，挂在 body 上，随用随选） */
  function cunFileInput() {
    let inp = $('tx-cun-file');
    if (inp) return inp;
    inp = document.createElement('input');
    inp.type = 'file';
    inp.id = 'tx-cun-file';
    inp.accept = '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    inp.style.display = 'none';
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      inp.value = '';                       // 清空，便于连续选同一个文件
      if (f) cunImportDocx(f);
    });
    document.body.appendChild(inp);
    return inp;
  }

  /* .docx → HTML：解析后走同一套白名单清洗，再进编辑态等确认 */
  async function cunImportDocx(file) {
    const name = (file && file.name) || '';
    if (!/\.docx$/i.test(name)) {
      toastText('请选择 .docx 文件（Word 2007 及以上；旧版 .doc 请先用 Word 另存为 .docx）', true);
      return;
    }
    if (file.size > CUN_DOCX_MAX) {
      toastText(`文件 ${(file.size / 1048576).toFixed(1)}MB 超过 8MB 上限，请先在 Word 里压缩图片`, true);
      return;
    }
    if (typeof window.mammoth === 'undefined' || !window.mammoth.convertToHtml) {
      toastText('Word 解析组件未加载（vendor/mammoth.browser.min.js 缺失），请联系管理员', true);
      return;
    }
    toastText('正在解析 Word…');
    try {
      const buf = await file.arrayBuffer();
      const res = await window.mammoth.convertToHtml({ arrayBuffer: buf });
      const html = cunSanitize((res && res.value) || '');
      const msgs = (res && res.messages) || [];
      cunDraft = html || '<p></p>';
      cunEditing = true;          // 载入后直接进入编辑态：可以直接改，改完再保存
      cunCollapsed = false;
      renderCun();
      setTimeout(() => { const e = $('tx-cun-ed'); if (e) e.focus(); }, 0);
      const bad = msgs.filter(m => m.type === 'warning' || m.type === 'error').length;
      let tip = `已载入「${name}」—— 检查无误后点「保存并推送」`;
      if (html.length > CUN_HTML_WARN) tip += '（含较大图片，推送会慢一些）';
      if (bad) tip += `；有 ${bad} 处复杂格式（文本框/图表等）未能完整转换`;
      toastText(tip);
    } catch (e) {
      toastText('解析失败：' + ((e && e.message) || e), true);
    }
  }

  /* 只读锁：无编辑权限的人只能看，不能选、不能复制（防君子，不防开发者工具） */
  function cunLockReadonly(node) {
    node.classList.add('cun-ro');
    node.setAttribute('tabindex', '-1');
    node.setAttribute('aria-readonly', 'true');
    const stop = e => e.preventDefault();
    ['copy', 'cut', 'contextmenu', 'selectstart', 'dragstart'].forEach(t => node.addEventListener(t, stop));
    node.addEventListener('keydown', e => {
      const k = (e.key || '').toLowerCase();
      if ((e.ctrlKey || e.metaKey) && ['c', 'x', 'a', 'p', 's'].indexOf(k) >= 0) e.preventDefault();
    });
  }

  /* —— 顶置栏渲染 —— */
  function renderCun() {
    const box = $('tx-cun');
    if (!box) return;
    box.textContent = '';
    if (!cunCanView()) { box.hidden = true; return; }   // 没查看权限：整栏不显示
    box.hidden = false;

    const d = cunData();
    const head = el('div', 'cun-head');
    const fold = el('button', 'cun-fold', cunCollapsed ? '▶' : '▼');
    fold.type = 'button';
    fold.title = cunCollapsed ? '展开宝典' : '收起宝典';
    fold.onclick = () => { cunCollapsed = !cunCollapsed; saveCunCollapsed(); renderCun(); };
    head.appendChild(fold);
    head.appendChild(el('span', 'cun-title', '📕 村村通宝典'));
    if (d.updated_at) {
      const t = new Date(d.updated_at);
      if (!isNaN(t)) head.appendChild(el('span', 'cun-when', '更新于 ' + t.toLocaleString('zh-CN', { hour12: false })));
    }
    head.appendChild(el('span', 'flex-spacer'));
    const canEdit = cunCanEdit();
    if (canEdit && !cunEditing) {
      const ed = el('button', 'btn btn-sm btn-primary', '✍️ 编辑宝典');
      ed.type = 'button';
      ed.id = 'tx-cun-edit';
      ed.title = '以 Word 式编辑器改写宝典正文，保存后推送给所有有查看权限的人';
      ed.onclick = () => {
        cunEditing = true;
        cunDraft = cunData().html || '';
        renderCun();
        setTimeout(() => { const e = $('tx-cun-ed'); if (e) { e.focus(); } }, 0);
      };
      head.appendChild(ed);
      /* 没有 mammoth（离线版没打包它）就不给「上传 Word」入口 */
      if (typeof window.mammoth === 'object' && window.mammoth && window.mammoth.convertToHtml) {
        const up = el('button', 'btn btn-sm', '📄 上传 Word');
        up.type = 'button';
        up.id = 'tx-cun-upload';
        up.title = '上传 .docx 更新宝典（解析后可直接在线修改，确认后再保存推送）';
        up.onclick = () => cunFileInput().click();
        head.appendChild(up);
      }
    }
    if (!canEdit) head.appendChild(el('span', 'cun-lock', '🔒 只读'));
    box.appendChild(head);
    if (cunCollapsed) return;

    /* 编辑态：工具条 + 可编辑区 + 保存 / 取消 */
    if (cunEditing && canEdit) {
      box.appendChild(cunToolbar());
      const area = el('div', 'cun-ed');
      area.id = 'tx-cun-ed';
      area.setAttribute('contenteditable', 'true');
      area.innerHTML = cunSanitize(cunDraft || '<p></p>');
      area.addEventListener('input', () => { cunDraft = area.innerHTML; });
      /* 粘贴时去格式，避免把网页样式/脚本带进来 */
      area.addEventListener('paste', e => {
        e.preventDefault();
        const txt = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
        document.execCommand('insertText', false, txt);
        cunDraft = area.innerHTML;
      });
      box.appendChild(area);
      const foot = el('div', 'cun-foot');
      const ok = el('button', 'btn btn-sm btn-primary', '保存并推送');
      ok.type = 'button';
      ok.id = 'tx-cun-save';
      ok.onclick = saveCun;
      const no = el('button', 'btn btn-sm', '取消');
      no.type = 'button';
      no.onclick = () => { cunEditing = false; renderCun(); };
      foot.appendChild(ok); foot.appendChild(no);
      foot.appendChild(el('span', 'cun-tip', '保存后本机立即生效；已登录管理员会同时推送到云端，其他人下次打开即可看到'));
      box.appendChild(foot);
      return;
    }

    /* 浏览态：就是正常的文本阅览，不做额外装饰 */
    const body = el('div', 'cun-body');
    body.id = 'tx-cun-body';
    const html = cunSanitize(d.html || '');
    if (html.trim()) body.innerHTML = html;
    else body.appendChild(el('div', 'cun-empty', '（宝典还是空的 —— 有编辑权限的人点右上「📄 上传 Word」或「✍️ 编辑宝典」开始）'));
    if (!canEdit) cunLockReadonly(body);      // v42：无编辑权限 = 只能看，选不中也复制不走
    box.appendChild(body);
  }

  async function saveCun() {
    const ed = $('tx-cun-ed');
    const html = cunSanitize(ed ? ed.innerHTML : cunDraft);
    if (typeof window.adminSaveBaodian !== 'function') { toastText('保存功能未就绪', true); return; }
    toastText('正在保存…');
    const r = await window.adminSaveBaodian(html);
    if (r && r.error) {
      toastText('已存本机，但推送失败：' + (r.error.message || ''), true);
    } else {
      toastText(r && r.offline ? '已保存到本机（云端未连接，未推送）' : '已保存并推送给所有人');
    }
    cunEditing = false;
    renderCun();
  }

  /* ---------- 骨架 ---------- */
  function build() {
    const root = $('text-root');
    root.innerHTML = `
      <div class="tx-wrap">
        <div class="tx-head">
          <div class="tx-title">📖 文本查询系统
            <small class="muted">规则书 / 战役书 PDF 原页图片 · 内置全文检索</small></div>
          <div class="tx-tools">
            <input id="tx-q" class="tx-input tx-input-lg" type="text" placeholder="搜索关键词（按下方范围检索全书页文本）">
            <span id="tx-stat" class="tx-stat"></span>
            <button id="tx-prev" class="btn btn-sm" type="button" title="上一处（Shift+Enter）">↑</button>
            <button id="tx-next" class="btn btn-sm" type="button" title="下一处（Enter）">↓</button>
            <button id="tx-clear" class="btn btn-sm" type="button">清空</button>
          </div>
        </div>
        <!-- v40：村村通宝典 —— 顶置栏，进系统第一眼就能看到 -->
        <section id="tx-cun" class="tx-cun"></section>
        <div class="tx-scope-row">
          <span class="tx-scope-l">检索范围</span>
          <div id="tx-scope" class="tx-scope"></div>
          <span id="tx-toast" class="tx-toast"></span>
        </div>
        <div class="tx-body">
          <aside class="tx-side">
            <div class="tx-find">
              <input id="tx-find" class="tx-input tx-find-in" type="text" placeholder="搜索书名 / 类别 / 说明">
            </div>
            <div id="tx-filters" class="tx-filters"></div>
            <div id="tx-books" class="tx-books"></div>
            <div id="tx-list" class="tx-list"></div>
          </aside>
          <section class="tx-main">
            <div id="tx-meta" class="tx-meta"></div>
            <div id="tx-pager" class="tx-pager"></div>
            <article id="tx-doc" class="tx-doc"></article>
          </section>
        </div>
      </div>`;

    $('tx-q').addEventListener('input', e => {
      q = e.target.value;
      runSearch(q);
      if (q.trim() && hits.length) openHit(0, false);
      else { renderList(); renderDoc(); renderStat(); }
    });
    $('tx-q').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); move(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { q = ''; $('tx-q').value = ''; runSearch(''); renderAll(); }
    });
    $('tx-find').addEventListener('input', e => { findQ = e.target.value; renderBooks(); });
    $('tx-find').addEventListener('keydown', e => {
      if (e.key === 'Escape') { findQ = ''; e.target.value = ''; renderBooks(); }
    });
    $('tx-prev').addEventListener('click', () => move(-1));
    $('tx-next').addEventListener('click', () => move(1));
    $('tx-clear').addEventListener('click', () => {
      q = ''; $('tx-q').value = ''; runSearch(''); renderAll();
    });
    document.addEventListener('keydown', e => {
      if (!window.TextApp || !window.TextApp.ready) return;
      if (!$('text-root') || !$('text-root').offsetParent) return;   // 不在本系统时不响应
      const t = e.target;
      if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      /* v31：+ / - 调缩放，0 回默认 50% */
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(zoom + ZOOM_STEP); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoom(zoom - ZOOM_STEP); }
      else if (e.key === '0') { e.preventDefault(); setZoom(ZOOM_DEF); }
    });
  }

  let booted = false;
  window.TextApp = {
    boot() {
      if (booted) return;
      booted = true;
      books = bookData();
      /* v31：窄屏（手机）默认 100% 宽，否则 50% 会太窄；档位仍是 25%~300% */
      if (window.matchMedia && window.matchMedia('(max-width:900px)').matches) zoom = 100;
      if (!books.length) books = [{ id: 'empty', title: '（暂无书籍）', kind: '资料', note: '尚未载入书籍数据', pages: [] }];
      build();
      renderAll();
    },
    get ready() { return booted; },
    /* v30：云端数据包换了书籍数据后，由 app.js 调用重新载入（不用整页刷新） */
    reload() {
      if (!booted) return false;
      books = bookData();
      if (!books.length) books = [{ id: 'empty', title: '（暂无书籍）', kind: '资料', note: '尚未载入书籍数据', pages: [] }];
      curBook = 0; curPage = 0; q = ''; hits = []; hitIdx = -1;
      renderAll();
      return true;
    },
    /* v31：云端书名 / 类别覆盖变化后，就地重绘（保留当前书与页码） */
    applyMeta() {
      if (!booted) return false;
      books = bookData();
      if (curBook >= books.length) curBook = 0;
      if (curPage >= pageCount()) curPage = 0;
      metaEditing = false;
      renderCun();                   // v40：后台权限可能刚改过，顶置栏要跟着显示 / 隐藏
      renderAll();
      return true;
    },
    /* v40：云端推送来新的宝典内容时，就地重绘顶置栏 */
    reloadCun() {
      if (!booted) return false;
      cunEditing = false;
      renderCun();
      return true;
    },
    /* v31：供测试与其它系统调用 */
    get zoom() { return zoom; },
    setZoom(z) { setZoom(z); return zoom; },
    getScope() { return { mode: scope.mode, kind: scope.kind }; },
    setScope(mode, kind) { scope = { mode: mode || 'all', kind: kind || '' }; renderScope(); rerun(); return { ...scope }; },
    search(key) {                       // 供其它系统（后续地图卡 / 任务卡）调用
      q = String(key || '');
      $('tx-q').value = q;
      runSearch(q);
      renderAll();
    },
  };
})();
