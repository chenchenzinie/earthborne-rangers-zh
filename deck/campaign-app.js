/* ============================================================
 * 地缘行者 · 战役记录器
 * 功能：
 *   · 基础（引入山谷）/ 扩展（先祖遗产）战役表自由切换
 *   · 三个可同时使用的存档槽 + JSON 导出/导入 + 浏览器删除提醒
 *   · 可交互地图：点击地点图标记录旅行（自动识别两地间路径地形并写入记录表，
 *     关键/非关键地点提示应加入路径牌堆的牌），直接点击路径线段也可识别地形；
 *     地形笔刷与下方输入框保留手动修改；📍 图钉随存档保存
 *   · 新战役默认第 1 天位于孤树基站（路径：树林）
 *   · 扩展天气分地上/地下两轨（地上同基础，地下为万籁俱静/光辉之雨/波光洪流）
 *   · 任务牌数据库：名称可搜索下拉 + 每行备注栏
 *   · 30 天日历推进/回退、手册条目提醒
 * ============================================================ */
(function () {
  'use strict';

  const SLOT_COUNT = 3;
  const SLOT_KEY = i => `ebr_slot_${i + 1}`;
  const ACTIVE_KEY = 'ebr_active_slot';
  const LEGACY_KEY = 'ebr_campaign_v1';
  const PIPS = 3;
  const REWARD_SLOTS = 36;
  const DECK_SLOTS = 4;            // 玩家牌组栏（联动卡牌管理系统）

  let slotIdx = 0;
  let slot = null;          // { v:2, active, valley:{...}, ancestral:{...} }
  let state = null;         // 当前战役
  let selectedDay = 1;
  /* v41：旅行日记 */
  let curView = 'sheet';        // 'sheet' 战役面板 / 'diary' 旅行日记
  let diaryDay = null;          // 日记正在看第几天；null = 跟随 state.currentDay
  let diaryStatTimer = 0;
  let currentMap = 'valley';
  let brushTerrain = null;  // 地形笔刷
  let dirty = false;
  let chConfirmPending = false;  // 挑战抽牌：确认界面待处理（按钮显示「确定」）
  let chConfirmAck = false;      // 当前重洗标记已被玩家确认（抽到下一张重洗牌时重置）

  const esc2 = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const camp = () => CAMPAIGNS[slot.active];
  const dayCount = () => camp().days;
  const missionSlots = () => camp().missionSlots;
  const missionDB = () => (slot.active === 'valley' ? MISSIONS_VALLEY : MISSIONS_ANCESTRAL);
  const rewardDB = () => (slot.active === 'valley' ? REWARDS_VALLEY : REWARDS_ANCESTRAL);
  /* 资源根目录：合入「地缘行者·游戏辅助系统」后，战役图片统一放在 campaign/ 下 */
  const ASSET = 'campaign/';
  const rewardImg = m => slot.active === 'valley'
    ? `${ASSET}rewards-valley/奖励-${m.n}-31.jpg`
    : `${ASSET}rewards-ancestral/奖励XZ-${m.n}-29.jpg`;
  // 当前天气区域（基础战役恒为地上；扩展可在地上/地下间切换）
  const region = () => (slot.active === 'ancestral' && state.region === 'underground') ? 'underground' : 'surface';
  const wtable = () => camp().weather[region()];
  const otherTable = () => {
    if (slot.active !== 'ancestral') return null;
    return camp().weather[region() === 'underground' ? 'surface' : 'underground'];
  };
  const weatherBg = cls => `var(--${cls})`;

  /* ---------- 状态构造 / 规范化 ---------- */
  function blankCampaign(key) {
    // 第一天的初始地点：孤树基站（路径：树林）
    const startMap = key === 'valley' ? 'valley' : 'ancestral';
    const start = MAP_DB[startMap].spots.find(s => s[0] === '孤树基站');
    return {
      v: 2,
      currentDay: 1,
      hardWeather: false,
      region: 'surface',    // 扩展战役：surface 地上 / underground 地下
      rangers: '',
      location: '孤树基站',
      terrain: '树林',
      events: Array(CAMPAIGNS[key].eventSlots).fill(''),
      rewards: Array(REWARD_SLOTS).fill(''),
      dayEntries: {},
      diary: {},                 // v41：旅行日记 —— { [天数]: 正文 }，随存档保存
      missions: Array.from({ length: CAMPAIGNS[key].missionSlots }, () => ({ day: '', name: '', prog: 0, note: '' })),
      decks: Array(DECK_SLOTS).fill(null),   // 玩家牌组：由卡牌管理系统的牌组代码导入
      deckNames: [],                         // 上一次由牌组同步进「行者」名单的名字（用于移除时区分手写内容）
      mapPin: { map: startMap, x: start[1] / 100, y: start[2] / 100 },
      challenges: blankChallenges(),
    };
  }
  function normalizeCampaign(key, raw) {
    const b = blankCampaign(key);
    const r = raw && typeof raw === 'object' ? raw : {};
    const s = Object.assign(b, r);
    if (!Array.isArray(s.rewards)) s.rewards = [];
    // 旧版 3 个长文本奖励框的内容保留到新 36 栏的前 3 栏，不丢数据
    s.rewards = Array.from({ length: REWARD_SLOTS }, (_, i) =>
      (typeof s.rewards[i] === 'string' ? s.rewards[i] : ''));
    // 重要事件：基础 22 栏 / 扩展 33 栏；旧版两个文本框内容迁入前 2 栏
    if (!Array.isArray(r.events)) {
      s.events = [];
      if (typeof r.events1 === 'string' && r.events1.trim()) s.events.push(r.events1);
      if (typeof r.events2 === 'string' && r.events2.trim()) s.events.push(r.events2);
    }
    const evSlots = CAMPAIGNS[key].eventSlots;
    s.events = Array.from({ length: evSlots }, (_, i) =>
      (typeof s.events[i] === 'string' ? s.events[i] : ''));
    delete s.events1; delete s.events2;
    if (typeof s.dayEntries !== 'object' || !s.dayEntries) s.dayEntries = {};
    /* v41：旅行日记 —— 只保留 1..days 范围内的字符串，避免旧存档/脏数据混入 */
    const dRaw = (s.diary && typeof s.diary === 'object') ? s.diary : {};
    s.diary = {};
    for (let d = 1; d <= CAMPAIGNS[key].days; d++) {
      const t = dRaw[d];
      if (typeof t === 'string') s.diary[d] = t;
    }
    if (s.region !== 'underground') s.region = 'surface';
    const slots = CAMPAIGNS[key].missionSlots;
    const old = Array.isArray(s.missions) ? s.missions : [];
    // 卡牌清单变动（删牌）后，按「编号 · 名称」把旧记录对齐到新槽位
    const db = key === 'valley' ? MISSIONS_VALLEY : MISSIONS_ANCESTRAL;
    const valIdx = {};
    db.forEach((m, i) => { valIdx[`${m.n} · ${m.name}`] = i; });
    const next = Array.from({ length: slots }, () => null);
    const used = new Set();
    old.forEach(o => {
      if (!o || typeof o !== 'object') return;
      const idx = valIdx[(o.name || '').trim()];
      if (idx != null && !used.has(idx)) { used.add(idx); next[idx] = o; }
    });
    s.missions = next.map(o => Object.assign({ day: '', name: '', prog: 0, note: '' }, o || {}));
    // 玩家牌组：4 栏，每栏 { name, code, at, sum:{...} } 或 null
    s.decks = Array.from({ length: DECK_SLOTS }, (_, i) => {
      const d = Array.isArray(r.decks) ? r.decks[i] : null;
      if (!d || typeof d !== 'object' || !d.code) return null;
      return { name: String(d.name || '未命名'), code: String(d.code), at: d.at || null, sum: (d.sum && typeof d.sum === 'object') ? d.sum : null };
    });
    s.currentDay = Math.min(CAMPAIGNS[key].days + 1, Math.max(1, s.currentDay | 0 || 1));
    s.missions.forEach(m => { m.prog = Math.max(0, Math.min(PIPS, m.prog | 0 || 0)); });
    if (s.mapPin && (typeof s.mapPin !== 'object' || !MAP_DB[s.mapPin.map])) s.mapPin = null;
    if (!Array.isArray(s.deckNames)) s.deckNames = Array.isArray(r.decks)
      ? r.decks.filter(d => d && d.name).map(d => String(d.name)) : [];
    s.challenges = normalizeChallenges(s.challenges);
    return s;
  }
  // 挑战牌堆：deck 是剩余牌（数组下标大者=牌堆顶端，pop 抽出），drawn 是已抽牌（按抽牌顺序）
  function blankChallenges() {
    const deck = CHALLENGES.map((_, i) => i);
    // Fisher-Yates 洗牌
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return { deck, drawn: [] };
  }
  function normalizeChallenges(raw) {
    if (!raw || typeof raw !== 'object') return blankChallenges();
    let deck = Array.isArray(raw.deck) ? raw.deck.filter(i => Number.isInteger(i) && i >= 0 && i < CHALLENGES.length) : [];
    let drawn = Array.isArray(raw.drawn) ? raw.drawn.filter(i => Number.isInteger(i) && i >= 0 && i < CHALLENGES.length) : [];
    // 去重：同一张牌不能同时出现在 deck 和 drawn
    const all = new Set(drawn);
    deck = deck.filter(i => !all.has(i));
    // 若 deck+drawn 不足 24 张（旧存档/数据损坏），用缺失的牌补满 deck
    const present = new Set([...deck, ...drawn]);
    const missing = [];
    for (let i = 0; i < CHALLENGES.length; i++) if (!present.has(i)) missing.push(i);
    deck = deck.concat(missing);
    return { deck, drawn };
  }
  function blankSlot() {
    return { v: 2, active: 'valley', valley: blankCampaign('valley'), ancestral: blankCampaign('ancestral') };
  }
  function normalizeSlot(raw) {
    const b = blankSlot();
    const s = Object.assign(b, raw && typeof raw === 'object' ? raw : {});
    if (!CAMPAIGNS[s.active]) s.active = 'valley';
    s.valley = normalizeCampaign('valley', s.valley);
    s.ancestral = normalizeCampaign('ancestral', s.ancestral);
    return s;
  }

  /* ---------- 持久化 ---------- */
  function load() {
    try { slotIdx = Math.min(SLOT_COUNT - 1, Math.max(0, +(localStorage.getItem(ACTIVE_KEY) || 0))); }
    catch (e) { slotIdx = 0; }
    try {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy && !localStorage.getItem(SLOT_KEY(0))) {
        const migrated = blankSlot();
        migrated.valley = normalizeCampaign('valley', JSON.parse(legacy));
        localStorage.setItem(SLOT_KEY(0), JSON.stringify(migrated));
        localStorage.removeItem(LEGACY_KEY);
      }
    } catch (e) { console.error('旧存档迁移失败', e); }
    loadSlot(slotIdx);
  }
  function loadSlot(i) {
    slotIdx = i;
    try {
      const raw = localStorage.getItem(SLOT_KEY(i));
      slot = raw ? normalizeSlot(JSON.parse(raw)) : blankSlot();
    } catch (e) {
      console.error('存档读取失败', e);
      slot = blankSlot();
    }
    state = slot[slot.active];
    if (!camp().maps.includes(currentMap)) currentMap = camp().maps[0];
    brushTerrain = null;
    chConfirmPending = false;
    chConfirmAck = false;
    selectedDay = Math.min(state.currentDay, dayCount());
    diaryDay = null;                 // v41：换槽后日记回到「今天」
    dirty = false;
    try { localStorage.setItem(ACTIVE_KEY, String(i)); } catch (e) {}
  }
  let saveTimer = null;
  function save() {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 120);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    if (!dirty) return;
    try {
      localStorage.setItem(SLOT_KEY(slotIdx), JSON.stringify(slot));
      dirty = false;
      renderSlotTabs();
    } catch (e) { console.error('保存失败', e); }
  }

  /* ---------- 天气 ---------- */
  function weatherIndexFor(day, rKey) {
    const t = camp().weather[rKey];
    const base = t.seq[day - 1];
    return state.hardWeather ? Math.min(t.hardMax, base + 1) : base;
  }
  function weatherIndex(day) { return weatherIndexFor(day, region()); }

  /* ---------- DOM 工具 ---------- */
  const $ = id => document.getElementById(id);
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  /* ---------- 渲染：战役 / 存档槽切换 ---------- */
  function renderCampaignTabs() {
    document.querySelectorAll('#campaign-switch .camp-tab').forEach(btn => {
      const k = btn.dataset.camp;
      btn.classList.toggle('on', k === slot.active);
      btn.title = `${CAMPAIGNS[k].sub} · ${CAMPAIGNS[k].name}`;
    });
  }
  function slotSummary(i) {
    try {
      const raw = localStorage.getItem(SLOT_KEY(i));
      if (!raw) return '空';
      const s = JSON.parse(raw);
      const c = s && s[s.active];
      if (!c) return '空';
      const dc = CAMPAIGNS[s.active].days;
      const done = Math.min(c.currentDay - 1, dc);
      return `${CAMPAIGNS[s.active].name} · 第${c.currentDay > dc ? '完' : done + 1}天`;
    } catch (e) { return '空'; }
  }
  function renderSlotTabs() {
    document.querySelectorAll('#slot-switch .slot-tab').forEach(btn => {
      const i = +btn.dataset.slot;
      btn.classList.toggle('on', i === slotIdx);
      btn.innerHTML = `存档槽 ${i + 1}<small>${i === slotIdx ? `${camp().name} · 进行中` : slotSummary(i)}</small>`;
    });
  }

  /* ---------- 渲染：今日条（扩展含地上/地下切换） ---------- */
  function renderToday() {
    const d = state.currentDay;
    const dc = dayCount();
    $('today-num').textContent = d;
    const w = $('today-weather');
    w.style.background = 'transparent';
    if (d > dc) {
      w.textContent = '战役完成';
      w.style.background = 'var(--ink)';
    } else if (slot.active === 'ancestral') {
      w.innerHTML = ['surface', 'underground'].map(rKey => {
        const t = camp().weather[rKey];
        const wi = weatherIndexFor(d, rKey);
        const label = rKey === 'surface' ? '地上' : '地下';
        return `<button type="button" class="wchip ${rKey === region() ? 'on' : 'off'}" data-r="${rKey}"
          style="--chipc:${weatherBg(t.cls[wi])}" title="点击切换天气轨（地上/地下）">
          <b>${label}</b>${t.names[wi]}</button>`;
      }).join('');
      w.querySelectorAll('.wchip').forEach(b => b.addEventListener('click', () => {
        if (state.region === b.dataset.r) return;
        state.region = b.dataset.r;
        dirty = true; saveNow();
        renderToday(); renderCalendar();
      }));
    } else {
      const wi = weatherIndex(d);
      w.textContent = `今日天气 · ${wtable().names[wi]}`;
      w.style.background = weatherBg(wtable().cls[wi]);
    }
    $('btn-advance').disabled = d > dc;
    $('btn-prev').disabled = d <= 1;
  }

  /* ---------- 渲染：日历 ---------- */
  function renderCalendar() {
    const grid = $('calendar-grid');
    grid.innerHTML = '';
    const dc = dayCount();
    for (let day = 1; day <= dc; day++) {
      const past = day < state.currentDay;
      const current = day === state.currentDay;
      const wi = weatherIndex(day);
      const entries = state.dayEntries[day] || ['', '', ''];
      const cell = el('div',
        `day-cell ${wtable().cls[wi]} ${past ? 'past' : ''} ${current ? 'current' : ''} ${day > state.currentDay ? 'future' : ''}` +
        (day === selectedDay ? ' selected' : ''));
      cell.dataset.day = day;
      const dots = entries.map(s => `<i class="${s.trim() ? 'on' : ''}"></i>`).join('');
      cell.innerHTML =
        `<span class="d-num">${day}</span>` +
        (past ? '<span class="d-x">✕</span>' : `<span class="d-x" style="visibility:hidden">·</span>`) +
        `<span class="d-dots">${dots}</span>`;
      let title = `第 ${day} 天 · ${region() === 'underground' ? '地下' : '地上'} · ${wtable().names[wi]}`;
      const ot = otherTable();
      if (ot) {
        const owi = weatherIndexFor(day, region() === 'underground' ? 'surface' : 'underground');
        title += ` ｜ ${region() === 'underground' ? '地上' : '地下'} · ${ot.names[owi]}`;
      }
      cell.title = title;
      cell.addEventListener('click', () => onDayCellClick(day));
      grid.appendChild(cell);
    }
    renderDayEditor();
    renderWeatherLegend();
  }
  function renderWeatherLegend() {
    const lg = $('weather-legend');
    if (slot.active === 'ancestral') {
      lg.innerHTML =
        `<span class="lg-title">地上：</span>` +
        `<span><i class="dot w1"></i>风和日丽</span><span><i class="dot w2"></i>倾盆大雨</span><span><i class="dot w3"></i>狂风呼啸</span>` +
        `<span class="legend-sep"></span><span class="lg-title">地下：</span>` +
        `<span><i class="dot u1"></i>万籁俱静</span><span><i class="dot u2"></i>光辉之雨</span><span><i class="dot u3"></i>波光洪流</span>` +
        `<span class="legend-sep"></span><span><i class="dot w4"></i>电光迷雾（地上加码）</span>`;
    } else {
      lg.innerHTML =
        `<span><i class="dot w1"></i>风和日丽</span>` +
        `<span><i class="dot w2"></i>倾盆大雨</span>` +
        `<span><i class="dot w3"></i>狂风呼啸</span>` +
        `<span><i class="dot w4"></i>电光迷雾（加码）</span>`;
    }
  }

  function onDayCellClick(day) {
    if (day === state.currentDay && day <= dayCount()) {
      advanceDay();
      selectedDay = state.currentDay;
    } else if (day === state.currentDay - 1) {
      regressDay();
      selectedDay = state.currentDay;
    } else {
      selectedDay = day;
    }
    renderCalendar();
    renderToday();
  }

  function renderDayEditor() {
    const day = Math.min(dayCount(), Math.max(1, selectedDay));
    $('de-day').textContent = day;
    const entries = state.dayEntries[day] || ['', '', ''];
    [1, 2, 3].forEach((k, i) => {
      const inp = $('de-' + k);
      if (document.activeElement !== inp) inp.value = entries[i] || '';
    });
  }
  function commitDayEntry(slotNo) {
    const day = selectedDay;
    const arr = (state.dayEntries[day] || ['', '', '']).slice();
    arr[slotNo - 1] = $('de-' + slotNo).value;
    if (arr.some(x => x.trim())) state.dayEntries[day] = arr;
    else delete state.dayEntries[day];
    save();
    renderCalendar();
  }

  /* ---------- 推进 / 回退 ---------- */
  function advanceDay() {
    const n = state.currentDay;
    const dc = dayCount();
    if (n > dc) return;
    const msgs = [];
    const fixed = camp().fixedRemind || {};
    if (fixed[n]) msgs.push(`别忘了阅读战役手册条目 ${fixed[n]}！`);
    const nextDay = n + 1;
    if (nextDay <= dc) {
      const entries = (state.dayEntries[nextDay] || []).map(s => s.trim()).filter(Boolean);
      entries.forEach(x => msgs.push(`别忘了阅读战役手册条目 ${x}！`));
    }
    if (n === dc) msgs.push(`第 ${dc} 天结束，战役已完成！`);
    state.currentDay = nextDay;
    selectedDay = Math.min(nextDay, dc);
    dirty = true; saveNow();
    showReminder(n === dc ? '战役完成' : `第 ${nextDay} 天`, msgs);
  }
  function regressDay() {
    if (state.currentDay <= 1) return;
    state.currentDay -= 1;
    selectedDay = state.currentDay;
    dirty = true; saveNow();
    hideReminder();
  }

  /* ---------- v25：提醒横幅 5 秒倒计时后缓慢淡出（鼠标移上去暂停） ---------- */
  const REM_SEC = 5, REM_FADE = 1500;
  let remTick = 0, remFade = 0, remLeft = 0;
  function clearRemTimers() { clearInterval(remTick); clearTimeout(remFade); remTick = remFade = 0; }
  function remPaint() {
    const box = $('reminder-box');
    if (!box) return;
    const t = box.querySelector('.rem-timer'), bar = box.querySelector('.rem-bar i');
    if (t) t.textContent = `${remLeft} 秒后自动消失（鼠标移上来暂停）`;
    if (bar) bar.style.width = Math.max(0, remLeft / REM_SEC * 100) + '%';
  }
  function remStartTick() {
    clearRemTimers();
    remTick = setInterval(() => {
      remLeft -= 1; remPaint();
      if (remLeft <= 0) {
        clearInterval(remTick); remTick = 0;
        const box = $('reminder-box');
        if (box) box.classList.add('fading');       // 缓慢消散
        remFade = setTimeout(hideReminder, REM_FADE);
      }
    }, 1000);
  }
  function scheduleReminder() {
    const box = $('reminder-box');
    if (!box) return;
    box.classList.remove('fading');
    remLeft = REM_SEC; remPaint(); remStartTick();
  }

  function showReminder(title, msgs, label = '阅读提醒', icon = '📖') {
    const box = $('reminder-box');
    if (!msgs.length) { box.hidden = true; return; }
    box.innerHTML =
      `<button class="rem-close" title="关闭">×</button>` +
      `<h3>${icon} ${title} · ${label}</h3><ul>${msgs.map(m => `<li>${m}</li>`).join('')}</ul>` +
      `<div class="rem-foot"><span class="rem-timer"></span><span class="rem-bar"><i></i></span></div>`;
    box.hidden = false;
    box.querySelector('.rem-close').addEventListener('click', hideReminder);
    // 每次弹提示时触发一次 pulse 动画，让用户能明显感知"新提示出现"（即使上次提示还未关闭）
    box.classList.remove('pulse');
    void box.offsetWidth;
    box.classList.add('pulse');
    // v25：5 秒倒计时后缓慢消散；鼠标移上去暂停，移开继续
    scheduleReminder();
    box.onmouseenter = () => { if (remTick) { clearInterval(remTick); remTick = 0; } clearTimeout(remFade); remFade = 0; box.classList.remove('fading'); };
    box.onmouseleave = () => { if (!remTick && remLeft > 0 && !box.hidden) remStartTick(); };
  }
  function hideReminder() {
    clearRemTimers();
    const box = $('reminder-box');
    if (!box) return;
    box.hidden = true;
    box.classList.remove('fading');
  }

  /* ---------- 渲染：任务 ---------- */
  function renderMissionDatalist() {
    const dl = $('mission-names');
    dl.innerHTML = '';
    missionDB().forEach(m => {
      const opt = document.createElement('option');
      opt.value = `${m.n} · ${m.name}`;
      opt.label = m.type + (m.goal ? `｜${m.goal}` : '');
      dl.appendChild(opt);
    });
    $('mission-hint').textContent =
      `（${missionSlots()} 个槽位 · 名称可输入编号或文字搜索 · 3 格进度 ◆ · 每行带备注）`;
  }
  function renderMissions() {
    const wrap = $('mission-cols');
    wrap.innerHTML = '';
    const total = missionSlots();
    const perCol = Math.ceil(total / 3);
    for (let col = 0; col < 3; col++) {
      const colEl = el('div', 'mission-col');
      for (let k = 0; k < perCol; k++) {
        const idx = col * perCol + k;
        if (idx >= total) break;
        const m = state.missions[idx];
        const row = el('div', 'mission-row');

        const line1 = el('div', 'm-line1');
        const dayInp = el('input');
        dayInp.type = 'text'; dayInp.maxLength = 6; dayInp.placeholder = '日期';
        dayInp.value = m.day;
        dayInp.addEventListener('input', () => { m.day = dayInp.value; save(); });
        const nameInp = el('input');
        nameInp.type = 'text'; nameInp.placeholder = `任务 ${idx + 1}（输入编号/名称搜索）`;
        nameInp.dataset.ac = 'mission-names';
        nameInp.value = m.name;
        nameInp.addEventListener('input', () => { m.name = nameInp.value; save(); });
        const dayWrap = el('span', 'm-day'); dayWrap.appendChild(dayInp);
        const nameWrap = el('span', 'm-name'); nameWrap.appendChild(nameInp);
        const pips = el('span', 'pips');
        for (let p = 0; p < PIPS; p++) {
          const pip = el('button', 'pip' + (p < m.prog ? ' on' : ''), '◆');
          pip.type = 'button';
          pip.title = `进度 ${p + 1}/3`;
          pip.addEventListener('click', () => {
            m.prog = (p < m.prog) ? m.prog - 1 : m.prog + 1;
            save(); renderMissions();
          });
          pips.appendChild(pip);
        }
        line1.appendChild(dayWrap);
        line1.appendChild(nameWrap);
        line1.appendChild(pips);

        const line2 = el('div', 'm-line2');
        const noteInp = el('input');
        noteInp.type = 'text'; noteInp.placeholder = '备注…';
        noteInp.value = m.note || '';
        noteInp.addEventListener('input', () => { m.note = noteInp.value; save(); });
        line2.appendChild(noteInp);

        row.appendChild(line1);
        row.appendChild(line2);
        colEl.appendChild(row);
      }
      wrap.appendChild(colEl);
    }
  }

  /* ---------- 渲染：奖励（36 栏，3 列 × 12 行；下拉带牌面缩略图） ---------- */
  function renderRewardDatalist() {
    const dl = $('reward-names');
    dl.innerHTML = '';
    rewardDB().forEach(m => {
      const o = document.createElement('option');
      o.value = `${m.n} · ${m.name}`;
      o.label = m.type;
      o.dataset.img = rewardImg(m);
      dl.appendChild(o);
    });
    $('reward-hint').textContent =
      `（${REWARD_SLOTS} 栏 · 当前战役奖励牌 ${rewardDB().length} 张 · 可输入编号/名称搜索）`;
  }
  function renderRewards() {
    const wrap = $('reward-cols');
    wrap.innerHTML = '';
    const perCol = REWARD_SLOTS / 3;
    for (let col = 0; col < 3; col++) {
      const colEl = el('div', 'reward-col');
      for (let k = 0; k < perCol; k++) {
        const idx = col * perCol + k;
        const row = el('label', 'rw-row');
        const no = el('span', 'rw-no', String(idx + 1));
        const inp = el('input');
        inp.type = 'text';
        inp.placeholder = `奖励 ${idx + 1}`;
        inp.dataset.ac = 'reward-names';
        inp.value = state.rewards[idx] || '';
        inp.addEventListener('input', () => { state.rewards[idx] = inp.value; save(); });
        row.appendChild(no);
        row.appendChild(inp);
        colEl.appendChild(row);
      }
      wrap.appendChild(colEl);
    }
  }

  /* ---------- 渲染：重要事件（基础 22 栏=2列11行 / 扩展 33 栏=3列11行） ---------- */
  function renderEvents() {
    const total = camp().eventSlots;
    const cols = total / 11;
    $('event-hint').textContent = `（${total} 栏）`;
    const wrap = $('event-cols');
    wrap.innerHTML = '';
    wrap.classList.toggle('ec3', cols === 3);
    wrap.classList.toggle('ec2', cols === 2);
    const perCol = 11;
    for (let col = 0; col < cols; col++) {
      const colEl = el('div', 'event-col');
      for (let k = 0; k < perCol; k++) {
        const idx = col * perCol + k;
        if (idx >= total) break;
        const row = el('label', 'ev-row');
        row.appendChild(el('span', 'ev-no', String(idx + 1)));
        const inp = el('input');
        inp.type = 'text';
        inp.placeholder = `重要事件 ${idx + 1}`;
        inp.value = state.events[idx] || '';
        inp.addEventListener('input', () => { state.events[idx] = inp.value; save(); });
        row.appendChild(inp);
        colEl.appendChild(row);
      }
      wrap.appendChild(colEl);
    }
  }

  /* ---------- 渲染：玩家牌组（联动卡牌管理系统） ----------
   * 4 个槽位，每槽可：粘贴卡牌管理系统的「牌组代码 / 分享链接」导入，
   * 或直接从本站「我的牌组」里挑一个。导入后自动同步到上方「行者」名单，
   * 并可以把该牌组用到的奖励牌一键填入「奖励」栏。 */
  const deckApi = () => (typeof decodeDeckCode === 'function' && typeof encodeDeckCode === 'function');
  function deckSum(deckObj) {
    try {
      if (typeof deckStatus !== 'function') return null;
      const st = deckStatus(deckObj), s = deckObj.steps || {};
      const cb = typeof cardById === 'function' ? cardById : () => null;
      const ri = typeof roleInfo === 'function' ? roleInfo(deckObj) : null;
      return {
        bg: s.background?.deck || '', exp: s.expertise?.deck || '',
        role: ri?.name || cb(s.role)?.name || '',
        attr: cb(s.attribute)?.attr || null,
        kinds: st.kinds, cards: st.cards, problems: st.problems.length,
        rws: (s.rewards || []).map(x => ({ r: x.reward, o: x.replaced,
          rn: cb(x.reward)?.name || '', on: cb(x.replaced)?.name || '' })).filter(x => x.rn),
        traits: (typeof TRAIT_GROUPS !== 'undefined' ? TRAIT_GROUPS : [])
          .map(g => ({ k: g.key, label: g.label, attr: g.attr, name: cb(deckObj.steps?.traits?.[g.key])?.name || '' })),
      };
    } catch (e) { return null; }
  }
  const say = m => { try { if (typeof toast === 'function') toast(m, 3600); else alert(m); } catch (e) { alert(m); } };

  /* 牌组名同步进「行者」名单（保留用户手写的内容，只追加/移除牌组名） */
  function syncRangersFromDecks() {
    const mine = (state.decks || []).filter(d => d && d.name).map(d => d.name);
    const prev = Array.isArray(state.deckNames) ? state.deckNames.map(String) : [];
    const cur = String(state.rangers || '').split('\n').map(s => s.trim()).filter(Boolean);
    /* 只删掉「上次由牌组写进去、现在已不在牌组里」的名字，用户手写的内容原样保留 */
    const kept = cur.filter(n => !prev.includes(n));
    state.rangers = [...kept, ...mine].join('\n');
    state.deckNames = mine.slice();
  }
  function importDeckAt(i, raw) {
    if (!deckApi()) { say('卡牌管理系统尚未就绪，请刷新后重试'); return; }
    const r = decodeDeckCode(raw);
    if (r.error) { say(r.error); return; }
    state.decks[i] = { name: r.deck.name, code: encodeDeckCode(r.deck), at: Date.now(), sum: deckSum(r.deck) };
    if (r.missing && r.missing.length) say(`已导入「${r.deck.name}」，有 ${r.missing.length} 张卡在当前数据中找不到`);
    else say(`已把「${r.deck.name}」记入玩家 ${i + 1}`);
    syncRangersFromDecks();
    saveNow(); renderAll();
  }
  function renderDecks() {
    const box = $('deck-cols'); if (!box) return;
    if (!Array.isArray(state.decks)) state.decks = Array(DECK_SLOTS).fill(null);
    const hint = $('deck-hint');
    if (hint) hint.textContent = deckApi()
      ? `（${DECK_SLOTS} 栏 · 粘贴牌组代码 / 分享链接，或从「我的牌组」直接选 · 导入后自动写进行者名单）`
      : `（${DECK_SLOTS} 栏 · 卡牌管理系统尚未加载，请刷新页面）`;
    const mine = (typeof DB !== 'undefined' && Array.isArray(DB.decks)) ? DB.decks : [];
    box.innerHTML = state.decks.map((d, i) => {
      const head = `<div class="ds-head"><b>玩家 ${i + 1}</b>${d ? `<span class="ds-name">${esc2(d.name)}</span>` : '<span class="muted small">未导入</span>'}</div>`;
      if (!d) {
        return `<div class="deck-slot empty">
          ${head}
          <input type="text" class="ds-code" data-dkcode="${i}" placeholder="粘贴牌组代码 / 分享链接">
          <div class="ds-btns">
            <button type="button" class="btn sm primary" data-dkimp="${i}">导入</button>
            <select class="ds-sel" data-dksel="${i}">
              <option value="">从我的牌组…</option>
              ${mine.map(x => `<option value="${esc2(x.id)}">${esc2(x.name)}</option>`).join('')}
            </select>
          </div>
        </div>`;
      }
      const s = d.sum || {};
      const attrTxt = s.attr ? Object.entries(s.attr).map(([k, v]) => `${k}${v}`).join(' ') : '';
      const traitTxt = (s.traits || []).filter(t => t.name).map(t => `${t.label}:${t.name}`).join(' · ');
      const rwTxt = (s.rws || []).map(x => `${x.rn} ⇄ ${x.on}`).join(' · ');
      return `<div class="deck-slot">
        ${head}
        <div class="ds-meta">背景 <b>${esc2(s.bg || '—')}</b> · 专长 <b>${esc2(s.exp || '—')}</b></div>
        <div class="ds-meta">角色 <b>${esc2(s.role || '—')}</b></div>
        <div class="ds-meta">牌库 <b>${s.kinds ?? '—'}</b> 种 / <b>${s.cards ?? '—'}</b> 张
          ${s.problems ? `<span class="bad">⚠ ${s.problems} 项待处理</span>` : '<span class="ok">✔ 合规</span>'}</div>
        ${attrTxt ? `<div class="ds-meta small muted">属性 ${esc2(attrTxt)}</div>` : ''}
        ${traitTxt ? `<div class="ds-meta small muted">性格 ${esc2(traitTxt)}</div>` : ''}
        ${rwTxt ? `<div class="ds-meta small">奖励替换：${esc2(rwTxt)}</div>` : ''}
        <div class="ds-btns">
          <button type="button" class="btn sm" data-dksync="${i}" title="把牌组名写进上方「行者」名单">⤴ 同步行者栏</button>
          <button type="button" class="btn sm" data-dkrw="${i}" title="把这张牌组用到的奖励牌填入「奖励」栏空位">⤵ 奖励填入</button>
          <button type="button" class="btn sm" data-dkcode2="${i}">代码</button>
          <button type="button" class="btn sm danger" data-dkdel="${i}">移除</button>
        </div>
      </div>`;
    }).join('');

    box.querySelectorAll('[data-dkimp]').forEach(btn => btn.addEventListener('click', () => {
      const i = +btn.dataset.dkimp;
      const inp = box.querySelector(`[data-dkcode="${i}"]`);
      const raw = (inp && inp.value || '').trim();
      if (!raw) { say('请先粘贴牌组代码'); return; }
      importDeckAt(i, raw);
    }));
    box.querySelectorAll('[data-dkcode]').forEach(inp => inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); importDeckAt(+inp.dataset.dkcode, inp.value); }
    }));
    box.querySelectorAll('[data-dksel]').forEach(sel => sel.addEventListener('change', () => {
      const i = +sel.dataset.dksel, id = sel.value;
      if (!id) return;
      const d = mine.find(x => x.id === id);
      if (!d) return;
      importDeckAt(i, encodeDeckCode(d));
      sel.value = '';
    }));
    box.querySelectorAll('[data-dksync]').forEach(btn => btn.addEventListener('click', () => {
      syncRangersFromDecks(); saveNow(); renderAll(); say('已同步到行者名单');
    }));
    box.querySelectorAll('[data-dkrw]').forEach(btn => btn.addEventListener('click', () => {
      const i = +btn.dataset.dkrw, d = state.decks[i];
      const names = ((d && d.sum && d.sum.rws) || []).map(x => x.rn).filter(Boolean);
      if (!names.length) { say('这张牌组还没有奖励替换记录'); return; }
      let n = 0;
      names.forEach(nm => {
        const free = state.rewards.findIndex(v => !String(v || '').trim());
        if (free >= 0) { state.rewards[free] = nm; n++; }
      });
      saveNow(); renderRewards(); say(`已把 ${n} 张奖励牌填入「奖励」栏${n < names.length ? `（还剩 ${names.length - n} 张没有空位）` : ''}`);
    }));
    box.querySelectorAll('[data-dkcode2]').forEach(btn => btn.addEventListener('click', () => {
      const i = +btn.dataset.dkcode2, d = state.decks[i];
      if (!d) return;
      const ta = document.createElement('textarea');
      ta.value = d.code; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); say('牌组代码已复制'); } catch (e) { say('复制失败，请手动复制'); }
      document.body.removeChild(ta);
    }));
    box.querySelectorAll('[data-dkdel]').forEach(btn => btn.addEventListener('click', () => {
      const i = +btn.dataset.dkdel;
      if (!confirm(`移除玩家 ${i + 1} 的牌组记录？（只是从战役里移除，卡牌管理系统里的牌组不受影响）`)) return;
      state.decks[i] = null; syncRangersFromDecks(); saveNow(); renderAll();
    }));
  }

  /* ---------- 渲染：挑战抽牌器 ---------- */
  function challengeImg(i) { return `${ASSET}challenges/挑战-${CHALLENGES[i].type}-${CHALLENGES[i].n}.jpg`; }
  function renderChallenges() {
    const c = state.challenges;
    const wrap = $('ch-drawn');
    wrap.innerHTML = '';
    // 已抽牌按抽牌顺序展示（最近的在最右）
    c.drawn.forEach(idx => {
      const card = CHALLENGES[idx];
      const t = CHALLENGE_TYPES[card.type];
      const e = el('div', 'ch-card ' + t.cls + (card.reshuffle ? ' reshuffle' : ''));
      e.title = `${card.type}${card.n} · 知觉${signed(card.perception)} 精神${signed(card.spirit)} 体质${signed(card.constitution)} 专注${signed(card.focus)}${card.reshuffle ? '（重洗）' : ''}`;
      const img = document.createElement('img');
      img.src = challengeImg(idx);
      img.alt = `${card.type}${card.n}`;
      img.loading = 'lazy';
      img.draggable = false;
      e.appendChild(img);
      // 四属性迷你数值徽章（左上=知觉/右上=精神/左下=体质/右下=专注，与卡牌四象限一致）
      const grid = el('div', 'ch-attrs');
      grid.appendChild(attrCell('知觉', card.perception, 'per'));
      grid.appendChild(attrCell('精神', card.spirit, 'spi'));
      grid.appendChild(attrCell('体质', card.constitution, 'con'));
      grid.appendChild(attrCell('专注', card.focus, 'foc'));
      e.appendChild(grid);
      if (card.reshuffle) e.appendChild(el('span', 'ch-reshuffle', '⟲'));
      wrap.appendChild(e);
    });
    if (c.drawn.length === 0) {
      wrap.appendChild(el('div', 'ch-empty', '尚未抽牌。点击「抽牌」从牌堆顶端抽一张挑战牌。'));
    }
    $('ch-deck-count').textContent = c.deck.length;
    $('btn-draw').disabled = c.deck.length === 0;
    $('btn-reshuffle').disabled = c.drawn.length === 0;
    updateDrawButton();
    updateChallengeNotice();
  }
  // 抽牌按钮状态：已抽牌堆里出现重洗标记后，按钮文字在「抽牌/确定」间切换
  function updateDrawButton() {
    const btn = $('btn-draw');
    if (!btn) return;
    const hasReshuffle = state.challenges.drawn.some(idx => CHALLENGES[idx].reshuffle);
    if (hasReshuffle && chConfirmPending) {
      btn.textContent = '确定';
      btn.classList.add('warn');
    } else {
      btn.textContent = '抽牌';
      btn.classList.remove('warn');
    }
  }
  // 抽牌器内部本地提示：紧贴按钮栏，按状态显示不同颜色
  // 无论是否抽到重洗牌，都保留这张牌的数值提示；重洗时额外增加重洗提示
  function updateChallengeNotice() {
    const el = $('ch-notice');
    if (!el) return;
    const c = state.challenges;
    if (c.drawn.length === 0) {
      el.hidden = true;
      el.className = 'ch-notice';
      el.textContent = '';
      return;
    }
    // 最新抽到的那张牌（用于显示数值）
    const lastIdx = c.drawn[c.drawn.length - 1];
    const card = CHALLENGES[lastIdx];
    const attrs = `知觉${signed(card.perception)} 精神${signed(card.spirit)} 体质${signed(card.constitution)} 专注${signed(card.focus)}`;
    const cardLine = `<b>${card.type}${card.n}</b> · ${attrs}`;
    const hasReshuffle = c.drawn.some(idx => CHALLENGES[idx].reshuffle);
    if (chConfirmPending) {
      // 确认界面：显示确认提示 + 保留最新一张牌的数值
      el.hidden = false;
      el.className = 'ch-notice alert';
      el.innerHTML = `<b>已出现重洗标记，确定是否继续抽牌</b> · 再次点击「确定」抽牌，或点「重洗」把已抽牌洗回。<br>当前最近抽到：${cardLine}${card.reshuffle ? ' <span class="reshuffle-mark">⟲ 重洗</span>' : ''}`;
    } else if (hasReshuffle) {
      // 已抽到重洗牌（未到确认步骤）：显示重洗牌数值 + 提示再次点抽牌会要求确认
      const lastReshuffleIdx = [...c.drawn].reverse().find(i => CHALLENGES[i].reshuffle);
      const rc = CHALLENGES[lastReshuffleIdx];
      const rcAttrs = `知觉${signed(rc.perception)} 精神${signed(rc.spirit)} 体质${signed(rc.constitution)} 专注${signed(rc.focus)}`;
      el.hidden = false;
      el.className = 'ch-notice warn';
      el.innerHTML = `⚠ 已抽到带重洗标记的牌 <b>${rc.type}${rc.n}</b> · ${rcAttrs} <span class="reshuffle-mark">⟲</span><br>再次点「抽牌」会要求确认是否继续。当前最近抽到：${cardLine}${card.reshuffle ? '（重洗）' : ''}`;
    } else {
      // 无重洗牌：显示最新一张牌的数值
      el.hidden = false;
      el.className = 'ch-notice info';
      el.textContent = `最近抽到：${card.type}${card.n} · ${attrs}${card.reshuffle ? '（重洗）' : ''}`;
    }
  }
  // 已抽牌堆里是否有重洗标记
  function hasReshuffleInDrawn() { return state.challenges.drawn.some(idx => CHALLENGES[idx].reshuffle); }
  function onDrawClick() {
    // 抽到重洗牌后再次点击「抽牌」：弹出确认界面，按钮变「确定」，本次不抽牌
    if (hasReshuffleInDrawn() && !chConfirmAck && !chConfirmPending) {
      chConfirmPending = true;
      updateDrawButton();
      updateChallengeNotice();
      showReminder('挑战牌（重洗待确认）', [
        '已出现重洗标记：已抽的牌里有带 ⟲ 的牌。',
        '按规则应先重洗再继续抽牌。',
        '再次点击「确定」继续抽牌，或点「重洗」把已抽牌洗回。',
      ], '已出现重洗标记，确定是否继续抽牌', '⚠');
      return;
    }
    // 已确认继续抽牌 / 无重洗：直接抽牌（确认后抽到的普通牌不再弹确认）
    if (chConfirmPending) { chConfirmPending = false; chConfirmAck = true; }
    drawChallenge();
  }
  function signed(n) { return n > 0 ? `+${n}` : String(n); }
  function attrCell(label, n, cls) {
    const c = el('div', `ch-attr ${cls} v${n}`);
    c.appendChild(el('span', 'ch-attr-val', signed(n)));
    c.appendChild(el('span', 'ch-attr-lbl', label));
    return c;
  }
  function drawChallenge() {
    const c = state.challenges;
    if (c.deck.length === 0) return;
    const idx = c.deck.pop();
    c.drawn.push(idx);
    save();
    renderChallenges();
    // 抽到带重洗标记的牌：弹一次"已抽出第 N 张重洗牌"提示（含数值），按钮保持「抽牌」
    // 再次点击「抽牌」时才弹出确认界面
    const card = CHALLENGES[idx];
    if (card.reshuffle) {
      chConfirmAck = false;  // 新的重洗牌出现，需要重新确认
      const reshuffleCount = c.drawn.filter(i => CHALLENGES[i].reshuffle).length;
      const attrs = `知觉 ${signed(card.perception)} / 精神 ${signed(card.spirit)} / 体质 ${signed(card.constitution)} / 专注 ${signed(card.focus)}`;
      const cnt = reshuffleCount === 1 ? '第一张' : reshuffleCount === 2 ? '第二张' : reshuffleCount === 3 ? '第三张' : reshuffleCount === 4 ? '第四张' : `第 ${reshuffleCount} 张`;
      showReminder(`已抽出 ${cnt} 带重洗标记的挑战牌`, [
        `本次抽到：${card.type}${card.n}（${attrs}）`,
        '该牌带重洗标记（⟲）：按规则应把弃牌堆洗回牌堆。',
        '再次点击「抽牌」时会要求确认是否继续。',
      ], `已抽出 ${cnt} 重洗牌`, '⚠');
    }
  }
  function reshuffleChallenges() {
    // 把所有已抽牌洗回牌堆（重新 Fisher-Yates 洗牌 deck+drawn）
    const c = state.challenges;
    const all = [...c.deck, ...c.drawn];
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    c.deck = all;
    c.drawn = [];
    chConfirmPending = false;
    chConfirmAck = false;
    save();
    renderChallenges();
    showReminder('挑战牌堆', [`已洗回 ${all.length} 张，剩余牌堆重置完成。`], '挑战牌堆已重洗', '🔀');
  }

  /* ---------- 渲染：可交互地图 ---------- */
  function renderMapTabs() {
    const tabs = $('map-tabs');
    tabs.innerHTML = '';
    camp().maps.forEach(key => {
      const b = el('button', 'map-tab' + (key === currentMap ? ' on' : ''), MAP_DB[key].short);
      b.type = 'button';
      b.title = MAP_DB[key].title;
      b.addEventListener('click', () => switchMap(key));
      tabs.appendChild(b);
    });
  }
  function switchMap(key) {
    if (key === currentMap) return;
    currentMap = key;
    brushTerrain = null;
    // 扩展战役：看地下图自动切到地下天气轨，看地上图切回地上
    if (slot.active === 'ancestral' && MAP_DB[key].region !== state.region) {
      state.region = MAP_DB[key].region;
      dirty = true; saveNow();
      renderToday(); renderCalendar();
    }
    renderMapTabs();
    renderMap();
  }
  /* ---------- v20：地图尺寸 —— 默认缩放＝整图完整显示，容器无滚动条（只能拖动） ---------- */
  function mapFitBase() {
    const view = $('map-view'), img = $('map-img');
    if (!view || !img) return null;
    const natW = img.naturalWidth || 0, natH = img.naturalHeight || 0;
    const vw = view.clientWidth || 0;
    if (!natW || !natH || !vw) return null;
    // 上限取 CSS 的 max-height（单一真源，改 CSS 即可），再扣掉边框占用避免差几像素溢出
    const mh = parseFloat(getComputedStyle(view).maxHeight);
    const cap = (isFinite(mh) && mh > 0 ? mh : window.innerHeight * 0.7) - 6;
    const fullH = natH * (vw / natW);                      // 按容器宽度铺满时需要的高度
    const vh = Math.max(160, Math.min(cap, fullH));        // 竖版长图受高度限制，横版贴合不留白
    return { fit: Math.min(vw / natW, vh / natH), vh };
  }
  /* keepCenter：缩放时保持视觉中心不动 */
  function applyMapFit(keepCenter) {
    const view = $('map-view'), canvas = $('map-canvas'), img = $('map-img');
    if (!view || !canvas || !img) return;
    const base = mapFitBase();
    if (!base) return;
    const zoom = (+($('map-zoom').value || 100)) / 100;
    const prev = { cw: canvas.offsetWidth, ch: canvas.offsetHeight, sl: view.scrollLeft, st: view.scrollTop };
    const w = Math.round(img.naturalWidth * base.fit * zoom);
    const h = Math.round(img.naturalHeight * base.fit * zoom);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    // 容器高度：默认缩放贴合整图高度（无留白、不裁切）；放大后保持，超出部分靠拖动查看
    if (zoom <= 1) {
      const want = Math.round(img.naturalHeight * base.fit);
      view.style.height = want + 'px';
      const chrome = view.offsetHeight - view.clientHeight;   // 边框等占用，避免差几像素又溢出
      if (chrome > 0 && view.clientHeight < want) view.style.height = (want + chrome) + 'px';
    } else if (!view.style.height) {
      view.style.height = Math.round(base.vh) + 'px';
    }
    if (keepCenter && prev.cw && prev.ch) {
      const cx = (prev.sl + view.clientWidth / 2) / prev.cw;
      const cy = (prev.st + view.clientHeight / 2) / prev.ch;
      view.scrollLeft = cx * w - view.clientWidth / 2;
      view.scrollTop = cy * h - view.clientHeight / 2;
    }
  }

  /* v25：缩放档位 100%→600%（步进 20%，共 26 档），实时显示当前比例 */
  function mapZoomLabel() {
    const s = $('map-zoom'), out = $('map-zoom-val');
    if (!s || !out) return;
    const v = +s.value || 100;
    out.textContent = v + '%';
    out.classList.toggle('is-fit', v <= 100);
    s.title = v <= 100 ? '100% = 整张地图完整显示' : `已放大到 ${v}%（${(v / 100).toFixed(1)} 倍）`;
  }
  function renderMap() {
    const map = MAP_DB[currentMap];
    const canvas = $('map-canvas');
    const img = $('map-img');
    img.src = ASSET + map.file;
    canvas.classList.toggle('portrait', !!map.portrait);
    $('map-zoom').value = 100;
    /* v20：默认缩放 = 整张地图完整显示（全屏），尺寸由 applyMapFit 按图片原始比例计算 */
    canvas.style.removeProperty('--mz');
    mapZoomLabel();
    // 换图后需等解码拿到原始尺寸；已缓存则立即计算
    if (img.complete && img.naturalWidth) applyMapFit();
    else img.onload = () => applyMapFit();

    // 地名 / 地形候选
    const dl = $('map-locations'); dl.innerHTML = '';
    map.spots.forEach(([name]) => {
      const o = document.createElement('option'); o.value = name; dl.appendChild(o);
    });
    const dt = $('map-terrains'); dt.innerHTML = '';
    map.terrains.forEach(name => {
      const o = document.createElement('option'); o.value = name; dt.appendChild(o);
    });
    $('map-location').value = state.location || '';
    $('map-terrain').value = state.terrain || '';

    renderSpots();
    renderBrushBar();
    renderPin();
  }
  function renderSpots() {
    const layer = $('map-spots');
    layer.innerHTML = '';
    const map = MAP_DB[currentMap];
    const keys = map.key || [];
    map.spots.forEach(([name, x, y]) => {
      const isKey = keys.includes(name);
      /* 隐藏式触点：默认完全透明（样式 opacity:0），只在悬停 / 当前所在地点时显现；
         点击不再各绑一套，统一交给地图的「点击=吸附最近地点」处理，避免重复触发 */
      const b = el('button',
        `map-spot ${isKey ? 'key' : 'minor'}` + (state.location === name ? ' cur' : ''));
      b.type = 'button';
      b.style.left = x + '%';
      b.style.top = y + '%';
      b.title = `旅行至此：${name}（${isKey ? '关键地点' : '非关键地点'}）`;
      b.innerHTML = `<span class="ms-lbl">${name}</span>`;
      layer.appendChild(b);
    });
  }
  function renderBrushBar() {
    const bar = $('terrain-brush');
    bar.innerHTML = '<span class="brush-cap">路径地形笔刷：</span>';
    MAP_DB[currentMap].terrains.forEach(t => {
      const b = el('button', 'tbrush' + (brushTerrain === t ? ' on' : ''));
      b.type = 'button';
      b.innerHTML = `${t}`;            // 图标已改为隐藏式（样式里 .tdot 不显示），只留文字
      b.addEventListener('click', () => {
        brushTerrain = (brushTerrain === t) ? null : t;
        renderBrushBar();
      });
      bar.appendChild(b);
    });
    if (brushTerrain) {
      bar.appendChild(el('span', 'brush-tip',
        `已选「${brushTerrain}」：点击地图任意处记录该地形（再次点击笔刷可取消）`));
    } else {
      bar.appendChild(el('span', 'brush-tip',
        '点一下地图＝自动选中最近地点并记录旅行 ｜ 按住拖动＝平移地图 ｜ 选笔刷后点击＝记录该处地形'));
    }
  }

  /* 图钉标记已移除（地点改为隐藏触点 + 文字提示），保留空函数以免旧调用点报错 */
  function renderPin() { /* no-op */ }
  // 在两地间查找路径边
  function findPath(map, a, b) {
    return (map.paths || []).find(p =>
      (p[0] === a && p[1] === b) || (p[1] === a && p[0] === b)) || null;
  }
  // 距点击处最近的路径线段（x,y 为百分比坐标），命中阈值内才返回
  function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  function nearestPath(x, y) {
    const map = MAP_DB[currentMap];
    if (!map.paths) return null;
    const pt = {};
    map.spots.forEach(s => { pt[s[0]] = [s[1], s[2]]; });
    let best = null, bestD = 2.6;   // 命中阈值（%）
    map.paths.forEach(p => {
      const a = pt[p[0]], b = pt[p[1]];
      if (!a || !b) return;
      const d = distToSeg(x, y, a[0], a[1], b[0], b[1]);
      if (d < bestD) { bestD = d; best = p; }
    });
    return best;
  }
  function pickSpot(name, x, y) {
    const map = MAP_DB[currentMap];
    const keys = map.key || [];
    const prev = state.location;
    state.location = name;
    state.mapPin = { map: currentMap, x: x / 100, y: y / 100 };

    const isKey = keys.includes(name);
    const msgs = [`地点：${name}（${isKey ? '关键地点' : '非关键地点'}）`];
    // 旅行：识别上一地点到本地点之间的路径地形
    const edge = (prev && prev !== name) ? findPath(map, prev, name) : null;
    let label = '地点已选择', icon = '📍';
    if (edge) {
      state.terrain = edge[2];
      label = '旅行记录'; icon = '🥾';
      msgs.push(`路径：${prev} — ${name} · ${edge[2]}`);
      if (isKey) {
        msgs.push(`关键地点：请向路径牌堆加入「${name}」+「${edge[2]}」`);
      } else {
        const kind = map.region === 'underground' ? '地下城' : '山谷';
        msgs.push(`非关键地点：请向路径牌堆加入三张普通的${kind}路径牌 +「${edge[2]}」`);
      }
    } else {
      msgs.push(`地形：${state.terrain || '（未记录）'}`);
      if (prev && prev !== name) msgs.push(`未识别到「${prev}」—「${name}」的直达路径，请用笔刷或手动记录地形`);
    }
    msgs.push('已直接写入战役记录表。');
    save();
    $('map-location').value = name;
    $('location').value = name;
    $('map-terrain').value = state.terrain;
    $('terrain').value = state.terrain;
    renderSpots();
    renderPin();
    showReminder('当前位置', msgs, label, icon);
  }
  /* 距点击处最近的地点（百分比坐标），超过阈值返回 null —— 隐藏触点的吸附半径 */
  function nearestSpot(x, y, maxD) {
    const map = MAP_DB[currentMap];
    let best = null, bd = maxD == null ? 3.6 : maxD;
    map.spots.forEach(s => {
      const d = Math.hypot(x - s[1], y - s[2]);
      if (d < bd) { bd = d; best = s; }
    });
    return best;
  }
  /* 点击（非拖动）地图：① 吸附最近地点 → 直接确定并提示；② 命中路径 → 记地形；③ 其他 */
  function onMapTap(e) {
    const img = $('map-img');
    const r = img.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    const px = x * 100, py = y * 100;

    // ① 笔刷：显式选了地形就优先记地形（不改地点）
    if (brushTerrain) {
      state.terrain = brushTerrain;
      $('map-terrain').value = brushTerrain;
      $('terrain').value = brushTerrain;
      save();
      showReminder('当前位置', [`地形：${state.terrain}`, `地点：${state.location || '（未记录）'}`, '已直接写入战役记录表。'], '路径已记录', '🥾');
      return;
    }
    // ② 最近地点（图标隐藏，点整片区域都能命中）→ 自动确定
    const spot = nearestSpot(px, py);
    if (spot) { pickSpot(spot[0], spot[1], spot[2]); return; }
    // ③ 最近路径线段 → 记录该路径地形
    const edge = nearestPath(px, py);
    if (edge) {
      state.terrain = edge[2];
      $('map-terrain').value = edge[2];
      $('terrain').value = edge[2];
      save();
      showReminder('当前位置', [`路径：${edge[0]} — ${edge[1]}`, `地形：${edge[2]}`, '已直接写入战役记录表。'], '路径已识别', '🥾');
      return;
    }
    // ④ 空白：明确告知没命中，避免以为点成功了
    showReminder('未识别', [
      `此处（${px.toFixed(0)}%，${py.toFixed(0)}%）附近没有已知地点或路径。`,
      '请点得更靠近目标一点，或直接在下方输入框填写地点 / 地形。',
    ], '未识别到地点', '❔');
  }
  /* 拖动识别：按住在地图上移动 = 平移地图；没有位移才算「点击」。
     阈值 6px，触屏与鼠标统一走 Pointer Events。 */
  function bindMapPan() {
    const canvas = $('map-canvas'), view = $('map-view');
    if (!canvas || !view || canvas.dataset.panBound === '1') return;
    canvas.dataset.panBound = '1';
    let st = null;
    canvas.addEventListener('pointerdown', e => {
      if (e.button != null && e.button !== 0) return;
      st = { x: e.clientX, y: e.clientY, sl: view.scrollLeft, stp: view.scrollTop, moved: false };
    });
    canvas.addEventListener('pointermove', e => {
      if (!st) return;
      const dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (!st.moved && Math.hypot(dx, dy) > 6) { st.moved = true; canvas.classList.add('dragging'); }
      if (!st.moved) return;
      view.scrollLeft = st.sl - dx;
      view.scrollTop = st.stp - dy;
      e.preventDefault();
    });
    const finish = e => {
      if (!st) return;
      const moved = st.moved;
      st = null;
      canvas.classList.remove('dragging');
      if (moved) return;            // 属于拖动，不当点击
      onMapTap(e);
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', () => { st = null; canvas.classList.remove('dragging'); });
    canvas.addEventListener('pointerleave', () => { if (st && st.moved) { st = null; canvas.classList.remove('dragging'); } });
  }
  function syncLocation() {
    state.location = $('map-location').value;
    state.terrain = $('map-terrain').value;
    save();
    $('location').value = state.location;
    $('terrain').value = state.terrain;
    renderSpots();
    showReminder('当前位置', [`地点：${state.location || '（空）'}`, `地形：${state.terrain || '（空）'}`, '已同步到战役记录表。'], '位置已同步', '📍');
  }

  /* ---------- 自定义搜索下拉（替代原生 datalist：面板限高、适配屏幕滚动） ---------- */
  const ac = {
    panel: null, input: null, source: '', items: [], active: -1, raf: 0,
    ensurePanel() {
      if (this.panel) return this.panel;
      const p = el('div', 'ac-panel');
      p.hidden = true;
      document.body.appendChild(p);
      // mousedown 先于 blur 触发，点选项时不会误关
      p.addEventListener('mousedown', e => {
        e.preventDefault();
        const item = e.target.closest('.ac-item');
        if (item) this.choose(+item.dataset.idx);
      });
      this.panel = p;
      return p;
    },
    readOptions() {
      const dl = $(this.source);
      return dl ? Array.from(dl.options).map(o => ({
        value: o.value, label: o.label || '', img: o.dataset.img || '',
      })) : [];
    },
    open(input) {
      this.input = input;
      this.source = input.dataset.ac;
      this.active = -1;
      this.renderAll();   // 聚焦展开时显示全部选项；输入时才按文字过滤
    },
    close() {
      if (this.panel) this.panel.hidden = true;
      this.input = null;
      this.active = -1;
      cancelAnimationFrame(this.raf);
    },
    renderAll() {
      if (!this.input) return;
      this.items = this.readOptions();
      this.active = this.items.length ? 0 : -1;
      this.render();
    },
    refresh() {
      if (!this.input) return;
      const q = this.input.value.trim().toLowerCase();
      const all = this.readOptions();
      this.items = q
        ? all.filter(o => (o.value + ' ' + o.label).toLowerCase().includes(q))
        : all;
      this.active = this.items.length ? Math.min(Math.max(this.active, 0), this.items.length - 1) : -1;
      this.render();
    },
    render() {
      const p = this.ensurePanel();
      if (!this.items.length) {
        p.innerHTML = '<div class="ac-empty">无匹配项（可直接手动输入）</div>';
      } else {
        p.textContent = '';
        this.items.forEach((o, i) => {
          const d = el('div', 'ac-item' + (i === this.active ? ' active' : ''));
          d.dataset.idx = i;
          if (o.img) d.innerHTML = `<img class="ac-thumb" alt="" loading="lazy" src="${o.img}">`;
          const txt = el('span', 'ac-txt');
          txt.appendChild(el('span', 'ac-val')).textContent = o.value;
          if (o.label) txt.appendChild(el('span', 'ac-label')).textContent = o.label;
          d.appendChild(txt);
          p.appendChild(d);
        });
      }
      p.hidden = false;
      this.position();
    },
    position() {
      const p = this.ensurePanel();
      if (!this.input) return;
      const r = this.input.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight, gap = 8;
      const width = Math.min(r.width, vw - 16);
      p.style.width = width + 'px';
      p.style.left = Math.min(Math.max(8, r.left), vw - width - 8) + 'px';
      const spaceBelow = vh - r.bottom - gap;
      const spaceAbove = r.top - gap;
      // 下方空间优先；不足时向上展开；高度按屏幕可用空间自适应（内部滚动）
      const up = spaceBelow < 150 && spaceAbove > spaceBelow;
      p.classList.toggle('up', up);
      p.style.maxHeight = Math.max(120, Math.min(340, (up ? spaceAbove : spaceBelow), vh * 0.55)) + 'px';
      if (up) {
        p.style.top = 'auto';
        p.style.bottom = (vh - r.top + 4) + 'px';
      } else {
        p.style.bottom = 'auto';
        p.style.top = (r.bottom + 4) + 'px';
      }
    },
    move(step) {
      if (!this.items.length) return;
      this.active = (this.active + step + this.items.length) % this.items.length;
      const nodes = this.panel.querySelectorAll('.ac-item');
      nodes.forEach(n => n.classList.toggle('active', +n.dataset.idx === this.active));
      const cur = nodes[this.active];
      if (cur) cur.scrollIntoView({ block: 'nearest' });
    },
    choose(idx) {
      const o = this.items[idx];
      if (!o || !this.input) return;
      this.input.value = o.value;
      this.input.dispatchEvent(new Event('input', { bubbles: true }));
      this.input.dispatchEvent(new Event('change', { bubbles: true }));
      this.input.focus();
      this.close();
    },
    onScrollResize() {
      if (!this.input) return;
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(() => this.position());
    },
    bind() {
      document.addEventListener('focusin', e => {
        if (e.target.matches && e.target.matches('[data-ac]')) this.open(e.target);
      });
      document.addEventListener('input', e => {
        if (e.target.dataset && e.target.dataset.ac && this.input === e.target) this.refresh();
      });
      document.addEventListener('mousedown', e => {
        const t = e.target;
        // 点在下拉输入框上：打开/刷新（鼠标与触摸都走 mousedown，比 focusin 更可靠）
        if (t.matches && t.matches('[data-ac]')) { this.open(t); return; }
        // 点在面板内：交由面板自身处理，不关闭
        if (this.panel && this.panel.contains(t)) return;
        // 点在其他区域：关闭
        if (this.input && !this.panel.hidden) this.close();
      });
      document.addEventListener('keydown', e => {
        if (!this.input || this.input !== e.target || this.panel.hidden) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); this.move(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); this.move(-1); }
        else if (e.key === 'Enter') {
          if (this.active >= 0) { e.preventDefault(); this.choose(this.active); }
          else this.close();
        } else if (e.key === 'Escape') { this.close(); }
      });
      // 面板随输入框位置移动（页面滚动/缩放时），rAF 合帧
      window.addEventListener('resize', () => this.onScrollResize());
      window.addEventListener('scroll', () => this.onScrollResize(), true);
    },
  };

  /* ---------- 文本字段绑定 ---------- */
  function bindTextField(id, get, set) {
    const inp = $(id);
    inp.addEventListener('input', () => { set(inp.value); save(); });
  }
  function syncTextFields() {
    $('rangers').value = state.rangers;
    $('location').value = state.location;
    $('terrain').value = state.terrain;
    $('hard-weather').checked = !!state.hardWeather;
  }

  /* ---------- 导出 / 导入 / 清空 ---------- */
  function exportJSON() {
    saveNow();
    const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const name = `地缘行者战役记录_槽${slotIdx + 1}_${camp().name}_${ts}.json`;
    const content = JSON.stringify({ app: 'ebr-campaign', v: 2, slot: slotIdx + 1, exportedAt: new Date().toISOString(), data: slot }, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const s = JSON.parse(reader.result);
        if (typeof s !== 'object' || s === null) throw new Error('格式错误');
        if (s.data && typeof s.data === 'object' && (s.data.valley || s.data.ancestral)) {
          slot = normalizeSlot(s.data);
        } else if (s.valley || s.ancestral) {
          slot = normalizeSlot(s);
        } else {
          slot[slot.active] = normalizeCampaign(slot.active, s);
        }
        state = slot[slot.active];
        if (!camp().maps.includes(currentMap)) currentMap = camp().maps[0];
        selectedDay = Math.min(state.currentDay, dayCount());
        diaryDay = null;                 // v41：导入的存档从「今天」看起
        dirty = true; saveNow();
        renderAll();
        alert('存档导入成功');
      } catch (e) {
        alert('导入失败：' + e.message);
      }
    };
    reader.readAsText(file);
  }
  function clearAll() {
    if (!confirm(`确定清空当前战役（${camp().name}）的全部记录吗？\n此操作不可恢复，建议先导出存档。`)) return;
    slot[slot.active] = blankCampaign(slot.active);
    state = slot[slot.active];
    selectedDay = 1;
    diaryDay = null;                 // v41：清空后日记也回到第 1 天跟随
    brushTerrain = null;
    dirty = true; saveNow();
    hideReminder();
    renderAll();
  }

  /* ---------- v32：云端存档（手动上传 / 读取账号存档） ---------- */
  /* 云端可用 + 已登录；否则给出可执行的引导（云端挂了就建议用导出备份） */
  function cloudReady() {
    if (typeof cloudOn !== 'function' || !cloudOn()) { say('云端服务未就绪，请先用「导出存档」备份到本机'); return false; }
    if (typeof isSignedIn !== 'function' || !isSignedIn()) { say('请先登录账号（右上角头像）后再使用云端存档'); return false; }
    return true;
  }
  /* 当前槽的一句话摘要：战役名 + 第几天（也用作云端存档标签） */
  function slotLabel(s) {
    const st = s || slot, key = CAMPAIGNS[st.active] ? st.active : 'valley';
    const c = st[key] || {}, dc = CAMPAIGNS[key].days;
    const cur = Math.min(dc + 1, Math.max(1, c.currentDay | 0 || 1));
    return `${CAMPAIGNS[key].name} · ${cur > dc ? '已完成' : '第' + cur + '天'}`;
  }
  const fmtTime = t => {
    if (!t) return '';
    const d = new Date(t);
    if (isNaN(d.getTime())) return '';
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  /* 上传：把当前存档槽整槽（基础 + 扩展两套战役）推到云端同号槽位 */
  async function pushCloudSlot() {
    if (!cloudReady()) return;
    saveNow();
    const btn = $('btn-cloud-push');
    if (btn) { btn.disabled = true; btn.textContent = '上传中…'; }
    /* 深拷贝：避免上传后本地继续改动时连带影响待发送的数据 */
    const snap = JSON.parse(JSON.stringify(slot));
    const payload = { app: 'ebr-campaign', v: 2, slot: slotIdx + 1, exportedAt: new Date().toISOString(), data: snap };
    let r;
    try { r = await cloudPushCampaign(slotIdx + 1, payload, slotLabel()); }
    catch (e) { r = { error: { message: e && e.message || '未知错误' } }; }
    if (btn) { btn.disabled = false; btn.textContent = '⬆ 上传云端'; }
    if (r && r.error) { say('上传失败：' + r.error.message); return; }
    say(`已上传「存档槽 ${slotIdx + 1}」到云端 · ${slotLabel()}`);
  }

  /* 读取：弹窗列出云端 3 个槽，可选恢复到任意本地槽 */
  let CS_LIST = [];
  function csModalOpen() { const b = $('cs-modal'); return b && !b.classList.contains('hidden'); }
  function closeCloudModal() { const b = $('cs-modal'); if (b) b.classList.add('hidden'); }
  async function openCloudModal() {
    if (!cloudReady()) return;
    const b = $('cs-modal');
    if (b) b.classList.remove('hidden');
    $('cs-sub').innerHTML = `账号：<b>${esc2(typeof userEmail === 'function' ? (userEmail() || '—') : '—')}</b> · 云端 3 个存档槽，可恢复到任意本地存档槽`;
    $('cs-msg').textContent = '读取中…';
    $('cs-list').innerHTML = '<div class="cs-empty small muted">正在读取云端存档…</div>';
    await loadCloudList();
  }
  async function loadCloudList() {
    let r;
    try { r = await cloudPullCampaign(); }
    catch (e) { r = { error: { message: e && e.message || '未知错误' } }; }
    if (r && r.error) {
      CS_LIST = [];
      $('cs-msg').textContent = '';
      $('cs-list').innerHTML = `<div class="cs-empty">读取失败：${esc2(r.error.message)}</div>`;
      return;
    }
    CS_LIST = (r && r.data) || [];
    renderCloudList();
  }
  function cloudRowInfo(row) {
    const d = row && row.payload && row.payload.data;
    if (!d || typeof d !== 'object') return { name: '—', day: '' };
    const key = CAMPAIGNS[d.active] ? d.active : 'valley';
    const c = d[key] || {}, dc = CAMPAIGNS[key].days;
    const cur = Math.min(dc + 1, Math.max(1, c.currentDay | 0 || 1));
    return { name: CAMPAIGNS[key].name, day: cur > dc ? '已完成' : '第' + cur + '天' };
  }
  function renderCloudList() {
    const list = $('cs-list');
    if (!list) return;
    list.innerHTML = '';
    if (!CS_LIST.length) {
      list.innerHTML = '<div class="cs-empty">云端还没有战役存档。回到记录器点「⬆ 上传云端」即可保存当前存档槽。</div>';
      $('cs-msg').textContent = '';
      return;
    }
    for (let i = 0; i < SLOT_COUNT; i++) {
      const row = CS_LIST.find(x => +x.slot_no === i + 1);
      const card = el('div', 'cs-card' + (row ? '' : ' cs-blank'));
      if (!row) {
        card.innerHTML = `<div class="cs-head"><b>云端存档槽 ${i + 1}</b><span class="cs-tag muted">空</span></div>` +
          `<div class="cs-meta muted small">尚未上传过</div>`;
      } else {
        const info = cloudRowInfo(row);
        card.innerHTML =
          `<div class="cs-head"><b>云端存档槽 ${i + 1}</b><span class="cs-tag">${esc2(info.name)} · ${esc2(info.day)}</span></div>` +
          `<div class="cs-meta muted small">更新于 ${esc2(fmtTime(row.updated_at))}${row.label ? ' · ' + esc2(row.label) : ''}</div>` +
          `<div class="cs-acts"><span class="cs-acts-label">恢复到</span>` +
          [0, 1, 2].map(t => `<button type="button" class="btn btn-sm${t === slotIdx ? ' btn-primary' : ''}" data-cs-re="${i + 1}" data-cs-to="${t}">本地槽 ${t + 1}</button>`).join('') +
          `<button type="button" class="btn btn-sm btn-danger" data-cs-del="${i + 1}" title="删除这个云端存档（不影响本地）">删除</button></div>`;
      }
      list.appendChild(card);
    }
    $('cs-msg').textContent = `共 ${CS_LIST.length} / ${SLOT_COUNT} 个云端存档`;
  }
  /* 云端 payload → 本地槽对象（兼容整槽 / 单战役两种写法） */
  function cloudToSlot(payload) {
    const p = payload && typeof payload === 'object' ? payload : null;
    if (!p) return null;
    if (p.data && typeof p.data === 'object' && (p.data.valley || p.data.ancestral)) return normalizeSlot(p.data);
    if (p.valley || p.ancestral) return normalizeSlot(p);
    return null;
  }
  async function restoreCloudSlot(src, target) {
    const row = CS_LIST.find(x => +x.slot_no === src);
    if (!row) return;
    const s = cloudToSlot(row.payload);
    if (!s) { say('这个云端存档的内容无法识别，可能不是战役存档'); return; }
    if (!confirm(`把「云端存档槽 ${src}」恢复到「本地存档槽 ${target + 1}」吗？\n该本地槽现有的记录会被覆盖（建议先「导出存档」备份）。`)) return;
    try { localStorage.setItem(SLOT_KEY(target), JSON.stringify(s)); }
    catch (e) { say('写入本地存档失败：' + e.message); return; }
    if (target === slotIdx) { loadSlot(target); renderAll(); }
    else { renderSlotTabs(); }
    closeCloudModal();
    say(`已把云端存档槽 ${src} 恢复到本地存档槽 ${target + 1}`);
  }
  async function removeCloudSlot(src) {
    if (!confirm(`确定删除云端「存档槽 ${src}」吗？\n本地存档不受影响。`)) return;
    let r;
    try { r = await cloudDeleteCampaign(src); }
    catch (e) { r = { error: { message: e && e.message || '未知错误' } }; }
    if (r && r.error) { say('删除失败：' + r.error.message); return; }
    await loadCloudList();
    say(`已删除云端存档槽 ${src}`);
  }
  function bindCloudModal() {
    const box = $('cs-modal');
    if (!box) return;
    $('cs-close').addEventListener('click', closeCloudModal);
    $('cs-ok').addEventListener('click', closeCloudModal);
    $('cs-refresh').addEventListener('click', () => loadCloudList());
    box.addEventListener('click', e => { if (e.target === box) closeCloudModal(); });
    $('cs-list').addEventListener('click', e => {
      const re = e.target.closest('[data-cs-re]');
      if (re) { restoreCloudSlot(+re.dataset.csRe, +re.dataset.csTo); return; }
      const del = e.target.closest('[data-cs-del]');
      if (del) removeCloudSlot(+del.dataset.csDel);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && csModalOpen()) closeCloudModal(); });
  }

  /* ---------- 战役 / 存档槽切换 ---------- */
  function switchCampaign(key) {
    if (!CAMPAIGNS[key] || key === slot.active) return;
    saveNow();
    slot.active = key;
    state = slot[key];
    if (!camp().maps.includes(currentMap)) currentMap = camp().maps[0];
    brushTerrain = null;
    selectedDay = Math.min(state.currentDay, dayCount());
    diaryDay = null;                 // v41
    dirty = true; saveNow();
    hideReminder();
    renderAll();
  }
  function switchSlot(i) {
    if (i === slotIdx) return;
    saveNow();
    hideReminder();
    loadSlot(i);
    renderAll();
  }

  /* ============================================================
   * v41：旅行日记（战役记录器子界面）
   *   · 顶部标签在「战役面板 / 旅行日记」间切换，随时可切
   *   · 按天记录：可前后翻天，也可直接点天数格子跳转；有内容的天会高亮
   *   · 数据存 state.diary[day] —— 挂在存档里，三个存档槽 × 两套战役各自独立
   *   · 公开可用：不接功能开关，不登录也能写
   * ============================================================ */
  const diaryDayOf = () => (diaryDay == null ? Math.min(state.currentDay, dayCount()) : diaryDay);

  function switchView(v) {
    if (v !== 'sheet' && v !== 'diary') return;
    if (v === curView) return;
    curView = v;
    document.querySelectorAll('#camp-view-switch .view-tab').forEach(b => {
      const on = b.dataset.view === v;
      b.classList.toggle('on', on);   // 与 .camp-tab / .slot-tab 同一套选中类名
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('camp-sheet').hidden = (v !== 'sheet');
    $('camp-diary').hidden = (v !== 'diary');
    if (v === 'sheet') applyMapFit();       // 面板重新显示后按容器重算地图尺寸
    else { renderDiary(); try { $('diary-text').focus(); } catch (e) {} }
    try { localStorage.setItem('ebr_camp_view', v); } catch (e) {}
  }

  function renderDiaryStat(saved) {
    const day = diaryDayOf();
    const t = state.diary[day] || '';
    let total = 0;
    for (let d = 1; d <= dayCount(); d++) if ((state.diary[d] || '').trim()) total++;
    $('diary-stat').innerHTML =
      `${t.length} 字 · 本存档共 <b>${total}</b> / ${dayCount()} 天有记录 · ` +
      (saved ? '<b class="ok">✓ 已保存</b>' : '… 保存中');
  }

  function renderDiary() {
    const day = diaryDayOf();
    const dc = dayCount();
    $('diary-day').textContent = day;
    const wi = weatherIndex(day);
    const wname = (day <= dc && wtable() && wtable().names[wi]) ? wtable().names[wi] : '—';
    $('diary-meta').innerHTML =
      `天气 <b>${esc2(wname)}</b> · 位置 <b>${esc2(state.location || '—')}</b>` +
      (day === state.currentDay ? ' · <b class="diary-now">今天</b>' : '');

    const box = $('diary-days');
    box.innerHTML = '';
    for (let d = 1; d <= dc; d++) {
      const txt = state.diary[d] || '';
      const has = !!txt.trim();
      const b = el('button', 'dd-cell' + (d === day ? ' on' : '') + (has ? ' has' : ''));
      b.type = 'button';
      b.textContent = d;
      b.title = has ? `第 ${d} 天 · 已记录 ${txt.length} 字` : `第 ${d} 天 · 空`;
      b.addEventListener('click', () => {
        diaryDay = d; renderDiary();
        try { $('diary-text').focus(); } catch (e) {}
      });
      box.appendChild(b);
    }

    const ta = $('diary-text');
    const val = state.diary[day] || '';
    if (ta.value !== val) ta.value = val;
    $('diary-prev').disabled = day <= 1;
    $('diary-next').disabled = day >= dc;
    renderDiaryStat(true);
  }

  /* 输入即写回存档（防抖保存），空内容直接删键，避免存档里堆空字符串 */
  function onDiaryInput() {
    const day = diaryDayOf();
    const v = $('diary-text').value;
    if (v) state.diary[day] = v; else delete state.diary[day];
    dirty = true; save();
    /* 只改当前格的「已记录」标记，不整块重绘 —— 否则输入过程中光标会被打断 */
    const cell = $('diary-days').children[day - 1];
    if (cell) cell.classList.toggle('has', !!v.trim());
    renderDiaryStat(false);
    clearTimeout(diaryStatTimer);
    diaryStatTimer = setTimeout(() => { if (curView === 'diary') renderDiaryStat(true); }, 320);
  }

  /* ---------- 总渲染 ---------- */
  function renderAll() {
    renderCampaignTabs();
    renderSlotTabs();
    renderToday();
    renderCalendar();
    renderMissionDatalist();
    renderMissions();
    renderRewardDatalist();
    renderRewards();
    renderEvents();
    renderDecks();
    renderChallenges();
    syncTextFields();
    renderMapTabs();
    renderMap();
    renderDiary();      // v41：旅行日记（内容随存档/战役切换一起重绘）
  }

  /* ---------- 启动 ---------- */
  function init() {
    load();
    ac.bind();

    document.querySelectorAll('#campaign-switch .camp-tab').forEach(btn =>
      btn.addEventListener('click', () => switchCampaign(btn.dataset.camp)));
    document.querySelectorAll('#slot-switch .slot-tab').forEach(btn =>
      btn.addEventListener('click', () => switchSlot(+btn.dataset.slot)));

    $('btn-advance').addEventListener('click', () => { advanceDay(); renderToday(); renderCalendar(); renderDiary(); });
    $('btn-prev').addEventListener('click', () => { regressDay(); renderToday(); renderCalendar(); renderDiary(); });
    $('hard-weather').addEventListener('change', e => {
      state.hardWeather = e.target.checked; saveNow(); renderToday(); renderCalendar();
    });
    [1, 2, 3].forEach(k => $('de-' + k).addEventListener('input', () => commitDayEntry(k)));

    bindTextField('rangers', () => state.rangers, v => state.rangers = v);
    bindTextField('location', () => state.location, v => state.location = v);
    bindTextField('terrain', () => state.terrain, v => state.terrain = v);
    // 手动改地图面板的地点/地形输入框时即时写回（切换输入框即生效）
    $('map-location').addEventListener('input', e => { state.location = e.target.value; save(); $('location').value = e.target.value; renderSpots(); });
    $('map-terrain').addEventListener('input', e => { state.terrain = e.target.value; save(); $('terrain').value = e.target.value; });

    bindMapPan();                 // 点=选地点 / 拖=平移地图
    /* v20：缩放以「整图完整显示」为 100% 基准，缩放时保持视觉中心 */
    $('map-zoom').addEventListener('input', () => { applyMapFit(true); mapZoomLabel(); });
    // 窗口尺寸变化后按新容器重算（隐藏时 clientWidth=0，切回战役由 relayout 补算）
    let mapFitTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(mapFitTimer);
      mapFitTimer = setTimeout(() => applyMapFit(true), 150);
    });
    $('btn-sync-loc').addEventListener('click', syncLocation);
    $('map-img').addEventListener('dragstart', e => e.preventDefault());

    $('btn-draw').addEventListener('click', onDrawClick);
    $('btn-reshuffle').addEventListener('click', reshuffleChallenges);

    /* v41：旅行日记 —— 视图切换 / 翻天 / 输入自动保存 */
    document.querySelectorAll('#camp-view-switch .view-tab').forEach(b =>
      b.addEventListener('click', () => switchView(b.dataset.view)));
    $('diary-prev').addEventListener('click', () => {
      diaryDay = Math.max(1, diaryDayOf() - 1); renderDiary();
      try { $('diary-text').focus(); } catch (e) {}
    });
    $('diary-next').addEventListener('click', () => {
      diaryDay = Math.min(dayCount(), diaryDayOf() + 1); renderDiary();
      try { $('diary-text').focus(); } catch (e) {}
    });
    $('diary-today').addEventListener('click', () => {
      diaryDay = null; renderDiary();
      try { $('diary-text').focus(); } catch (e) {}
    });
    $('diary-text').addEventListener('input', onDiaryInput);

    $('btn-export').addEventListener('click', exportJSON);
    $('btn-import').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', e => {
      if (e.target.files[0]) importJSON(e.target.files[0]);
      e.target.value = '';
    });
    $('btn-clear').addEventListener('click', clearAll);

    /* v32：云端存档（上传 / 读取） */
    bindCloudModal();
    $('btn-cloud-push').addEventListener('click', pushCloudSlot);
    $('btn-cloud-pull').addEventListener('click', openCloudModal);

    $('notice-close').addEventListener('click', () => { $('storage-notice').style.display = 'none'; });

    renderAll();
    /* v41：恢复上次停留的视图（日记 / 战役面板），本机记忆 */
    let v0 = 'sheet';
    try { v0 = localStorage.getItem('ebr_camp_view') || 'sheet'; } catch (e) {}
    if (v0 === 'diary') switchView('diary');

    window.addEventListener('pagehide', saveNow);
  }

  /* 合入「地缘行者·游戏辅助系统」后不再自动启动：由主应用切到「战役管理系统」时调用 CampaignApp.boot() */
  let booted = false;
  window.CampaignApp = {
    boot() { if (booted) return; booted = true; init(); },
    get ready() { return booted; },
    relayout() { if (booted) applyMapFit(); },   // v20：容器尺寸变化/重新显示后重算地图尺寸
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (!window.EBR_SHELL) window.CampaignApp.boot();   // 单独打开本文件时仍自动启动
    });
  } else if (!window.EBR_SHELL) window.CampaignApp.boot();
})();
