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
    // 旧版 deck.aspect 是属性卡 id 字符串（如 "aspect-3122"），新版改为 4 维数值数组
    if (typeof deck.aspect === 'string') {
      const a = (DB.ranger && DB.ranger.aspects || []).find(x => x.id === deck.aspect);
      deck.aspect = a ? a.values.slice() : null;
    }
    if (Array.isArray(deck.aspect) && deck.aspect.length !== 4) deck.aspect = null;
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
    const diag = aspectDiagnostics(deck.aspect);
    if (!diag.ok) {
      if (diag.errors.length) diag.errors.forEach(e => errs.push('属性：' + e.text));
      else errs.push('属性数值未设置合法（须 4 维各 1-4、总和 8、分布为 [1,2,2,3] 或 [1,1,2,4] 的某种排列）');
    }
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

  /* 步骤 1：属性数值（4 维自由输入，每维 1-4，总和 8，分布须为 [1,2,2,3] 或 [1,1,2,4] 的某种排列） */
  const ASP_NAMES = ['AWA', 'FIT', 'FOC', 'SPI'];
  function renderAspect() {
    const p = document.getElementById('step-aspect');
    // 旧版数据兼容：deck.aspect 是属性卡 id 字符串，转成 4 维数组
    if (typeof deck.aspect === 'string') {
      const a = (DB.ranger && DB.ranger.aspects || []).find(x => x.id === deck.aspect);
      deck.aspect = a ? a.values.slice() : null;
    }
    if (!Array.isArray(deck.aspect) || deck.aspect.length !== 4) deck.aspect = [2, 2, 2, 2];
    const v = deck.aspect;
    const labels = ['知觉 AWA', '体质 FIT', '专注 FOC', '精神 SPI'];
    const colors = ['AWA', 'FIT', 'FOC', 'SPI'];
    const diag = aspectDiagnostics(v);
    p.innerHTML = `<h3><span class="step-num">1</span>属性数值（自由分配 8 点到 4 维，每维 1-4，分布须为 1/2/2/3 或 1/1/2/4）</h3>
      <div class="aspect-inputs">${v.map((n, i) => `
        <div class="asp-input-row asp-${colors[i]}${diag.rowBad[i] ? ' bad' : ''}${diag.rowWarn[i] ? ' warn' : ''}">
          <span class="asp-label">${labels[i]}</span>
          <button type="button" class="asp-btn" data-asp="${i}" data-delta="-1" aria-label="减 1">−</button>
          <input type="number" class="asp-num" min="1" max="4" step="1" value="${n}" data-asp="${i}">
          <button type="button" class="asp-btn" data-asp="${i}" data-delta="1" aria-label="加 1">+</button>
        </div>`).join('')}
        <div class="asp-total ${diag.ok ? 'ok' : 'bad'}">${aspectTotalText()}</div>
        <div class="asp-feedback">
          <ul class="asp-errors">${diag.errors.map(e => `<li>${UI.esc(e.text)}</li>`).join('')}</ul>
          <div class="asp-hint">合法分布参考：核心盒 1/2/2/3（如 3·1·2·2）或扩展 1/1/2/4（如 4·2·1·1）的任意排列，总和 8</div>
        </div>
      </div>`;
    // 数值输入：仅更新数据 + 局部刷新反馈，不重建 DOM（避免失焦）
    p.querySelectorAll('input.asp-num').forEach(inp => inp.addEventListener('input', e => {
      const i = +e.target.dataset.asp;
      let n = parseInt(e.target.value, 10);
      if (isNaN(n)) n = 1;
      n = Math.max(1, Math.min(4, n));
      deck.aspect[i] = n;
      saveCurrent();
      updateAspectFeedback();
    }));
    p.querySelectorAll('input.asp-num').forEach(inp => inp.addEventListener('blur', e => {
      const i = +e.target.dataset.asp;
      // blur 时把 input 值纠正为合法范围内的整数
      e.target.value = deck.aspect[i];
      renderAll();  // 重建以同步下游面板（含属性满足判定）
    }));
    // 加减按钮：直接重建 DOM（按钮不持焦）
    p.querySelectorAll('button.asp-btn').forEach(btn => btn.addEventListener('click', () => {
      const i = +btn.dataset.asp;
      const d = +btn.dataset.delta;
      deck.aspect[i] = Math.max(1, Math.min(4, (deck.aspect[i] || 2) + d));
      saveCurrent();
      renderAll();
    }));
  }
  /* 合法分布校验：4 维各 1-4，总和 8，且分布恰为 [1,2,2,3] 或 [1,1,2,4] 的某种排列。
     前者对应核心盒 12 张属性卡，后者对应扩展包引入的 4211 分布（如允许某维达到 4） */
  const VALID_DIST = ['1,2,2,3', '1,1,2,4'];
  function isAspectValid(v) {
    if (!Array.isArray(v) || v.length !== 4) return false;
    if (!v.every(n => n >= 1 && n <= 4)) return false;
    if (v.reduce((s, n) => s + n, 0) !== 8) return false;
    return VALID_DIST.includes(v.slice().sort((a, b) => a - b).join(','));
  }
  function aspectTotalText() {
    const v = deck.aspect || [0, 0, 0, 0];
    const total = v.reduce((s, n) => s + (n || 0), 0);
    const valid = isAspectValid(v);
    const tail = valid ? '✓'
      : (total > 8 ? `（超 ${total - 8}）`
        : (total < 8 ? `（差 ${8 - total}）` : ''));
    return `已分配 ${total} / 8 ${tail}`;
  }
  /* 逐维度诊断：
     rowBad[i]  = 第 i 维数值确定填错（超范围 / 分布不合法时必须改动的行）
     rowWarn[i] = 第 i 维是修复总和错误的候选调整行（黄框提示）
     errors     = 人类可读的错误与修改建议 */
  function aspectDiagnostics(v) {
    const errors = [];
    const rowBad = [false, false, false, false];
    const rowWarn = [false, false, false, false];
    if (!Array.isArray(v) || v.length !== 4) return { ok: false, errors, rowBad, rowWarn };
    // 1) 单维范围
    v.forEach((n, i) => {
      if (!(n >= 1 && n <= 4)) {   // NaN 也落到这里
        errors.push({ text: `${ASP_NAMES[i]} = ${n} 超出范围：每维只能填 1-4` });
        rowBad[i] = true;
      }
    });
    if (errors.length) return { ok: false, errors, rowBad, rowWarn };
    const total = v.reduce((s, n) => s + n, 0);
    // 2) 总和不对：指出可调整的具体维度
    if (total !== 8) {
      if (total > 8) {
        const d = total - 8;
        const cand = v.map((n, i) => (n > 1 ? i : -1)).filter(i => i >= 0);
        cand.forEach(i => { rowWarn[i] = true; });
        errors.push({ text: `总和 ${total}，超出 ${d} 点：把 ${cand.map(i => ASP_NAMES[i]).join(' / ')} 中任一维减 ${d}` });
      } else {
        const d = 8 - total;
        const cand = v.map((n, i) => (n < 4 ? i : -1)).filter(i => i >= 0);
        cand.forEach(i => { rowWarn[i] = true; });
        errors.push({ text: `总和 ${total}，还差 ${d} 点：把 ${cand.map(i => ASP_NAMES[i]).join(' / ')} 中任一维加 ${d}` });
      }
      return { ok: false, errors, rowBad, rowWarn };
    }
    // 3) 总和对但分布不合法：枚举所有合法排列，找改动位数最少的方案
    const sorted = v.slice().sort((a, b) => a - b);
    if (VALID_DIST.includes(sorted.join(','))) return { ok: true, errors, rowBad, rowWarn };
    const best = nearestLegalArrangement(v);
    best.changes.forEach(c => { rowBad[c.i] = true; });
    const desc = best.changes.map(c => `${ASP_NAMES[c.i]} ${c.from}→${c.to}`).join('、');
    errors.push({ text: `当前分布 [${sorted.join('/')}] 不在合法分布内。建议修改：${desc}` });
    return { ok: false, errors, rowBad, rowWarn };
  }
  /* 在两种合法分布的全部排列中，找与当前 v 改动位置最少的方案 */
  function nearestLegalArrangement(v) {
    const uniquePerms = arr => {
      const out = new Set();
      (function rec(rest, acc) {
        if (!rest.length) { out.add(acc.join(',')); return; }
        rest.forEach((x, i) => rec(rest.filter((_, j) => j !== i), acc.concat(x)));
      })(arr, []);
      return [...out].map(s => s.split(',').map(Number));
    };
    let best = null;
    for (const pat of VALID_DIST) {
      for (const perm of uniquePerms(pat.split(',').map(Number))) {
        const changes = [];
        perm.forEach((n, i) => { if (n !== v[i]) changes.push({ i, from: v[i], to: n }); });
        if (!best || changes.length < best.changes.length) best = { pattern: pat, changes };
      }
    }
    return best;
  }
  /* 输入过程中局部刷新：行状态 + 总点数 + 错误列表（不碰 input，保持焦点） */
  function updateAspectFeedback() {
    const root = document.getElementById('step-aspect');
    if (!root) return;
    const v = deck.aspect;
    const diag = aspectDiagnostics(v);
    root.querySelectorAll('.asp-input-row').forEach((row, i) => {
      row.classList.toggle('bad', !!diag.rowBad[i]);
      row.classList.toggle('warn', !!diag.rowWarn[i]);
    });
    const total = root.querySelector('.asp-total');
    if (total) {
      total.className = 'asp-total ' + (diag.ok ? 'ok' : 'bad');
      total.textContent = aspectTotalText();
    }
    const ul = root.querySelector('.asp-errors');
    if (ul) ul.innerHTML = diag.errors.map(e => `<li>${UI.esc(e.text)}</li>`).join('');
  }

  /* 步骤 2：性格（每属性各 1 张） */
  function renderPersonality() {
    const p = document.getElementById('step-personality');
    const cols = ['AWA', 'FIT', 'FOC', 'SPI'].map((asp, idx) => {
      const cards = personalityBy(asp);
      const items = cards.map(c => {
        const sel = deck.personalities.includes(c.id) ? ' sel' : '';
        const aspTag = c.aspect_id ? `<span class="tag asp-${c.aspect_id}">${c.aspect_id}</span>` : '';
        const pkTag = c.pack_id ? `<span class="tag pack-${c.pack_id}">${UI.esc(c.pack_name_zh || c.pack_name_en || '')}</span>` : '';
        return `<div class="setup-item${sel}" data-pid="${c.id}">
          <div>${UI.esc(c.name_zh || c.name_en)}</div>
          <div class="si-en">${UI.esc(c.name_en)}</div>
          <div class="si-tags">${aspTag}${pkTag}</div></div>`;
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
    return `<div class="pool-row pick-row${sel}${unmetClass(c, sel)}" data-pick="${c.id}">
      ${rowTags(c)}
      <span class="pr-name">${UI.esc(c.name_zh || c.name_en)}<small>${UI.esc(c.name_en)} · ${UI.esc(c.type_zh || '')}</small></span>
      <span class="pr-ctrl">${unmetTag(c, sel)}<b>${sel ? '×' + PICK_COPIES : ''}</b></span></div>`;
  }
  /* 属性需求与满足判定（仿 RangersDB 原站英文模式） */
  const ASPECT_ORDER = ['AWA', 'FIT', 'FOC', 'SPI'];
  function aspectValOf(id) {
    if (!Array.isArray(deck.aspect)) return null;
    const i = ASPECT_ORDER.indexOf(id);
    return i >= 0 ? deck.aspect[i] : null;
  }
  // null = 无需求（属性卡/角色卡 cost=null），true = 满足，false = 不足
  function cardMeetsAspect(c) {
    if (c.cost == null || !c.aspect_id) return null;
    const v = aspectValOf(c.aspect_id);
    if (v == null) return null;
    return v >= c.cost;
  }
  function rowTags(c) {
    const costTag = c.cost != null
      ? `<span class="pr-cost tag asp-${c.aspect_id || 'none'}">${c.cost}${c.aspect_id ? ' ' + c.aspect_id : ''}</span>`
      : '<span class="pr-cost tag none">—</span>';
    const packTag = c.pack_id
      ? `<span class="pr-pack tag pack-${c.pack_id}">${UI.esc(c.pack_name_zh || c.pack_name_en || '')}</span>`
      : '';
    return costTag + packTag;
  }
  function unmetClass(c, sel) {
    return (cardMeetsAspect(c) === false && !sel) ? ' unmet' : '';
  }
  function unmetTag(c, sel) {
    return (cardMeetsAspect(c) === false && !sel)
      ? '<span class="unmet-tag">不满足</span>' : '';
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
      <div class="pool-list">${list.map(c => {
        const sel = deck.interest === c.id;
        return `<div class="pool-row pick-row${sel ? ' sel' : ''}${unmetClass(c, sel)}" data-interest="${c.id}">
          ${rowTags(c)}
          <span class="pr-name">${UI.esc(c.name_zh || c.name_en)}<small>${UI.esc(c.name_en)} · ${UI.esc(c.type_zh || '')}</small></span>
          <span class="pr-ctrl">${unmetTag(c, sel)}<b>${sel ? '×' + PICK_COPIES : ''}</b></span></div>`;
      }).join('') || '<div class="empty-hint">无匹配</div>'}</div>`
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
    const aspectArr = Array.isArray(deck.aspect) ? deck.aspect : null;
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
      ${aspectArr ? `<div class="ov-line">属性：${aspVals(aspectArr)}（${aspectArr.join(' · ')}）</div>` : ''}
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
