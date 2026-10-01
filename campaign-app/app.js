/* ============================================================
 * 地缘行者 · 战役记录器
 * 功能对标 TTS 模组 Campaign Tracker（camp_0.lua）：
 *   30 天日历推进/回退、内置天气表（可加码）、手册条目提醒、
 *   33 个任务槽（日期/名称/3 格进度）、行者/当前位置、奖励×3、重要事件×2
 * 数据自动保存 localStorage，并支持 JSON 导出/导入
 * ============================================================ */
(function () {
  'use strict';

  const LS_KEY = 'ebr_campaign_v1';
  const DAY_COUNT = 30;
  const MISSION_SLOTS = 33;
  const PIPS = 3;

  /* TTS dayWeather（第 1-30 天的基础天气：1 风和日丽 / 2 倾盆大雨 / 3 狂风呼啸） */
  const DAY_WEATHER = [1,1,1,2,2,2,2,1,1,2,2,2,3,3,2,2,2,3,3,3,1,1,2,2,2,3,3,3,1,1];
  const WEATHER_NAME = { 1: '风和日丽', 2: '倾盆大雨', 3: '狂风呼啸', 4: '电光迷雾' };
  const WEATHER_CLS = { 1: 'w1', 2: 'w2', 3: 'w3', 4: 'w4' };
  /* 固定手册提醒（对应 TTS Day() 里的 index==2 → 94.1、index==3 → 1.04） */
  const FIXED_REMIND = { 2: '94.1', 3: '1.04' };

  let state = null;
  let selectedDay = 1;
  let dirty = false;   // 自加载后是否有编辑（避免 pagehide 把旧内存状态覆盖已被外部清空的存档）

  function blankState() {
    return {
      v: 1,
      currentDay: 1,        // 当前所处日序；< currentDay 的日子都已结束（打 ×）
      hardWeather: false,
      rangers: '',
      location: '',
      terrain: '',
      events1: '', events2: '',
      rewards: ['', '', ''],
      dayEntries: {},       // { "3": ["94.1","",""] } 每天 3 格手册条目
      missions: Array.from({ length: MISSION_SLOTS }, () => ({ day: '', name: '', prog: 0 })),
    };
  }

  /* ---------- 持久化 ---------- */
  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) { state = blankState(); return; }
      const s = JSON.parse(raw);
      state = Object.assign(blankState(), s);
      if (!Array.isArray(state.rewards) || state.rewards.length !== 3) state.rewards = ['', '', ''];
      if (typeof state.dayEntries !== 'object' || !state.dayEntries) state.dayEntries = {};
      if (!Array.isArray(state.missions) || state.missions.length !== MISSION_SLOTS) {
        const old = Array.isArray(state.missions) ? state.missions : [];
        state.missions = Array.from({ length: MISSION_SLOTS }, (_, i) =>
          Object.assign({ day: '', name: '', prog: 0 }, old[i] || {}));
      }
      state.currentDay = Math.min(DAY_COUNT + 1, Math.max(1, state.currentDay | 0 || 1));
      state.missions.forEach(m => { m.prog = Math.max(0, Math.min(PIPS, m.prog | 0 || 0)); });
    } catch (e) {
      console.error('存档读取失败', e);
      state = blankState();
    }
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
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); dirty = false; }
    catch (e) { console.error('保存失败', e); }
  }

  /* ---------- 天气 ---------- */
  function weatherIndex(day) {
    const base = DAY_WEATHER[day - 1];
    return state.hardWeather ? Math.min(4, base + 1) : base;
  }
  function weatherName(day) { return WEATHER_NAME[weatherIndex(day)]; }

  /* ---------- DOM 工具 ---------- */
  const $ = id => document.getElementById(id);
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  /* ---------- 渲染：今日条 ---------- */
  function renderToday() {
    const d = state.currentDay;
    $('today-num').textContent = d;
    const w = $('today-weather');
    if (d > DAY_COUNT) {
      w.textContent = '战役完成';
      w.style.background = 'var(--ink)';
    } else {
      const wi = weatherIndex(d);
      w.textContent = `今日天气 · ${WEATHER_NAME[wi]}`;
      w.style.background = { w1: 'var(--w1)', w2: 'var(--w2)', w3: 'var(--w3)', w4: 'var(--w4)' }[WEATHER_CLS[wi]];
    }
    $('btn-advance').disabled = d > DAY_COUNT;
    $('btn-prev').disabled = d <= 1;
  }

  /* ---------- 渲染：日历 ---------- */
  function renderCalendar() {
    const grid = $('calendar-grid');
    grid.innerHTML = '';
    for (let day = 1; day <= DAY_COUNT; day++) {
      const past = day < state.currentDay;
      const current = day === state.currentDay;
      const wi = weatherIndex(day);
      const entries = state.dayEntries[day] || ['', '', ''];
      const cell = el('div',
        `day-cell ${WEATHER_CLS[wi]} ${past ? 'past' : ''} ${current ? 'current' : ''} ${day > state.currentDay ? 'future' : ''}` +
        (day === selectedDay ? ' selected' : ''));
      cell.dataset.day = day;
      const dots = entries.map(s => `<i class="${s.trim() ? 'on' : ''}"></i>`).join('');
      cell.innerHTML =
        `<span class="d-num">${day}</span>` +
        (past ? '<span class="d-x">✕</span>' : `<span class="d-x" style="visibility:hidden">·</span>`) +
        `<span class="d-dots">${dots}</span>`;
      cell.title = `第 ${day} 天 · ${WEATHER_NAME[wi]}`;
      cell.addEventListener('click', () => onDayCellClick(day));
      grid.appendChild(cell);
    }
    renderDayEditor();
  }

  function onDayCellClick(day) {
    // 与 TTS 一致：点当前日 = 结束当天推进；点已结束的最后一天 = 回退；其他日仅选中编辑条目
    if (day === state.currentDay && day <= DAY_COUNT) {
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
    const day = Math.min(DAY_COUNT, Math.max(1, selectedDay));
    $('de-day').textContent = day;
    const entries = state.dayEntries[day] || ['', '', ''];
    [1, 2, 3].forEach((k, i) => {
      const inp = $('de-' + k);
      if (document.activeElement !== inp) inp.value = entries[i] || '';
    });
  }
  function commitDayEntry(slot) {
    const day = selectedDay;
    const arr = (state.dayEntries[day] || ['', '', '']).slice();
    arr[slot - 1] = $('de-' + slot).value;
    if (arr.some(x => x.trim())) state.dayEntries[day] = arr;
    else delete state.dayEntries[day];
    save();
    renderCalendar();
  }

  /* ---------- 推进 / 回退 ---------- */
  function advanceDay() {
    const n = state.currentDay;
    if (n > DAY_COUNT) return;
    const msgs = [];
    // 固定条目（TTS：进入第 3 天提示 94.1，进入第 4 天提示 1.04）
    if (FIXED_REMIND[n]) msgs.push(`别忘了阅读战役手册条目 ${FIXED_REMIND[n]}！`);
    // 新一天格子里记录的条目
    const nextDay = n + 1;
    if (nextDay <= DAY_COUNT) {
      const entries = (state.dayEntries[nextDay] || []).map(s => s.trim()).filter(Boolean);
      entries.forEach(x => msgs.push(`别忘了阅读战役手册条目 ${x}！`));
    }
    if (n === DAY_COUNT) {
      msgs.push('第 30 天结束，战役已完成！');
    }
    state.currentDay = nextDay;
    selectedDay = Math.min(nextDay, DAY_COUNT);
    dirty = true; saveNow();
    showReminder(n === DAY_COUNT ? '战役完成' : `第 ${nextDay} 天`, msgs);
  }
  function regressDay() {
    if (state.currentDay <= 1) return;
    state.currentDay -= 1;
    selectedDay = state.currentDay;
    dirty = true; saveNow();
    hideReminder();
  }

  function showReminder(title, msgs) {
    const box = $('reminder-box');
    if (!msgs.length) { box.hidden = true; return; }
    box.innerHTML =
      `<button class="rem-close" title="关闭">×</button>` +
      `<h3>📖 ${title} · 阅读提醒</h3><ul>${msgs.map(m => `<li>${m}</li>`).join('')}</ul>`;
    box.hidden = false;
    box.querySelector('.rem-close').addEventListener('click', hideReminder);
  }
  function hideReminder() { $('reminder-box').hidden = true; }

  /* ---------- 渲染：任务 ---------- */
  function renderMissions() {
    const wrap = $('mission-cols');
    wrap.innerHTML = '';
    for (let col = 0; col < 3; col++) {
      const colEl = el('div', 'mission-col');
      for (let k = 0; k < 11; k++) {
        const idx = col * 11 + k;
        const m = state.missions[idx];
        const row = el('div', 'mission-row');
        const dayInp = el('input');
        dayInp.type = 'text'; dayInp.maxLength = 6; dayInp.placeholder = '日期';
        dayInp.value = m.day;
        dayInp.addEventListener('input', () => { m.day = dayInp.value; save(); });
        const nameInp = el('input');
        nameInp.type = 'text'; nameInp.placeholder = `任务 ${idx + 1} 名称`;
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
            // 与 TTS 一致：3 个勾等价，点空勾 +1，点已填勾 -1（重绘后总是前 prog 个亮起）
            m.prog = (p < m.prog) ? m.prog - 1 : m.prog + 1;
            save(); renderMissions();
          });
          pips.appendChild(pip);
        }
        row.appendChild(dayWrap);
        row.appendChild(nameWrap);
        row.appendChild(pips);
        colEl.appendChild(row);
      }
      wrap.appendChild(colEl);
    }
  }

  /* ---------- 文本字段绑定 ---------- */
  function bindTextField(id, get, set) {
    const inp = $(id);
    inp.value = get();
    inp.addEventListener('input', () => { set(inp.value); save(); });
  }
  function renderTextFields() {
    bindTextField('rangers', () => state.rangers, v => state.rangers = v);
    bindTextField('location', () => state.location, v => state.location = v);
    bindTextField('terrain', () => state.terrain, v => state.terrain = v);
    bindTextField('events1', () => state.events1, v => state.events1 = v);
    bindTextField('events2', () => state.events2, v => state.events2 = v);
    bindTextField('rewards1', () => state.rewards[0], v => state.rewards[0] = v);
    bindTextField('rewards2', () => state.rewards[1], v => state.rewards[1] = v);
    bindTextField('rewards3', () => state.rewards[2], v => state.rewards[2] = v);
  }

  /* ---------- 导出 / 导入 / 清空 ---------- */
  function exportJSON() {
    saveNow();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    a.href = URL.createObjectURL(blob);
    a.download = `地缘行者战役记录_${ts}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const s = JSON.parse(reader.result);
        if (typeof s !== 'object' || s === null) throw new Error('格式错误');
        const merged = Object.assign(blankState(), s);
        if (!Array.isArray(merged.rewards) || merged.rewards.length !== 3) throw new Error('rewards 字段错误');
        if (!Array.isArray(merged.missions) || merged.missions.length !== MISSION_SLOTS) throw new Error('missions 字段错误');
        state = merged;
        state.currentDay = Math.min(DAY_COUNT + 1, Math.max(1, state.currentDay | 0 || 1));
        selectedDay = Math.min(state.currentDay, DAY_COUNT);
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
    if (!confirm('确定清空全部战役记录吗？此操作不可恢复，建议先导出存档。')) return;
    state = blankState();
    selectedDay = 1;
    dirty = true; saveNow();
    hideReminder();
    renderAll();
  }

  /* ---------- 总渲染 ---------- */
  function renderAll() {
    renderToday();
    renderCalendar();
    renderMissions();
    renderTextFields();
    $('hard-weather').checked = !!state.hardWeather;
  }

  /* ---------- 启动 ---------- */
  function init() {
    load();
    selectedDay = Math.min(state.currentDay, DAY_COUNT);
    renderAll();

    $('btn-advance').addEventListener('click', () => { advanceDay(); renderToday(); renderCalendar(); });
    $('btn-prev').addEventListener('click', () => { regressDay(); renderToday(); renderCalendar(); });
    $('hard-weather').addEventListener('change', e => {
      state.hardWeather = e.target.checked; saveNow(); renderToday(); renderCalendar();
    });
    [1, 2, 3].forEach(k => $('de-' + k).addEventListener('input', () => commitDayEntry(k)));
    $('btn-export').addEventListener('click', exportJSON);
    $('btn-import').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', e => {
      if (e.target.files[0]) importJSON(e.target.files[0]);
      e.target.value = '';
    });
    $('btn-clear').addEventListener('click', clearAll);

    // 离开页面前确保落盘
    window.addEventListener('pagehide', saveNow);

    // 注册离线缓存（file:// 下浏览器会拒绝，静默忽略）
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW 注册失败', err));
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
