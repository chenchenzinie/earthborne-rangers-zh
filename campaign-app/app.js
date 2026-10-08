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

  let slotIdx = 0;
  let slot = null;          // { v:2, active, valley:{...}, ancestral:{...} }
  let state = null;         // 当前战役
  let selectedDay = 1;
  let currentMap = 'valley';
  let brushTerrain = null;  // 地形笔刷
  let dirty = false;

  const camp = () => CAMPAIGNS[slot.active];
  const dayCount = () => camp().days;
  const missionSlots = () => camp().missionSlots;
  const missionDB = () => (slot.active === 'valley' ? MISSIONS_VALLEY : MISSIONS_ANCESTRAL);
  const rewardDB = () => (slot.active === 'valley' ? REWARDS_VALLEY : REWARDS_ANCESTRAL);
  const rewardImg = m => slot.active === 'valley'
    ? `rewards-valley/奖励-${m.n}-31.jpg`
    : `rewards-ancestral/奖励XZ-${m.n}-29.jpg`;
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
      missions: Array.from({ length: CAMPAIGNS[key].missionSlots }, () => ({ day: '', name: '', prog: 0, note: '' })),
      mapPin: { map: startMap, x: start[1] / 100, y: start[2] / 100 },
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
    s.currentDay = Math.min(CAMPAIGNS[key].days + 1, Math.max(1, s.currentDay | 0 || 1));
    s.missions.forEach(m => { m.prog = Math.max(0, Math.min(PIPS, m.prog | 0 || 0)); });
    if (s.mapPin && (typeof s.mapPin !== 'object' || !MAP_DB[s.mapPin.map])) s.mapPin = null;
    return s;
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
    selectedDay = Math.min(state.currentDay, dayCount());
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

  function showReminder(title, msgs, label = '阅读提醒', icon = '📖') {
    const box = $('reminder-box');
    if (!msgs.length) { box.hidden = true; return; }
    box.innerHTML =
      `<button class="rem-close" title="关闭">×</button>` +
      `<h3>${icon} ${title} · ${label}</h3><ul>${msgs.map(m => `<li>${m}</li>`).join('')}</ul>`;
    box.hidden = false;
    box.querySelector('.rem-close').addEventListener('click', hideReminder);
  }
  function hideReminder() { $('reminder-box').hidden = true; }

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
  function renderMap() {
    const map = MAP_DB[currentMap];
    const canvas = $('map-canvas');
    const img = $('map-img');
    img.src = map.file;
    canvas.classList.toggle('portrait', !!map.portrait);
    $('map-zoom').value = 100;
    canvas.style.width = map.portrait ? '60%' : '100%';

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
      const b = el('button',
        `map-spot ${isKey ? 'key' : 'minor'}` + (state.location === name ? ' cur' : ''));
      b.type = 'button';
      b.style.left = x + '%';
      b.style.top = y + '%';
      b.title = `旅行至此：${name}（${isKey ? '关键地点' : '非关键地点'}）`;
      b.innerHTML = `<span class="ms-lbl">${name}</span>`;
      b.addEventListener('click', e => { e.stopPropagation(); pickSpot(name, x, y); });
      layer.appendChild(b);
    });
  }
  function renderBrushBar() {
    const bar = $('terrain-brush');
    bar.innerHTML = '<span class="brush-cap">路径地形笔刷：</span>';
    MAP_DB[currentMap].terrains.forEach(t => {
      const b = el('button', 'tbrush' + (brushTerrain === t ? ' on' : ''));
      b.type = 'button';
      b.innerHTML = `<i class="tdot" data-t="${t}"></i>${t}`;
      b.addEventListener('click', () => {
        brushTerrain = (brushTerrain === t) ? null : t;
        renderBrushBar();
      });
      bar.appendChild(b);
    });
    if (brushTerrain) {
      const tip = el('span', 'brush-tip', `已选「${brushTerrain}」：点击地图路径处记录该地形（再次点击笔刷可取消）`);
      bar.appendChild(tip);
    } else {
      bar.appendChild(el('span', 'brush-tip',
        '◆ 金色菱形=关键地点 · ○ 白色圆形=非关键地点 · ◆ 红色=当前选中地点 ｜ 点击地点图标=旅行（自动识别路径地形）· 直接点击路径线段=记录该路径地形'));
    }
  }
  function renderPin() {
    const pin = $('map-pin');
    const p = state.mapPin;
    if (p && p.map === currentMap) {
      pin.hidden = false;
      pin.style.left = (p.x * 100) + '%';
      pin.style.top = (p.y * 100) + '%';
    } else {
      pin.hidden = true;
    }
  }
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
  function onMapClick(e) {
    const img = $('map-img');
    const r = img.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    state.mapPin = { map: currentMap, x, y };
    if (brushTerrain) {
      state.terrain = brushTerrain;
      $('map-terrain').value = brushTerrain;
      $('terrain').value = brushTerrain;
      save();
      renderPin();
      showReminder('当前位置', [`地形：${state.terrain}`, `地点：${state.location || '（未记录）'}`, '已直接写入战役记录表。'], '路径已记录', '🥾');
      return;
    }
    // 无笔刷：点击路径线段 → 自动识别并记录该路径的地形
    const edge = nearestPath(x * 100, y * 100);
    if (edge) {
      state.terrain = edge[2];
      $('map-terrain').value = edge[2];
      $('terrain').value = edge[2];
      save();
      renderPin();
      showReminder('当前位置', [`路径：${edge[0]} — ${edge[1]}`, `地形：${edge[2]}`, '已直接写入战役记录表。'], '路径已识别', '🥾');
      return;
    }
    save();   // 空白处：仅记录图钉
    renderPin();
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
    brushTerrain = null;
    dirty = true; saveNow();
    hideReminder();
    renderAll();
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
    syncTextFields();
    renderMapTabs();
    renderMap();
  }

  /* ---------- 启动 ---------- */
  function init() {
    load();
    ac.bind();

    document.querySelectorAll('#campaign-switch .camp-tab').forEach(btn =>
      btn.addEventListener('click', () => switchCampaign(btn.dataset.camp)));
    document.querySelectorAll('#slot-switch .slot-tab').forEach(btn =>
      btn.addEventListener('click', () => switchSlot(+btn.dataset.slot)));

    $('btn-advance').addEventListener('click', () => { advanceDay(); renderToday(); renderCalendar(); });
    $('btn-prev').addEventListener('click', () => { regressDay(); renderToday(); renderCalendar(); });
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

    $('map-canvas').addEventListener('click', onMapClick);
    $('map-zoom').addEventListener('input', e => {
      const base = MAP_DB[currentMap].portrait ? 0.6 : 1;
      $('map-canvas').style.width = (+e.target.value / 100 * base * 100) + '%';
    });
    $('btn-sync-loc').addEventListener('click', syncLocation);
    $('map-img').addEventListener('dragstart', e => e.preventDefault());

    $('btn-export').addEventListener('click', exportJSON);
    $('btn-import').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', e => {
      if (e.target.files[0]) importJSON(e.target.files[0]);
      e.target.value = '';
    });
    $('btn-clear').addEventListener('click', clearAll);

    $('notice-close').addEventListener('click', () => { $('storage-notice').style.display = 'none'; });

    renderAll();

    window.addEventListener('pagehide', saveNow);

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW 注册失败', err));
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
