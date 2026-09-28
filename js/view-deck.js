/* 组牌器：选背景/专长/性格/属性 → 卡池加牌 → 校验 → 分享/保存 */
window.ViewDeck = (function () {
  const LS_KEY = 'ebr_decks_v1';
  const LS_CUR = 'ebr_deck_current';
  const DECK_SIZE = 30;
  let deck = null;   // {name, background, specialty, personality, aspect, cards:{id:n}}
  let poolFilter = '';

  function blank() {
    return { name: '我的行者牌组', background: null, specialty: null, personality: null, aspect: null, cards: {} };
  }
  function loadCurrent() {
    try { deck = JSON.parse(localStorage.getItem(LS_CUR)) || blank(); } catch (e) { deck = blank(); }
  }
  function saveCurrent() { localStorage.setItem(LS_CUR, JSON.stringify(deck)); }
  function savedDecks() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; }
  }

  function poolCodes() {
    if (!deck.background || !deck.specialty) return null;
    const r = DB.ranger;
    const bg = r.backgrounds.find(x => x.id === deck.background);
    const sp = r.specialties.find(x => x.id === deck.specialty);
    if (!bg || !sp) return null;
    return new Set([...(bg.cards || []), ...(sp.cards || [])]);
  }

  function deckCount() { return Object.values(deck.cards).reduce((a, b) => a + b, 0); }

  function validate() {
    const errs = [];
    if (!deck.background) errs.push('未选择背景');
    if (!deck.specialty) errs.push('未选择专长');
    if (!deck.personality) errs.push('未选择性格');
    if (!deck.aspect) errs.push('未选择属性卡');
    const n = deckCount();
    if (n !== DECK_SIZE) errs.push(`牌组需 ${DECK_SIZE} 张，当前 ${n} 张`);
    const pool = poolCodes();
    for (const [id, cnt] of Object.entries(deck.cards)) {
      const c = DB.byId[id];
      if (!c) { errs.push(`未知卡牌 ${id}`); continue; }
      const lim = c.deck_limit || 2;
      if (cnt > lim) errs.push(`「${c.name_zh || c.name_en}」超过上限 ${lim}`);
      if (pool && !pool.has(id) && c.type_id !== 'attribute' && c.type_id !== 'role')
        errs.push(`「${c.name_zh || c.name_en}」不在当前卡池`);
    }
    return errs;
  }

  /* ---------- 渲染 ---------- */
  function render(el, params) {
    loadCurrent();
    if (params && params[0]) {
      const d = DeckCodec.decode(params[0]);
      if (d) { deck = Object.assign(blank(), d, { name: '分享的牌组' }); saveCurrent(); location.hash = '#/deck'; }
    }
    el.innerHTML = `<h2 class="view-title">组牌器</h2>
      <div class="deck-layout">
        <div>
          <div class="deck-panel" id="setup-panel"></div>
          <div class="deck-panel" style="margin-top:14px" id="pool-panel"></div>
        </div>
        <div class="deck-panel deck-side" id="side-panel"></div>
      </div>`;
    renderSetup(); renderPool(); renderSide();
  }

  function roleItem(r, kind) {
    const sel = deck[kind] === r.id ? ' sel' : '';
    return `<div class="setup-item${sel}" data-kind="${kind}" data-id="${r.id}">
      <div>${UI.esc(r.name_zh || r.name_en)}</div>
      <div class="si-en">${UI.esc(r.name_en)}</div>
      ${r.cards ? `<div class="si-count">${r.cards.length} 张可用牌</div>` : ''}</div>`;
  }

  function renderSetup() {
    const r = DB.ranger;
    const p = document.getElementById('setup-panel');
    const pers = r.personalities.map(x => {
      const sel = deck.personality === x.id ? ' sel' : '';
      return `<div class="setup-item${sel}" data-kind="personality" data-id="${x.id}">
        <div>${UI.esc(x.name_zh || x.name_en)}</div><div class="si-en">${UI.esc(x.name_en)}</div></div>`;
    }).join('');
    const asps = r.aspects.map(a => {
      const sel = deck.aspect === a.id ? ' sel' : '';
      return `<div class="setup-item${sel}" data-kind="aspect" data-id="${a.id}">
        <div class="aspect-vals">${a.values.join(' · ')}</div>
        <div class="si-en">觉 ${a.values[0]} / 体 ${a.values[1]} / 专 ${a.values[2]} / 精 ${a.values[3]}</div></div>`;
    }).join('');
    p.innerHTML = `<h3>1. 行者构成</h3>
      <div style="margin:6px 0 4px;color:var(--fg-dim);font-size:.85rem">背景（决定部分卡池）</div>
      <div class="setup-grid">${r.backgrounds.map(x => roleItem(x, 'background')).join('')}</div>
      <div style="margin:10px 0 4px;color:var(--fg-dim);font-size:.85rem">专长（决定部分卡池）</div>
      <div class="setup-grid">${r.specialties.map(x => roleItem(x, 'specialty')).join('')}</div>
      <div style="margin:10px 0 4px;color:var(--fg-dim);font-size:.85rem">性格</div>
      <div class="setup-grid">${pers}</div>
      <div style="margin:10px 0 4px;color:var(--fg-dim);font-size:.85rem">属性分配（知觉/体质/专注/精神）</div>
      <div class="setup-grid">${asps}</div>`;
    p.querySelectorAll('.setup-item').forEach(it => it.addEventListener('click', () => {
      deck[it.dataset.kind] = it.dataset.id;
      saveCurrent(); renderSetup(); renderPool(); renderSide();
    }));
  }

  function renderPool() {
    const p = document.getElementById('pool-panel');
    const pool = poolCodes();
    if (!pool) {
      p.innerHTML = `<h3>2. 可用卡池</h3><div class="empty-hint">先选择背景与专长</div>`;
      return;
    }
    const q = poolFilter.toLowerCase();
    let list = DB.cards.filter(c =>
      pool.has(c.id) && c.type_id !== 'role' && c.type_id !== 'attribute');
    if (q) list = list.filter(c =>
      [c.name_en, c.name_zh, c.text_en, c.text_zh].filter(Boolean).join(' ').toLowerCase().includes(q));
    list.sort((a, b) => (a.cost ?? 99) - (b.cost ?? 99) || a.id.localeCompare(b.id));
    p.innerHTML = `<h3>2. 可用卡池（${list.length}）</h3>
      <div class="filters"><input type="text" id="pool-q" placeholder="筛选卡池…" value="${UI.esc(poolFilter)}"></div>
      <div class="pool-list">${list.map(rowHtml).join('') || '<div class="empty-hint">无匹配</div>'}</div>`;
    document.getElementById('pool-q').addEventListener('input', e => { poolFilter = e.target.value; renderPool(); });
    p.querySelectorAll('.pool-row button').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const id = b.dataset.id, delta = +b.dataset.d;
      const c = DB.byId[id];
      const cur = deck.cards[id] || 0;
      const lim = (c && c.deck_limit) || 2;
      let nxt = cur + delta;
      if (nxt < 0) nxt = 0;
      if (nxt > lim) nxt = lim;
      if (nxt === 0) delete deck.cards[id]; else deck.cards[id] = nxt;
      saveCurrent(); renderPool(); renderSide();
    }));
    p.querySelectorAll('.pool-row').forEach(row => row.addEventListener('click', () => {
      const c = DB.byId[row.dataset.id];
      if (c) UI.cardDetail(c);
    }));
  }

  function rowHtml(c) {
    const n = deck.cards[c.id] || 0;
    const lim = c.deck_limit || 2;
    const aspCls = c.aspect_id ? `asp-${c.aspect_id}` : '';
    return `<div class="pool-row" data-id="${c.id}">
      <span class="pr-cost tag ${aspCls}">${c.cost ?? '-'}</span>
      <span class="pr-name">${UI.esc(c.name_zh || c.name_en)}<small>${UI.esc(c.name_en)} · ${UI.esc(c.type_zh || '')}</small></span>
      <span class="pr-ctrl">
        <button data-id="${c.id}" data-d="-1" ${n === 0 ? 'disabled' : ''}>−</button>
        <b>${n}/${lim}</b>
        <button data-id="${c.id}" data-d="1" ${n >= lim ? 'disabled' : ''}>＋</button>
      </span></div>`;
  }

  function renderSide() {
    const p = document.getElementById('side-panel');
    const n = deckCount();
    const errs = validate();
    const entries = Object.entries(deck.cards)
      .map(([id, cnt]) => ({ c: DB.byId[id], cnt }))
      .filter(x => x.c)
      .sort((a, b) => (a.c.cost ?? 99) - (b.c.cost ?? 99) || a.c.id.localeCompare(b.c.id));
    const shareCode = DeckCodec.encode(deck);
    const shareUrl = location.origin + location.pathname + '#/deck/' + shareCode;
    const saved = savedDecks();
    p.innerHTML = `<h3>3. 牌组（<span class="deck-count ${n === DECK_SIZE ? 'full' : ''}">${n}</span>/${DECK_SIZE}）</h3>
      <input class="deck-name-input" id="deck-name" value="${UI.esc(deck.name)}" placeholder="牌组名称">
      <ul>${entries.map(x => `<li><span>${UI.esc(x.c.name_zh || x.c.name_en)}</span><b>×${x.cnt}</b></li>`).join('') || '<li style="color:var(--fg-dim)">尚未添加卡牌</li>'}</ul>
      ${errs.length ? `<div class="deck-warnings">${errs.map(e => '✗ ' + UI.esc(e)).join('\n')}</div>` : '<div class="deck-ok">✓ 牌组合法</div>'}
      <button class="btn" id="btn-copy-url">复制分享链接</button>
      <button class="btn ghost" id="btn-save">保存到本地</button>
      <button class="btn ghost" id="btn-clear">清空</button>
      <textarea class="share-out" id="share-out" rows="3" readonly>${UI.esc(shareUrl)}</textarea>
      <h3 style="margin-top:14px">已保存的牌组</h3>
      <div>${Object.keys(saved).map(name => `
        <div class="saved-deck" data-name="${UI.esc(name)}">
          <span>${UI.esc(name)}</span><span class="sd-del" data-name="${UI.esc(name)}">删除</span>
        </div>`).join('') || '<div style="color:var(--fg-dim);font-size:.85rem">暂无</div>'}</div>`;

    document.getElementById('deck-name').addEventListener('input', e => { deck.name = e.target.value; saveCurrent(); });
    document.getElementById('btn-copy-url').addEventListener('click', () => {
      const ta = document.getElementById('share-out');
      ta.select();
      (navigator.clipboard ? navigator.clipboard.writeText(ta.value) : Promise.reject())
        .catch(() => document.execCommand('copy'));
    });
    document.getElementById('btn-save').addEventListener('click', () => {
      const all = savedDecks();
      all[deck.name || ('牌组 ' + new Date().toLocaleString())] = deck;
      localStorage.setItem(LS_KEY, JSON.stringify(all));
      renderSide();
    });
    document.getElementById('btn-clear').addEventListener('click', () => {
      deck = blank(); saveCurrent(); renderSetup(); renderPool(); renderSide();
    });
    p.querySelectorAll('.saved-deck').forEach(sd => sd.addEventListener('click', e => {
      const name = sd.dataset.name;
      if (e.target.classList.contains('sd-del')) {
        const all = savedDecks(); delete all[name];
        localStorage.setItem(LS_KEY, JSON.stringify(all)); renderSide(); return;
      }
      const all = savedDecks();
      if (all[name]) { deck = all[name]; saveCurrent(); renderSetup(); renderPool(); renderSide(); }
    }));
  }

  return { render };
})();
