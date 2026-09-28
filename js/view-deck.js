/* 组牌器 v2：官方流程（Creating Ranger Decks）
 * 1 属性卡 12 选 1 → 2 性格 4 属性各 1 张 → 3 背景 5 张 + 专长 5 张 + 角色
 * → 4 兴趣 1 张 → 牌组 30 张（15 独特 × 2）+ 属性卡 + 角色卡（开局在场，不进牌组）
 */
window.ViewDeck = (function () {
  const LS_KEY = 'ebr_decks_v2';
  const LS_CUR = 'ebr_deck_current_v2';
  const DECK_SIZE = 30;
  const PICK_COPIES = 2;
  let deck = null;   // {name, aspect, personalities[4], background, specialty, role, bgPicks[5], spPicks[5], interest}
  let poolFilter = '';

  function blank() {
    return { name: '我的行者牌组', aspect: null, personalities: [], background: null,
             specialty: null, role: null, bgPicks: [], spPicks: [], interest: null };
  }
  function loadCurrent() {
    try { deck = JSON.parse(localStorage.getItem(LS_CUR)) || blank(); } catch (e) { deck = blank(); }
    if (!Array.isArray(deck.personalities)) deck = blank();   // 旧结构 v1 数据直接重置
  }
  function saveCurrent() { localStorage.setItem(LS_CUR, JSON.stringify(deck)); }
  function savedDecks() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; }
  }

  /* 候选卡池 */
  function setPools() {
    const r = DB.ranger;
    const bg = r.backgrounds.find(x => x.id === deck.background);
    const sp = r.specialties.find(x => x.id === deck.specialty);
    return { bg: bg ? bg.cards : null, sp: sp ? sp.cards : null };
  }
  function isExpert(c) { return (c.traits || []).includes('Expert'); }
  /* 兴趣池：背景∪专长 set 全部非 role 卡（含签名属性卡），排除 Expert */
  function interestPool() {
    if (!deck.background || !deck.specialty) return [];
    return DB.cards.filter(c =>
      (c.set_id === deck.background || c.set_id === deck.specialty) &&
      c.type_id !== 'role' && !isExpert(c));
  }
  function roleCards() {
    if (!deck.specialty) return [];
    return DB.cards.filter(c => c.set_id === deck.specialty && c.type_id === 'role');
  }
  function personalityBy(aspectId) {
    return DB.cards.filter(c => c.set_id === 'personality' && c.aspect_id === aspectId);
  }
  function deckCount() { return PICK_COPIES * (deck.personalities.length + deck.bgPicks.length + deck.spPicks.length + (deck.interest ? 1 : 0)); }
  function toggle(arr, id, max) {
    const i = arr.indexOf(id);
    if (i >= 0) arr.splice(i, 1);
    else if (arr.length < max) arr.push(id);
  }

  function validate() {
    const errs = [];
    if (!deck.aspect) errs.push('未选择属性卡');
    if (deck.personalities.length !== 4) errs.push('性格需选 4 张（每属性各 1 张），当前 ' + deck.personalities.length);
    else if (new Set(deck.personalities.map(id => DB.byId[id] && DB.byId[id].aspect_id)).size !== 4) errs.push('性格卡须覆盖 4 个不同属性');
    if (!deck.background) errs.push('未选择背景');
    else if (deck.bgPicks.length !== 5) errs.push('背景卡需选 5 张，当前 ' + deck.bgPicks.length);
    if (!deck.specialty) errs.push('未选择专长');
    else if (deck.spPicks.length !== 5) errs.push('专长卡需选 5 张，当前 ' + deck.spPicks.length);
    if (!deck.role) errs.push('未选择角色卡（开局在场，不占 30 张）');
    if (!deck.interest) errs.push('未选择兴趣卡（Outside Interest）');
    const n = deckCount();
    if (n !== DECK_SIZE) errs.push(`牌组 ${n}/${DECK_SIZE} 张`);
    return errs;
  }

  /* ---------- 渲染 ---------- */
  function render(el, params) {
    loadCurrent();
    if (params && params[0]) {
      const d = DeckCodec.decode(params[0]);
      if (d) { deck = Object.assign(blank(), d); saveCurrent(); location.hash = '#/deck'; }
    }
    el.innerHTML = `<h2 class="view-title">组牌器</h2>
      <div class="deck-layout">
        <div>
          <div class="deck-panel" id="step-aspect"></div>
          <div class="deck-panel" style="margin-top:14px" id="step-personality"></div>
          <div class="deck-panel" style="margin-top:14px" id="step-constitute"></div>
          <div class="deck-panel" style="margin-top:14px" id="step-interest"></div>
        </div>
        <div class="deck-panel deck-side" id="side-panel"></div>
      </div>`;
    renderAll();
  }
  function renderAll() { renderAspect(); renderPersonality(); renderConstitute(); renderInterest(); renderSide(); }

  function aspVals(values) {
    return `觉 ${values[0]} / 体 ${values[1]} / 专 ${values[2]} / 精 ${values[3]}`;
  }

  /* 步骤 1：属性卡 */
  function renderAspect() {
    const p = document.getElementById('step-aspect');
    p.innerHTML = `<h3><span class="step-num">1</span>属性卡（12 选 1，决定四维数值）</h3>
      <div class="setup-grid">${DB.ranger.aspects.map(a => `
        <div class="setup-item${deck.aspect === a.id ? ' sel' : ''}" data-aspect="${a.id}">
          <div class="aspect-vals">${a.values.join(' · ')}</div>
          <div class="si-en">${aspVals(a.values)}</div></div>`).join('')}</div>`;
    p.querySelectorAll('.setup-item').forEach(it => it.addEventListener('click', () => {
      deck.aspect = (deck.aspect === it.dataset.aspect) ? null : it.dataset.aspect;
      saveCurrent(); renderAll();
    }));
  }

  /* 步骤 2：性格（每属性各 1 张） */
  function renderPersonality() {
    const p = document.getElementById('step-personality');
    const cols = ['AWA', 'FIT', 'FOC', 'SPI'].map((asp, idx) => {
      const cards = personalityBy(asp);
      const items = cards.map(c => {
        const sel = deck.personalities.includes(c.id) ? ' sel' : '';
        return `<div class="setup-item${sel}" data-pid="${c.id}">
          <div>${UI.esc(c.name_zh || c.name_en)}</div><div class="si-en">${UI.esc(c.name_en)}</div></div>`;
      }).join('');
      const done = deck.personalities.some(id => DB.byId[id] && DB.byId[id].aspect_id === asp);
      return `<div><div class="pers-col-title ${done ? 'done' : ''}">${['知觉', '体质', '专注', '精神'][idx]}${done ? ' ✓' : ''}</div>${items}</div>`;
    }).join('');
    p.innerHTML = `<h3><span class="step-num">2</span>性格（4 个属性各选 1 张，每张 2 副本）</h3>
      <div class="pers-cols">${cols}</div>`;
    p.querySelectorAll('.setup-item[data-pid]').forEach(it => it.addEventListener('click', () => {
      const id = it.dataset.pid;
      const cur = DB.byId[id];
      const same = deck.personalities.includes(id);
      if (same) {
        deck.personalities = deck.personalities.filter(x => x !== id);
      } else {
        // 同属性位置替换：先移除同属性的其他选择
        deck.personalities = deck.personalities.filter(x => !(DB.byId[x] && DB.byId[x].aspect_id === cur.aspect_id));
        deck.personalities.push(id);
      }
      saveCurrent(); renderAll();
    }));
  }

  /* 步骤 3：背景 + 专长 + 角色 */
  function renderConstitute() {
    const p = document.getElementById('step-constitute');
    const r = DB.ranger;
    const bgSec = setSection('背景', 'background', r.backgrounds, deck.background,
      deck.bgPicks, 5, setPools().bg);
    const spSec = setSection('专长', 'specialty', r.specialties, deck.specialty,
      deck.spPicks, 5, setPools().sp);
    const roles = roleCards();
    const roleHtml = !deck.specialty ? '' : `
      <div style="margin:10px 0 4px;color:var(--fg-dim);font-size:.85rem">角色卡（开局在场，不进牌组）</div>
      <div class="setup-grid">${roles.map(rc => `
        <div class="setup-item${deck.role === rc.id ? ' sel' : ''}" data-role="${rc.id}">
          <div>${UI.esc(rc.name_zh || rc.name_en)}</div><div class="si-en">${UI.esc(rc.name_en)}</div></div>`).join('')}</div>`;
    p.innerHTML = `<h3><span class="step-num">3</span>背景与专长（各选 5 张卡，每张 2 副本）</h3>${bgSec}${spSec}${roleHtml}`;
    bindPickEvents(p);
    p.querySelectorAll('.setup-item[data-role]').forEach(it => it.addEventListener('click', () => {
      deck.role = (deck.role === it.dataset.role) ? null : it.dataset.role;
      saveCurrent(); renderAll();
    }));
  }

  function setSection(label, kind, list, setId, picks, max, pool) {
    const sets = list.map(x => `
      <div class="setup-item${setId === x.id ? ' sel' : ''}" data-set="${kind}" data-id="${x.id}">
        <div>${UI.esc(x.name_zh || x.name_en)}</div><div class="si-en">${UI.esc(x.name_en)}</div></div>`).join('');
    let inner = `<div style="margin:6px 0 4px;color:var(--fg-dim);font-size:.85rem">${label}（${max} 选 1）</div>
      <div class="setup-grid">${sets}</div>`;
    if (setId && pool) {
      inner += `<div class="pool-list" style="margin-top:8px">${pool.map(id => pickRow(DB.byId[id], picks, max)).join('')}</div>`;
    }
    return inner;
  }

  function pickRow(c, picks, max) {
    if (!c) return '';
    const sel = picks.includes(c.id) ? ' sel' : '';
    return `<div class="pool-row pick-row${sel}" data-pick="${c.id}">
      <span class="pr-cost tag ${c.aspect_id ? 'asp-' + c.aspect_id : ''}">${c.cost ?? '-'}</span>
      <span class="pr-name">${UI.esc(c.name_zh || c.name_en)}<small>${UI.esc(c.name_en)} · ${UI.esc(c.type_zh || '')}</small></span>
      <span class="pr-ctrl"><b>${sel ? '×' + PICK_COPIES : ''}</b></span></div>`;
  }

  function bindPickEvents(root) {
    root.querySelectorAll('.setup-item[data-set]').forEach(it => it.addEventListener('click', () => {
      const kind = it.dataset.set, id = it.dataset.id;
      if (kind === 'background') {
        deck.background = (deck.background === id) ? null : id;
        deck.bgPicks = [];
      } else {
        deck.specialty = (deck.specialty === id) ? null : id;
        deck.spPicks = []; deck.role = null;
      }
      saveCurrent(); renderAll();
    }));
    root.querySelectorAll('.pick-row[data-pick]').forEach(row => row.addEventListener('click', () => {
      const id = row.dataset.pick;
      const inBg = setPools().bg && setPools().bg.includes(id);
      if (inBg) toggle(deck.bgPicks, id, 5); else toggle(deck.spPicks, id, 5);
      saveCurrent(); renderAll();
    }));
  }

  /* 步骤 4：兴趣卡 */
  function renderInterest() {
    const p = document.getElementById('step-interest');
    const pool = interestPool();
    const q = poolFilter.toLowerCase();
    let list = pool;
    if (q) list = list.filter(c =>
      [c.name_en, c.name_zh, c.text_en, c.text_zh].filter(Boolean).join(' ').toLowerCase().includes(q));
    list.sort((a, b) => (a.cost ?? 99) - (b.cost ?? 99) || a.id.localeCompare(b.id));
    p.innerHTML = `<h3><span class="step-num">4</span>兴趣卡（背景 ∪ 专长全池选 1 张，不可带「专家」）</h3>
      ${pool.length ? `<div class="filters"><input type="text" id="interest-q" placeholder="筛选…" value="${UI.esc(poolFilter)}">
        <span class="pick-count">${deck.interest ? '已选 1 张 ×2' : '尚未选择'}</span></div>
      <div class="pool-list">${list.map(c => `
        <div class="pool-row pick-row${deck.interest === c.id ? ' sel' : ''}" data-interest="${c.id}">
          <span class="pr-cost tag ${c.aspect_id ? 'asp-' + c.aspect_id : ''}">${c.cost ?? '-'}</span>
          <span class="pr-name">${UI.esc(c.name_zh || c.name_en)}<small>${UI.esc(c.name_en)} · ${UI.esc(c.type_zh || '')}</small></span>
          <span class="pr-ctrl"><b>${deck.interest === c.id ? '×' + PICK_COPIES : ''}</b></span></div>`).join('') || '<div class="empty-hint">无匹配</div>'}</div>`
      : '<div class="empty-hint">先完成第 3 步选择背景与专长</div>'}`;
    const iq = document.getElementById('interest-q');
    if (iq) iq.addEventListener('input', e => { poolFilter = e.target.value; renderInterest(); });
    p.querySelectorAll('[data-interest]').forEach(row => row.addEventListener('click', () => {
      const id = row.dataset.interest;
      deck.interest = (deck.interest === id) ? null : id;
      saveCurrent(); renderAll();
    }));
  }

  /* 步骤 5：牌组总览 */
  function renderSide() {
    const p = document.getElementById('side-panel');
    const n = deckCount();
    const errs = validate();
    const li = (c, cnt) => c ? `<li><span>${UI.esc(c.name_zh || c.name_en)}</span><b>×${cnt}</b></li>` : '';
    const aspectCard = deck.aspect ? DB.ranger.aspects.find(a => a.id === deck.aspect) : null;
    const roleCard = deck.role ? DB.byId[deck.role] : null;
    const pers = deck.personalities.map(id => li(DB.byId[id], PICK_COPIES)).join('');
    const bg = deck.bgPicks.map(id => li(DB.byId[id], PICK_COPIES)).join('');
    const sp = deck.spPicks.map(id => li(DB.byId[id], PICK_COPIES)).join('');
    const it = deck.interest ? li(DB.byId[deck.interest], PICK_COPIES) : '';
    const shareCode = DeckCodec.encode(deck);
    const shareUrl = shareCode ? location.origin + location.pathname + '#/deck/' + shareCode : '';
    const saved = savedDecks();
    p.innerHTML = `<h3>牌组总览（<span class="deck-count ${n === DECK_SIZE ? 'full' : ''}">${n}</span>/${DECK_SIZE}）</h3>
      <input class="deck-name-input" id="deck-name" value="${UI.esc(deck.name)}" placeholder="牌组名称">
      ${aspectCard ? `<div class="ov-line">属性卡：${aspectCard.values.join(' · ')}（${UI.esc(aspVals(aspectCard.values))}）</div>` : ''}
      ${roleCard ? `<div class="ov-line">角色：${UI.esc(roleCard.name_zh || roleCard.name_en)}（开局在场）</div>` : ''}
      <div class="ov-group">性格</div><ul>${pers || '<li style="color:var(--fg-dim)">未选</li>'}</ul>
      <div class="ov-group">背景</div><ul>${bg || '<li style="color:var(--fg-dim)">未选</li>'}</ul>
      <div class="ov-group">专长</div><ul>${sp || '<li style="color:var(--fg-dim)">未选</li>'}</ul>
      <div class="ov-group">兴趣</div><ul>${it || '<li style="color:var(--fg-dim)">未选</li>'}</ul>
      ${errs.length ? `<div class="deck-warnings">${errs.map(e => '✗ ' + UI.esc(e)).join('\n')}</div>` : '<div class="deck-ok">✓ 牌组合法（15 独特 × 2 = 30 张）</div>'}
      <button class="btn" id="btn-copy-url" ${shareUrl ? '' : 'disabled'}>复制分享链接</button>
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
      deck = blank(); saveCurrent(); renderAll();
    });
    p.querySelectorAll('.saved-deck').forEach(sd => sd.addEventListener('click', e => {
      const name = sd.dataset.name;
      if (e.target.classList.contains('sd-del')) {
        const all = savedDecks(); delete all[name];
        localStorage.setItem(LS_KEY, JSON.stringify(all)); renderSide(); return;
      }
      const all = savedDecks();
      if (all[name]) { deck = all[name]; saveCurrent(); renderAll(); }
    }));
  }

  return { render };
})();
