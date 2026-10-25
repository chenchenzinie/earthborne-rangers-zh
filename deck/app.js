/* ============================================================
 * 地缘行者 · 游戏辅助系统  app.js（外壳 + 卡牌管理系统）
 * 子系统：卡牌管理系统（本文件）/ 战役管理系统（campaign-app.js）
 * 模块：登录认证 / 数据看板 / 卡牌列表 / 表单编辑 / 卡牌整合 /
 *       卡表检索 / 角色创建（按规则手册 P32-33 校验）/ 导出
 * 存储：localStorage（每档案独立命名空间）
 * ============================================================ */
'use strict';
window.EBR_SHELL = true;      // 告知 campaign-app.js：由外壳接管启动时机

/* ---------------- 常量 ---------------- */
const LS_PROFILES = 'ebr_dm_profiles';
const LS_CUR      = 'ebr_dm_cur';
const lsData      = id => `ebr_dm_data_${id}`;

const GROUPS = {
  background: '背景', expertise: '专长', trait: '性格', attribute: '属性',
  role: '角色', injury: '伤病', reward: '奖励', story: '志向剧情',
};
const SETS = { base: '基础', valley: '山谷卫士', ancestral: '先祖遗产' };
/* ------------------------------------------------------------------
 * 奖励卡查看开关（v27）
 * 奖励卡属于战役剧透内容：默认一律隐藏，卡牌列表 / 卡表检索里查不到。
 * 需要手动开启总开关，再点选要查看的扩展（本体 / 山谷卫士 / 先祖遗产），
 * 三个扩展各自独立，可只开其中一个。
 * 该功能直接开放（不分角色、不设后台开关），状态存在本机档案 DB.rewardView。
 * ------------------------------------------------------------------ */
const REWARD_SETS = [
  { key: 'base',      label: '本体',     icon: '🎁' },
  { key: 'valley',    label: '山谷卫士', icon: '🏞️' },
  { key: 'ancestral', label: '先祖遗产', icon: '🏺' },
];
const REWARD_SET_LABEL = REWARD_SETS.reduce((o, s) => (o[s.key] = s.label, o), {});
/* 属性固定按「知觉 → 精神 → 体质 → 专注」排列（与卡面顺序一致） */
const ATTRS = ['知', '精', '体', '专'];
const ATTR_FULL = { 知: '知觉', 精: '精神', 体: '体质', 专: '专注' };
/* 手段（卡面四枚图标）：可多选、可重复（同一手段可出现多次） */
const MEANS = [
  { key: '关联', icon: '🔗' },
  { key: '冲突', icon: '⚔️' },
  { key: '探索', icon: '🧭' },
  { key: '推理', icon: '🔍' },
];
const MEAN_ICON = MEANS.reduce((o, m) => (o[m.key] = m.icon, o), {});
const meanIcon = k => MEAN_ICON[k] || '❓';
/* 「卡牌类型」下拉只在行者牌 / 奖励牌上出现；四维数值只在属性牌上出现 */
const CARD_TYPE_GROUPS = ['role', 'reward'];
const hasCardType = c => CARD_TYPE_GROUPS.includes(c?.group);
/* ------------------------------------------------------------------
 * v37：行者牌库卡的「类型 / 需求 / 装备值 / 标记」四项校对数据
 * 只有行者牌库里这五类（背景 / 专长 / 性格 / 属性 / 角色）才填这四项；
 * 数据随校对记录 DB.proof[cardId] 一起走（个人库自动同步到云端）。
 * ------------------------------------------------------------------ */
const RANGER_GROUPS = ['background', 'expertise', 'trait', 'attribute', 'role'];
const hasRangerData = c => RANGER_GROUPS.includes(c?.group);
/* v43：哪些类别的「需求」可以被校对输入覆盖。
   属性牌除外 —— 它的 attr 是四观点数分配（牌库基准），不是需求。 */
const REQ_PROOF_GROUPS = ['background', 'expertise', 'trait', 'role', 'reward'];
/* ------------------------------------------------------------------
 * v43：专家牌判定 —— 「关键词」与「类型行」两个来源取并集
 * 类型行（c.type，如「道具·科技·专家」）里含「专家」即视为专家牌，
 * 与 keywords 里的「专家」完全等效：任标一处就算专家牌。
 * 两处不一致（多半是 OCR 漏标）会在校对页标出来提醒复核。
 * ------------------------------------------------------------------ */
const EXPERT_KW = '专家';
const typeHasExpert = c => String(c?.type || '').includes(EXPERT_KW);
const kwHasExpert   = c => (c?.keywords || []).includes(EXPERT_KW);
/* 是不是专家牌 */
function isExpertCard(c) { return !!c && (kwHasExpert(c) || typeHasExpert(c)); }
/* 命中来源：both / keyword / type / '' */
function expertFrom(c) {
  if (!c) return '';
  const k = kwHasExpert(c), t = typeHasExpert(c);
  return (k && t) ? 'both' : k ? 'keyword' : t ? 'type' : '';
}
/* 只在一处标了「专家」——另一处漏标，校对时要提醒 */
const expertMismatch = c => { const f = expertFrom(c); return f === 'keyword' || f === 'type'; };
/* 红色「专家」标签（鼠标悬停看来源） */
function expertTagHTML(c) {
  const f = expertFrom(c); if (!f) return '';
  const why = f === 'both' ? '关键词与类型行都含「专家」'
            : f === 'type' ? '类型行含「专家」（关键词未标）'
            : '关键词含「专家」（类型行未标）';
  return `<span class="tag red" title="${esc(why)}">专家</span>`;
}
/* 关键词标签串：专家单独走 expertTagHTML（这样类型行命中也能显示），其余照常 */
function keywordsHTML(c) {
  if (!c) return '';
  const rest = (c.keywords || []).filter(k => k !== EXPERT_KW);
  return `${expertTagHTML(c)}${rest.map(k => `<span class="tag gray">${esc(k)}</span>`).join('')}`;
}
const R_TYPE_ORDER = ['精', '体', '知', '专'];          // 下拉顺序：精神 / 体质 / 知觉 / 专注
const R_EQ_MAX = 5;                                     // 装备值：5 格
const BG_DECKS   = ['工匠', '樵客', '牧民', '旅人', '话士'];
const EXP_DECKS  = ['创物者', '调解者', '探索者', '塑造者', '灵语者'];

/* 构筑规则（规则手册 P32-33） */
const RULES = {
  attribute: { label: '属性牌', kinds: 1, copies: 1, note: '从属性牌中选择 1 张（每张含四属性分配，一项最高 3 点、一项最低 1 点）' },
  trait:     { label: '性格',   per: 2, note: '官方规则：从每项属性（知觉/体质/精神/专注）的对应性格牌组中各选 1 种，每种 2 张，共 8 张。性格牌的属性归属待数据校对，当前先按「任选 4 种」校验' },
  background:{ label: '背景',   decks: BG_DECKS,  kinds: 5, copies: 2, note: '选择 1 个背景牌组，从中选 5 种牌，每种 2 张（共 10 张）' },
  expertise: { label: '专长',   decks: EXP_DECKS, kinds: 5, copies: 2, note: '选择 1 个专长牌组，从中选 5 种牌，每种 2 张（共 10 张）' },
  role:      { label: '角色牌', per: 1, note: '从所选专长牌组的角色牌中选 1 张（不进牌库，放角色区）' },
  hobby:     { label: '爱好',   per: 2, note: '从任意背景/专长牌组中选 1 种非专家牌（关键词与类型行都不含「专家」）且未选过的牌，加 2 张（不能选角色牌）' },
};
const DECK_TOTAL = { kinds: 15, cards: 30 };     // 牌库 15 种 × 2 张

/* ------------------------------------------------------------------
 * 组卡限制联动规则（对应「组卡限制联动」功能开关 deckrules）
 * 每条 test(card, ctx) 返回 null（可选）或不可选原因字符串。
 * pending:true 的规则只提示、不拦截（条件待数据校对完成后按《规则手册》补精确值）。
 * 校对完成后只需在这里增改条目 / 去掉 pending 标记，无需改动界面代码。
 * ------------------------------------------------------------------ */
const LINK_RULES = [
  /* always: true 的规则不受「限制联动」开关影响 —— 属性需求是硬性牌库规则，必须拦 */
  { id: 'attr', label: '属性未到需求', note: '卡牌的属性需求不得超过属性牌提供的点数（硬性拦截，不可关）',
    always: true, hide: false,
    test: (c, ctx) => {
      /* 第 1 步正是在挑属性牌本身，不拿它去比对自己；性格牌走下面的 trait-req */
      if (ctx.step === 'attribute' || ctx.step === 'trait') return null;
      const a = ctx.attr; if (!a || !Object.keys(a).length) return null;
      const need = cardReqMap(c); if (!need) return null;
      const lack = Object.entries(need).filter(([k, n]) => (a[k] ?? 0) < n);
      return lack.length ? `属性未到需求：${lack.map(([k, n]) => `${ATTR_FULL[k] || k} 需 ${n}（属性牌 ${a[k] ?? 0}）`).join('、')}` : null;
    } },
  { id: 'role-out', label: '角色牌不进牌库', note: '角色牌放角色区，不能当作背景 / 专长 / 爱好选入牌库', hide: true,
    test: (c, ctx) => (c.group === 'role' && ctx.step !== 'role')
      ? '角色牌只能在第 5 步选择，且不进入牌库' : null },
  /* v43：类型行含「专家」也算专家牌 —— 与关键词取并集 */
  { id: 'hobby-expert', label: '爱好排除「专家」', note: '专家牌不能作为爱好：关键词或类型行任含「专家」即命中', hide: true,
    test: (c, ctx) => (ctx.step === 'hobby' && isExpertCard(c))
      ? `专家牌不能作为爱好（${expertFrom(c) === 'type' ? '类型行含「专家」' : '含「专家」'}）` : null },
  { id: 'hobby-unique', label: '爱好不与牌库重复', note: '爱好必须是牌库里没选过的另一种牌', hide: true,
    test: (c, ctx) => (ctx.step === 'hobby' && (ctx.used || []).includes(c.id))
      ? '这张牌已经在牌库里了（爱好需是第 15 种）' : null },
  { id: 'role-deck', label: '角色牌来自专长牌组', note: '角色牌须取自所选专长牌组（空白行者卡例外）', pending: true,
    test: (c, ctx) => (ctx.step === 'role' && ctx.expDeck && c.group === 'role'
      && c.deck !== ctx.expDeck && !c.customizable)
      ? `角色牌通常取自「${ctx.expDeck}」牌组（待校对，暂不强制）` : null },
  { id: 'trait-req', label: '性格需求不超过属性', note: '性格按颜色分四组，每组对应一项属性；需求不得超过属性牌点数（硬性拦截；需求数字未校对时只提示）',
    always: true,
    test: (c, ctx) => {
      if (ctx.step !== 'trait') return null;
      const g = traitGroupById(c.id);
      if (!g) return null;
      const a = ctx.attr; if (!a || !Object.keys(a).length) return null;
      /* v37：校对里填过「需求」就以校对值为准 */
      const rd = typeof rangerDataOf === 'function' ? rangerDataOf(c.id) : { req: '' };
      const fixed = rd.req !== '' && rd.req != null;
      const need = fixed ? Number(rd.req) : (typeof traitReq === 'function' ? traitReq(c) : 1);
      const pend = !fixed && (typeof traitReqPending === 'function' ? traitReqPending(c) : true);
      const have = a[g.attr] ?? 0;
      if (have >= need) return null;
      return {
        msg: `属性未到需求：${g.label}组 · ${ATTR_FULL[g.attr]} 需 ${need}（属性牌 ${have}）${pend ? '（需求未校对，暂可强行选入）' : ''}`,
        soft: pend,
      };
    } },
  { id: 'trait-one', label: '同色性格只能选 1 张', note: '同一颜色分组内只能选 1 张（点另一张即替换）', soft: true,
    test: (c, ctx) => {
      if (ctx.step !== 'trait') return null;
      const g = traitGroupById(c.id);
      if (!g) return null;
      const cur = (ctx.traitSlots || {})[g.key];
      return (cur && cur !== c.id) ? `${g.label}组已选「${cardById(cur)?.name || ''}」，选中将替换` : null;
    } },
];

/* 单条判定：null = 可选；{ msg, soft } = 不可选 / soft 仅提示
   v38：always 类规则（属性需求）不受「限制联动」开关影响，永远生效；
        test 可以返回字符串，也可以返回 { msg, soft } 让同一条规则自己决定软硬。 */
function linkBlock(c, ctx) {
  const on = featureOn('deckrules');
  for (const r of LINK_RULES) {
    if (!on && !r.always) continue;
    let m = null;
    try { m = r.test(c, ctx || {}); } catch (e) { m = null; }
    if (!m) continue;
    const msg = typeof m === 'string' ? m : m.msg;
    const soft = (typeof m === 'object' && m.soft != null) ? !!m.soft : (!!r.pending || !!r.soft);
    return { msg, soft, rule: r.id };
  }
  return null;
}

/* 牌库规则逐条校验清单（总览页与列表页共用） */
/* ---------------- 性格牌四色分组（数据见 data/data-traits.js） ----------------
 * 性格按卡图颜色分为四组，每组对应一项属性、只能选 1 张，且该牌的「属性需求」
 * 不能超过属性牌提供的点数。旧存档按属性键存放，这里自动迁移为颜色键。 */
const TRAIT_KEYS = () => traitGroupsAll().map(g => g.key);
function traitSlots(d) {
  const raw = (d && d.steps && d.steps.traits) || {};
  const out = {}; let changed = false;
  for (const [k, v] of Object.entries(raw)) {
    if (!v) continue;
    const g = traitGroupById(v) || traitGroupsAll().find(x => x.attr === k);
    const key = g ? g.key : k;
    if (key !== k) changed = true;
    out[key] = v;
  }
  if (changed && d && d.steps) d.steps.traits = out;
  return out;
}
/* 已选性格 → { 属性: 已用点数 } 之类用不到，这里给「每组已选几张」用 */
const traitPickedIds = d => Object.values(traitSlots(d)).filter(Boolean);

function deckRuleCheck(d) {
  const st = deckStatus(d);
  const s = d.steps || {};
  const tSlots = traitSlots(d);
  const tKinds = Object.values(tSlots).filter(Boolean);
  const tGroups = TRAIT_KEYS().filter(k => tSlots[k]).length;
  const attr = s.attribute ? cardById(s.attribute)?.attr : null;
  const tReqOk = tKinds.every(id => {
    const c = cardById(id), g = traitGroupById(id);
    if (!c || !g || !attr) return true;
    return (attr[g.attr] ?? 0) >= traitReq(c);
  });
  return [
    { label: '属性牌 1 张', ok: !!s.attribute },
    { label: '性格：四色各 1 种（共 4 种 × 2 张）', ok: tKinds.length === 4 && tGroups === 4 },
    { label: '性格：属性需求不超过属性牌点数', ok: tReqOk },
    { label: '背景 5 种 × 2 张（同一牌组）', ok: !!s.background?.deck && (s.background.picks || []).length === 5 },
    { label: '专长 5 种 × 2 张（同一牌组）', ok: !!s.expertise?.deck && (s.expertise.picks || []).length === 5 },
    { label: '角色牌 1 张（不进牌库）', ok: !!s.role },
    { label: '爱好 1 种 × 2 张（非专家牌且不重复）', ok: !!s.hobby && !isExpertCard(cardById(s.hobby)) },
    { label: `牌库合计 ${DECK_TOTAL.kinds} 种 / ${DECK_TOTAL.cards} 张`,
      ok: st.kinds === DECK_TOTAL.kinds && st.cards === DECK_TOTAL.cards },
  ];
}

/* ---------------- 工具 ---------------- */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const attrHTML = a => Object.entries(a || {}).map(([k, v]) =>
  `<span class="chip-attr attr-${esc(k)}" title="${esc(ATTR_FULL[k] || k)}需求">${esc(k)}${v}</span>`).join(' ');
/* ------------------------------------------------------------------
 * v43：需求数值胶囊 —— 卡上那枚「专1 / 精1」到底取哪个数，只有一个口径：
 *   校对栏填过「类型 + 需求」→ 用输入值（实线胶囊）；
 *   没填过 → 用卡面 OCR 值（虚线胶囊 + 浅色，鼠标悬停提示「尚未校对」）。
 * 组牌校验走同一张表（cardReqMap），所以卡上显示几就是按几校验，不会两张皮。
 * ------------------------------------------------------------------ */
function reqChipsHTML(c, opts = {}) {
  const { map, proofed } = cardReqEff(c);
  if (!map || !Object.keys(map).length) return '';
  const tip = proofed ? '已校对' : '卡面 OCR 值，尚未校对';
  const chips = Object.entries(map).map(([k, v]) =>
    `<span class="chip-attr attr-${esc(k)} ${proofed ? 'is-proof' : 'is-raw'}" title="${esc(ATTR_FULL[k] || k)}需求 ${v} · ${tip}">${esc(k)}${v}</span>`).join(' ');
  return chips + (!proofed && opts.pend
    ? `<span class="chip-unproof" title="需求数字来自卡图 OCR，尚未人工校对">未校对</span>` : '');
}
/* 组牌时贴着需求胶囊的「你有 N 点」对比（还没选属性牌就不显示） */
function reqHaveHTML(c, attr) {
  const ra = pickReqAttr(c);
  if (!ra || !attr) return '';
  const need = pickReqNum(c), have = attr[ra] ?? 0;
  return ` <span class="${have >= need ? 'ok' : 'bad'}" title="${esc(ATTR_FULL[ra] || ra)}需求 ${need} · 属性牌 ${have}">（你有 ${have}）</span>`;
}

/* 手段图标串（卡牌详情页 / 大图信息区共用）：只读展示 */
const meansHTML = m => (Array.isArray(m) ? m : []).filter(Boolean)
  .map(k => `<span class="chip-mean" title="手段：${esc(k)}">${meanIcon(k)}${esc(k)}</span>`).join(' ');
/* 效果文本按行：优先用校对后的多行条目，否则沿用原文本按换行拆 */
const cardTextLines = c => Array.isArray(c?.textLines)
  ? c.textLines.slice()
  : String(c?.text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
/* 手段串 → 数组（CSV 导入用，支持「关联 探索、探索」等写法，保留重复） */
function parseMeansStr(s) {
  const out = [];
  String(s || '').split(/[、,，\/|\s]+/).forEach(t => { if (MEAN_ICON[t]) out.push(t); });
  return out;
}
const arrEq = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);

/* 关键词着色：精力 / 能量 = 琥珀黄（游戏资源标识色） */
const kwText = s => esc(s ?? '').replace(/(精力|能量)/g, '<span class="kw-amber">$1</span>');
/* v45：卡牌自制正文 —— 在 kwText 基础上把首行引导词加粗（与 PNG 导出的 mcRuns 一致），换行转 <br> */
const mcTextHTML = s => kwText(s)
  .replace(/^((?:消耗|响应|部署|行动|灵感|通灵)[：:])/, '<b>$1</b>')
  .replace(/\n/g, '<br>');

/* 本地图片 → 压缩 dataURL（最长边 maxW，JPEG 0.85），用于上传底图
   返回 { url, w, h }：自制卡要记图的真实比例，插画的「cover 基准 + 缩放」
   全靠它；只给 url 的话缩放滑块会失效（同比例框 + slice 等于不缩放）。 */
function shrinkImageInfo(file, maxW = 900) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onerror = rej;
    r.onload = () => {
      const img = new Image();
      img.onerror = rej;
      img.onload = () => {
        const scale = Math.min(1, maxW / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        res({ url: cv.toDataURL('image/jpeg', 0.85), w: cv.width, h: cv.height });
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}
function shrinkImage(file, maxW = 900) {
  return shrinkImageInfo(file, maxW).then(r => r.url);
}

function toast(msg, ms = 2200) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._tm); toast._tm = setTimeout(() => t.classList.add('hidden'), ms);
}
async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

/* ---------------- 界面配色（主题） ---------------- */
const THEME_VAR_KEYS = ['--bg', '--panel', '--panel2', '--ink', '--ink2', '--line',
  '--green', '--green2', '--green-soft', '--amber', '--amber-soft',
  '--red', '--red-soft', '--blue', '--blue-soft'];
const THEME_PRESETS = {
  moss:   { label: '苔绿（默认）', mode: 'auto', vars: {} },
  sand:   { label: '暖砂', mode: 'light', vars: {
    '--bg': '#f7f1e3', '--panel': '#fffdf6', '--panel2': '#fbf5e9', '--ink': '#3a3226',
    '--ink2': '#7a6e5b', '--line': '#e8dcc2', '--green': '#7d6a34', '--green2': '#96814a',
    '--green-soft': '#f1ead6', '--amber': '#b07d2b', '--amber-soft': '#f6ecd9' } },
  forest: { label: '深林', mode: 'dark', vars: {
    '--bg': '#1d241f', '--panel': '#262e26', '--panel2': '#2c342c', '--ink': '#e4ead9',
    '--ink2': '#a2ab98', '--line': '#3a443a', '--green': '#7fb08a', '--green2': '#6a9a75',
    '--green-soft': '#2f4231', '--amber': '#d3a45c', '--amber-soft': '#3c3423',
    '--red': '#d07a5f', '--red-soft': '#42312a', '--blue': '#7fa3c0', '--blue-soft': '#2c3742' } },
  night:  { label: '夜蓝', mode: 'dark', vars: {
    '--bg': '#1b222c', '--panel': '#242c38', '--panel2': '#2a3341', '--ink': '#dde5ef',
    '--ink2': '#98a5b5', '--line': '#374150', '--green': '#5f9e7d', '--green2': '#74b092',
    '--green-soft': '#294036', '--amber': '#d3a45c', '--amber-soft': '#3a3324',
    '--red': '#d07a5f', '--red-soft': '#42312a', '--blue': '#84a9c6', '--blue-soft': '#2c3742' } },
  plum:   { label: '紫檀', mode: 'light', vars: {
    '--bg': '#f3eee9', '--panel': '#fffcf9', '--panel2': '#f8f2ec', '--ink': '#33292f',
    '--ink2': '#6f616b', '--line': '#e5d9d0', '--green': '#6a5a7a', '--green2': '#84739a',
    '--green-soft': '#efe8f2', '--amber': '#a8762a', '--amber-soft': '#f5edd9' } },
};
const THEME_PICK = [
  ['--green', '主色（按钮 / 标题）'], ['--bg', '页面底色'], ['--panel', '面板底色'],
  ['--ink', '正文文字'], ['--amber', '强调色（精力 / 提示）'], ['--line', '分隔线'],
];
/* 主题另存一份到本机（与账号数据槽无关）：刷新时账号槽要等云端档案返回才切到正确槽位，
   期间若只依赖 DB.settings.theme 会短暂回退成默认配色，故用设备级缓存兜底。 */
const LS_THEME = 'ebr_dm_theme';
const readThemeLS = () => { try { return JSON.parse(localStorage.getItem(LS_THEME) || 'null') || null; } catch { return null; } };
const themeOf = () => (DB?.settings?.theme) || readThemeLS() || { preset: 'moss', mode: 'auto', vars: {} };
function applyTheme(t) {
  const root = document.documentElement;
  t = t || themeOf();
  const preset = THEME_PRESETS[t.preset] || THEME_PRESETS.moss;
  const mode = t.mode || preset.mode || 'auto';
  if (mode === 'auto') root.removeAttribute('data-theme'); else root.dataset.theme = mode;
  const vars = { ...(preset.vars || {}), ...(t.vars || {}) };
  THEME_VAR_KEYS.forEach(k => root.style.removeProperty(k));
  for (const [k, v] of Object.entries(vars)) if (v) root.style.setProperty(k, v);
}
/* 取色器的当前值：自定义 → 预设 → 当前 CSS 变量 */
function themePickVal(k) {
  const t = themeOf();
  const preset = THEME_PRESETS[t.preset] || THEME_PRESETS.moss;
  const v = (t.vars || {})[k] || (preset.vars || {})[k];
  if (v) return v;
  const cs = getComputedStyle(document.documentElement).getPropertyValue(k).trim();
  return /^#[0-9a-fA-F]{6}$/.test(cs) ? cs : '#888888';
}
const themeName = t => t?.preset === 'custom' ? '自定义' : (THEME_PRESETS[t?.preset] || THEME_PRESETS.moss).label;
function saveTheme(t) {
  DB.settings = DB.settings || {};
  DB.settings.theme = t;
  try { localStorage.setItem(LS_THEME, JSON.stringify(t)); } catch { /* 隐私模式忽略 */ }
  saveDB(); applyTheme(t);
}

/* ---------------- 会话与数据（本地 + 云端） ---------------- */
/* 游客：数据存本机 localStorage；登录后：数据存云端，本地仅作离线缓存 */
const LS_GUEST = 'ebr_dm_guest';
const lsUser = tag => `ebr_dm_u_${tag}`;

let DB = null;
const slotKey = () => (isSignedIn() ? lsUser(userTag() || 'tmp') : LS_GUEST);

const blankDB = () => ({
  collection: {},             // cardId -> 拥有张数（{} = 全部拥有，按需勾选）
  ownAll: true,               // 默认视为全收藏
  customs: [],                // 自定义卡
  overrides: {},              // cardId -> 字段覆盖
  decks: [],                  // 行者构筑
  makerCards: [],             // 卡牌自制（角色卡/行者卡/空白卡）
  proof: {},                  // 校对记录：cardId -> { status, note, by, at }
  proofConflicts: {},         // 待审阅区：cardId -> { local:{...}, cloud:{...}, at, seen }
  proofResolved: {},          // 已裁定过：cardId -> 当时云端那条的内容快照（云端没变就不再重复提示）
  settings: {},
  /* 奖励卡查看开关：默认关闭（on:false），开启后还要点选具体扩展才会显示 */
  rewardView: { on: false, sets: [] },
});

/* ---- 奖励卡查看开关（v27）---- */
function rewardView() {
  const d = (DB && DB.rewardView) || {};
  const sets = Array.isArray(d.sets) ? d.sets.filter(k => REWARD_SET_LABEL[k]) : [];
  return { on: !!d.on, sets };
}
function saveRewardView(on, sets) {
  if (!DB) return;
  DB.rewardView = { on: !!on, sets: [...new Set(sets || [])].filter(k => REWARD_SET_LABEL[k]) };
  saveDB();
}
/* 单张奖励卡当前是否可见：非奖励卡恒可见；自己新建的自定义卡不受隐藏影响 */
function rewardShown(c) {
  if (!c || c.group !== 'reward') return true;
  if (c.custom) return true;
  const rv = rewardView();
  return rv.on && rv.sets.includes(c.set || 'base');
}
/* 每个扩展的奖励卡张数（用于按钮角标；自定义卡单算，恒可见） */
function rewardCounts() {
  const out = {}; REWARD_SETS.forEach(s => (out[s.key] = 0));
  allCards().forEach(c => {
    if (c.group !== 'reward' || c.custom) return;
    const k = REWARD_SET_LABEL[c.set || 'base'] ? (c.set || 'base') : 'base';
    out[k] = (out[k] || 0) + 1;
  });
  return out;
}

function slotDB() {
  try { return { ...blankDB(), ...(JSON.parse(localStorage.getItem(slotKey())) || {}) }; }
  catch { return blankDB(); }
}
/* 内容指纹：saveDB 有 40+ 个调用点，其中大量只是切换视图 / 展开面板，内容其实没变。
   以前每次都整份写盘 + 触发一次全量云上行，白烧额度。
   现在先比对序列化结果，没变就直接返回；切账号后 slotKey 变化，指纹自动失效。 */
let _lastSaveSig = null;
let _lastSaveSlot = null;
function saveDB() {
  if (!DB) return;
  const k = slotKey();
  const json = JSON.stringify(DB);
  if (k === _lastSaveSlot && json === _lastSaveSig) return;
  _lastSaveSlot = k; _lastSaveSig = json;
  localStorage.setItem(k, json);
  if (cloudSessionOk()) { cloudPushSoon(DB); renderSyncBadge(); }
}

/* ---- 顶部账号区 / 侧栏 / 同步状态 ---- */
const ROUTE_META = [
  { key: 'cards',    icon: '🃏', label: '卡牌列表', need: 'guest' },
  { key: 'search',   icon: '🔎', label: '卡表检索', need: 'guest' },
  { key: 'builder',  icon: '🧙', label: '角色创建', need: 'user'  },
  { key: 'proof',    icon: '🔍', label: '数据校对', need: 'user'  },
  { key: 'maker',    icon: '🎨', label: '卡牌自制', need: 'user'  },
  { key: 'export',   icon: '📦', label: '导出',     need: 'user'  },
  /* v26：个人中心 / 后台管理已移出卡牌管理系统，各自成为独立系统
     （个人中心由右上角 / 左上角的人头进入，后台管理为顶栏第四个系统）。
     standalone: true 只表示「不出现在卡牌系统的侧栏」，路由本身照常可用（暂时保留）。 */
  { key: 'account',  icon: '👤', label: '个人中心', need: 'user',  standalone: true },
  { key: 'dashboard',icon: '📊', label: '数据看板', need: 'admin' },
  { key: 'editor',   icon: '✏️', label: '表单编辑', need: 'admin' },
  { key: 'merge',    icon: '🧩', label: '卡牌整合', need: 'admin' },
  { key: 'admin',    icon: '🛠️', label: '后台管理', need: 'admin', standalone: true },
];
/* 注意：战役管理系统不再占用侧栏入口（已从卡牌系统里移除），
   只在顶部「系统切换」中作为并列子系统出现（见 FEATURE_GROUPS）。 */
const ROLE_LEVEL = { guest: 0, user: 1, beta: 2, admin: 3 };
const ROLE_NAME  = { guest: '游客', user: '普通用户', beta: '内测账号', admin: '后台管理员' };

/* 站点功能开关默认值（云端 site_features 有记录时以其为准，管理员可在后台开关 / 调整最低可见角色） */
const FEATURE_DEFS = {
  /* —— 母选项（分组总开关）：关闭后其下所有子项一律不可用 —— */
  cardsys:   { label: '卡牌管理系统', enabled: true,  min: 'guest' },
  campaign:  { label: '战役管理系统', enabled: true,  min: 'guest' },  // 已开放（2026-10-26 起全站可用）
  textsys:   { label: '文本查询系统', enabled: true,  min: 'guest' },  // 规则书/战役书/相关数据，全站可查
  music:     { label: '原声音乐',     enabled: true,  min: 'user'  },  // v34：官方 OST 播放器，登录后可用
  /* —— 卡牌管理系统子项 —— */
  cards:     { label: '卡牌列表', enabled: true,  min: 'guest' },
  search:    { label: '卡表检索', enabled: true,  min: 'guest' },
  builder:   { label: '角色创建', enabled: true,  min: 'user'  },
  proof:     { label: '数据校对', enabled: true,  min: 'user'  },
  maker:     { label: '卡牌自制', enabled: true,  min: 'user'  },   // v45 开放：14 种空白模板（四色行者牌/路径牌/瞬间/任务…）
  export:    { label: '导出',     enabled: true,  min: 'user'  },
  dashboard: { label: '数据看板', enabled: true,  min: 'admin' },
  editor:    { label: '表单编辑', enabled: true,  min: 'admin' },
  merge:     { label: '卡牌整合', enabled: true,  min: 'admin' },
  deckrules: { label: '组卡限制联动', enabled: true,  min: 'guest' },  // 不占侧栏，属于卡牌系统
  /* —— 独立项（不属于任何母选项） —— */
  account:   { label: '个人中心', enabled: true,  min: 'user'  },
  admin:     { label: '后台管理', enabled: true,  min: 'admin' },
  /* —— 战役管理系统子项（各组件可单独开关 / 单独设定权限） —— */
  'camp.head':      { label: '抬头与今日状态', enabled: true, min: 'guest' },
  'camp.calendar':  { label: '30 天日历',      enabled: true, min: 'guest' },
  'camp.rangers':   { label: '行者与当前位置', enabled: true, min: 'guest' },
  'camp.challenges':{ label: '挑战抽牌器',     enabled: true, min: 'guest' },
  'camp.map':       { label: '交互地图',       enabled: true, min: 'guest' },
  'camp.missions':  { label: '任务进度',       enabled: true, min: 'guest' },
  'camp.rewards':   { label: '奖励',           enabled: true, min: 'guest' },
  'camp.events':    { label: '重要事件',       enabled: true, min: 'guest' },
  'camp.saves':     { label: '战役与存档',     enabled: true, min: 'guest' },
  'camp.weather':   { label: '恶劣天气加码',   enabled: true, min: 'guest' },
  'camp.decks':     { label: '玩家牌组栏',     enabled: true, min: 'guest' },   // 联动卡牌管理系统
  /* —— 文本查询系统子项 —— */
  'textsys.metaedit': { label: '书籍信息编辑与推送', enabled: true, min: 'admin' },
  /* —— v40：村村通宝典（顶置栏）—— 查看与编辑拆成两个独立权限 —— */
  'textsys.cun.view': { label: '村村通宝典 · 查看', enabled: true, min: 'guest' },
  'textsys.cun.edit': { label: '村村通宝典 · 编辑', enabled: true, min: 'admin' },
  /* —— v35：原声音乐子项 —— */
  'music.guard': { label: '音源保护（防盗链）', enabled: true, min: 'guest' },
};
/* ── v33：文本查询系统 · 卡牌图集分项权限 ──
   每一种卡牌图集 = 一个独立权限项（后台「卡牌图集权限」可单独设最低可见角色，
   默认游客可见）。id 必须与 data-books.js 里卡牌册的 id 一致（src === 'cards'）。 */
const CARD_BOOK_DEFS = [
  { id: 'task',   icon: '🎯', label: '任务牌' },
  { id: 'loc',    icon: '📍', label: '地点牌' },
  { id: 'path',   icon: '🛤️', label: '路径牌（道路牌组）' },
  { id: 'enc',    icon: '⚔️', label: '遭遇牌（挑战牌）' },
  { id: 'weather',icon: '⛈️', label: '天气牌' },
  { id: 'reward', icon: '🎁', label: '奖励牌' },
  { id: 'attr',   icon: '🎴', label: '属性牌' },
  { id: 'bg',     icon: '🏘️', label: '背景牌' },
  { id: 'pers',   icon: '🎭', label: '性格牌' },
  { id: 'spec',   icon: '⭐', label: '专长牌' },
  { id: 'injury', icon: '🩹', label: '伤病牌' },
  { id: 'ambit',  icon: '📜', label: '志向剧情牌' },
  { id: 'mini',   icon: '🧒', label: '迷你行者角色牌' },
  { id: 'moment', icon: '🌄', label: '瞬间牌（旅途时分）' },
  { id: 'hint',   icon: '🔄', label: '轮次与检定提示牌' },
];
const CARD_PERM_KEY = id => 'textsys.card.' + id;
for (const c of CARD_BOOK_DEFS) {
  FEATURE_DEFS[CARD_PERM_KEY(c.id)] = { label: c.label, enabled: true, min: 'guest' };
}
const FEATURE_LOCKED = new Set(['admin', 'account']);   // 后台 / 个人中心必须可达，不允许关闭
/* 功能分组树：后台「功能开关」与「单账号权限」都按这棵树展示；
   母选项（cardsys / campaign）既是分组标题，也是总开关 —— 关掉后子项全部不可用。 */
const FEATURE_GROUPS = [
  { key: 'cardsys', icon: '🃏', children: [
    'cards', 'search', 'builder', 'proof', 'maker', 'export',
    'dashboard', 'editor', 'merge', 'deckrules'] },
  { key: 'account', icon: '👤', children: [] },
  { key: 'admin',   icon: '🛠️', children: [] },
  { key: 'campaign', icon: '🗺️', children: [
    'camp.head', 'camp.calendar', 'camp.saves', 'camp.weather',
    'camp.rangers', 'camp.challenges', 'camp.map',
    'camp.missions', 'camp.rewards', 'camp.events', 'camp.decks'] },
  { key: 'textsys', icon: '📖', children: [
    'textsys.cun.view', 'textsys.cun.edit',
    'textsys.metaedit', ...CARD_BOOK_DEFS.map(c => CARD_PERM_KEY(c.id))] },
  { key: 'music', icon: '🎵', children: ['music.guard'] },
];
const CHILD_ICON = {
  'camp.head': '📌', 'camp.calendar': '📅', 'camp.saves': '💾', 'camp.weather': '⛈️',
  'camp.rangers': '🧑‍🤝‍🧑', 'camp.challenges': '🎴', 'camp.map': '🗺️',
  'camp.missions': '🎯', 'camp.rewards': '🎁', 'camp.events': '❗', 'camp.decks': '🎒',
};
for (const c of CARD_BOOK_DEFS) CHILD_ICON[CARD_PERM_KEY(c.id)] = c.icon;
CHILD_ICON['textsys.cun.view'] = '👁️';
CHILD_ICON['textsys.cun.edit'] = '✍️';
const PARENT_OF = {};                        // 子项 -> 母选项
for (const g of FEATURE_GROUPS) for (const c of g.children) PARENT_OF[c] = g.key;
/* 展示用扁平列表：{ key, icon, label, parent, depth } */
const FEATURE_ROWS = FEATURE_GROUPS.flatMap(g => [
  { key: g.key, icon: g.icon, label: FEATURE_DEFS[g.key]?.label || g.key, parent: null, depth: 0 },
  ...g.children.map(c => ({
    key: c, icon: CHILD_ICON[c] || (ROUTE_META.find(m => m.key === c)?.icon || '・'),
    label: FEATURE_DEFS[c]?.label || c, parent: g.key, depth: 1,
  })),
]);
const FEATURE_HINT = {
  cardsys: '🃏 母选项：卡牌系统的总开关，关闭后下列所有卡牌相关模块一律不可用（子项自身设置保留）',
  cards: '浏览全部卡牌图与数据', search: '按名称 / 牌组 / 属性检索',
  builder: '构筑向导与 30 张规则校验', proof: '逐张核对卡面数据并记录疑问',
  maker: '自制角色卡 / 行者卡 / 空白卡（内测中）', export: '导出卡组 JSON / 文本 / TTS',
  account: '个人中心、云端同步与配色', dashboard: '站点数据统计',
  editor: '增改卡牌字段（生成覆盖）', merge: '官方数据与自定义数据整合',
  admin: '后台管理（不可关闭）',
  campaign: '🗺️ 母选项：战役记录器的总开关（未上线）—— 关闭后整个战役系统不可用，下列组件可再单独开关',
  textsys: '📖 规则书 / 战役书 / 相关数据的存档与全书检索（后续地图卡、任务卡查询也挂在这里）',
  'textsys.metaedit': '✎ 允许管理员在文本查询系统里直接改书名与类别标签（Tag），保存后立即推送给所有用户；关闭后任何人都不显示编辑入口',
  'textsys.cun.view': '👁️ 文本查询系统顶部的「村村通宝典」顶置栏：关闭后任何人都看不到这一栏（内容保留，只是不显示）',
  'textsys.cun.edit': '✍️ 允许以 Word 式富文本编辑器改写「村村通宝典」的正文（加粗 / 标题 / 列表 / 对齐 / 插入符号等），保存后推送给所有有查看权限的人；注意：编辑权限以「查看权限」为前提，两者都开着才能改',
  'music.guard': '🔒 音源保护：①音源文件名随机化，无法按序号批量拉取；②必须先登录才加载音频；③音频由脚本取回转成内存临时地址播放，页面里不会出现可复制的 mp3 直链；④页面带域名 + 账号专属 ID + 时间的水印，录屏也会留下来源；⑤禁右键 / 拖拽 / 另存为。关闭后退回直链播放（排障用）',
  music: '🎵 官方原声带播放器（68 首，含立体声 / 双耳混音两组）。开启后顶栏出现「原声音乐」；默认登录用户可听，管理员可改成游客可见',
  deckrules: '组卡时按《规则手册》实时联动限制可选牌（属性需求 / 每种 2 张 / 牌组锁定 / 爱好去重等），并给出逐条校验清单',
  'camp.head': '强制置顶的抬头：第几天 / 今日天气 / 结束今天·回退一天 / 弹窗提醒',
  'camp.calendar': '30 天日历、手册条目编号（3 格）与天气图例',
  'camp.saves': '战役切换（引入山谷 / 先祖遗产）、三存档槽、导出 / 导入 / 清空存档',
  'camp.weather': '「恶劣天气加码」开关（天气整体加码一级）',
  'camp.rangers': '行者名单与当前位置（地点 / 地形）',
  'camp.challenges': '挑战牌堆抽牌器（山 / 战 / 阳三类、四属性调整、重洗）',
  'camp.map': '交互式地图：点击选点、拖动平移、路径地形笔刷',
  'camp.missions': '任务面板（日期 / 名称 / 3 格 ◆ 进度 / 备注）',
  'camp.rewards': '奖励面板（36 栏、含牌面缩略图）',
  'camp.events': '重要事件记录',
};

/* v33：卡牌图集每种卡牌的说明（张数 + 收录范围） */
for (const c of CARD_BOOK_DEFS) {
  const _b = (window.BOOKS || (typeof BOOKS !== 'undefined' ? BOOKS : [])).find(x => x.id === c.id);
  FEATURE_HINT[CARD_PERM_KEY(c.id)] =
    `卡牌图集：${_b ? (_b.count || (_b.pages || []).length) : 0} 张${_b && _b.note ? ' · ' + _b.note : ''}`;
}

/* 功能开关状态：云端优先，缺失时用默认值；再叠加「单账号权限覆盖」 */
function featureState(key) {
  const d = FEATURE_DEFS[key] || { enabled: true, min: 'user' };
  const f = (typeof featureOf === 'function') ? featureOf(key) : null;
  const ov = (typeof overrideOf === 'function') ? overrideOf(key) : null;   // true 放行 / false 拒绝 / null 继承
  return {
    label: d.label,
    /* 云端没有下发开关时用默认值。注意：不要因为"离线版没人能开开关"就把
       enabled 一律改成 true —— 战役系统默认关闭是产品决定（内测未上线），
       该由作者自己放，不该被部署形态偷偷打开。 */
    enabled: FEATURE_LOCKED.has(key) ? true : (f ? f.enabled !== false : d.enabled),
    min: f?.min_role || d.min,
    fromCloud: !!f,
    override: ov,                       // 单账号覆盖值
    byOverride: ov !== null,            // 该账号是否被单独设定过
  };
}
/* 单项自身是否可用（不看母选项） */
function featureSelfOn(key) {
  const f = featureState(key);
  if (!f.enabled) return false;
  if (f.override === false) return false;
  if (f.override === true) return true;
  return ROLE_LEVEL[userRole()] >= (ROLE_LEVEL[f.min] || 0);
}
/* 功能是否可用（含母选项联动：母选项关闭 → 子项一律不可用） */
const featureOn = key => {
  const p = PARENT_OF[key];
  return featureSelfOn(key) && (!p || featureSelfOn(p));
};
/* v33：某类卡牌图集是否对当前用户可见（供 text-app.js 侧栏 / 检索调用）。
   未登记权限项的新卡册默认可见，避免管理员漏配就整类消失。 */
function textCardVisible(id) {
  const key = CARD_PERM_KEY(id);
  if (!FEATURE_DEFS[key]) return true;
  /* 只看这一类自己的设置（含「单账号单独放行 / 拒绝」）：
     母选项 textsys 管的是「能不能进文本查询系统」，进来之后就按各类卡牌自己的权限走 */
  return featureSelfOn(key);
}
const canSee = key => {
  const m = ROUTE_META.find(x => x.key === key);
  if (!m) return false;
  if (!featureOn(key)) return false;                               // 含母选项联动
  const f = featureState(key);
  if (f.override === true) return true;                            // 该账号被单独放行：忽略最低权限
  const need = Math.max(ROLE_LEVEL[m.need] || 0, ROLE_LEVEL[f.min] || 0);
  return ROLE_LEVEL[userRole()] >= need;
};
/* 战役管理系统：不再走侧栏路由，只看功能开关（母选项）
   v41：本机预览（?preview=admin，仅 localhost 生效）时放行，方便未登录先看效果 */
const campaignAllowed = () => {
  if (featureOn('campaign')) return true;
  try { return localPreviewAdmin(); } catch (e) { return false; }
};
/* 文本查询系统：规则书 / 战役书 / 相关数据，管理员可用 */
const textsysAllowed = () => featureOn('textsys');
/* v34：原声音乐系统 —— 官方 OST 播放器，默认登录用户可用 */
const musicAllowed = () => featureOn('music');

function renderSidenav() {
  const nav = $('#sidenav');
  /* v26：个人中心 / 后台管理不再出现在卡牌系统的侧栏（已独立成系统） */
  nav.innerHTML = ROUTE_META.filter(m => !m.standalone && canSee(m.key)).map(m =>
    `<a href="#${m.key}" data-route="${m.key}">${m.icon} ${m.label}</a>`).join('')
    + `<div class="sidenav-foot">按《规则手册》P32–33<br>构筑规则校验<br><br>${
        OFFLINE_MODE ? '离线版 · 数据存本机'
        : isSignedIn() ? '已登录 · 数据存云端' : '游客模式 · 数据存本机'}</div>`;
  renderSysSwitch();
}

/* ---------- 子系统切换：卡牌 / 战役 / 文本查询 / 后台管理（+ 个人中心，由头像进入） ---------- */
const SYS = { cur: 'cards', campBooted: false, textBooted: false, musicBooted: false };
const SYS_META = {
  cards: { name: '卡牌管理系统', tip: '卡牌浏览 / 构筑 / 检索 / 导出' },
  campaign: {
    name: '战役管理系统',
    tip: ok => ok ? '战役记录器：日历 / 地图 / 挑战 / 任务 / 奖励'
                : '战役管理系统：尚未开放（管理员可在「后台管理 → 功能开关」中开启）',
  },
  text: {
    name: '文本查询系统',
    tip: ok => ok ? '规则书 / 战役书 / 相关数据 · 全书检索'
                : '文本查询系统：尚未开放（管理员可在「后台管理 → 功能开关」中开启）',
  },
  /* v34：原声音乐系统 —— 官方 OST 播放器 */
  music: {
    name: '原声音乐',
    tip: ok => ok ? '官方原声带 · 68 首 · 跨系统后台播放'
                : '原声音乐：尚未开放（管理员可在「后台管理 → 功能开关」中开启；默认登录后可听）',
  },
  /* v26：后台管理系统 —— 与前三个系统并列，仅管理员可用 */
  admin: {
    name: '后台管理系统',
    tip: ok => ok ? '账号管理 / 功能开关 / 邀请码 / 登录记录 / 站点数据'
                : '后台管理系统：仅后台管理员可用',
  },
  /* 个人中心：不是顶栏标签，由右上角 / 左上角的人头进入 */
  me: { name: '个人中心', tip: ok => ok ? '显示名称 / 专属 ID / 配色 / 云端同步 / 备份'
                                       : '个人中心：登录后可用' },
};

function renderSysSwitch() {
  const box = $('#sys-switch');
  if (!box) return;
  const okCamp = campaignAllowed();
  const okText = textsysAllowed();
  const okMusic = musicAllowed();
  const okAdmin = canSee('admin');
  const okMe = canSee('account');
  $$('#sys-switch .sys-tab').forEach(b => {
    const s = b.dataset.sys;
    const ok = s === 'campaign' ? okCamp : s === 'text' ? okText : s === 'music' ? okMusic
             : s === 'admin' ? okAdmin : true;
    b.classList.toggle('active', SYS.cur === s);
    b.classList.toggle('locked', !ok);
    const meta = SYS_META[s];
    b.title = (OFFLINE_MODE && s === 'text')
      ? '文本查询系统：全书文字检索、卡牌图集可用；规则书原页扫描图（约 2.4GB）未随离线包发布'
      : meta ? (typeof meta.tip === 'function' ? meta.tip(ok) : meta.tip) : '';
  });
  /* 个人中心：顶栏左右两侧的人头按钮，位于该系统时高亮；未登录时隐藏 */
  const meBtns = $$('#btn-me, #btn-me-l');
  meBtns.forEach(b => {
    b.classList.toggle('active', SYS.cur === 'me');
    b.classList.toggle('hidden', !isSignedIn());
    b.title = okMe ? '个人中心：显示名称 / 专属 ID / 配色 / 云端同步 / 备份' : '个人中心（登录后可用）';
  });
  applyCampGates();     // 战役各组件的开关随权限变化实时刷新
}

/* 战役各组件的开关 → #camp-root 上的 CSS 类（类名固定，重渲染后依然生效） */
const CAMP_CSS_KEY = {
  'camp.head': 'head', 'camp.calendar': 'calendar', 'camp.saves': 'saves',
  'camp.weather': 'weather', 'camp.rangers': 'rangers', 'camp.challenges': 'challenges',
  'camp.map': 'map', 'camp.missions': 'missions', 'camp.rewards': 'rewards',
  'camp.events': 'events', 'camp.decks': 'decks',
};
function applyCampGates() {
  const root = $('#camp-root');
  if (!root) return;
  let any = false;
  /* v41：本机预览（?preview=admin）时把所有组件当已开启，方便未登录先看效果 */
  let preview = false;
  try { preview = localPreviewAdmin(); } catch (e) { preview = false; }
  for (const [key, short] of Object.entries(CAMP_CSS_KEY)) {
    const on = preview || featureOn(key);
    root.classList.toggle(`camp-off-${short}`, !on);
    if (on) any = true;
  }
  root.classList.toggle('camp-alloff', !any);
  const note = $('#camp-off-note');
  if (note) note.hidden = !((preview || featureSelfOn('campaign')) && !any);
}

/* ---------- 规则书 / 战役书文本（data/data-books.js，1.1MB）的按需加载 ----------
   默认随包静态引用；离线版打包时会被改成懒加载（写入 window.__BOOKS_LAZY__），
   只有真正进入「文本查询系统」时才去取，首屏不再为它付流量。 */
let _booksPromise = null;
function ensureBooks() {
  if (window.BOOKS && window.BOOKS.length) return Promise.resolve(window.BOOKS);
  if (_booksPromise) return _booksPromise;
  const src = window.__BOOKS_LAZY__;
  /* 没给懒加载路径（线上静态版）：数据本就该在，返回现有值让页面自行降级 */
  if (!src) return Promise.resolve(window.BOOKS || []);
  _booksPromise = new Promise(resolve => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve(window.BOOKS || []);
    s.onerror = () => { console.warn('[books] 加载失败，文本查询系统将显示为空：' + src); resolve([]); };
    document.head.appendChild(s);
  });
  return _booksPromise;
}

function setSys(s) {
  /* v26：cards / campaign / text / admin 为顶栏四个并列系统；me（个人中心）由头像进入 */
  SYS.cur = ['campaign', 'text', 'music', 'admin', 'me'].includes(s) ? s : 'cards';
  const main = $('#main');
  if (main) {
    main.classList.toggle('sys-campaign', SYS.cur === 'campaign');
    main.classList.toggle('sys-text', SYS.cur === 'text');
    main.classList.toggle('sys-music', SYS.cur === 'music');
    main.classList.toggle('sys-admin', SYS.cur === 'admin');
    main.classList.toggle('sys-me', SYS.cur === 'me');
  }
  if (SYS.cur === 'campaign' && !SYS.campBooted && window.CampaignApp) {
    SYS.campBooted = true;
    try { window.CampaignApp.boot(); }
    catch (e) { console.warn('战役模块启动失败', e); toast('战役模块启动失败，请刷新重试', 3600); }
    // v20：战役面板刚显示，按实际容器尺寸重算地图（默认缩放＝整图完整显示）
    if (window.CampaignApp.relayout) requestAnimationFrame(() => window.CampaignApp.relayout());
  }
  if (SYS.cur === 'text' && !SYS.textBooted && window.TextApp) {
    SYS.textBooted = true;
    /* 离线版的书本数据是懒加载：等 load 完再 boot，否则书架是空的。
       弱网下这 1.1MB 要几秒，先给个提示，别让人对着空白页等。 */
    if (!(window.BOOKS && window.BOOKS.length)) {
      toast('正在加载规则书文本（约 1.1MB，首次进入需几秒）…', 3200);
    }
    ensureBooks().then(() => {
      try { window.TextApp.boot(); }
      catch (e) { console.warn('文本查询模块启动失败', e); toast('文本查询模块启动失败，请刷新重试', 3600); }
    });
  }
  if (SYS.cur === 'music' && !SYS.musicBooted && window.MusicApp) {
    SYS.musicBooted = true;
    try { window.MusicApp.boot(); }
    catch (e) { console.warn('原声音乐模块启动失败', e); toast('原声音乐模块启动失败，请刷新重试', 3600); }
  }
  applyCampGates();
  renderSysSwitch();
  const sc = SYS.cur === 'campaign' ? $('#camp-root')
    : SYS.cur === 'text' ? $('#text-root')
    : SYS.cur === 'music' ? $('#music-root') : $('#view');
  if (sc) sc.scrollTop = 0;
  barsReset();               // v25：切系统后顶部两栏恢复显示、重新计基准
}

/* 跳转：hash 已相同时也要重跑一次 renderRoute（否则点当前系统不会有任何反应） */
function gotoHash(h) {
  if (location.hash === h) renderRoute(); else location.hash = h;
}

/* ---------- v25：下滑自动隐藏顶部两栏（站点顶栏 + 战役抬头），上滑 / 鼠标移到顶部再显现 ---------- */
const BAR_SHOW_BELOW = 80;    // 滚动距离小于此值时始终显示
const BAR_STEP = 6;           // 判定滚动方向的最小位移
let barLastY = 0, barHidden = false, barHoverHold = false, barRaf = 0;

function activeScroller() {
  const camp = $('#camp-root'), txt = $('#text-root');
  if (camp && getComputedStyle(camp).display !== 'none') return camp;
  if (txt && getComputedStyle(txt).display !== 'none') return txt;
  return $('#view') || document.scrollingElement;
}
function setBarsHidden(h) {
  if (h === barHidden) return;
  barHidden = h;
  document.body.classList.toggle('bars-hidden', h);
}
function barsReset() {
  barHoverHold = false;
  setBarsHidden(false);
  const el = activeScroller();
  barLastY = el ? el.scrollTop : 0;
}
function onBarScroll() {
  if (barRaf) return;
  barRaf = requestAnimationFrame(() => {
    barRaf = 0;
    const el = activeScroller();
    const y = el ? el.scrollTop : window.scrollY;
    const dy = y - barLastY;
    barLastY = y;
    if (y <= BAR_SHOW_BELOW) { setBarsHidden(false); return; }
    if (barHoverHold) return;                 // 鼠标正停在顶部：不自动隐藏
    if (dy > BAR_STEP) setBarsHidden(true);   // 下滑 → 逐渐收起
    else if (dy < -BAR_STEP) setBarsHidden(false); // 上滑 → 显现
  });
}
function initAutoHideBars() {
  ['#view', '#camp-root', '#text-root'].forEach(s => {
    const el = $(s);
    if (el) el.addEventListener('scroll', onBarScroll, { passive: true });
  });
  window.addEventListener('scroll', onBarScroll, { passive: true });
  /* 鼠标移到屏幕最上方 → 立即显现；离开顶部区域后恢复自动隐藏 */
  window.addEventListener('mousemove', e => {
    if (e.clientY <= 46) { barHoverHold = true; setBarsHidden(false); }
    else if (barHoverHold && e.clientY > 130) barHoverHold = false;
  }, { passive: true });
  /* 悬停在顶栏 / 战役抬头本身时也保持显示 */
  ['.topbar', '#camp-root .camp-head'].forEach(s => {
    const el = document.querySelector(s);
    if (!el) return;
    el.addEventListener('mouseenter', () => { barHoverHold = true; setBarsHidden(false); });
    el.addEventListener('mouseleave', () => { barHoverHold = false; });
  });
  barsReset();
}

/* 战役管理系统未开放时的说明页 */
function campaignBlockedPage() {
  const v = $('#view');
  const f = featureState('campaign');
  v.innerHTML = `<h2 class="page-title">功能未开放</h2>
    <p class="page-sub">「战役管理系统」目前尚未上线，仅后台管理员可用。</p>
    <div class="panel">
      <p class="muted small">战役记录器（30 天日历、交互式地图、挑战抽牌、任务 / 奖励 / 重要事件记录）
        正在内测中，暂不对全站开放。${!f.enabled
          ? '管理员可在「后台管理 → 功能开关」中开启后使用。'
          : `该功能最低需要「${ROLE_NAME[f.min] || f.min}」权限。`}</p>
      <div style="margin-top:12px"><a class="btn" href="#cards">返回卡牌列表</a></div>
    </div>`;
  $$('.sidenav a').forEach(a => a.classList.remove('active'));
}

/* 文本查询系统未开放时的说明页 */
function textBlockedPage() {
  const v = $('#view');
  const f = featureState('textsys');
  v.innerHTML = `<h2 class="page-title">功能未开放</h2>
    <p class="page-sub">「文本查询系统」目前仅后台管理员可用。</p>
    <div class="panel">
      <p class="muted small">规则手册 / 战役书 / 相关数据的存档与全文检索正在整理中，暂不对全站开放。${!f.enabled
        ? '管理员可在「后台管理 → 功能开关」中开启后使用。'
        : `该功能最低需要「${ROLE_NAME[f.min] || f.min}」权限。`}</p>
      <div style="margin-top:12px"><a class="btn" href="#cards">返回卡牌列表</a></div>
    </div>`;
  $$('.sidenav a').forEach(a => a.classList.remove('active'));
}

/* v34：原声音乐系统无权限时的说明页 */
function musicBlockedPage() {
  const v = $('#view');
  const f = featureState('music');
  const why = !f.enabled
    ? '该功能当前未开放（管理员可在「后台管理 → 功能开关」中开启）。'
    : !isSignedIn()
      ? '原声音乐需要登录账号后收听。'
      : `该功能最低需要「${ROLE_NAME[f.min] || f.min}」权限，你当前为「${ROLE_NAME[userRole()] || userRole()}」。`;
  v.innerHTML = `<h2 class="page-title">功能未开放</h2>
    <p class="page-sub">「原声音乐」目前不可使用。</p>
    <div class="panel">
      <p class="muted small">官方原声带（Tom Figgins《Earthborne Rangers Original Soundtrack》68 首）播放器。${esc(why)}</p>
      <div style="margin-top:12px"><a class="btn" href="#cards">返回卡牌列表</a></div>
    </div>`;
  $$('.sidenav a').forEach(a => a.classList.remove('active'));
}

/* v26：独立子系统（后台管理 / 个人中心）无权限时的说明页 */
function standaloneBlockedPage(key) {
  const meta = ROUTE_META.find(x => x.key === key) || { icon: '🔒', label: key };
  const f = featureState(key);
  const v = $('#view');
  const how = key === 'admin'
    ? '后台管理系统是顶栏第四个独立系统，仅后台管理员可用。'
    : '登录账号后，点击顶栏的人头图标 👤 即可进入个人中心。';
  v.innerHTML = `<h2 class="page-title">功能未开放</h2>
    <p class="page-sub">「${esc(meta.label)}」为独立子系统，${key === 'admin' ? '仅后台管理员可用' : '需要登录账号'}。</p>
    <div class="panel">
      <p class="muted small">${esc(how)}${isSignedIn()
        ? `　该功能最低需要「${esc(ROLE_NAME[f.min] || f.min)}」权限，你当前为「${esc(ROLE_NAME[userRole()] || userRole())}」。`
        : ''}</p>
      <div style="margin-top:12px"><a class="btn" href="#cards">返回卡牌列表</a></div>
    </div>`;
  $$('.sidenav a').forEach(a => a.classList.remove('active'));
}

function renderTopRight() {
  const chip = $('#current-profile');
  const btnAcc = $('#btn-account'), btnMe = $('#btn-me');
  const st = sessionState();
  if (isSignedIn()) {
    const shown = userDisplayName() || (userEmail() ? userEmail().split('@')[0] : '');
    const tag = st === 'restoring' ? '⏳ 会话恢复中'
      : (isAdmin() ? '🛠️ 管理员' : (userRole() === 'beta' ? '🧪 内测' : '👤'));
    chip.textContent = `${tag} ${shown || '已登录'}`;
    chip.title = [userPublicId(), userEmail()].filter(Boolean).join(' · ')
      + (st === 'restoring' ? '\n（云端会话尚未确认，部分在线功能暂不可用）' : '');
    btnAcc.textContent = '退出登录';
    btnAcc.classList.remove('hidden');
    btnMe.classList.remove('hidden');
  } else if (OFFLINE_MODE) {
    /* 离线版：没有服务端账号，挂一个点了必然失败的「登录 / 注册」只会让人困惑。
       改为明确告知数据存在本机，备份走「个人中心 → 导出备份」。 */
    chip.textContent = '📴 离线版 · 数据存本机';
    chip.title = '这一版没有服务端账号：收藏 / 构筑 / 校对都保存在当前浏览器里。\n换设备或清浏览器缓存会丢，请用「导出」把备份 JSON 存好。';
    btnAcc.classList.add('hidden');
    btnMe.classList.add('hidden');
  } else {
    chip.textContent = '👥 游客（未登录）';
    chip.title = '未登录：仅可浏览卡牌，数据存本机浏览器';
    btnAcc.textContent = '登录 / 注册';
    btnAcc.classList.remove('hidden');
    btnMe.classList.add('hidden');
  }
  renderSyncBadge();
  renderCloudBanner();
  renderSessionBar();
}

/* 会话只恢复了本机缓存（刷新后云端还没确认）时的提示 + 自愈入口 */
function renderSessionBar() {
  const b = $('#session-bar');
  if (!b) return;
  if (sessionState() !== 'restoring') { b.classList.add('hidden'); b.innerHTML = ''; return; }
  b.classList.remove('hidden');
  b.innerHTML = `<span>⚠ 登录状态<b>尚未与云端确认</b>：当前显示的是本机缓存的身份，
    云同步与在线功能暂不可用（专属 ID 等可能显示不全）。</span>
    <button class="btn btn-sm" id="sb-reconnect">重新连接</button>
    <button class="btn btn-sm" id="sb-signout">退出并重新登录</button>`;
  const rc = $('#sb-reconnect');
  if (rc) rc.onclick = async () => {
    rc.disabled = true; rc.textContent = '连接中…';
    const r = await cloudReconnect();
    toast(r.ok ? '已重新连接云端' : ('重连失败：' + r.msg), 3000);
    applyTheme(); renderTopRight(); renderSidenav(); renderRoute(); renderSessionBar();
  };
  const so = $('#sb-signout');
  if (so) so.onclick = () => { doSignOut(); };
}

/* 会话未确认时的后台自愈：冷却期过后静默再取一次，成功则自动补全界面 */
let _reconnectTimer = null;
function scheduleSilentReconnect(delay) {
  if (_reconnectTimer) clearTimeout(_reconnectTimer);
  _reconnectTimer = setTimeout(async () => {
    _reconnectTimer = null;
    if (!cloudOn() || sessionState() !== 'restoring') return;
    const r = await cloudReconnect().catch(() => ({ ok: false }));
    if (r.ok) { applyTheme(); renderTopRight(); renderSidenav(); renderSessionBar(); renderRoute(); }
  }, delay || 2500);
}

/* 云端不可达（如部署到第三方域名）时的降级提示 */
function renderCloudBanner() {
  const b = $('#cloud-banner');
  if (!b) return;
  if (CLOUD_DOWN) {
    b.classList.remove('hidden');
    b.innerHTML = '⚠ 当前域名与云端服务不匹配，已切换为<b>离线模式</b>：账号登录与云同步不可用，'
      + '卡牌浏览/构筑/导出均可正常使用，数据存本机，可在「个人中心」用备份 JSON 搬运。';
  } else b.classList.add('hidden');
}

const SYNC_TEXT = { off: '本地', syncing: '同步中…', synced: '已同步', error: '同步失败', dirty: '待同步' };
function renderSyncBadge() {
  const b = $('#sync-badge');
  if (!b) return;
  if (!isSignedIn()) { b.classList.add('hidden'); return; }
  b.classList.remove('hidden');
  b.textContent = `☁ ${SYNC_TEXT[SYNC_STATE] || SYNC_STATE}`;
  b.className = 'sync-badge ' + (SYNC_STATE === 'error' ? 'bad' : '');
}

/* ---------------- v30：站点版本与更新公告 ---------------- */
function renderVerChip() {
  const b = $('#ver-chip');
  if (!b) return;
  const v = (SITE_VERSION && SITE_VERSION.version) || SITE_VERSION_FALLBACK || '1.0';
  b.textContent = 'V' + v;
  b.classList.remove('hidden');
  b.title = `当前版本 ${v}\n点击查看详情${SITE_VERSION.title ? '：' + SITE_VERSION.title : ''}`;
  b.onclick = () => showReleaseModal(true);
}

const SEEN_VER_KEY = 'eb_seen_version';
/* 版本发生变化时自动弹一次公告（点顶栏版本号可随时重看）。
   注意：本机没有记录 = 第一次访问本站，不弹 —— 全新用户看到的本就是最新版，没有「更新」可言，
   也不会一进站就被弹窗挡住；只有老用户遇到新版本才会弹。 */
function maybeShowRelease() {
  const v = (SITE_VERSION && SITE_VERSION.version) || SITE_VERSION_FALLBACK || '1.0';
  if (!(SITE_VERSION.notes || '').trim()) return;                 // 没写公告就不打扰
  let seen = null;
  try { seen = localStorage.getItem(SEEN_VER_KEY); } catch (e) { return; }
  if (seen === null) {                                            // 首次访问：只记版本，不弹
    try { localStorage.setItem(SEEN_VER_KEY, v); } catch (e) {}
    return;
  }
  if (seen === v) return;
  showReleaseModal(false);
  try { localStorage.setItem(SEEN_VER_KEY, v); } catch (e) {}
}

function showReleaseModal(manual) {
  const box = $('#release-modal');
  if (!box) return;
  const v = (SITE_VERSION && SITE_VERSION.version) || SITE_VERSION_FALLBACK || '1.0';
  $('#rel-badge').textContent = 'V' + v;
  $('#rel-title').textContent = SITE_VERSION.title || '更新公告';
  const at = SITE_VERSION.published_at ? new Date(SITE_VERSION.published_at) : null;
  $('#rel-sub').textContent = at && !isNaN(at.getTime())
    ? `发布于 ${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
    : '版本号与公告由管理员在「后台管理 → 版本与公告」维护';
  $('#rel-body').innerHTML = (SITE_VERSION.notes || '')
    .split('\n').map(l => `<p>${esc(l) || '&nbsp;'}</p>`).join('') || '<p class="muted small">本次更新暂无说明。</p>';
  $('#rel-msg').textContent = manual ? '' : '本次为更新后首次进入，公告只弹一次。';
  box.classList.remove('hidden');
  const close = () => box.classList.add('hidden');
  $('#rel-close').onclick = close;
  $('#rel-ok').onclick = close;
  box.onclick = e => { if (e.target === box) close(); };
}

/* ---------------- v30：后台「版本与公告」面板 ---------------- */
async function renderVersionPanel(v) {
  const box = v.querySelector('#adm-version');
  if (!box) return;
  const cur = SITE_VERSION || {};
  const at = cur.published_at ? new Date(cur.published_at) : null;
  const atStr = at && !isNaN(at.getTime())
    ? `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
    : '—';
  const rel = await cloudLoadReleases(20);
  const rows = rel.data || [];

  box.innerHTML = `
    <h3 style="margin-bottom:8px">版本与公告</h3>
    <p class="small muted" style="margin-bottom:10px">
      版本号与更新公告保存在云端：发布后所有用户下次打开站点即可看到（顶栏显示版本号，
      <b>新版本首次进入会自动弹一次公告</b>，之后可点顶栏版本号随时重看）。发布同时会记入下方历史。
    </p>
    <div class="ver-now">
      <span class="ver-big">V${esc(cur.version || SITE_VERSION_FALLBACK)}</span>
      <div class="ver-meta">
        <div class="ver-title">${esc(cur.title || '（未填标题）')}</div>
        <div class="small muted">发布时间：${esc(atStr)}</div>
      </div>
    </div>
    <div class="ver-form">
      <label class="field">
        <span class="field-label">版本号</span>
        <input id="vr-ver" class="input" type="text" maxlength="20" placeholder="如 1.1 / 1.0.1" value="${esc(cur.version || '')}">
      </label>
      <label class="field">
        <span class="field-label">公告标题</span>
        <input id="vr-title" class="input" type="text" maxlength="40" placeholder="如「1.1 更新：新增 XX」" value="${esc(cur.title || '')}">
      </label>
      <label class="field">
        <span class="field-label">更新公告正文（换行分段）</span>
        <textarea id="vr-notes" class="input" rows="6" placeholder="写下这次更新了什么…">${esc(cur.notes || '')}</textarea>
      </label>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button class="btn btn-primary" id="vr-publish">发布新版本</button>
        <button class="btn" id="vr-preview">预览</button>
        <span class="small muted" id="vr-msg"></span>
      </div>
    </div>
    <h4 class="ver-sub">历史公告（${rows.length}）</h4>
    <div class="ver-hist">${rows.length ? rows.map(r => {
      const d = r.published_at ? new Date(r.published_at) : null;
      const ds = d && !isNaN(d.getTime())
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
        : '—';
      return `<div class="ver-item" data-rid="${r.id}">
        <div class="ver-item-head">
          <span class="rel-badge sm">V${esc(r.version)}</span>
          <b>${esc(r.title || '（无标题）')}</b>
          <span class="small muted">${esc(ds)}</span>
          <span class="flex-spacer"></span>
          <button class="btn btn-sm" data-rfill="${r.id}">载入到表单</button>
        </div>
        <div class="ver-item-body small">${(r.notes || '').split('\n').map(l => `<p>${esc(l) || '&nbsp;'}</p>`).join('')}</div>
      </div>`;
    }).join('') : '<p class="small muted">还没有历史记录。</p>'}</div>`;

  const msg = box.querySelector('#vr-msg');
  box.querySelector('#vr-publish').onclick = async () => {
    const ver = box.querySelector('#vr-ver').value.trim();
    const title = box.querySelector('#vr-title').value.trim();
    const notes = box.querySelector('#vr-notes').value;
    if (!ver) { msg.textContent = '请填写版本号'; msg.style.color = 'var(--red)'; return; }
    msg.textContent = '正在发布…'; msg.style.color = '';
    const r = await adminPublishVersion(ver, title, notes);
    if (r.error) { msg.textContent = '发布失败：' + (r.error.message || '未知错误'); msg.style.color = 'var(--red)'; return; }
    toast(`已发布 V${ver}`, 3000);
    renderVerChip();
    try { localStorage.setItem(SEEN_VER_KEY, '0'); } catch (e) {}   // 让本机也看到一次这次的公告
    renderVersionPanel(v);
  };
  box.querySelector('#vr-preview').onclick = () => {
    const ver = box.querySelector('#vr-ver').value.trim() || cur.version;
    const keep = SITE_VERSION;
    SITE_VERSION = { version: ver, title: box.querySelector('#vr-title').value.trim(), notes: box.querySelector('#vr-notes').value, published_at: new Date().toISOString() };
    showReleaseModal(true);
    SITE_VERSION = keep;
  };
  box.querySelectorAll('[data-rfill]').forEach(btn => btn.onclick = () => {
    const r = rows.find(x => String(x.id) === btn.dataset.rfill);
    if (!r) return;
    box.querySelector('#vr-ver').value = r.version || '';
    box.querySelector('#vr-title').value = r.title || '';
    box.querySelector('#vr-notes').value = r.notes || '';
    msg.textContent = `已载入 V${r.version}（改好后点「发布新版本」即为按此内容重新发布）`;
    msg.style.color = '';
  });
}

/* ---------------- v30：后台「手动更新上传」（数据包） ---------------- */
async function renderPackPanel(v) {
  const box = v.querySelector('#adm-packs');
  if (!box) return;
  const list = await cloudListPacks();
  const rows = list.data || [];
  const used = {};
  for (const r of rows) if (r.active && !used[r.kind]) used[r.kind] = r.id;   // 同类型生效中的最新一条

  box.innerHTML = `
    <h3 style="margin-bottom:8px">手动更新上传（数据包）</h3>
    <p class="small muted" style="margin-bottom:10px">
      站点是静态站，改代码必须重新部署；但<b>数据</b>可以在这里直接上传：上传后存在云端，
      所有用户下次打开即读到新数据，无需重新部署。支持 <b>.json</b> 或项目里的
      <b>data-cards.js / data-books.js / data-traits.js</b> 这类数据文件原样上传。
      同一类型上传新包会自动接管（旧包转为停用，可随时切回）。<b>只上传你自己确认可信的数据文件。</b>
    </p>
    <div class="pack-form">
      <label class="field">
        <span class="field-label">数据类型</span>
        <select id="pk-kind" class="input">
          ${PACK_KINDS.map(k => `<option value="${k.key}">${k.label} — ${esc(k.hint)}</option>`).join('')}
        </select>
      </label>
      <label class="field">
        <span class="field-label">备注名（可选）</span>
        <input id="pk-label" class="input" type="text" maxlength="40" placeholder="如「10-09 卡牌校对更新」">
      </label>
      <label class="field">
        <span class="field-label">选择文件</span>
        <input id="pk-file" class="input" type="file" accept=".js,.json,.txt">
      </label>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button class="btn btn-primary" id="pk-upload">解析并上传</button>
        <button class="btn" id="pk-reload">重新载入云端数据</button>
        <span class="small muted" id="pk-msg"></span>
      </div>
    </div>
    <h4 class="ver-sub">已上传的数据包（${rows.length}）</h4>
    <div class="pack-list">${rows.length ? rows.map(r => {
      const d = r.created_at ? new Date(r.created_at) : null;
      const ds = d && !isNaN(d.getTime())
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
        : '—';
      const on = !!r.active;
      return `<div class="pack-item${on ? ' is-on' : ''}" data-pid="${r.id}">
        <div class="pack-item-head">
          <span class="tag ${on ? 'green' : 'gray'}">${on ? '生效中' : '已停用'}</span>
          <b>${esc(packKindLabel(r.kind))}</b>
          <span class="small muted">${esc(r.label || '（无备注）')}</span>
          <span class="small muted">${((r.bytes || 0) / 1024).toFixed(0)} KB · ${esc(ds)}</span>
          <span class="flex-spacer"></span>
          <button class="btn btn-sm" data-ptog="${r.id}">${on ? '停用' : '启用'}</button>
          <button class="btn btn-sm danger" data-pdel="${r.id}">删除</button>
        </div>
      </div>`;
    }).join('') : '<p class="small muted">还没有上传过数据包。</p>'}</div>
    <p class="small muted" style="margin-top:10px">本次启动已应用：${
      PACK_STATE.applied.length ? PACK_STATE.applied.map(p => `${packKindLabel(p.kind)}(#${p.id})`).join(' · ') : '无'
    }${PACK_STATE.failed.length ? `　｜　应用失败：${PACK_STATE.failed.map(p => packKindLabel(p.kind)).join(' · ')}` : ''}</p>`;

  const msg = box.querySelector('#pk-msg');
  const say = (t, bad) => { msg.textContent = t; msg.style.color = bad ? 'var(--red)' : ''; };

  box.querySelector('#pk-upload').onclick = async () => {
    const f = box.querySelector('#pk-file').files?.[0];
    if (!f) { say('请先选择文件', true); return; }
    say('读取中…');
    let text = '';
    try { text = await f.text(); } catch (e) { say('读取文件失败', true); return; }
    say('解析中…');
    let data;
    try { data = parseDataText(text); } catch (e) { say('解析失败：' + (e.message || e), true); return; }
    say('上传中…');
    const kind = box.querySelector('#pk-kind').value;
    const label = box.querySelector('#pk-label').value.trim();
    const r = await adminUploadPack(kind, label || f.name, /\.json$/i.test(f.name) ? 'json' : 'js', data, text.length);
    if (r.error) { say('上传失败：' + (r.error.message || '未知错误'), true); return; }
    toast(`已上传「${packKindLabel(kind)}」数据包`, 3000);
    await applyCloudPacks();
    renderSidenav(); renderRoute(); renderPackPanel(v);
  };

  box.querySelector('#pk-reload').onclick = async () => {
    say('正在从云端载入…');
    const n = await applyCloudPacks();
    renderSidenav(); renderRoute();
    renderPackPanel(v);
    toast(n ? `已应用 ${n} 个数据包` : '没有生效中的数据包', 2600);
  };

  box.querySelectorAll('[data-ptog]').forEach(btn => btn.onclick = async () => {
    const r = rows.find(x => String(x.id) === btn.dataset.ptog);
    if (!r) return;
    const res = await adminSetPackActive(r.id, !r.active);
    if (res.error) { toast('操作失败：' + (res.error.message || ''), 3000); return; }
    toast(r.active ? '已停用，需重新载入才对当前页生效' : '已启用，正在载入…', 2600);
    await applyCloudPacks();
    renderSidenav(); renderRoute(); renderPackPanel(v);
  });

  box.querySelectorAll('[data-pdel]').forEach(btn => btn.onclick = async () => {
    if (!confirm('删除这个数据包？删除后其他用户将不再读到它（本机缓存会保留到下次更新）。')) return;
    const res = await adminDeletePack(btn.dataset.pdel);
    if (res.error) { toast('删除失败：' + (res.error.message || ''), 3000); return; }
    toast('已删除', 2000);
    renderPackPanel(v);
  });
}

/* ---- 进入 / 退出 ---- */
/* ---------------- 邀请码兑换（登录弹窗 / 个人中心共用） ----------------
 * 云端函数会：校验码有效 → 计次 → 按等级只升不降地改角色 → 写回 profiles.invite_code。
 * 这里负责把结果翻成人话（含「会话未确认」这类真实原因），并立刻刷新本机权限与界面。 */
const INVITE_ERR = {
  not_found: '邀请码不存在', inactive: '该邀请码已停用',
  exhausted: '该邀请码次数已用完', empty: '请填写邀请码', anon: '请先登录',
};
async function redeemInviteFlow(code) {
  const c = String(code || '').trim();
  if (!c) return { ok: false, msg: '请填写邀请码' };
  if (!isSignedIn()) return { ok: false, msg: '请先登录账号后再兑换' };
  /* 会话只是本机乐观恢复时先补一次刷新，否则云端会以「未认证」拒绝 */
  if (typeof cloudSessionOk === 'function' && !cloudSessionOk() && typeof cloudReconnect === 'function') {
    try { await cloudReconnect(); } catch (e) { /* ignore */ }
  }
  const iv = await cloudRedeemInvite(c);
  const res = String(iv.data || '');
  if (res.startsWith('ok')) {
    const role = res.split(':')[1] || 'beta';
    await cloudLoadProfile();
    await cloudLoadFeatures();
    if (typeof cloudLoadOverrides === 'function') await cloudLoadOverrides();
    /* 只刷新顶栏与侧栏（权限变了要立刻反映）；不整页 renderRoute —— 否则会把当前面板连同输入框一起重建 */
    renderTopRight(); renderSidenav();
    return { ok: true, role, msg: `邀请码已生效：账号角色为「${ROLE_NAME[role] || role}」` };
  }
  if (iv.error) {
    const m = String(iv.error.message || '');
    const known = /not authenticated|MISSING_CREDENTIALS|JWT/i.test(m)
      ? '账号会话还没被云端确认（请稍等几秒后重试，或退出重新登录）' : m;
    return { ok: false, msg: '兑换失败：' + known };
  }
  return { ok: false, msg: '兑换失败：' + (INVITE_ERR[res] || res || '未知问题') };
}

async function afterSignIn(merged) {
  DB = slotDB();
  /* 未登录时（游客槽）做过的校对 / 收藏 / 构筑，登录后并进账号档案，避免切换数据槽丢失 */
  const gm = mergeGuestIntoAccount();
  if (gm) {
    const LBL = { proof: '校对', customs: '自定义卡', overrides: '字段修正', decks: '构筑' };
    const parts = Object.entries(gm).filter(([, n]) => n).map(([k, n]) => `${n} 条${LBL[k] || k}`);
    if (parts.length) toast(`已把游客模式下的 ${parts.join(' · ')}并入账号`, 4200);
  }
  await cloudLoadFeatures();
  await cloudLoadOverrides();       // 该账号的单账号权限覆盖
  await cloudTouchLogin();          // 记录登录日期 / 次数
  if (isSignedIn()) await cloudLoadProfile();   // 重新拉取，带上最新的登录信息
  await tryPullFromCloud(merged);
  applyTheme();
  renderTopRight(); renderSidenav();
  location.hash = '#cards';
  renderRoute();
  /* 登录后：把本机（含游客时期）的校对补传到云端共享表 */
  if (Object.keys(DB.proof || {}).length) pushProofSoon(1500);
}

/* 校对记录逐条合并：同一张卡取「时间更新」的那条，本机较新则保留本机。
   绝不能用云端整体覆盖 —— 否则刚做完的校对会被旧云端打回「待校」。 */
function mergeProof(localP, remoteP) {
  const out = { ...(remoteP && typeof remoteP === 'object' ? remoteP : {}) };
  for (const [id, r] of Object.entries(localP && typeof localP === 'object' ? localP : {})) {
    if (!r || typeof r !== 'object') continue;
    const o = out[id];
    const ta = r.at ? (Date.parse(r.at) || 0) : 0;
    const tb = o && o.at ? (Date.parse(o.at) || 0) : 0;
    if (!o || ta >= tb) out[id] = r;
  }
  return out;
}

/* 游客（未登录，数据存 ebr_dm_guest）校对过再登录时，把游客数据合并进账号档案，
   否则一切到账号槽，之前在校对页做的记录就全没了。 */
function mergeGuestIntoAccount() {
  if (!isSignedIn()) return null;
  let g = null;
  try { g = JSON.parse(localStorage.getItem(LS_GUEST) || 'null') || null; } catch { return null; }
  if (!g || typeof g !== 'object') return null;
  const gp = g.proof && typeof g.proof === 'object' ? Object.keys(g.proof).length : 0;
  const gc = (g.customs || []).length, go = Object.keys(g.overrides || {}).length, gd = (g.decks || []).length;
  if (!gp && !gc && !go && !gd) return null;                 // 游客什么都没做
  const cur = DB || slotDB();
  DB = {
    ...blankDB(), ...cur,
    proof: mergeProof(g.proof, cur.proof),
    overrides: { ...(g.overrides || {}), ...(cur.overrides || {}) },
    customs: [...(g.customs || []), ...(cur.customs || [])],
    decks: [...(g.decks || []), ...(cur.decks || [])],
    makerCards: [...(g.makerCards || []), ...(cur.makerCards || [])],
  };
  localStorage.setItem(slotKey(), JSON.stringify(DB));
  return { proof: gp, customs: gc, overrides: go, decks: gd };
}

async function tryPullFromCloud(silent) {
  if (!cloudSessionOk()) return;
  const remote = await cloudPull();
  renderSyncBadge();
  if (!remote) {
    const e = lastCloudError();
    toast('云端读取失败，暂用本机数据' + (e && e.where === 'pull' ? '：' + e.message.slice(0, 60) : ''), 4200);
    return;
  }
const local = DB || slotDB();
  /* 判断「有数据」必须把 proof / makerCards 也算进去：
     只做过校对的账号若被判成「本地无数据」，就会被云端（可能更旧）的库整体覆盖，
     表现为「明明校对过，刷新后又全变回待校」。 */
  const hasAny = o => (o?.decks?.length || 0) + (o?.customs?.length || 0) > 0
    || Object.keys(o?.overrides || {}).length > 0
    || Object.keys(o?.proof || {}).length > 0
    || (o?.makerCards?.length || 0) > 0
    || Object.keys(o?.settings || {}).length > 0;
  const localHas = hasAny(local);
  const remoteLib = remote.library || {};
  const remoteHas = (remote.decks?.length || 0) > 0 || hasAny(remoteLib);
  const backupLocal = () => { try { localStorage.setItem(slotKey() + '_bak', JSON.stringify(local)); } catch { /* ignore */ } };
  const takeRemote = () => {
    const merged = { ...blankDB(), ...remoteLib, decks: remote.decks || [] };
    merged.proof = mergeProof(local.proof, merged.proof);        // 逐条取新，绝不整体丢弃
    /* 自制卡：云端有就用云端，云端为空则保留本机（首次迁移时云端还没上传，不能把本机的清掉） */
    merged.makerCards = (remote.makerCards && remote.makerCards.length)
      ? remote.makerCards
      : (local.makerCards || []);
    return merged;
  };
  if (remoteHas && !(localHas && !silent)) {
    DB = takeRemote();
    localStorage.setItem(slotKey(), JSON.stringify(DB));
    toast('已读取云端数据');
  } else if (localHas && !remoteHas) {
    await cloudPush(DB);
    toast('本机数据已上传到云端');
  } else if (localHas && remoteHas) {
    // 两端都有数据：以云端为准写入，但校对记录逐条合并，本机原有数据另存一份备份
    backupLocal();
    DB = takeRemote();
    localStorage.setItem(slotKey(), JSON.stringify(DB));
    toast('已读取云端数据（本机原有数据已备份到本机）');
  } else {
    DB = takeRemote();
    localStorage.setItem(slotKey(), JSON.stringify(DB));
  }
}

async function doSignOut() {
  /* 先确保改动落到云端，再销毁会话（否则防抖队列里的那次 push 会因没令牌而失败） */
  try { if (cloudSessionOk() && typeof cloudPush === 'function') await cloudPush(DB); } catch (e) { /* 尽力而为 */ }
  saveDB();
  await cloudSignOut();
  DB = slotDB();
  SYNC_STATE = 'off';
  applyTheme();
  renderTopRight(); renderSidenav(); renderSessionBar();
  location.hash = '#cards';
  renderRoute();
  toast('已退出登录');
}

/* ---------------- 卡牌数据访问（整合层） ---------------- */
/* ---------------- v30：云端数据包（管理员在后台上传，覆盖内置静态数据） ----------------
 * 内置数据随站点静态文件发布；管理员上传的同类型数据包会接管，所有用户下次打开即读到新数据，
 * 无需重新部署。只认「启用」的包，同类型以最新一条为准；内容按 id 缓存到本机，避免每次全量下载。 */
let CARDS_PACK = null, BOOKS_PACK = null, TRAITS_PACK = null;
const BOOKS_BUILTIN = (typeof BOOKS !== 'undefined' ? BOOKS : null);   // 内置书籍数据的原始引用（停用数据包后还原）
let PACK_STATE = { applied: [], failed: [] };      // 本次启动实际应用的包（供后台显示）

const cardSource = () => (CARDS_PACK && CARDS_PACK.length ? CARDS_PACK : (typeof CARDS !== 'undefined' ? CARDS : []));
const traitGroupsAll = () => (TRAITS_PACK && TRAITS_PACK.groups ? TRAITS_PACK.groups : (typeof TRAIT_GROUPS !== 'undefined' ? TRAIT_GROUPS : []));
const traitGroupById = id => (TRAITS_PACK && TRAITS_PACK.map ? (TRAITS_PACK.map[id] || null)
  : (typeof traitGroup === 'function' ? traitGroup(id) : null));

function applyPack(kind, data) {
  if (!data) return false;
  if (kind === 'cards') {
    const arr = Array.isArray(data) ? data : (Array.isArray(data.cards) ? data.cards : null);
    if (!arr || !arr.length) return false;
    CARDS_PACK = arr;
  } else if (kind === 'books') {
    const arr = Array.isArray(data) ? data : (Array.isArray(data.books) ? data.books : null);
    if (!arr || !arr.length) return false;
    BOOKS_PACK = arr;
    try { window.BOOKS = arr; } catch (e) { /* 忽略 */ }
    try { window.TextApp && window.TextApp.reload && window.TextApp.reload(); } catch (e) { /* 尚未启动 */ }
  } else if (kind === 'traits') {
    const groups = Array.isArray(data) ? data : (data.groups || data.TRAIT_GROUPS || []);
    const map = data.map || data.TRAIT_GROUP_OF || {};
    if (!Array.isArray(groups) || !groups.length) return false;
    TRAITS_PACK = { groups, map };
  } else if (kind === 'cun') {
    /* v40：村村通宝典 —— 形如 { html, updated_at }，空 html 视为「未设置」 */
    const html = String((data && data.html) || '');
    if (!html.trim()) return false;
    CUN_BAODIAN = { html, updated_at: data.updated_at || '', updated_by: data.updated_by || '' };
    try { window.TextApp && window.TextApp.reloadCun && window.TextApp.reloadCun(); } catch (e) { /* 尚未启动 */ }
  } else return false;
  return true;
}

/* 数据包文本 → JS 对象：支持纯 JSON，或 data-*.js 那种 `var X = [...]; window.X = X;` 形式 */
function parseDataText(text) {
  const t = String(text || '').trim();
  if (!t) throw new Error('内容为空');
  if (/^[\[{]/.test(t)) return JSON.parse(t);
  const m = t.match(/^\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*\n|\s)*(?:const|var|let)?\s*[\w$]+\s*=\s*([\s\S]+)$/);
  if (!m) throw new Error('不是 JSON，也没找到「X = ...」赋值语句');
  let body = m[1].trim().replace(/;\s*$/, '');
  body = body.replace(/;\s*(?:window\.)?[\w$]+\s*=\s*[\w$]+\s*;?\s*$/, '');   // 去掉尾部的 window.X = X
  body = body.replace(/;\s*$/, '');
  return (new Function('return (' + body + ');'))();
}

const PACK_KINDS = [
  { key: 'cards', label: '卡牌数据', hint: 'data-cards.js / 卡牌 JSON 数组' },
  { key: 'books', label: '书籍数据', hint: 'data-books.js / 书籍 JSON 数组' },
  { key: 'traits', label: '性格分组', hint: 'data-traits.js 的分组表' },
  { key: 'other', label: '其它数据', hint: '仅存档，不覆盖任何内置数据' },
];
const packKindLabel = k => (PACK_KINDS.find(x => x.key === k) || { label: k }).label;

/* 本机缓存：key 含包 id，包更新才会重新下载 */
const packCacheKey = (kind, id) => `ebpk_${kind}_${id}`;
function packCacheRead(kind, id) {
  try {
    const s = localStorage.getItem(packCacheKey(kind, id));
    return s ? JSON.parse(s) : null;
  } catch (e) { return null; }
}
function packCacheWrite(kind, id, data) {
  try { localStorage.setItem(packCacheKey(kind, id), JSON.stringify(data)); } catch (e) { /* 容量不足则每次现取 */ }
}

/* ---------------- v31：书籍信息（书名 / 类别标签）云端覆盖 ----------------
 * 管理员在文本查询系统里改过的书名 / 类别存云端，所有用户打开即看到，无需重新部署。
 * 每本书第一次应用时记住内置原值（_o），覆盖被删除后能还原。 */
function applyBookMeta() {
  const src = window.BOOKS || (typeof BOOKS !== 'undefined' ? BOOKS : []);
  if (!Array.isArray(src)) return;
  src.forEach(b => {
    if (!b || !b.id) return;
    if (!b._o) b._o = { title: b.title, kind: b.kind };
    const m = BOOK_META[b.id];
    b.title = (m && m.title) ? m.title : b._o.title;
    b.kind = (m && m.kind) ? m.kind : b._o.kind;
  });
  try { if (window.TextApp && window.TextApp.ready && window.TextApp.applyMeta) window.TextApp.applyMeta(); } catch (e) { /* 忽略 */ }
}
/* 文本系统里能否编辑书名 / 类别：管理员 + 后台「书籍信息编辑与推送」开关开启
   （用函数声明而非 const，确保挂到 window 上，text-app.js 才能跨文件调用） */
function bookMetaEditable() {
  return typeof featureOn === 'function' ? featureOn('textsys.metaedit') : false;
}

/* ---------------- v40：村村通宝典（文本查询系统顶置栏） ----------------
 * 内容走现成的数据包通道（site_data_packs，kind='cun'）：管理员保存后上传，
 * 所有用户下次打开自动拉到最新的那一包 —— 与卡牌 / 书籍数据同一套分发机制，无需新表。
 * 本地另存一份兜底：离线或云端不可用时，本机编辑的内容照常可见。 */
var CUN_BAODIAN = { html: '', updated_at: '', updated_by: '' };
const CUN_LS_KEY = 'eb_cun_baodian_v1';

function cunLocalRead() {
  try {
    const s = JSON.parse(localStorage.getItem(CUN_LS_KEY) || '{}');
    return (s && typeof s === 'object') ? { html: String(s.html || ''), updated_at: s.updated_at || '', updated_by: s.updated_by || '' } : { html: '', updated_at: '', updated_by: '' };
  } catch (e) { return { html: '', updated_at: '', updated_by: '' }; }
}
function cunLocalWrite(html) {
  const rec = { html: String(html || ''), updated_at: new Date().toISOString(), updated_by: '' };
  try { localStorage.setItem(CUN_LS_KEY, JSON.stringify(rec)); } catch (e) { /* 容量不足则忽略 */ }
  return rec;
}
/* 云端内容优先，没有就用本地兜底 */
function cunBaodian() {
  if (CUN_BAODIAN.html) return CUN_BAODIAN;
  return cunLocalRead();
}
/* —— 本地预览：?preview=admin 让未登录的本机也能先看宝典效果 ——
   仅在 localhost / 127.0.0.1 打开时生效，线上（含云端不可用）一律不放行 */
function localPreviewAdmin() {
  try {
    const h = location.hostname;
    if (h !== 'localhost' && h !== '127.0.0.1' && h !== '[::1]') return false;
    return new URLSearchParams(location.search).get('preview') === 'admin';
  } catch (e) { return false; }
}
/* —— 两个权限：查看 / 编辑（用函数声明，供 text-app.js 跨文件调用）—— */
/* 查看顶置栏：受母选项 textsys 与自身开关双重约束 */
function cunBaodianViewable() {
  if (localPreviewAdmin()) return true;
  return typeof featureOn === 'function' ? featureOn('textsys.cun.view') : false;
}
/* 编辑顶置栏：以「查看」为前提 —— 自己都看不见就没必要让人改 */
function cunBaodianEditable() {
  if (typeof featureOn !== 'function') return localPreviewAdmin();
  return cunBaodianViewable() && (localPreviewAdmin() ? true : featureSelfOn('textsys.cun.edit'));
}
/* 管理员保存：本地立刻生效 + 云端上传推送全站（云端失败不阻塞，只提示） */
async function adminSaveBaodian(html) {
  const rec = cunLocalWrite(html);
  CUN_BAODIAN = rec;
  if (typeof adminUploadPack !== 'function' || typeof cloudOn !== 'function' || !cloudOn()) {
    return { data: rec, error: null, offline: true };
  }
  const payload = { html: rec.html, updated_at: rec.updated_at };
  const bytes = (() => { try { return new Blob([JSON.stringify(payload)]).size; } catch (e) { return JSON.stringify(payload).length; } })();
  const r = await adminUploadPack('cun', '村村通宝典', 'json', payload, bytes);
  if (r.error) return { data: rec, error: r.error, offline: false };
  return { data: rec, error: null, offline: false };
}

/* 全部还原为内置静态数据（数据包被停用 / 删除时用，否则旧数据会一直留在内存里） */
function resetPacks() {
  CARDS_PACK = null; BOOKS_PACK = null; TRAITS_PACK = null;
  if (BOOKS_BUILTIN) { try { window.BOOKS = BOOKS_BUILTIN; } catch (e) { /* 忽略 */ } }
  applyBookMeta();                                    // v31：数据包换了书籍后重新套用云端书名 / 类别
  try { window.TextApp && window.TextApp.reload && window.TextApp.reload(); } catch (e) { /* 尚未启动 */ }
}

/* 启动时拉取并应用云端数据包（返回应用成功的条数） */
async function applyCloudPacks() {
  PACK_STATE = { applied: [], failed: [] };
  resetPacks();                                       // 先还原，停用/删除的包不会再生效
  if (!cloudOn()) return 0;
  const meta = await cloudListPacks();
  const rows = (meta.data || []).filter(r => r.active);
  const latest = {};                                  // 同类型只取最新一条
  for (const r of rows) if (!latest[r.kind]) latest[r.kind] = r;
  for (const [kind, r] of Object.entries(latest)) {
    let data = packCacheRead(kind, r.id);
    if (!data) {
      const got = await cloudPackPayload(r.id);
      data = got.data;
      if (data) packCacheWrite(kind, r.id, data);
    }
    if (applyPack(kind, data)) PACK_STATE.applied.push({ ...r, kind });
    else PACK_STATE.failed.push({ ...r, kind });
  }
  applyBookMeta();        // v31：数据包换掉书籍数据后，重新套用云端书名 / 类别
  return PACK_STATE.applied.length;
}

/* ---------------- 官方数据视图 ---------------- */
/* 官方数据 CARDS（data-cards.js 或云端数据包） + 用户自定义 customs + overrides → 统一视图 */
function allCards() {
  const base = cardSource().map(c => ({ ...c }));
  const merged = [...base];
  for (const c of DB.customs) merged.push({ ...c, custom: true });
  for (const [id, ov] of Object.entries(DB.overrides || {})) {
    const c = merged.find(x => x.id === id);
    if (c) Object.assign(c, ov, { edited: true });
  }
  return merged;
}
const cardById = id => allCards().find(c => c.id === id);

/* ---------------- 路由 ---------------- */
const ROUTES = {
  dashboard, cards, editor, merge, search, builder, maker, proof,
  export: exportPage, exportPage, account, admin,
};
function renderRoute() {
  /* 分享链接：#deck=EBRD1:... → 直接导入并打开 */
  const raw = location.hash || '';
  if (raw.includes('#deck=') || raw.startsWith('#deck=')) {
    const r = decodeDeckCode(raw);
    if (r.deck) {
      DB.decks = DB.decks || [];
      DB.decks.push(r.deck); saveDB();
      location.hash = '#builder';
      BuilderUI.cur = r.deck.id; BuilderUI.step = 0;
      toast(`已从链接导入牌组「${r.deck.name}」${r.missing?.length ? `（${r.missing.length} 张卡未匹配）` : ''}`, 4200);
      return;
    }
    toast(r.error || '牌组链接无效', 3600);
    location.hash = '#cards';
    return;
  }
  let r = (location.hash || '#cards').slice(1).split('?')[0];
  /* 子系统：战役管理系统 */
  if (r === 'campaign') {
    if (!campaignAllowed()) { setSys('cards'); campaignBlockedPage(); return; }
    setSys('campaign');
    return;
  }
  /* 子系统：文本查询系统（管理员） */
  if (r === 'text') {
    if (!textsysAllowed()) { setSys('cards'); textBlockedPage(); return; }
    setSys('text');
    /* v31：切回文本系统时重绘一次（权限 / 后台推送开关可能刚变过，编辑入口要跟着显示或隐藏） */
    try { if (window.TextApp && window.TextApp.ready) window.TextApp.applyMeta(); } catch (e) { /* 忽略 */ }
    return;
  }
  /* v34：子系统：原声音乐 */
  if (r === 'music') {
    if (!musicAllowed()) { setSys('cards'); musicBlockedPage(); return; }
    setSys('music');
    return;
  }
  /* v26：独立子系统 —— 后台管理系统（顶栏第四栏，仅管理员）/ 个人中心（头像进入）
     已从卡牌管理系统的侧栏移出，但路由本身保留可用。
     v41：后台管理支持二级路由 —— #admin/<子页>（如 #admin/users），顶级名仍按 admin 判定权限 */
  const rTop = r.split('/')[0];
  if (rTop === 'admin' || rTop === 'account') {
    if (!canSee(rTop)) { setSys('cards'); standaloneBlockedPage(rTop); return; }
    setSys(rTop === 'admin' ? 'admin' : 'me');
    (ROUTES[rTop] || cards)($('#view'));
    $$('.sidenav a').forEach(a => a.classList.toggle('active', a.dataset.route === rTop));
    return;
  }
  if (SYS.cur !== 'cards') setSys('cards');
  if (!canSee(r)) {
    if (r === 'dashboard') r = 'cards';
    else {
      const v = $('#view');
      const f = featureState(r);
      const meta = ROUTE_META.find(x => x.key === r);
      const pKey = PARENT_OF[r];
      const pOff = !!(pKey && !featureSelfOn(pKey));            // 母选项被关
      const closed = pOff || !f.enabled;
      const why = pOff
        ? `其所属的母选项「${FEATURE_DEFS[pKey]?.label || pKey}」当前未开放（管理员可在「后台管理 → 功能开关」中开启）`
        : !f.enabled
          ? `「${f.label}」当前未开放（管理员可在「后台管理 → 功能开关」中开启）`
          : !isSignedIn() ? '该页面需要登录账号' : '该页面需要更高权限';
      const needRole = ROLE_NAME[f.min] || f.min;
      v.innerHTML = `<h2 class="page-title">${closed ? '功能未开放' : '需要更高权限'}</h2>
        <p class="page-sub">${esc(why)}。</p>
        <div class="panel"><p class="muted small">${closed
          ? '该模块正在内测 / 维护中，暂时关闭。若你需要使用，请联系站点管理员开启。'
          : !isSignedIn()
            ? '点击右上角「登录 / 注册」，用邮箱注册一个账号即可使用角色创建与导出。'
            : `该功能最低需要「${esc(needRole)}」权限，你当前为「${esc(ROLE_NAME[userRole()] || userRole())}」。如需更高权限请联系站点管理员。`}</p>
          ${meta && !f.enabled ? `<p class="small muted" style="margin-top:8px">模块：${meta.icon} ${esc(f.label)}</p>` : ''}
          <div style="margin-top:12px"><a class="btn" href="#cards">返回卡牌列表</a></div></div>`;
      $$('.sidenav a').forEach(a => a.classList.toggle('active', a.dataset.route === r));
      return;
    }
  }
  const fn = ROUTES[r] || cards;
  $$('.sidenav a').forEach(a => a.classList.toggle('active', a.dataset.route === r));
  $('#view').innerHTML = '';
  fn($('#view'));
  saveDB();
}
window.addEventListener('hashchange', renderRoute);

/* ================= 1) 数据看板 ================= */
function dashboard(v) {
  const cards = allCards();
  const byGroup = {}, bySet = {}, byDeck = {};
  cards.forEach(c => {
    const g = GROUPS[c.group] || c.group;
    byGroup[g] = (byGroup[g] || 0) + 1;
    bySet[SETS[c.set] || c.set] = (bySet[SETS[c.set] || c.set] || 0) + 1;
    if (c.deck) byDeck[c.deck] = (byDeck[c.deck] || 0) + 1;
  });
  const decks = DB.decks || [];
  const deckStat = decks.map(d => {
    const st = deckStatus(d);
    return `<tr>
      <td><b>${esc(d.name)}</b></td>
      <td>${esc(d.steps?.background?.deck || '—')} / ${esc(d.steps?.expertise?.deck || '—')}</td>
      <td class="${st.kinds === DECK_TOTAL.kinds ? 'ok' : 'bad'}">${st.kinds} / ${DECK_TOTAL.kinds} 种</td>
      <td class="${st.cards === DECK_TOTAL.cards ? 'ok' : 'bad'}">${st.cards} / ${DECK_TOTAL.cards} 张</td>
      <td>${st.problems.length ? `<span class="tag red">${st.problems.length} 项问题</span>` : '<span class="tag">合规</span>'}</td>
      <td><button class="btn btn-sm" data-open-deck="${d.id}">打开</button></td>
    </tr>`;
  }).join('');

  const bar = (obj, total) => Object.entries(obj).map(([k, n]) => `
    <div class="bar-row"><span class="bl">${esc(k)}</span>
      <div class="btrack"><div class="bfill" style="width:${total ? (n / total * 100).toFixed(1) : 0}%"></div></div>
      <span class="bv">${n}</span></div>`).join('');

  v.innerHTML = `
    <h2 class="page-title">数据看板</h2>
    <p class="page-sub">收藏与构筑总览 · 数据保存在本机浏览器</p>
    <div class="stat-grid">
      <div class="stat"><div class="num">${cards.length}</div><div class="lbl">卡牌条目（含自定义）</div></div>
      <div class="stat"><div class="num">${cards.filter(c => c.review).length}</div><div class="lbl">待校对条目</div></div>
      <div class="stat"><div class="num">${DB.customs.length}</div><div class="lbl">自定义卡</div></div>
      <div class="stat"><div class="num">${decks.length}</div><div class="lbl">行者构筑</div></div>
    </div>
    <div class="panel"><h3 style="margin-bottom:10px">卡牌分布</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px">
        <div><div class="small muted" style="margin-bottom:6px">按类别</div>${bar(byGroup, cards.length)}</div>
        <div><div class="small muted" style="margin-bottom:6px">按扩展</div>${bar(bySet, cards.length)}</div>
        <div><div class="small muted" style="margin-bottom:6px">按牌组</div>${bar(byDeck, cards.length)}</div>
      </div>
    </div>
    <div class="panel"><h3 style="margin-bottom:10px">行者构筑</h3>
      ${decks.length ? `<table class="tbl"><thead><tr><th>名称</th><th>背景/专长</th><th>种类</th><th>张数</th><th>校验</th><th></th></tr></thead><tbody>${deckStat}</tbody></table>`
        : '<p class="muted small">还没有构筑。去 <a href="#builder" style="color:var(--green)">角色创建</a> 开一个新行者。</p>'}
    </div>
    <div class="panel"><h3 style="margin-bottom:10px">数据管理</h3>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" id="btn-export-all">导出全部数据（备份 JSON）</button>
        <button class="btn" id="btn-import-all">导入备份</button>
        <input type="file" id="file-import" accept=".json" class="hidden">
      </div>
      <p class="small muted" style="margin-top:10px">备份 JSON 包含本档案的收藏、自定义卡、覆盖与全部构筑。换浏览器/换电脑时用它搬运。</p>
    </div>`;
  v.querySelector('#btn-export-all').onclick = exportAllData;
  const fi = v.querySelector('#file-import');
  v.querySelector('#btn-import-all').onclick = () => fi.click();
  fi.onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const d = JSON.parse(rd.result);
        DB = { ...blankDB(), ...d }; saveDB(); toast('导入成功'); renderRoute();
      } catch { toast('文件解析失败'); }
    };
    rd.readAsText(f);
  };
  v.querySelectorAll('[data-open-deck]').forEach(b => b.onclick = () => { location.hash = '#builder'; BuilderUI.open(b.dataset.openDeck); });
}
function exportAllData() {
  const payload = { ...DB, _by: exportBy() || undefined, _exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `地缘行者卡牌管理_备份_${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); URL.revokeObjectURL(a.href);
}

/* ================= 2) 卡牌列表 + 3) 卡表检索 ================= */
function cardFilters(v, state) {
  v.querySelector('.toolbar').innerHTML = `
    <input type="text" class="f-q" placeholder="搜索名称 / 效果…" value="${esc(state.q)}" style="min-width:200px">
    <select class="f-group"><option value="">全部类别</option>${Object.entries(GROUPS).map(([k, n]) =>
      `<option value="${k}" ${state.group === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <select class="f-set"><option value="">全部扩展</option>${Object.entries(SETS).map(([k, n]) =>
      `<option value="${k}" ${state.set === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <select class="f-deck"><option value="">全部牌组</option>${[...BG_DECKS, ...EXP_DECKS].map(d =>
      `<option ${state.deck === d ? 'selected' : ''}>${d}</option>`).join('')}</select>
    <select class="f-sort">
      <option value="deck" ${state.sort === 'deck' ? 'selected' : ''}>按牌组</option>
      <option value="name" ${state.sort === 'name' ? 'selected' : ''}>按名称</option>
      <option value="cost" ${state.sort === 'cost' ? 'selected' : ''}>按费用</option>
    </select>
    <label class="small" style="display:flex;align-items:center;gap:4px">
      <input type="checkbox" class="f-noexpert" ${state.noExpert ? 'checked' : ''}> 仅无「专家」</label>`;

  /* ---- v27：奖励卡查看开关（默认关闭；开启后再按扩展分别点选） ---- */
  const tb = v.querySelector('.toolbar');
  if (tb && !v.querySelector('.reward-bar')) tb.insertAdjacentHTML('afterend', '<div class="reward-bar"></div>');

  /* 重绘卡区；若选了「奖励」类别却因开关而一张不显示，给出明确指引 */
  const refreshArea = () => {
    const area = v.querySelector('.card-area');
    if (!area) return;
    area.innerHTML = state.renderBody(state);
    const rv = rewardView();
    if (state.group === 'reward' && !(rv.on && rv.sets.length)) {
      area.insertAdjacentHTML('afterbegin', `<p class="rb-tip">${
        rv.on ? '⚠️ 已开启奖励卡查看，但还没选择扩展 —— 点上方按钮选择要查看的奖励卡。'
              : '⚠️ 奖励卡查看当前已关闭 —— 请在上方开启「🎁 奖励卡查看」，再点选要查看的扩展。'}</p>`);
    }
    bindCardEvents(v, state);
  };

  const drawRewardBar = () => {
    const bar = v.querySelector('.reward-bar');
    if (!bar) return;
    const rv = rewardView();
    const cnt = rewardCounts();
    const customN = allCards().filter(c => c.group === 'reward' && c.custom).length;
    const shownN = REWARD_SETS.filter(s => rv.sets.includes(s.key)).reduce((n, s) => n + (cnt[s.key] || 0), 0) + customN;
    bar.innerHTML = `
      <span class="rb-title">🎁 奖励卡查看</span>
      <label class="sw" title="默认关闭：奖励卡含战役内容，开启后才会在卡表里出现">
        <input type="checkbox" class="rb-on" ${rv.on ? 'checked' : ''}><span></span></label>
      <span class="rb-state ${rv.on ? 'on' : 'off'}">${rv.on ? '已开启' : '已关闭'}</span>
      ${rv.on ? `<span class="rb-sep"></span>${REWARD_SETS.map(s => {
        const on = rv.sets.includes(s.key);
        return `<button type="button" class="btn btn-sm rb-set${on ? ' is-on' : ''}" data-rset="${esc(s.key)}"
          aria-pressed="${on}" title="${on ? '点击隐藏' : '点击显示'}「${esc(s.label)}」的奖励卡（${cnt[s.key] || 0} 张）">
          ${s.icon} ${esc(s.label)}<span class="rb-n">${cnt[s.key] || 0}</span></button>`;
      }).join('')}` : ''}
      <span class="rb-hint">${rv.on
        ? (rv.sets.length ? `已显示 ${shownN} 张奖励卡${customN ? `（含自定义 ${customN} 张）` : ''} · 再次点击按钮可隐藏`
                          : '← 点上方按钮，选择要查看的扩展')
        : '奖励卡含战役剧透，默认隐藏；开启后按本体 / 山谷卫士 / 先祖遗产分别点选查看'}</span>`;
    const sw = bar.querySelector('.rb-on');
    if (sw) sw.onchange = () => { saveRewardView(sw.checked, rewardView().sets); drawRewardBar(); refreshArea(); };
    bar.querySelectorAll('[data-rset]').forEach(b => b.onclick = () => {
      const cur = rewardView(), k = b.dataset.rset;
      const sets = cur.sets.includes(k) ? cur.sets.filter(x => x !== k) : [...cur.sets, k];
      saveRewardView(cur.on, sets); drawRewardBar(); refreshArea();
    });
  };

  const apply = () => {
    state.q = v.querySelector('.f-q').value.trim();
    state.group = v.querySelector('.f-group').value;
    state.set = v.querySelector('.f-set').value;
    state.deck = v.querySelector('.f-deck').value;
    state.sort = v.querySelector('.f-sort').value;
    state.noExpert = v.querySelector('.f-noexpert').checked;
    refreshArea();
  };
  v.querySelector('.f-q').oninput = apply;
  v.querySelectorAll('select').forEach(s => s.onchange = apply);
  v.querySelector('.f-noexpert').onchange = apply;
  drawRewardBar();
}

function filterCards(state) {
  /* v27：奖励卡默认隐藏，需手动开启总开关并点选对应扩展 */
  let list = allCards().filter(rewardShown);
  if (state.group) list = list.filter(c => c.group === state.group);
  if (state.set)   list = list.filter(c => c.set === state.set);
  if (state.deck)  list = list.filter(c => c.deck === state.deck);
  /* v43：类型行含「专家」同样被排除 */
  if (state.noExpert) list = list.filter(c => !isExpertCard(c));
  if (state.q) {
    const q = state.q.toLowerCase();
    list = list.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.type || '').toLowerCase().includes(q) ||
      (c.text || '').toLowerCase().includes(q) ||
      (c.deck || '').toLowerCase().includes(q));
  }
  const cmp = { deck: (a, b) => (a.deck || '').localeCompare(b.deck || '') || (a.name || '').localeCompare(b.name || '', 'zh'),
                name: (a, b) => (a.name || '').localeCompare(b.name || '', 'zh'),
                cost: (a, b) => (Number(a.cost) || 0) - (Number(b.cost) || 0) || (a.name || '').localeCompare(b.name || '', 'zh') };
  return list.sort(cmp[state.sort] || cmp.deck);
}

function cardGrid(list, opts = {}) {
  return `<div class="card-grid">${list.map(c => `
    <div class="card-item" data-id="${esc(c.id)}">
      ${c.review ? '<span class="tag amber flag-warn" title="OCR 读取，待人工校对">待校</span>' : ''}
      ${c.custom ? '<span class="tag blue flag-warn">自定义</span>' : ''}
      ${c.edited ? '<span class="tag blue flag-warn" title="存在本地覆盖">已改</span>' : ''}
      ${c.img ? `<img class="thumb" loading="lazy" src="${esc(c.img)}" alt="${esc(c.name)}" data-zoom="${esc(c.id)}">`
              : `<div class="thumb noimg">🂠</div>`}
      <div class="cbody">
        <div class="cname">${esc(c.name)}${c.cost !== '' && c.cost != null ? `<span class="cost">${esc(c.cost)}</span>` : ''}</div>
        <div class="ctype">${esc(c.type || GROUPS[c.group] || '')}${c.deck ? ' · ' + esc(c.deck) : ''}</div>
        ${rangerLineHTML(c, { tag: 'div' })}
        <div class="cfoot">${reqChipsHTML(c)}${c.customizable ? '<span class="tag blue" title="在角色创建中选入后，可自定义名称/技能/属性">可自定义</span>' : ''}${keywordsHTML(c)}
          ${c.set ? `<span class="tag amber">${esc(SETS[c.set])}</span>` : ''}
        </div>
        ${opts.picker ? `<div style="margin-top:7px"><button class="btn btn-sm btn-primary" data-pick="${esc(c.id)}">选入</button></div>` : ''}
      </div>
    </div>`).join('') || '<p class="muted">没有匹配的卡牌。</p>'}</div>`;
}

/* 同一视图内可浏览的卡图 ID 序列（用于大图左右翻页） */
function zoomIds(el) {
  const root = el.closest('.card-area') || el.closest('.pick-grid') || el.closest('.panel')
            || el.closest('.view') || document.getElementById('view');
  return [...(root ? root.querySelectorAll('[data-zoom]') : [])].map(x => x.dataset.zoom);
}

function bindCardEvents(v, state) {
  v.querySelectorAll('[data-zoom]').forEach(el =>
    el.onclick = () => openModal(el.dataset.zoom, zoomIds(el)));
  v.querySelectorAll('[data-pick]').forEach(el => el.onclick = () => state.onPick && state.onPick(el.dataset.pick));
}

/* ================= 卡牌大图：左右浏览 ================= */
const GALLERY = { ids: [], i: 0, touch: null };

function openModal(id, ids) {
  if (Array.isArray(ids) && ids.length) {
    GALLERY.ids = ids.slice();
    const k = GALLERY.ids.indexOf(id);
    if (k < 0) GALLERY.ids.unshift(id);
    GALLERY.i = k < 0 ? 0 : k;
  } else { GALLERY.ids = [id]; GALLERY.i = 0; }
  $('#modal').classList.remove('hidden');
  drawModal();
}

function closeModal() { $('#modal').classList.add('hidden'); }

function modalStep(d) {
  const n = GALLERY.ids.length;
  if (!n) return;
  GALLERY.i = (GALLERY.i + d + n) % n;   /* 首尾循环 */
  drawModal();
}

function drawModal() {
  const id = GALLERY.ids[GALLERY.i];
  const c = cardById(id);
  const stage = $('#modal-stage'), img = $('#modal-img');
  if (!c) { closeModal(); return; }
  if (c.img) { img.src = c.img; img.alt = c.name || '卡牌大图'; stage.style.display = ''; }
  else { img.removeAttribute('src'); stage.style.display = 'none'; }
  $('#modal-meta').innerHTML = `
    <b style="font-size:15px;color:var(--ink)">${esc(c.name)}</b>
    ${c.cost !== '' && c.cost != null ? `　费用 ${esc(c.cost)}` : ''}<br>
    ${esc(c.type || '')}${c.deck ? ' · ' + esc(c.deck) : ''}　${reqChipsHTML(c)}${c.attrType ? `　<span class="tag blue" title="卡牌类型">${esc(ATTR_FULL[c.attrType] || c.attrType)}</span>` : ''}<br>
    ${rangerLineHTML(c, { tag: 'div' })}
    ${keywordsHTML(c)}
    ${meansHTML(c.means) ? `<div style="margin-top:6px">${meansHTML(c.means)}</div>` : ''}
    ${c.text ? `<div style="margin-top:8px;color:var(--ink)">${kwText(c.text)}</div>` : ''}
    ${c.flavor ? `<div style="margin-top:6px;font-style:italic;color:var(--ink2)">${esc(c.flavor)}</div>` : ''}
    ${c.desc ? `<div class="small muted" style="margin-top:6px">${esc(c.desc)}</div>` : ''}
    ${c.review ? '<div style="margin-top:6px"><span class="tag amber">OCR 待校对</span></div>' : ''}`;
  const n = GALLERY.ids.length;
  $('#modal-count').textContent = n > 1
    ? `${GALLERY.i + 1} / ${n}　${c.name || ''}`
    : (c.name || '');
  /* 预取相邻两张，翻页不白屏 */
  [1, -1].forEach(d => {
    const nx = cardById(GALLERY.ids[(GALLERY.i + d + n) % n]);
    if (nx?.img) { const p = new Image(); p.src = nx.img; }
  });
}

function cards(v) {
  const state = { q: '', group: '', set: '', deck: '', sort: 'deck', noExpert: false,
    renderBody: st => cardGrid(filterCards(st)) };
  v.innerHTML = `
    <h2 class="page-title">卡牌列表</h2>
    <p class="page-sub">全部卡牌（基础 + 山谷卫士 + 先祖遗产）· 点击卡图放大后可用 ← → 或左右箭头翻页（手机可左右滑动）· 在<a href="#editor" style="color:var(--green)">表单编辑</a>中新增/修正</p>
    <div class="toolbar"></div>
    <div class="card-area"></div>`;
  cardFilters(v, state);
  v.querySelector('.card-area').innerHTML = state.renderBody(state);
  bindCardEvents(v, state);
}

function search(v) {
  const state = { q: '', group: '', set: '', deck: '', sort: 'name', noExpert: false,
    renderBody: st => {
      const list = filterCards(st);
      return `<p class="small muted" style="margin-bottom:10px">命中 <b>${list.length}</b> 张</p>` + cardGrid(list);
    } };
  v.innerHTML = `
    <h2 class="page-title">卡表检索</h2>
    <p class="page-sub">跨全部扩展与类别的全文检索（名称 / 类型 / 效果文本 / 牌组）</p>
    <div class="toolbar"></div>
    <div class="card-area"></div>`;
  cardFilters(v, state);
  v.querySelector('.card-area').innerHTML = state.renderBody(state);
  bindCardEvents(v, state);
  setTimeout(() => v.querySelector('.f-q').focus(), 50);
}

/* ================= 4) 表单编辑 ================= */
function editor(v) {
  v.innerHTML = `
    <h2 class="page-title">表单编辑</h2>
    <p class="page-sub">新增自定义卡牌，或修正官方条目（本地覆盖，不改原始数据；可随时在下方还原）</p>
    <div class="panel">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
        <button class="btn btn-primary" id="ed-new">＋ 新建自定义卡</button>
        <select id="ed-pick" style="min-width:240px">
          <option value="">— 选择官方卡进行修正 —</option>
          ${allCards().filter(c => !c.custom).map(c =>
            `<option value="${esc(c.id)}">${esc(c.deck ? c.deck + ' · ' : '')}${esc(c.name)}${c.custom ? '（自定义）' : ''}</option>`).join('')}
        </select>
      </div>
      <div id="ed-form"></div>
    </div>
    <div class="panel">
      <h3 style="margin-bottom:8px">本地覆盖 / 自定义一览</h3>
      <table class="tbl"><thead><tr><th>卡</th><th>类型</th><th>状态</th><th>操作</th></tr></thead><tbody id="ed-list"></tbody></table>
    </div>`;

  const form = $('#ed-form');
  function showForm(card, isNew) {
    form.innerHTML = `
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">
        <div style="flex:none;width:150px;text-align:center">
          <img id="ed-thumb" alt="卡图" src="${esc(card.img || '')}"
               style="width:150px;aspect-ratio:3/4.2;object-fit:cover;border-radius:9px;border:1px solid var(--line);background:var(--panel2)">
          <label class="btn btn-sm" style="display:block;margin-top:8px;cursor:pointer">上传底图
            <input type="file" id="ed-imgfile" accept="image/*" hidden></label>
          <div class="small muted" style="margin-top:4px">卡图预览（随图片路径实时更新）</div>
        </div>
        <div style="flex:1;min-width:260px">
          <div class="grid-form">
            <label class="fld">名称<input type="text" data-f="name" value="${esc(card.name || '')}"></label>
            <label class="fld">类别<select data-f="group">${Object.entries(GROUPS).map(([k, n]) =>
              `<option value="${k}" ${card.group === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
            <label class="fld">扩展<select data-f="set">${Object.entries(SETS).map(([k, n]) =>
              `<option value="${k}" ${card.set === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
            <label class="fld">牌组（背景/专长名，可空）<input type="text" data-f="deck" value="${esc(card.deck || '')}" list="decklist">
              <datalist id="decklist">${[...BG_DECKS, ...EXP_DECKS].map(d => `<option value="${d}">`).join('')}</datalist></label>
            <label class="fld">类型行（如：瞬间·智慧）<input type="text" data-f="type" value="${esc(card.type || '')}"></label>
            <label class="fld">费用（数字 / X，可空）<input type="text" data-f="cost" value="${esc(card.cost ?? '')}"></label>
            <label class="fld">属性需求（JSON，如 {"知":1}）<input type="text" data-f="attrJson" value="${esc(JSON.stringify(card.attr || {}))}"></label>
            <label class="fld">关键词（逗号分隔）<input type="text" data-f="kw" value="${esc((card.keywords || []).join(', '))}"></label>
            <label class="fld">默认张数<input type="number" min="0" max="9" data-f="copies" value="${card.copies ?? 2}"></label>
            <label class="fld">图片路径 / dataURL（可空）<input type="text" data-f="img" value="${esc(card.img || '')}"></label>
          </div>
          <label class="fld" style="margin-top:12px">效果文本<textarea data-f="text" rows="3">${esc(card.text || '')}</textarea></label>
        </div>
      </div>
      <div style="margin-top:14px;display:flex;gap:10px">
        <button class="btn btn-primary" id="ed-save">${isNew ? '创建' : '保存覆盖'}</button>
        ${!isNew ? `<button class="btn btn-danger" id="ed-revert">还原为官方数据</button>` : ''}
        <button class="btn" id="ed-cancel">关闭</button>
      </div>`;

    /* 卡图预览：随图片路径输入实时刷新；支持本地图片压缩上传 */
    const thumb = form.querySelector('#ed-thumb');
    const imgInput = form.querySelector('[data-f="img"]');
    const syncThumb = () => {
      const v = imgInput.value.trim();
      if (v) { thumb.src = v; thumb.style.display = ''; } else thumb.style.display = 'none';
    };
    imgInput.addEventListener('input', syncThumb); syncThumb();
    form.querySelector('#ed-imgfile').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        imgInput.value = await shrinkImage(f);
        imgInput.dispatchEvent(new Event('input'));
        toast('底图已压缩载入（JPEG ≤900px）');
      } catch { toast('图片读取失败'); }
    };

    form.querySelector('#ed-cancel').onclick = () => form.innerHTML = '';
    form.querySelector('#ed-save').onclick = () => {
      const g = f => form.querySelector(`[data-f="${f}"]`).value.trim();
      let attr;
      try { attr = JSON.parse(g('attrJson') || '{}'); } catch { toast('属性需求 JSON 格式错误'); return; }
      const obj = {
        name: g('name'), group: g('group'), set: g('set'), deck: g('deck'), type: g('type'),
        cost: g('cost') === '' ? null : (isNaN(+g('cost')) ? g('cost') : +g('cost')),
        attr, keywords: g('kw') ? g('kw').split(/[,，]/).map(s => s.trim()).filter(Boolean) : [],
        copies: +g('copies') || 0, img: g('img'), text: g('text'),
      };
      if (!obj.name) { toast('名称必填'); return; }
      if (isNew) {
        DB.customs.push({ id: 'cu' + uid(), ...obj, review: false });
        toast('已创建自定义卡');
      } else {
        DB.overrides[card.id] = { ...(DB.overrides[card.id] || {}), ...obj };
        toast('已保存本地覆盖');
      }
      saveDB(); editor(v);
    };
    if (!isNew) form.querySelector('#ed-revert').onclick = () => {
      delete DB.overrides[card.id]; saveDB(); toast('已还原'); editor(v);
    };
  }

  $('#ed-new').onclick = () => showForm({ group: 'background', set: 'base', copies: 2 }, true);
  $('#ed-pick').onchange = e => { if (e.target.value) showForm(cardById(e.target.value), false); };

  const rows = [];
  for (const c of DB.customs) rows.push([c, '自定义']);
  for (const id of Object.keys(DB.overrides)) { const c = cardById(id); if (c && !c.custom) rows.push([c, '覆盖']); }
  $('#ed-list').innerHTML = rows.map(([c, st]) => `
    <tr><td>${c.img ? `<img src="${esc(c.img)}" style="height:34px;border-radius:4px;vertical-align:middle;margin-right:6px">` : ''}${esc(c.name)}</td>
    <td class="small muted">${esc(c.type || GROUPS[c.group])}</td>
    <td><span class="tag ${st === '自定义' ? 'blue' : 'amber'}">${st}</span></td>
    <td><button class="btn btn-sm" data-edit="${esc(c.id)}">编辑</button>
        <button class="btn btn-sm btn-danger" data-del="${esc(c.id)}" data-st="${st}">删除</button></td></tr>`).join('')
    || '<tr><td colspan="4" class="muted small">暂无。上方新建或选择官方卡修正。</td></tr>';
  v.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => showForm(cardById(b.dataset.edit), b.dataset.edit.startsWith('cu')));
  v.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    if (b.dataset.st === '自定义') DB.customs = DB.customs.filter(x => x.id !== b.dataset.del);
    else delete DB.overrides[b.dataset.del];
    saveDB(); editor(v);
  });
}

/* ================= 5) 卡牌整合 ================= */
function merge(v) {
  const cards = allCards();
  const byName = {};
  cards.forEach(c => { (byName[c.name] = byName[c.name] || []).push(c); });
  const dup = Object.entries(byName).filter(([, l]) => l.length > 1);
  const setStat = Object.entries(SETS).map(([k, n]) => {
    const l = cards.filter(c => c.set === k);
    return `<div class="bar-row"><span class="bl">${n}</span>
      <div class="btrack"><div class="bfill" style="width:${cards.length ? l.length / cards.length * 100 : 0}%"></div></div>
      <span class="bv">${l.length}</span></div>`;
  }).join('');
  const groupStat = Object.entries(GROUPS).map(([k, n]) => {
    const l = cards.filter(c => c.group === k);
    return `<div class="bar-row"><span class="bl">${n}</span>
      <div class="btrack"><div class="bfill" style="width:${cards.length ? l.length / cards.length * 100 : 0}%"></div></div>
      <span class="bv">${l.length}</span></div>`;
  }).join('');

  v.innerHTML = `
    <h2 class="page-title">卡牌整合</h2>
    <p class="page-sub">官方数据（data-cards.js）＋ 本地覆盖 ＋ 自定义卡 → 统一卡牌视图。同名/多版本卡在此检查。</p>
    <div class="panel"><h3 style="margin-bottom:10px">整合来源</h3>
      <table class="tbl">
        <tr><td>📦 官方数据${CARDS_PACK ? '（云端数据包）' : '（data-cards.js）'}</td><td><b>${cardSource().length}</b> 条</td>
            <td class="small muted">随仓库部署，全站只读</td></tr>
        <tr><td>✏️ 本地覆盖（overrides）</td><td><b>${Object.keys(DB.overrides).length}</b> 条</td>
            <td class="small muted">按卡 ID 合并字段，官方数据不变</td></tr>
        <tr><td>🆕 自定义卡（customs）</td><td><b>${DB.customs.length}</b> 条</td>
            <td class="small muted">追加进统一视图，可参与构筑</td></tr>
      </table>
    </div>
    <div class="panel"><h3 style="margin-bottom:10px">规模分布</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px">
        <div>${setStat}</div><div>${groupStat}</div>
      </div></div>
    <div class="panel"><h3 style="margin-bottom:10px">同名 / 疑似重复检查</h3>
      ${dup.length ? `<table class="tbl"><thead><tr><th>名称</th><th>出现</th></tr></thead><tbody>
        ${dup.map(([n, l]) => `<tr><td><b>${esc(n)}</b></td><td class="small">
          ${l.map(c => `${esc(SETS[c.set])} · ${esc(GROUPS[c.group])}${c.deck ? '·' + esc(c.deck) : ''}${c.custom ? '（自定义）' : ''}`).join('<br>')}</td></tr>`).join('')}
      </tbody></table>` : '<p class="small ok">✔ 未发现同名条目。</p>'}
      <p class="small muted" style="margin-top:8px">基础与扩展的同名卡（如属性牌、性格牌）按「同一种卡的多个版本」处理，构筑时视为可选池。</p>
    </div>`;
}

/* ================= 6) 角色创建（构筑向导） ================= */
const BuilderUI = { cur: null };

/* ------------------------------------------------------------------
 * v38：选牌界面的「搜索 / 筛选 / 排序」栏
 * 每个步骤一套筛选条件，存在 BuilderUI.pf[步骤序号] 里（不落库，刷新即复位）。
 * 条件：关键字 / 类型 / 费用 / 需求 / 标签 + 排序 + 「只看可选」。
 * ------------------------------------------------------------------ */
const PICK_SORTS = [
  { k: 'default', label: '默认顺序' },
  { k: 'name',    label: '名称 A→Z' },
  { k: 'cost',    label: '费用 低→高' },
  { k: 'costD',   label: '费用 高→低' },
  { k: 'req',     label: '需求 低→高' },
  { k: 'reqD',    label: '需求 高→低' },
  { k: 'type',    label: '类型' },
  { k: 'attr',    label: '按属性' },
];
const PICK_SORT_KEYS = PICK_SORTS.map(s => s.k);
/* ------------------------------------------------------------------
 * v43：有效属性需求 —— 唯一的取值口径，显示与组牌校验都从这里读。
 *   属性牌：attr 是点数分配（牌库基准），直接采用。
 *   其它牌：校对栏填过「类型 + 需求」→ 以输入为准（proofed:true）；
 *           只填了数字没选类型、而卡面本来就只有一项需求 → 按那一项覆盖数字；
 *           只选了类型没填数字 → 沿用卡面数字，但算已校对（类型已人工确认）；
 *           都没填 → 卡面 OCR 值（proofed:false，显示成虚线提醒未校对）。
 * ------------------------------------------------------------------ */
function cardReqEff(c) {
  if (!c) return { map: null, proofed: false };
  const raw = (c.attr && Object.keys(c.attr).length) ? c.attr : null;
  if (c.group === 'attribute') return { map: raw, proofed: true };
  if (REQ_PROOF_GROUPS.includes(c.group) && typeof rangerDataOf === 'function') {
    const d = rangerDataOf(c.id);
    const hasReq = d.req !== '' && d.req != null;
    if (d.type && hasReq) return { map: { [d.type]: Number(d.req) }, proofed: true };
    if (hasReq && raw && Object.keys(raw).length === 1)
      return { map: { [Object.keys(raw)[0]]: Number(d.req) }, proofed: true };
    if (d.type && raw && Object.prototype.hasOwnProperty.call(raw, d.type))
      return { map: { [d.type]: raw[d.type] }, proofed: true };
  }
  return { map: raw, proofed: false };
}
function cardReqMap(c) { return cardReqEff(c).map; }
const cardReqProofed = c => cardReqEff(c).proofed;
/* 每张卡在筛选栏眼里长什么样（统一取值口径，避免各步骤算法不一致） */
const pickCostNum = c => {
  const n = Number(c?.cost);
  return (c?.cost == null || c.cost === '' || isNaN(n)) ? null : n;
};
/* 需求点数：性格牌优先取校对里填的需求，其次取卡面；其它牌取属性需求里最大的一项 */
function pickReqNum(c) {
  if (!c) return 0;
  if (c.group === 'trait') {
    const rd = typeof rangerDataOf === 'function' ? rangerDataOf(c.id) : { req: '' };
    if (rd.req !== '' && rd.req != null) return Number(rd.req);
    return typeof traitReq === 'function' ? traitReq(c) : 1;
  }
  const vs = Object.values(cardReqMap(c) || {}).filter(v => typeof v === 'number');
  return vs.length ? Math.max(...vs) : 0;
}
/* 需求对应的属性键（用于按属性排序 / 展示） */
function pickReqAttr(c) {
  if (!c) return '';
  if (c.group === 'trait') {
    const g = traitGroupById(c.id);
    if (g) return g.attr;
    const rd = typeof rangerDataOf === 'function' ? rangerDataOf(c.id) : { type: '' };
    return rd.type || '';
  }
  const e = Object.entries(cardReqMap(c) || {}).filter(([, v]) => typeof v === 'number');
  return e.length ? e.sort((a, b) => b[1] - a[1])[0][0] : '';
}
/* 关键字命中：名称 / 类型 / 牌组 / 标签 / 效果 / 风味 */
function pickMatchQ(c, q) {
  if (!q) return true;
  const s = String(q).trim().toLowerCase();
  if (!s) return true;
  const hay = [c.name, c.type, c.deck, c.set, ...(c.keywords || []),
               ...cardTextLines(c), c.flavor, c.desc].filter(Boolean).join(' ').toLowerCase();
  return s.split(/\s+/).every(w => hay.includes(w));
}
function pickFilterOf(idx) {
  BuilderUI.pf = BuilderUI.pf || {};
  const f = BuilderUI.pf[idx];
  const ok = f && typeof f === 'object';
  const cur = ok ? f : {};
  const norm = {
    q: typeof cur.q === 'string' ? cur.q : '',
    type: cur.type || '',
    cost: cur.cost || '',
    req: cur.req || '',
    tag: cur.tag || '',
    sort: PICK_SORT_KEYS.includes(cur.sort) ? cur.sort : 'default',
    ok: !!cur.ok,
  };
  return (BuilderUI.pf[idx] = norm);
}
/* 按条件过滤 + 排序（blkFn：返回该卡的限制对象，用于「只看可选」） */
function pickApply(pool, f, blkFn) {
  let out = pool.filter(c => {
    if (!pickMatchQ(c, f.q)) return false;
    if (f.type && (c.type || '') !== f.type) return false;
    if (f.tag && !(c.keywords || []).includes(f.tag)) return false;
    if (f.cost !== '') {
      const n = pickCostNum(c);
      if (f.cost === 'none') { if (n != null) return false; }
      else if (n == null || String(n) !== String(f.cost)) return false;
    }
    if (f.req !== '') {
      const n = pickReqNum(c);
      if (f.req === 'none') { if (n > 0) return false; }
      else if (String(n) !== String(f.req)) return false;
    }
    if (f.ok && blkFn) { const b = blkFn(c.id); if (b && !b.soft) return false; }
    return true;
  });
  const nameOf = c => String(c.name || '');
  const coll = (typeof Intl !== 'undefined' && Intl.Collator)
    ? new Intl.Collator('zh-Hans-CN', { numeric: true }) : { compare: (a, b) => a < b ? -1 : a > b ? 1 : 0 };
  switch (f.sort) {
    case 'name':  out = out.slice().sort((a, b) => coll.compare(nameOf(a), nameOf(b))); break;
    case 'cost':  out = out.slice().sort((a, b) => (pickCostNum(a) ?? 99) - (pickCostNum(b) ?? 99) || coll.compare(nameOf(a), nameOf(b))); break;
    case 'costD': out = out.slice().sort((a, b) => (pickCostNum(b) ?? -1) - (pickCostNum(a) ?? -1) || coll.compare(nameOf(a), nameOf(b))); break;
    case 'req':   out = out.slice().sort((a, b) => pickReqNum(a) - pickReqNum(b) || coll.compare(nameOf(a), nameOf(b))); break;
    case 'reqD':  out = out.slice().sort((a, b) => pickReqNum(b) - pickReqNum(a) || coll.compare(nameOf(a), nameOf(b))); break;
    case 'type':  out = out.slice().sort((a, b) => coll.compare(String(a.type || ''), String(b.type || '')) || coll.compare(nameOf(a), nameOf(b))); break;
    case 'attr':  out = out.slice().sort((a, b) => {
      const ia = ATTRS.indexOf(pickReqAttr(a)), ib = ATTRS.indexOf(pickReqAttr(b));
      return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib) || pickReqNum(a) - pickReqNum(b) || coll.compare(nameOf(a), nameOf(b));
    }); break;
    default: break;
  }
  return out;
}
/* 工具栏 HTML（各步骤共用；传 false 关掉不需要的筛选项） */
function pickBarHTML(idx, pool, fields = {}) {
  const f = pickFilterOf(idx);
  const use = Object.assign({ q: true, type: true, cost: true, req: true, tag: true, sort: true, ok: true }, fields);
  const types = [...new Set(pool.map(c => c.type).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'));
  const costs = [...new Set(pool.map(pickCostNum).filter(n => n != null))].sort((a, b) => a - b);
  const tags  = [...new Set(pool.flatMap(c => (c.keywords || []).filter(Boolean)))].sort((a, b) => a.localeCompare(b, 'zh'));
  const reqs  = [...new Set(pool.map(pickReqNum).filter(n => n > 0))].sort((a, b) => a - b);
  return `<div class="pickbar" id="pb-${idx}">
    ${use.q ? `<input type="search" id="pb-${idx}-q" class="pb-q" placeholder="🔍 搜索名称 / 关键字 / 效果…" value="${esc(f.q)}">` : ''}
    ${use.type ? `<label class="pb-f">类型<select id="pb-${idx}-type">
        <option value="">全部类型</option>
        ${types.map(t => `<option value="${esc(t)}"${f.type === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}
      </select></label>` : ''}
    ${use.cost ? `<label class="pb-f">费用<select id="pb-${idx}-cost">
        <option value="">全部费用</option>
        ${costs.map(n => `<option value="${esc(n)}"${String(f.cost) === String(n) ? ' selected' : ''}>${esc(n)} 点</option>`).join('')}
        <option value="none"${f.cost === 'none' ? ' selected' : ''}>无费用</option>
      </select></label>` : ''}
    ${use.req ? `<label class="pb-f">需求<select id="pb-${idx}-req">
        <option value="">全部需求</option>
        ${reqs.map(n => `<option value="${esc(n)}"${String(f.req) === String(n) ? ' selected' : ''}>需求 ${esc(n)}</option>`).join('')}
        <option value="none"${f.req === 'none' ? ' selected' : ''}>无需求</option>
      </select></label>` : ''}
    ${use.tag ? `<label class="pb-f">标签<select id="pb-${idx}-tag">
        <option value="">全部标签</option>
        ${tags.map(t => `<option value="${esc(t)}"${f.tag === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}
      </select></label>` : ''}
    ${use.sort ? `<label class="pb-f">排序<select id="pb-${idx}-sort">
        ${PICK_SORTS.map(s => `<option value="${esc(s.k)}"${f.sort === s.k ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}
      </select></label>` : ''}
    ${use.ok ? `<label class="pb-chk"><input type="checkbox" id="pb-${idx}-ok"${f.ok ? ' checked' : ''}>只看可选</label>` : ''}
    <button class="btn btn-sm" id="pb-${idx}-clr">清空筛选</button>
    <span class="pb-n small muted" id="pb-${idx}-n"></span>
  </div>`;
}

/* 空白行者卡（可自定义）：名称 / 技能 / 属性 均可按构筑独立设定 */
const BLANK_ROLE_ID = 'ro-valley-8';
/* 角色牌的实际展示信息：空白卡用本构筑的 roleCustom 覆盖 */
function roleInfo(d) {
  const c = d.steps.role ? cardById(d.steps.role) : null;
  if (!c) return null;
  if (c.customizable) {
    const rc = d.steps.roleCustom || {};
    return {
      name: (rc.name || '').trim() || d.name,
      text: rc.text || '',
      attr: Object.fromEntries(Object.entries(rc.attr || {}).filter(([, v]) => v != null && v !== '')),
      img: rc.img || c.img,
      custom: true, customizable: true,
    };
  }
  return { name: c.name, text: c.text || '', attr: c.attr || {}, img: c.img, custom: false, customizable: false };
}

function deckStatus(d) {
  const cards = allCards();
  const problems = [];
  const steps = d.steps || {};
  const attr = steps.attribute ? cardById(steps.attribute)?.attr : null;
  const kinds = new Set(); let total = 0;
  /* 奖励替换：被换掉的初始牌 → 记成奖励牌（张数不变，仍是 15 种 30 张） */
  const rwList = steps.rewards || [];
  const swap = {};
  rwList.forEach(x => { if (x.reward && x.replaced) swap[x.replaced] = x.reward; });
  const mapId = id => swap[id] || id;

  const push = (id, n) => {
    const c = cardById(id); if (!c) return;
    kinds.add(c.id); total += n;
    if (attr && c.attr) for (const [k, v] of Object.entries(c.attr))
      if ((attr[k] ?? 0) < v) problems.push(`「${c.name}」需要 ${ATTR_FULL[k]} ${v} 点，当前属性牌只有 ${attr[k] ?? 0} 点`);
  };

  // 性格 4 种 × 2（按四色分组，每组 1 张）
  const tSlots = traitSlots(d);
  const tKinds = Object.values(tSlots).filter(Boolean);
  tKinds.map(mapId).forEach(id => push(id, 2));
  /* 每组只能 1 张 + 需求不得超过属性牌点数 */
  for (const [k, id] of Object.entries(tSlots)) {
    const c = cardById(id), g = traitGroupsAll().find(x => x.key === k);
    if (!c || !g) continue;
    const need = traitReq(c);
    if (attr && (attr[g.attr] ?? 0) < need)
      problems.push(`性格「${c.name}」需要 ${ATTR_FULL[g.attr]} ${need} 点，属性牌只有 ${attr[g.attr] ?? 0} 点`);
  }
  const tGroupN = TRAIT_KEYS().filter(k => tSlots[k]).length;
  if (tKinds.length < 4) problems.push(`性格：还需选择 ${4 - tKinds.length} 组（四色各 1 种，每种 2 张）`);
  else if (tGroupN < 4) problems.push('性格：四色分组里有重复（同一颜色只能选 1 张）');

  // 背景 5 种 × 2
  const bgPicks = steps.background?.picks || [];
  bgPicks.map(mapId).forEach(id => push(id, 2));
  if (steps.background?.deck && bgPicks.length < RULES.background.kinds)
    problems.push(`背景：${steps.background.deck} 中已选 ${bgPicks.length}/${RULES.background.kinds} 种`);
  if (!steps.background?.deck) problems.push('背景：尚未选择牌组');

  // 专长 5 种 × 2
  const exPicks = steps.expertise?.picks || [];
  exPicks.map(mapId).forEach(id => push(id, 2));
  if (steps.expertise?.deck && exPicks.length < RULES.expertise.kinds)
    problems.push(`专长：${steps.expertise.deck} 中已选 ${exPicks.length}/${RULES.expertise.kinds} 种`);
  if (!steps.expertise?.deck) problems.push('专长：尚未选择牌组');

  // 角色 1 张
  if (!steps.role) problems.push('角色牌：尚未选择（从所选专长牌组中选 1 张）');

  // 爱好 1 种 × 2
  if (steps.hobby) push(mapId(steps.hobby), 2);
  else problems.push('爱好：尚未选择（任一背景/专长牌组中 1 种无「专家」的未选牌，2 张）');

  // 汇总
  if (kinds.size !== DECK_TOTAL.kinds || total !== DECK_TOTAL.cards)
    problems.push(`牌库合计 ${kinds.size} 种 ${total} 张，应为 ${DECK_TOTAL.kinds} 种 ${DECK_TOTAL.cards} 张`);
  const hobbyDup = steps.hobby && (bgPicks.includes(steps.hobby) || exPicks.includes(steps.hobby) || tKinds.includes(steps.hobby));
  if (hobbyDup) problems.push('爱好：与背景/专长/性格已选牌重复（应为 15 种不同卡）');

  return { kinds: kinds.size, cards: total, problems, kindsSet: kinds };
}

/* ============================================================
 * 牌组代码（可复制粘贴的一段数据）
 * 形如 EBRD1:<base64>，也可整段作为链接 #deck=EBRD1:... 粘贴导入。
 * 只存「卡牌 id + 自定义内容」，导入时按当前卡牌数据还原。
 * ============================================================ */
const DECK_CODE_VER = 'EBRD1';
const b64enc = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0)));

function encodeDeckCode(d) {
  const s = d.steps || {};
  const payload = {
    v: 1, n: d.name || '',
    a: s.attribute || '',
    t: traitSlots(d),                                   // { 颜色key: cardId }
    b: { d: s.background?.deck || '', p: s.background?.picks || [] },
    e: { d: s.expertise?.deck || '', p: s.expertise?.picks || [] },
    r: s.role || '',
    rc: s.roleCustom || null,
    h: s.hobby || '',
    w: s.rewards || [],                                 // 奖励替换记录
  };
  return DECK_CODE_VER + ':' + b64enc(JSON.stringify(payload));
}
const deckLink = d => location.origin + location.pathname + '#deck=' + encodeDeckCode(d);
/* 兼容：既接受纯代码，也接受整条链接 / #deck= 片段 */
function normalizeDeckCode(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(/#deck=([A-Za-z0-9+/=:._-]+)/);
  if (m) s = m[1];
  else if (/^https?:/i.test(s)) { try { const u = new URL(s); s = (u.hash.match(/#deck=(.+)/) || [, ''])[1]; } catch { /* ignore */ } }
  return s.replace(/\s+/g, '');
}
function decodeDeckCode(raw) {
  const s = normalizeDeckCode(raw);
  if (!s.startsWith(DECK_CODE_VER + ':')) return { error: '不是有效的牌组代码（应以 ' + DECK_CODE_VER + ' 开头）' };
  let o;
  try { o = JSON.parse(b64dec(s.slice(DECK_CODE_VER.length + 1))); }
  catch (e) { return { error: '代码解析失败：' + (e.message || '') }; }
  if (!o || typeof o !== 'object') return { error: '代码内容为空' };
  const miss = [];
  const has = id => !id || !!cardById(id);
  ['a', 'r', 'h'].forEach(k => { if (o[k] && !has(o[k])) miss.push(o[k]); });
  Object.values(o.t || {}).forEach(id => { if (id && !has(id)) miss.push(id); });
  [...(o.b?.p || []), ...(o.e?.p || []), ...(o.w || []).map(x => x.reward)].forEach(id => { if (id && !has(id)) miss.push(id); });
  const deck = {
    id: uid(),
    name: o.n || '导入的牌组',
    created: Date.now(),
    imported: true,
    steps: {
      attribute: o.a || null,
      traits: o.t || {},
      background: { deck: o.b?.d || '', picks: o.b?.p || [] },
      expertise: { deck: o.e?.d || '', picks: o.e?.p || [] },
      role: o.r || null,
      roleCustom: o.rc || null,
      hobby: o.h || null,
      rewards: o.w || [],
    },
  };
  return { deck, missing: miss };
}

function builder(v) {
  if (!BuilderUI.cur) {
    const list = DB.decks || [];
    v.innerHTML = `
      <h2 class="page-title">角色创建</h2>
      <p class="page-sub">按《规则手册》P32–33 的流程创建行者：属性牌 → 性格（四色各 1 种）→ 背景 → 专长+角色牌 → 爱好 → 奖励替换，最终牌库 15 种 × 2 张 + 角色牌 + 属性牌。</p>
      <div class="panel">
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
          <input type="text" id="bw-name" placeholder="新行者名称" style="min-width:200px">
          <button class="btn btn-primary" id="bw-create">开始创建</button>
          <span class="flex-spacer"></span>
          <input type="text" id="bw-imptxt" placeholder="粘贴牌组代码或分享链接" style="min-width:240px">
          <button class="btn" id="bw-import">导入牌组</button>
        </div>
        <p class="small muted" style="margin-bottom:12px">牌组代码可以在牌组列表里点「代码」获取，也可以把整条分享链接粘进来。</p>
        ${list.length ? `<table class="tbl"><thead><tr><th>行者</th><th>背景/专长</th><th>进度</th><th style="width:300px">操作</th></tr></thead><tbody>
          ${list.map(d => { const st = deckStatus(d); return `
            <tr><td><b>${esc(d.name)}</b>${d.imported ? ' <span class="tag blue">导入</span>' : ''}</td>
            <td class="small">${esc(d.steps?.background?.deck || '—')} / ${esc(d.steps?.expertise?.deck || '—')}</td>
            <td class="small ${st.cards === 30 ? 'ok' : 'bad'}">${st.kinds}/${DECK_TOTAL.kinds} 种 · ${st.cards}/${DECK_TOTAL.cards} 张</td>
            <td><button class="btn btn-sm" data-open="${d.id}">打开</button>
                <button class="btn btn-sm" data-copy="${d.id}" title="复制一份新的构筑">复制</button>
                <button class="btn btn-sm" data-code="${d.id}" title="生成可分享的牌组代码">代码</button>
                <button class="btn btn-sm btn-danger" data-del="${d.id}">删除</button></td></tr>`; }).join('')}
        </tbody></table>` : '<p class="muted small">还没有行者构筑。</p>'}
      </div>
      <div class="panel" id="dc-box" hidden>
        <h3 style="margin-bottom:8px">牌组代码 · <span id="dc-name"></span></h3>
        <p class="small muted" style="margin-bottom:8px">复制下面任一种：① <b>代码</b>（短，可直接粘贴到「粘贴牌组代码」框）；② <b>链接</b>（打开即导入）。</p>
        <label class="fld" style="margin-bottom:8px">代码<textarea id="dc-code" rows="3" readonly></textarea></label>
        <label class="fld">链接<textarea id="dc-link" rows="2" readonly></textarea></label>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm btn-primary" id="dc-copy">复制代码</button>
          <button class="btn btn-sm" id="dc-copylink">复制链接</button>
          <button class="btn btn-sm" id="dc-close">关闭</button>
        </div>
      </div>`;
    $('#bw-create').onclick = () => {
      const name = $('#bw-name').value.trim(); if (!name) { toast('请输入行者名称'); return; }
      const d = { id: uid(), name, created: Date.now(), steps: { traits: {}, background: { picks: [] }, expertise: { picks: [] } } };
      DB.decks.push(d); saveDB(); BuilderUI.cur = d.id; location.hash = '#builder'; renderRoute();
    };
    const doImport = () => {
      const txt = ($('#bw-imptxt').value || '').trim();
      if (!txt) { toast('请先粘贴牌组代码或链接'); return; }
      const r = decodeDeckCode(txt);
      if (r.error) { toast(r.error, 3600); return; }
      DB.decks = DB.decks || [];
      DB.decks.push(r.deck); saveDB();
      if (r.missing?.length) toast(`已导入「${r.deck.name}」，但有 ${r.missing.length} 张卡在当前数据中找不到（可能来自其它版本）`, 4200);
      else toast(`已导入牌组「${r.deck.name}」`, 3000);
      $('#bw-imptxt').value = '';
      renderRoute();
    };
    $('#bw-import').onclick = doImport;
    $('#bw-imptxt').onkeydown = e => { if (e.key === 'Enter') doImport(); };
    v.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { BuilderUI.cur = b.dataset.open; BuilderUI.step = 0; renderRoute(); });
    v.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => {
      const src = DB.decks.find(x => x.id === b.dataset.copy); if (!src) return;
      const cp = JSON.parse(JSON.stringify(src));
      cp.id = uid(); cp.name = `${src.name} · 副本`; cp.created = Date.now();
      DB.decks.push(cp); saveDB(); renderRoute();
      toast(`已复制为「${cp.name}」`, 2600);
    });
    v.querySelectorAll('[data-code]').forEach(b => b.onclick = () => {
      const d = DB.decks.find(x => x.id === b.dataset.code); if (!d) return;
      const box = $('#dc-box');
      box.hidden = false;
      $('#dc-name').textContent = d.name;
      $('#dc-code').value = encodeDeckCode(d);
      $('#dc-link').value = deckLink(d);
      box.scrollIntoView({ block: 'nearest' });
    });
    const copyFrom = sel => {
      const el = $(sel); if (!el) return;
      el.select(); el.setSelectionRange(0, 99999);
      let okc = false;
      try { okc = document.execCommand('copy'); } catch (e) { okc = false; }
      if (!okc && navigator.clipboard) navigator.clipboard.writeText(el.value).then(() => toast('已复制'), () => toast('复制失败，请手动选中复制'));
      else toast(okc ? '已复制到剪贴板' : '请手动选中复制');
    };
    const c1 = $('#dc-copy'); if (c1) c1.onclick = () => copyFrom('#dc-code');
    const c2 = $('#dc-copylink'); if (c2) c2.onclick = () => copyFrom('#dc-link');
    const c3 = $('#dc-close'); if (c3) c3.onclick = () => { $('#dc-box').hidden = true; };
    v.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      if (!confirm('确定删除该行者构筑？')) return;
      DB.decks = DB.decks.filter(x => x.id !== b.dataset.del); saveDB(); renderRoute();
    });
    return;
  }

  const d = DB.decks.find(x => x.id === BuilderUI.cur);
  if (!d) { BuilderUI.cur = null; return builder(v); }
  const steps = d.steps;
  const stepIdx = BuilderUI.step ?? 0;
  const STEPS = ['属性牌', '性格', '背景', '专长', '角色牌', '爱好', '奖励替换', '总览'];

  const st = deckStatus(d);
  const attr = steps.attribute ? cardById(steps.attribute)?.attr : null;

  /* ---- 联动上下文：当前步骤 / 已选属性 / 已入选牌库的牌 ---- */
  const STEP_KEY = ['attribute', 'trait', 'background', 'expertise', 'role', 'hobby', 'reward'][stepIdx] || '';
  const usedIds = [...(steps.background?.picks || []), ...(steps.expertise?.picks || []), ...traitPickedIds(d)];
  const LINK_CTX = {
    step: STEP_KEY,
    attr: attr || null,
    used: usedIds,
    expDeck: steps.expertise?.deck || '',
    picked: traitPickedIds(d),
    traitSlots: traitSlots(d),
    bgDeck: steps.background?.deck || '',
    traitAttrs: [...new Set(traitPickedIds(d).map(id => traitGroupById(id)?.attr).filter(Boolean))],
  };
  /* cardId -> { msg, soft, rule }：当前步骤被规则判定的卡 */
  const BLOCK = new Map();
  const rulesOn = () => featureOn('deckrules');
  /* 单张卡在当前步骤的限制提示（置灰原因） */
  const blkOf = id => BLOCK.get(id) || null;
  const whyHTML = id => {
    const b = blkOf(id);
    return b ? `<div class="pick-why ${b.soft ? 'soft' : ''}">${b.soft ? '⚠' : '⛔'} ${esc(b.msg)}</div>` : '';
  };
  /* 应用联动规则：hide 类规则直接从池中剔除，其余保留但置灰并给出原因
     v38：去掉「总开关关闭就直接放行」的短路 —— 属性需求是 always 规则，关掉总开关也要拦 */
  const linked = pool => {
    BLOCK.clear();
    const out = [];
    for (const c of pool) {
      const b = linkBlock(c, LINK_CTX);
      if (!b) { out.push(c); continue; }
      BLOCK.set(c.id, b);
      if (b.soft) out.push(c);                                   // 待校对的软提示：仍可选
      else if (!(LINK_RULES.find(r => r.id === b.rule) || {}).hide) out.push(c);
    }
    return out;
  };

  /* ---- 选择池 ---- */
  function pickList(group, deck, opts = {}) {
    let pool = allCards().filter(c => (group == null || c.group === group) && (!deck || c.deck === deck));
    if (opts.only) pool = pool.filter(c => opts.only.includes(c.group));
    return linked(pool);
  }

  const sel = id => cardById(id)?.name || '（已删除）';
  let body = '';
  /* v38：筛选栏要在 body 塞进 DOM 之后才能绑定，先记下，最后统一执行 */
  let postBar = null;
  const noEmpty = html => html || '<p class="muted small" style="padding:8px 2px">这一组里没有符合条件的牌。</p>';

  if (stepIdx === 0) {           // 属性牌
    const pool = pickList('attribute');
    const attrTile = c => `
        <div class="pick ${steps.attribute === c.id ? 'sel' : ''} ${blkOf(c.id) && !blkOf(c.id).soft ? 'disabled' : ''}" data-sel="${c.id}" title="${blkOf(c.id) ? esc(blkOf(c.id).msg) : ''}">
          ${steps.attribute === c.id ? '<span class="badge">已选</span>' : ''}
          ${c.img ? `<img src="${esc(c.img)}" style="width:100%;border-radius:7px;margin-bottom:7px" loading="lazy">` : ''}
          <div class="pname">${esc(c.name)}</div>
          <div class="pmeta">${reqChipsHTML(c)}<br>${esc(SETS[c.set])}</div>
          ${whyHTML(c.id)}
        </div>`;
    body = `<p class="small muted" style="margin-bottom:10px">${RULES.attribute.note}。基础 12 张 + 山谷卫士新增，属性需求校验将以此牌为基准。</p>
      ${pickBarHTML(0, pool, { type: false, cost: false, req: false, tag: false, ok: false })}
      <div class="pick-grid" id="pb-list-0">${pool.map(attrTile).join('')}</div>`;
    postBar = () => bindPickBar(v, 0, pool, list => list.map(attrTile).join(''), { type: false, cost: false, req: false, tag: false, ok: false });
  }
  else if (stepIdx === 1) {      // 性格：按四色分组，每组 1 张
    const slots = traitSlots(d);
    const picked = Object.values(slots).filter(Boolean);
    /* 一次过规则，再按颜色分块展示（linked 会清空 BLOCK，不能分块各调一次） */
    const pool = linked(allCards().filter(c => c.group === 'trait'));
    const inPool = new Set(pool.map(c => c.id));
    const tile = (c, g) => {
      const on = slots[g.key] === c.id;
      const other = slots[g.key] && !on;
      const blk = blkOf(c.id);
      const dis = !!(blk && !blk.soft && !on);
      /* v37：校对里填过「需求」就以校对值为准，没填才退回 OCR 的 1 点 */
      const rd = rangerDataOf(c.id);
      const have = attr ? (attr[g.attr] ?? 0) : null;
      const need = (rd.req !== '' && rd.req != null) ? Number(rd.req) : traitReq(c);
      const reqPend = (rd.req !== '' && rd.req != null) ? false : traitReqPending(c);
      return `<div class="pick ${on ? 'sel' : ''} ${dis ? 'disabled' : ''}" data-traitpick="${c.id}" title="${blk ? esc(blk.msg) : ''}">
        ${on ? '<span class="badge">已选</span>' : ''}
        ${c.img ? `<img src="${esc(c.img)}" style="width:100%;border-radius:7px;margin-bottom:7px" loading="lazy">` : ''}
        <div class="pname">${esc(c.name)}</div>
        <div class="pmeta">${esc(c.type || '品质')} · ${esc(rangerReqText(c) || `需求 ${need}`)}${reqPend ? ' <span class="tag gray" title="卡图上的需求数字尚未校对，暂按 1 处理">待校对</span>' : ''}
          ${have != null ? ` <span class="${have >= need ? 'ok' : 'bad'}">（你有 ${have}）</span>` : ''}</div>
        ${rangerLineHTML(c, { tag: 'div', skipReq: true })}
        ${whyHTML(c.id)}
      </div>`;
    };
    /* v38：分块渲染 + 筛选后的重绘共用这一段（列表容器整体替换） */
    const groupsHTML = list => {
      const ids = new Set(list.map(c => c.id));
      return traitGroupsAll().map(g => {
        const cur = slots[g.key];
        const have = attr ? (attr[g.attr] ?? 0) : null;
        const cards = g.cards.map(id => cardById(id)).filter(c => c && ids.has(c.id));
        if (!cards.length) return '';
        return `<div class="trait-group" style="border-left:5px solid ${g.color}">
          <div class="tg-head">
            <b>${g.label}组 · ${ATTR_FULL[g.attr]}</b>
            <span class="small muted">属性牌 ${have == null ? '—' : have + ' 点'} · 本组已选 ${cur ? '1' : '0'}/1</span>
          </div>
          <div class="pick-grid">${cards.map(c => tile(c, g)).join('')}</div>
        </div>`;
      }).join('');
    };
    body = `<p class="small muted" style="margin-bottom:10px">性格牌按卡面颜色分为 <b>四组</b>，每组对应一项属性：<b>每组各选 1 种 × 2 张</b>（共 8 张）；
      所选性格的「属性需求」不得超过属性牌在该项上的点数。</p>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
        <span class="small ${picked.length === 4 ? 'ok' : 'muted'}">已选 ${picked.length}/4 组（每种 2 张）</span>
        ${picked.length ? `<button class="btn btn-sm" id="clr-traits">清空</button>` : ''}
        ${!attr ? '<span class="small muted">（先到第 1 步选属性牌，才能校验需求）</span>' : ''}
      </div>
      ${pickBarHTML(1, pool, { cost: false, tag: false })}
      <div id="pb-list-1">${noEmpty(groupsHTML(pool))}</div>`;
    postBar = () => bindPickBar(v, 1, pool, groupsHTML, { cost: false, tag: false });
  }
  else if (stepIdx === 2) {      // 背景
    if (!steps.background?.deck) {
      body = `<p class="small muted" style="margin-bottom:10px">${RULES.background.note}。</p>
        <div class="pick-grid">${RULES.background.decks.map(k => {
          const n = allCards().filter(c => c.group === 'background' && c.deck === k).length;
          return `<div class="pick" data-bgd="${k}"><div class="pname">${k}</div><div class="pmeta">${n} 种可选</div></div>`;
        }).join('')}</div>`;
    } else {
      const deck = steps.background.deck;
      const pool = pickList('background', deck);
      /* v38：卡片模板抽出来，初始渲染与筛选重绘共用 */
      const bgTile = c => {
        const on = steps.background.picks.includes(c.id);
        const full = steps.background.picks.length >= 5 && !on;
        const blk = blkOf(c.id);
        const dis = full || (blk && !blk.soft);
        return `<div class="pick ${on ? 'sel' : ''} ${dis ? 'disabled' : ''}" data-bgpick="${c.id}" title="${blk ? esc(blk.msg) : ''}">
          ${on ? '<span class="badge">已选</span>' : ''}
          ${c.img ? `<img src="${esc(c.img)}" style="width:100%;border-radius:7px;margin-bottom:7px" loading="lazy">` : ''}
          <div class="pname">${esc(c.name)}${c.cost != null && c.cost !== '' ? ` <span class="small muted">费用${esc(c.cost)}</span>` : ''}</div>
          <div class="pmeta">${esc(c.type || '')}<br>${reqChipsHTML(c, { pend: true })}${reqHaveHTML(c, attr)} ${keywordsHTML(c)}</div>
          ${whyHTML(c.id)}
        </div>`;
      };
      body = `<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
          <b>背景牌组：${deck}</b>
          <button class="btn btn-sm" id="chg-deck">重选牌组</button>
          <span class="small ${steps.background.picks.length === 5 ? 'ok' : 'muted'}">已选 ${steps.background.picks.length}/5 种（每种 2 张）</span></div>
        ${pickBarHTML(2, pool)}
        <div class="pick-grid" id="pb-list-2">${pool.map(bgTile).join('')}</div>`;
      postBar = () => bindPickBar(v, 2, pool, list => list.map(bgTile).join(''));
    }
  }
  else if (stepIdx === 3) {      // 专长
    if (!steps.expertise?.deck) {
      body = `<p class="small muted" style="margin-bottom:10px">${RULES.expertise.note}。</p>
        <div class="pick-grid">${RULES.expertise.decks.map(k => {
          const n = allCards().filter(c => c.group === 'expertise' && c.deck === k).length;
          return `<div class="pick" data-expd="${k}"><div class="pname">${k}</div><div class="pmeta">${n} 种可选</div></div>`;
        }).join('')}</div>`;
    } else {
      const deck = steps.expertise.deck;
      const pool = pickList('expertise', deck);
      const expTile = c => {
        const on = steps.expertise.picks.includes(c.id);
        const full = steps.expertise.picks.length >= 5 && !on;
        const blk = blkOf(c.id);
        const dis = full || (blk && !blk.soft);
        return `<div class="pick ${on ? 'sel' : ''} ${dis ? 'disabled' : ''}" data-exppick="${c.id}" title="${blk ? esc(blk.msg) : ''}">
          ${on ? '<span class="badge">已选</span>' : ''}
          ${c.img ? `<img src="${esc(c.img)}" style="width:100%;border-radius:7px;margin-bottom:7px" loading="lazy">` : ''}
          <div class="pname">${esc(c.name)}${c.cost != null && c.cost !== '' ? ` <span class="small muted">费用${esc(c.cost)}</span>` : ''}</div>
          <div class="pmeta">${esc(c.type || '')}<br>${reqChipsHTML(c, { pend: true })}${reqHaveHTML(c, attr)} ${keywordsHTML(c)}</div>
          ${whyHTML(c.id)}
        </div>`;
      };
      body = `<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
          <b>专长牌组：${deck}</b>
          <button class="btn btn-sm" id="chg-deck">重选牌组</button>
          <span class="small ${steps.expertise.picks.length === 5 ? 'ok' : 'muted'}">已选 ${steps.expertise.picks.length}/5 种（每种 2 张）</span></div>
        ${pickBarHTML(3, pool)}
        <div class="pick-grid" id="pb-list-3">${pool.map(expTile).join('')}</div>`;
      postBar = () => bindPickBar(v, 3, pool, list => list.map(expTile).join(''));
    }
  }
  else if (stepIdx === 4) {      // 角色牌
    const deck = steps.expertise?.deck;
    /* 空白行者卡不受专长牌组限制，任何构筑都可以选 */
    const pool = linked(deck ? allCards().filter(c => c.group === 'role' && (c.deck === deck || c.customizable))
                             : allCards().filter(c => c.group === 'role'));
    const rc = steps.roleCustom || {};
    const selCustom = steps.role && cardById(steps.role)?.customizable;
    const customForm = selCustom ? `
      <div class="panel" style="margin-top:14px">
        <h3 style="margin-bottom:6px">✏️ 自定义这张行者卡</h3>
        <p class="small muted" style="margin-bottom:10px">这张卡是空白的：名称、技能、属性都由你决定（属性可留空），只影响当前这位行者。</p>
        <div class="grid-form">
          <label class="fld">卡牌名称（留空则用行者名「${esc(d.name)}」）<input type="text" id="rc-name" maxlength="20" value="${esc(rc.name || '')}" placeholder="${esc(d.name)}"></label>
          <label class="fld">知觉（可空）<input type="number" id="rc-知" min="0" max="9" value="${rc.attr?.知 ?? ''}"></label>
          <label class="fld">精神（可空）<input type="number" id="rc-精" min="0" max="9" value="${rc.attr?.精 ?? ''}"></label>
          <label class="fld">体质（可空）<input type="number" id="rc-体" min="0" max="9" value="${rc.attr?.体 ?? ''}"></label>
          <label class="fld">专注（可空）<input type="number" id="rc-专" min="0" max="9" value="${rc.attr?.专 ?? ''}"></label>
        </div>
        <label class="fld" style="margin-top:12px">技能 / 效果文本<textarea id="rc-text" rows="3" placeholder="例如：消耗：当你执行检定时，回避 1 张牌。">${esc(rc.text || '')}</textarea></label>
        <div style="display:flex;gap:12px;align-items:flex-start;margin-top:12px;flex-wrap:wrap">
          <img id="rc-thumb" alt="底图" src="${esc(rc.img || 'images/t0303.webp')}"
               style="width:110px;aspect-ratio:3/4.2;object-fit:cover;border-radius:8px;border:1px solid var(--line)">
          <div>
            <label class="btn btn-sm" style="cursor:pointer">上传自定义底图
              <input type="file" id="rc-img" accept="image/*" hidden></label>
            ${rc.img ? '<button class="btn btn-sm" id="rc-imgclr">恢复默认图</button>' : ''}
            <div class="small muted" style="margin-top:5px;max-width:220px">自定义底图（自动压缩）会用于总览与 JSON 导出，仅存本机/你的云端档案。</div>
          </div>
        </div>
      </div>` : '';
    const roleTile = c => `
        <div class="pick ${steps.role === c.id ? 'sel' : ''} ${blkOf(c.id) && !blkOf(c.id).soft ? 'disabled' : ''}" data-sel="${c.id}" title="${blkOf(c.id) ? esc(blkOf(c.id).msg) : ''}">
          ${steps.role === c.id ? '<span class="badge">已选</span>' : ''}
          ${c.img ? `<img src="${esc(c.img)}" style="width:100%;border-radius:7px;margin-bottom:7px" loading="lazy">` : ''}
          <div class="pname">${esc(c.name)}</div>
          <div class="pmeta">${c.customizable ? '空白卡 · 选入后可自定义名称 / 技能 / 属性' : esc(c.deck || '') + (c.text ? '<br>' + kwText(c.text) : '')}</div>
          ${whyHTML(c.id)}
        </div>`;
    body = `<p class="small muted" style="margin-bottom:10px">${RULES.role.note}。空白行者卡不受牌组限制，选入后可自定义名称 / 技能 / 属性。</p>
      ${pickBarHTML(4, pool, { cost: false, req: false, tag: false })}
      <div class="pick-grid" id="pb-list-4">${pool.map(roleTile).join('')}</div>${customForm}`;
    postBar = () => bindPickBar(v, 4, pool, list => list.map(roleTile).join(''), { cost: false, req: false, tag: false });
  }
  else if (stepIdx === 5) {      // 爱好
    const pool = pickList(null, null, { only: ['background', 'expertise'] });
    /* 爱好卡图：初始渲染与过滤重绘共用同一套卡片模板 */
    const hobTile = c => `
        <div class="pick ${steps.hobby === c.id ? 'sel' : ''} ${blkOf(c.id) && !blkOf(c.id).soft ? 'disabled' : ''}" data-sel="${c.id}" title="${blkOf(c.id) ? esc(blkOf(c.id).msg) : ''}">
          ${steps.hobby === c.id ? '<span class="badge">已选</span>' : ''}
          ${c.img ? `<img src="${esc(c.img)}" style="width:100%;border-radius:7px;margin-bottom:7px" loading="lazy" onerror="this.style.display='none'">` : ''}
          <div class="pname">${esc(c.name)}${c.cost != null && c.cost !== '' ? ` <span class="small muted">费用${esc(c.cost)}</span>` : ''}</div>
          <div class="pmeta">${esc(c.deck || '')} · ${esc(c.type || '')}<br>${reqChipsHTML(c, { pend: true })}${reqHaveHTML(c, attr)} ${keywordsHTML(c)}</div>
          ${whyHTML(c.id)}
        </div>`;
    body = `<p class="small muted" style="margin-bottom:10px">${RULES.hobby.note}。属性需求以所选属性牌校验。</p>
      ${pickBarHTML(5, pool)}
      <div id="pb-list-5" class="pick-grid">${pool.map(hobTile).join('')}</div>`;
    postBar = () => bindPickBar(v, 5, pool, list => list.map(hobTile).join(''));
  }
  else if (stepIdx === 6) {      // 奖励牌替换初始牌
    const rw = steps.rewards || (steps.rewards = []);
    const pool = linked(allCards().filter(c => c.group === 'reward'));
    const swap = {};
    rw.forEach(x => { if (x.reward && x.replaced) swap[x.replaced] = x.reward; });
    const libIds = [...(steps.background?.picks || []), ...(steps.expertise?.picks || []),
                    ...traitPickedIds(d), steps.hobby].filter(Boolean);
    const rwTile = c => `
      <div class="pick ${BuilderUI.rwSel === c.id ? 'sel' : ''} ${blkOf(c.id) && !blkOf(c.id).soft ? 'disabled' : ''}"
           data-rwsel="${c.id}" title="${blkOf(c.id) ? esc(blkOf(c.id).msg) : ''}">
        ${c.img ? `<img src="${esc(c.img)}" style="width:100%;border-radius:7px;margin-bottom:7px" loading="lazy">` : ''}
        <div class="pname">${esc(c.name)}</div>
        <div class="pmeta">${esc(c.type || '奖励')}<br>${reqChipsHTML(c)}${c.set ? ' · ' + esc(SETS[c.set]) : ''}</div>
        ${whyHTML(c.id)}
      </div>`;
    const replTile = id => {
      const c = cardById(id); if (!c) return '';
      const cur = swap[id];
      return `<div class="pick ${cur ? 'sel' : ''}" data-rwrepl="${esc(id)}">
        ${cur ? '<span class="badge">已替换</span>' : ''}
        ${c.img ? `<img src="${esc(c.img)}" style="width:100%;border-radius:7px;margin-bottom:7px" loading="lazy">` : ''}
        <div class="pname">${esc(c.name)}</div>
        <div class="pmeta small">${esc(GROUPS[c.group] || '')}${c.deck ? ' · ' + esc(c.deck) : ''}${cur ? `<br>→ ${esc(cardById(cur)?.name || '')}` : ''}</div>
      </div>`;
    };
    body = `<p class="small muted" style="margin-bottom:10px">
      战役中获得奖励牌后，可以用它<b>替换牌库里的 1 种初始牌</b>（2 张一起换掉），牌库仍是 ${DECK_TOTAL.kinds} 种 ${DECK_TOTAL.cards} 张。
      流程：先在上方点一张<b>奖励牌</b>，再在下方点要被替换的那张初始牌；再点一次已替换的条目可撤销。</p>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
        <span class="small">已替换 <b>${rw.length}</b> 次</span>
        ${rw.length ? `<button class="btn btn-sm" id="rw-clr">全部撤销</button>` : ''}
        ${BuilderUI.rwSel ? `<span class="small ok">已选奖励牌：${esc(cardById(BuilderUI.rwSel)?.name || '')} → 请点下方要替换的牌</span>` : ''}
      </div>
      <h3 style="margin-bottom:8px">奖励牌</h3>
      ${pickBarHTML(6, pool)}
      <div class="pick-grid" id="pb-list-6">${pool.map(rwTile).join('')}</div>
      <h3 style="margin:16px 0 8px">牌库中的初始牌（点一张进行替换）</h3>
      ${libIds.length ? `<div class="pick-grid">${libIds.map(replTile).join('')}</div>`
        : '<p class="muted small">牌库还是空的，先完成前面的步骤。</p>'}`;
    postBar = () => {
      bindPickBar(v, 6, pool, list => list.map(rwTile).join(''));
      const cc = v.querySelector('#rw-clr');
      if (cc) cc.onclick = () => { steps.rewards = []; BuilderUI.rwSel = null; saveDB(); renderRoute(); };
    };
  }
  else {                          // 总览 / 牌组预览
    const ri = roleInfo(d);
    const slots = traitSlots(d);
    const swap = {};
    (steps.rewards || []).forEach(x => { if (x.reward && x.replaced) swap[x.replaced] = x.reward; });
    const rwNames = (steps.rewards || []).map(x =>
      `${cardById(x.reward)?.name || '?'} ⇄ ${cardById(x.replaced)?.name || '?'}`);
    const sec = (title, ids, note) => {
      const rows = (ids || []).filter(Boolean).map(id => {
        const orig = cardById(id), sw = swap[id];
        const c = sw ? cardById(sw) : orig;
        if (!c) return '';
        return `<tr>
          <td>${esc(c.name)}${sw ? ` <span class="tag blue" title="用奖励牌替换了「${esc(orig?.name || '')}」">奖励</span>` : ''}</td>
          <td class="small">${esc(c.deck || GROUPS[c.group] || '')}</td>
          <td class="small muted">${esc(c.type || '')}</td>
          <td class="small">${reqChipsHTML(c)}</td>
          <td>2</td>
          <td>${c.img ? `<img src="${esc(c.img)}" style="height:34px;border-radius:4px;cursor:zoom-in" data-zoom="${esc(c.id)}">` : ''}</td></tr>`;
      }).join('');
      return `<div class="dk-sec">
        <h3>${title}${note ? ` <span class="small muted">${esc(note)}</span>` : ''}</h3>
        <table class="tbl"><thead><tr><th>卡牌</th><th>牌组</th><th>类型</th><th>需求</th><th>数量</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="muted small">尚未选择</td></tr>'}</tbody></table></div>`;
    };
    const attrCard = cardById(steps.attribute);
    body = `
      <div class="${st.problems.length ? 'errline' : 'okline'}">
        ${st.problems.length
          ? `<b>未通过校验（${st.problems.length}）：</b><br>` + st.problems.map(p => '· ' + esc(p)).join('<br>')
          : `✔ 构筑合规：牌库 ${st.kinds} 种 ${st.cards} 张 + 角色牌「${esc(ri?.name || '—')}」${ri?.custom ? '（自定义）' : ''}+ 属性牌「${esc(sel(steps.attribute))}」。可以开始冒险！`}
      </div>
      <div class="dk-head">
        <div><b style="font-size:1.05rem">${esc(d.name)}</b></div>
        <div class="small muted">背景 ${esc(steps.background?.deck || '—')} · 专长 ${esc(steps.expertise?.deck || '—')} · 角色 ${esc(ri?.name || '—')}</div>
        <div class="small">牌库 <b>${st.kinds}</b>/${DECK_TOTAL.kinds} 种 · <b>${st.cards}</b>/${DECK_TOTAL.cards} 张${rwNames.length ? ` · 奖励替换 ${rwNames.length} 次` : ''}</div>
        ${attrCard ? `<div class="small">${attrHTML(attrCard.attr)}</div>` : ''}
      </div>
      ${attrCard ? `<div class="dk-sec"><h3>属性牌 <span class="small muted">1 张</span></h3>
        <table class="tbl"><tbody><tr><td><b>${esc(attrCard.name)}</b></td><td class="small">属性</td>
        <td class="small">${attrHTML(attrCard.attr)}</td><td>1</td>
        <td>${attrCard.img ? `<img src="${esc(attrCard.img)}" style="height:34px;border-radius:4px;cursor:zoom-in" data-zoom="${esc(attrCard.id)}">` : ''}</td></tr></tbody></table></div>` : ''}
      ${sec('性格', TRAIT_KEYS().map(k => slots[k]), '四色各 1 种 × 2 张')}
      ${sec('背景', steps.background?.picks || [], steps.background?.deck ? `${steps.background.deck} · 5 种 × 2 张` : '')}
      ${sec('专长', steps.expertise?.picks || [], steps.expertise?.deck ? `${steps.expertise.deck} · 5 种 × 2 张` : '')}
      ${sec('爱好', [steps.hobby], '1 种 × 2 张')}
      <div class="dk-sec"><h3>角色牌 <span class="small muted">不进牌库，放角色区</span></h3>
        <table class="tbl"><tbody><tr>
          <td><b>${esc(ri?.name || '—')}</b>${ri?.custom ? ' <span class="tag blue">自定义</span>' : ''}</td>
          <td class="small muted">${ri?.custom ? attrHTML(ri.attr) + ' ' : ''}${kwText(ri?.text || '')}</td>
          <td>1</td>
          <td>${ri?.img ? `<img src="${esc(ri.img)}" style="height:34px;border-radius:4px">` : ''}</td>
        </tr></tbody></table></div>
      ${rwNames.length ? `<div class="dk-sec"><h3>奖励替换 <span class="small muted">${rwNames.length} 次（牌库张数不变）</span></h3>
        <p class="small">${rwNames.map(esc).join(' · ')}</p></div>` : ''}
      ${rulesOn() ? `
      <div class="panel" style="margin-top:14px">
        <h3 style="margin-bottom:6px">🧩 组卡限制联动 · 逐条校验</h3>
        <p class="small muted" style="margin-bottom:10px">
          规则条目集中在 LINK_RULES；标注「待校对」的条件只提示、不拦截，数据校对完成后按《规则手册》补齐即可生效。
        </p>
        <table class="tbl"><tbody>
          ${deckRuleCheck(d).map(r => `<tr>
            <th style="width:280px">${esc(r.label)}</th>
            <td class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '✔ 通过' : '✖ 未完成'}</td></tr>`).join('')}
        </tbody></table>
        <p class="small muted" style="margin-top:8px">生效中的联动规则：${LINK_RULES.map(r =>
          `<span class="tag ${r.pending ? 'gray' : ''}">${r.always ? '🔒 ' : ''}${esc(r.label)}${r.pending ? '（待校对）' : ''}</span>`).join(' ')}</p>
      </div>` : ''}
      <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-primary" id="fin-save">💾 保存卡组</button>
        <button class="btn" id="fin-copy">⧉ 复制牌组</button>
        <button class="btn" id="fin-upd">⬆ 用代码更新</button>
        <button class="btn" id="fin-code">🔗 牌组代码</button>
        <button class="btn" id="fin-export">导出此构筑</button>
        <a class="btn" href="#export">前往导出页</a>
      </div>
      <div class="panel" id="fin-codebox" hidden style="margin-top:12px">
        <h3 style="margin-bottom:8px">牌组代码 / 分享链接</h3>
        <label class="fld" style="margin-bottom:8px">代码（可粘贴到「角色创建 → 粘贴牌组代码」）<textarea id="fc-code" rows="3" readonly></textarea></label>
        <label class="fld">链接（打开即导入）<textarea id="fc-link" rows="2" readonly></textarea></label>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm btn-primary" id="fc-copy">复制代码</button>
          <button class="btn btn-sm" id="fc-copylink">复制链接</button>
          <button class="btn btn-sm" id="fc-close">关闭</button>
        </div>
      </div>`;
  }

  v.innerHTML = `
    <h2 class="page-title">角色创建 · ${esc(d.name)}</h2>
    <p class="page-sub">步骤 ${stepIdx + 1}/7 · ${STEPS[stepIdx]}</p>
    <div class="wizard">
      <div class="wsteps">
        ${STEPS.map((s, i) => {
          const done = i === 0 ? !!steps.attribute
            : i === 1 ? TRAIT_KEYS().every(k => traitSlots(d)[k])
            : i === 2 ? (steps.background?.deck && steps.background.picks.length === 5)
            : i === 3 ? (steps.expertise?.deck && steps.expertise.picks.length === 5)
            : i === 4 ? !!steps.role : i === 5 ? !!steps.hobby
            : i === 6 ? (steps.rewards || []).length > 0 : false;
          return `<div class="wstep ${i === stepIdx ? 'active' : ''} ${done ? 'done' : ''}" data-step="${i}">
            <span class="snum">${done ? '✓' : i + 1}</span>${s}</div>`;
        }).join('')}
        <div class="bsum">
          牌库 <b>${st.kinds}</b>/${DECK_TOTAL.kinds} 种 · <b>${st.cards}</b>/${DECK_TOTAL.cards} 张<br>
          ${st.problems.length ? `<span class="bad">⚠ ${st.problems.length} 项待处理</span>` : '<span class="ok">✔ 合规</span>'}
          <div style="margin-top:6px" class="small">${rulesOn()
            ? '<span class="tag">🧩 限制联动 开</span>'
            : '<span class="tag gray">🧩 限制联动 关</span>'}
            <span class="tag">🔒 属性未到需求（硬性拦截）</span></div>
        </div>
        <div style="padding:8px 10px"><button class="btn btn-sm btn-danger" id="bw-exit">退出此行者</button></div>
      </div>
      <div class="panel">${body}</div>
    </div>`;

  function bindPick(vv, dd, idx) {
    /* 限制联动：被规则判定的卡不能新选入（取消已选不受限） */
    const guard = id => {
      const b = blkOf(id);
      if (b && !b.soft) { toast('组卡限制：' + b.msg, 3200); return true; }
      return false;
    };
    vv.querySelectorAll('[data-sel]').forEach(el => el.onclick = () => {
      const id = el.dataset.sel;
      if (idx === 0) { if (steps.attribute !== id && guard(id)) return; steps.attribute = (steps.attribute === id ? null : id); }
      else if (idx === 5) { if (steps.hobby !== id && guard(id)) return; steps.hobby = (steps.hobby === id ? null : id); }
      else if (idx === 4) {
        if (steps.role !== id && guard(id)) return;
        steps.role = (steps.role === id ? null : id);
        /* 选入空白行者卡时初始化自定义数据（名称留空则回落到行者名） */
        if (steps.role === BLANK_ROLE_ID && !steps.roleCustom)
          steps.roleCustom = { name: '', text: '', attr: {} };
      }
      saveDB(); renderRoute();
    });
    vv.querySelectorAll('[data-traitpick]').forEach(el => el.onclick = () => {
      const id = el.dataset.traitpick;
      const t = steps.traits || (steps.traits = {});
      const g = traitGroupById(id);
      const key = g ? g.key : 'other';
      const hit = Object.keys(t).find(k => t[k] === id);
      if (hit) { t[hit] = null; }
      else { if (guard(id)) return; t[key] = id; }      // 同色替换：直接覆盖本组槽位
      saveDB(); renderRoute();
    });
    const clrT = vv.querySelector('#clr-traits');
    if (clrT) clrT.onclick = () => { steps.traits = {}; saveDB(); renderRoute(); };
    vv.querySelectorAll('[data-bgpick]').forEach(el => el.onclick = () => {
      const id = el.dataset.bgpick, P = steps.background.picks;
      if (P.includes(id)) steps.background.picks = P.filter(x => x !== id);
      else if (P.length < 5) { if (guard(id)) return; P.push(id); } else { toast('最多选 5 种'); return; }
      saveDB(); renderRoute();
    });
    vv.querySelectorAll('[data-exppick]').forEach(el => el.onclick = () => {
      const id = el.dataset.exppick, P = steps.expertise.picks;
      if (P.includes(id)) steps.expertise.picks = P.filter(x => x !== id);
      else if (P.length < 5) { if (guard(id)) return; P.push(id); } else { toast('最多选 5 种'); return; }
      saveDB(); renderRoute();
    });
    vv.querySelectorAll('[data-rwsel]').forEach(el => el.onclick = () => {
      const id = el.dataset.rwsel;
      BuilderUI.rwSel = (BuilderUI.rwSel === id ? null : id);
      renderRoute();
    });
    vv.querySelectorAll('[data-rwrepl]').forEach(el => el.onclick = () => {
      const id = el.dataset.rwrepl;
      const rw = steps.rewards || (steps.rewards = []);
      const i = rw.findIndex(x => x.replaced === id);
      if (i >= 0) { rw.splice(i, 1); toast('已撤销这次替换'); }        // 再点一次 = 撤销
      else {
        if (!BuilderUI.rwSel) { toast('请先在上方选择一张奖励牌'); return; }
        if (guard(BuilderUI.rwSel)) return;
        if (rw.some(x => x.reward === BuilderUI.rwSel)) { toast('这张奖励牌已经用过了'); return; }
        rw.push({ reward: BuilderUI.rwSel, replaced: id, at: Date.now() });
        BuilderUI.rwSel = null;
        toast('已替换（牌库张数保持不变）');
      }
      saveDB(); renderRoute();
    });
    vv.querySelectorAll('[data-bgd]').forEach(el => el.onclick = () => {
      steps.background = { deck: el.dataset.bgd, picks: [] }; saveDB(); renderRoute();
    });
    vv.querySelectorAll('[data-expd]').forEach(el => el.onclick = () => {
      steps.expertise = { deck: el.dataset.expd, picks: [] }; saveDB(); renderRoute();
    });
    const chg = vv.querySelector('#chg-deck');
    if (chg) chg.onclick = () => {
      if (el_in_deck(idx)) {
        if (!confirm('重选牌组将清空已选卡牌，确定？')) return;
      }
      if (idx === 2) steps.background = { picks: [] }; else steps.expertise = { picks: [] };
      saveDB(); renderRoute();
    };
    const fe = vv.querySelector('#fin-export');
    if (fe) fe.onclick = () => exportDeck(d);
    /* 总览：保存 / 复制 / 用代码更新 / 牌组代码 */
    const fsave = vv.querySelector('#fin-save');
    if (fsave) fsave.onclick = () => {
      saveDB();
      toast(st.problems.length ? `已保存（还有 ${st.problems.length} 项待处理）` : '已保存卡组 ✔', 3000);
    };
    const fcopy = vv.querySelector('#fin-copy');
    if (fcopy) fcopy.onclick = () => {
      const cp = JSON.parse(JSON.stringify(d));
      cp.id = uid(); cp.name = `${d.name} · 副本`; cp.created = Date.now();
      DB.decks.push(cp); saveDB();
      BuilderUI.cur = null; BuilderUI.step = 0; renderRoute();
      toast(`已复制为「${cp.name}」`, 3000);
    };
    const fupd = vv.querySelector('#fin-upd');
    if (fupd) fupd.onclick = () => {
      const txt = prompt('粘贴牌组代码（当前这位行者的构筑内容会被替换）：');
      if (!txt) return;
      const r = decodeDeckCode(txt);
      if (r.error) { toast(r.error, 3600); return; }
      if (!confirm(`用「${r.deck.name}」的内容替换当前行者「${d.name}」？`)) return;
      d.steps = r.deck.steps; saveDB(); renderRoute();
      toast('已更新牌组' + (r.missing?.length ? `（${r.missing.length} 张卡未匹配）` : ''), 3400);
    };
    const fcode = vv.querySelector('#fin-code');
    if (fcode) fcode.onclick = () => {
      const box = vv.querySelector('#fin-codebox');
      if (!box) return;
      box.hidden = false;
      vv.querySelector('#fc-code').value = encodeDeckCode(d);
      vv.querySelector('#fc-link').value = deckLink(d);
      box.scrollIntoView({ block: 'nearest' });
    };
    const copySel = sel => {
      const el = vv.querySelector(sel); if (!el) return;
      el.select(); el.setSelectionRange(0, 99999);
      let okc = false;
      try { okc = document.execCommand('copy'); } catch (e) { okc = false; }
      if (!okc && navigator.clipboard) navigator.clipboard.writeText(el.value)
        .then(() => toast('已复制'), () => toast('请手动选中复制'));
      else toast(okc ? '已复制到剪贴板' : '请手动选中复制');
    };
    const fc1 = vv.querySelector('#fc-copy'); if (fc1) fc1.onclick = () => copySel('#fc-code');
    const fc2 = vv.querySelector('#fc-copylink'); if (fc2) fc2.onclick = () => copySel('#fc-link');
    const fc3 = vv.querySelector('#fc-close');
    if (fc3) fc3.onclick = () => { const bx = vv.querySelector('#fin-codebox'); if (bx) bx.hidden = true; };
    /* 空白行者卡自定义输入（名称/技能/四属性），随输入保存 */
    if (idx === 4) {
      const bindRc = (sel2, key) => {
        const el = vv.querySelector(sel2); if (!el) return;
        el.oninput = () => {
          const rc = steps.roleCustom || (steps.roleCustom = { name: '', text: '', attr: {} });
          if (key === 'name') rc.name = el.value;
          else if (key === 'text') rc.text = el.value;
          else rc.attr[key] = el.value === '' ? null : Math.max(0, Math.min(9, +el.value || 0));
          saveDB();
        };
      };
      bindRc('#rc-name', 'name'); bindRc('#rc-text', 'text');
      ATTRS.forEach(a => bindRc('#rc-' + a, a));
      /* 自定义底图上传 */
      const rcImg = vv.querySelector('#rc-img');
      if (rcImg) rcImg.onchange = async e => {
        const f = e.target.files[0]; if (!f) return;
        try {
          steps.roleCustom = steps.roleCustom || { name: '', text: '', attr: {} };
          steps.roleCustom.img = await shrinkImage(f);
          saveDB(); renderRoute(); toast('底图已压缩载入');
        } catch { toast('图片读取失败'); }
      };
      const rcClr = vv.querySelector('#rc-imgclr');
      if (rcClr) rcClr.onclick = () => { delete steps.roleCustom.img; saveDB(); renderRoute(); };
    }
    vv.querySelectorAll('[data-zoom]').forEach(el =>
      el.onclick = () => openModal(el.dataset.zoom, zoomIds(el)));
  }
  /* v38：搜索 / 筛选 / 排序栏 —— 输入即时重绘列表，不整页 renderRoute（保住输入焦点） */
  function bindPickBar(vv, idx, pool, renderList, fields) {
    const repaint = () => {
      const f = pickFilterOf(idx);
      const list = pickApply(pool, f, blkOf);
      const box = vv.querySelector('#pb-list-' + idx);
      if (box) box.innerHTML = list.length
        ? renderList(list)
        : '<p class="muted small" style="padding:10px 2px">没有符合条件的牌 —— 换个关键字或放宽筛选试试。</p>';
      const n = vv.querySelector('#pb-' + idx + '-n');
      if (n) n.textContent = `${list.length} / ${pool.length} 张`;
      bindPick(vv, d, idx);
    };
    const q = vv.querySelector('#pb-' + idx + '-q');
    if (q) q.oninput = () => { pickFilterOf(idx).q = q.value; repaint(); };
    ['type', 'cost', 'req', 'tag', 'sort'].forEach(k => {
      const el = vv.querySelector('#pb-' + idx + '-' + k);
      if (el) el.onchange = () => { pickFilterOf(idx)[k] = el.value; repaint(); };
    });
    const ok = vv.querySelector('#pb-' + idx + '-ok');
    if (ok) ok.onchange = () => { pickFilterOf(idx).ok = ok.checked; repaint(); };
    const clr = vv.querySelector('#pb-' + idx + '-clr');
    if (clr) clr.onclick = () => { BuilderUI.pf[idx] = null; renderRoute(); };
    repaint();
  }
  function el_in_deck(idx) {
    return idx === 2 ? (steps.background?.picks || []).length > 0 : (steps.expertise?.picks || []).length > 0;
  }
  bindPick(v, d, stepIdx);
  if (postBar) postBar();          // v38：筛选栏要等 DOM 就位才能绑事件
  v.querySelectorAll('[data-step]').forEach(el => el.onclick = () => { BuilderUI.step = +el.dataset.step; renderRoute(); });
  $('#bw-exit').onclick = () => { BuilderUI.cur = null; BuilderUI.step = 0; renderRoute(); };
}

/* 性格牌所属属性：数据中 traitAttr 字段优先，否则按 deck/名称推断 */
function deckOfTrait(c, attrKey) {
  if (c.traitAttr) return c.traitAttr === attrKey;
  return true;   // 无标记时不按属性过滤（待数据补全后启用）
}

/* ================= 6.5) 卡牌自制（角色卡 / 行者卡 / 空白卡 / v45 全类型空白模板） =================
 * v45：仿官方「自定义角色」空白卡的思路 —— 框架现成、内容自填。
 * 十个新模板 = 四色行者牌（知/精/体/专）×1 + 路径牌（道路/关键地点/通用/非关键地点）×4
 *            + 瞬间牌 ×1 + 任务牌 ×1。accent = 框架色，band = 左下竖排色条文字，
 *            defType = 类型行默认值，feeAttr = 费用属性默认值。 */
const MC_TPLS = {
  role:   { label: '角色卡', desc: '对应官方角色牌版式：全卡底图 + 顶部标题条 + 类型标签 + 底部技能框' },
  ranger: { label: '行者卡（旧版）', desc: '对应行者牌版式：全卡底图 + 底部绿带（名称 · 属性行 · 技能）' },
  blank:  { label: '空白卡', desc: '完全空白：上传底图，名称 / 类型 / 属性 / 技能自由填写，留空自动隐藏' },

  /* —— v46：四色行者牌。色值取自原版卡图实测（绿 #587e43 / 黄 / 红 / 蓝）—— */
  ranger_know: { group: '行者牌（四色）', label: '行者牌 · 知觉（绿）', accent: '#5b8a4e', band: '行者 · 知觉', defSym: 'tri',
    defType: '道具·科技', feeAttr: '知', feeLabel: '知', attrName: '知觉', attrShort: '知',
    desc: '知觉牌（绿）：左上费用块 → 名称条（名称 + 类型·关键词）→ 左侧手段符号 → 左缘属性需求 → 左下牌组编号 → 文本区' },
  ranger_spi:  { group: '行者牌（四色）', label: '行者牌 · 精神（黄）', accent: '#c79a2e', band: '行者 · 精神', defSym: 'spiral',
    defType: '道具·科技', feeAttr: '精', feeLabel: '精', attrName: '精神', attrShort: '精',
    desc: '精神牌（黄）：版式同知觉牌，框架色为精神黄' },
  ranger_phy:  { group: '行者牌（四色）', label: '行者牌 · 体质（红）', accent: '#a6492f', band: '行者 · 体质', defSym: 'heart',
    defType: '道具·科技', feeAttr: '体', feeLabel: '体', attrName: '体质', attrShort: '体',
    desc: '体质牌（红）：版式同知觉牌，框架色为体质红' },
  ranger_foc:  { group: '行者牌（四色）', label: '行者牌 · 专注（蓝）', accent: '#4d6da3', band: '行者 · 专注', defSym: 'ring',
    defType: '道具·科技', feeAttr: '专', feeLabel: '专', attrName: '专注', attrShort: '专',
    desc: '专注牌（蓝）：版式同知觉牌，框架色为专注蓝' },

  path_road:   { group: '路径牌', label: '路径牌 · 道路', accent: '#8a7a55', band: '道路', defSym: 'leaf',
    defType: '地标·动物', desc: '道路牌：左上圆标 + 名称条 + 右上存在度 + 右下伤害/疲劳 + 文本区 + 彩色触发条' },
  path_key:    { group: '路径牌', label: '路径牌 · 关键地点', accent: '#5f7d8c', band: '关键地点', defSym: 'gear',
    defType: '地标·机械', desc: '关键地点牌：版式同道路牌，常用于建筑 / 遗迹' },
  path_common: { group: '路径牌', label: '路径牌 · 通用', accent: '#7d8a5f', band: '通用', defSym: 'sun',
    defType: '地标·危害', desc: '通用路径牌：版式同道路牌，可带多条彩色触发条' },
  path_minor:  { group: '路径牌', label: '路径牌 · 非关键地点', accent: '#8c705f', band: '非关键地点', defSym: 'drop',
    defType: '地标·动物', desc: '非关键地点牌：版式同道路牌' },

  moment: { group: '瞬间与任务', label: '瞬间牌（旅途时分）', accent: '#3f5a44', band: '瞬间',
    defType: '瞬间·机遇', desc: '瞬间牌：居中名称 + 类型 + 场景斜体引子 + 「行者请选择」+ A/B 选项 + 居中牌组编号' },
  task:   { group: '瞬间与任务', label: '任务牌', accent: '#5a7846', band: '任务',
    defType: '任务·幕间', desc: '任务牌：居中名称 + 类型 + 横幅插画 + 说明 + 绿色条件条 + 居中牌组编号' },
};
/* v46：走 SVG 官方版式的家族（role / ranger / blank 仍走旧 HTML 版式） */
const MC_SVG_FAM = { ranger: 1, path: 1, moment: 1, task: 1 };
/* v45：模板家族（用于渲染 / 导出 / 表单显隐分流） */
const mcFam = tpl => String(tpl || '').startsWith('ranger_') ? 'ranger'
  : String(tpl || '').startsWith('path_') ? 'path'
  : (tpl === 'moment' || tpl === 'task') ? tpl : tpl;
/* 各家族需要哪些额外字段（表单显隐用） */
const MC_FAM_FIELDS = {
  ranger: ['fee', 'feeattr', 'flavor', 'attrs'],
  path:   ['ptop', 'pn'],
  task:   ['goal'],
  moment: [],
};
const MC_ATTR_COLOR = { 知: '#4d8f5c', 敏: '#c2833a', 体: '#a8452f', 精: '#c8951f', 专: '#4f6fa8' };
const MakerUI = { draft: null };   // 当前编辑草稿（未保存也保留）

/* ============================================================
   v46：官方卡面 SVG 模板（单一渲染源 —— 预览与导出同一套版面）
   坐标按原版卡图实测换算：原图 1448×2072 → 画布 750×1050
   对照《规则手册》P25「行者牌详解」11 个部位：
     ① 费用 ② 名称 ③ 卡牌类型与关键词 ④ 装备值 ⑤ 存在度
     ⑥ 标记 ⑦ 伤害阈值 ⑧ 手段符号 ⑨ 能力与检定 ⑩ 属性需求 ⑪ 牌组信息
   ============================================================ */
const MC_VW = 750, MC_VH = 1050;
const MC_FONT = '"Noto Sans SC","Source Han Sans SC","Microsoft YaHei","PingFang SC",sans-serif';
/* 数值/拉丁字型：原版是 Helvetica 系 grotesque（"1" 是窄身、无底衬），中文自动回落 Noto */
const MC_NUM_FONT = '"Helvetica Neue",Helvetica,Arial,"Noto Sans SC",sans-serif';
const MC_INK = '#2f2c25', MC_PAPER = '#f3efe3', MC_SUB = '#57523f';

/* 手段符号库（坐标系 0 0 100 100，颜色随卡面浅色） */
const MC_SYM = {
  tri: '<path d="M50 10 L92 84 H8 Z" fill="none" stroke="#f3efe3" stroke-width="10" stroke-linejoin="round"/><path d="M50 38 L70 74 H30 Z" fill="#f3efe3"/>',
  spiral: '<path d="M50 16a34 34 0 1 0 24 58 26 26 0 1 1-18-44 18 18 0 1 0 13 31" fill="none" stroke="#f3efe3" stroke-width="11" stroke-linecap="round"/>',
  heart: '<path d="M50 86 C22 66 10 52 10 36 A22 22 0 0 1 50 24 A22 22 0 0 1 90 36 C90 52 78 66 50 86Z" fill="#f3efe3"/>',
  ring: '<circle cx="50" cy="50" r="34" fill="none" stroke="#f3efe3" stroke-width="13"/>',
  leaf: '<path d="M50 8C24 34 18 60 34 78c16 18 42 12 52-8 10-20 2-42-36-62Z" fill="#f3efe3"/><path d="M34 78C40 56 52 36 70 22" fill="none" stroke="#3d3a33" stroke-width="6"/>',
  sun: '<circle cx="50" cy="50" r="21" fill="#f3efe3"/><g stroke="#f3efe3" stroke-width="9" stroke-linecap="round"><path d="M50 4v12M50 84v12M4 50h12M84 50h12M18 18l9 9M73 73l9 9M82 18l-9 9M27 73l-9 9"/></g>',
  paw: '<g fill="#f3efe3"><ellipse cx="28" cy="34" rx="11" ry="14"/><ellipse cx="50" cy="26" rx="11" ry="14"/><ellipse cx="72" cy="34" rx="11" ry="14"/><path d="M50 46c17 0 27 13 27 24 0 10-9 15-18 15-5 0-9-2-9-2s-4 2-9 2c-9 0-18-5-18-15 0-11 10-24 27-24Z"/></g>',
  book: '<path d="M16 16h26c5 0 8 3 8 8v62c0-5-3-8-8-8H16Z" fill="#f3efe3"/><path d="M84 16H58c-5 0-8 3-8 8v62c0-5 3-8 8-8h26Z" fill="#f3efe3" opacity=".72"/>',
  gear: '<path d="M50 12l7 12 14-3 3 14 13 6-7 12 7 12-13 6-3 14-14-3-7 12-7-12-14 3-3-14-13-6 7-12-7-12 13-6 3-14 14 3Z" fill="#f3efe3"/><circle cx="50" cy="50" r="13" fill="#3d3a33"/>',
  drop: '<path d="M50 10C36 34 22 50 22 64a28 28 0 0 0 56 0c0-14-14-30-28-54Z" fill="#f3efe3"/>',
  shield: '<path d="M50 10l34 12v26c0 22-14 36-34 44-20-8-34-22-34-44V22Z" fill="#f3efe3"/>',
  feather: '<path d="M72 12C46 22 30 44 28 72l-8 16 16-8c28-2 50-18 60-44Z" fill="#f3efe3"/><path d="M30 70L66 34" stroke="#3d3a33" stroke-width="6"/>',
};
const MC_SYM_KEYS = Object.keys(MC_SYM);
/* 螺旋用参数方程生成，比手写弧线更规整 */
MC_SYM.spiral = (() => {
  let d = '';
  for (let t = 0; t <= 3.55 * Math.PI; t += 0.14) {
    const r = 2.5 + t * 3.7;
    d += (d ? 'L' : 'M') + (50 + r * Math.cos(t)).toFixed(1) + ' ' + (50 + r * Math.sin(t)).toFixed(1);
  }
  return `<path d="${d}" fill="none" stroke="#f3efe3" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`;
})();
const MC_SYM_LABEL = { tri: '推理·三角', spiral: '冲突·漩涡', heart: '关联·心形', ring: '探索·圆环', leaf: '叶片', sun: '太阳', paw: '兽爪', book: '书页', gear: '齿轮', drop: '水滴', shield: '盾牌', feather: '羽毛' };

/* —— 文本测量 / 断行（用离屏 canvas 与 SVG 同字体量宽） —— */
let _mcCtx = null;
function mcFontW(str, size, weight) {
  if (!_mcCtx) _mcCtx = document.createElement('canvas').getContext('2d');
  _mcCtx.font = `${weight || 400} ${size}px ${MC_FONT}`;
  return _mcCtx.measureText(str).width;
}
/* 解析行内 **粗体** */
function mcRunsOf(s) {
  const out = []; const re = /\*\*([^*]+)\*\*/g; let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ t: s.slice(last, m.index), bold: false });
    out.push({ t: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: s.slice(last), bold: false });
  return out.length ? out : [{ t: '', bold: false }];
}
/* 折行：返回 [[{t,bold,w}...], ...] */
function mcLayout(text, size, maxW, weight = 400) {
  const lines = [];
  for (const para of String(text ?? '').split('\n')) {
    if (!para.trim()) { lines.push([]); continue; }
    let line = [], w = 0;
    for (const r of mcRunsOf(para)) {
      for (const ch of r.t) {
        const cw = mcFontW(ch, size, r.bold ? 700 : weight);
        if (w + cw > maxW && line.length) { lines.push(line); line = []; w = 0; }
        const last = line[line.length - 1];
        if (last && last.bold === r.bold) { last.t += ch; last.w += cw; }
        else line.push({ t: ch, bold: r.bold, w: cw });
        w += cw;
      }
    }
    lines.push(line);
  }
  return lines;
}
function mcLineSvg(line, x, y, size, fill, weight = 400, italic = false) {
  if (!line.length) return '';
  const spans = line.map(r => `<tspan font-weight="${r.bold ? 700 : weight}">${esc(r.t)}</tspan>`).join('');
  return `<text x="${x}" y="${y}" font-family='${MC_FONT}' font-size="${size}" fill="${fill}"${italic ? ' font-style="italic"' : ''} xml:space="preserve">${spans}</text>`;
}
/* 自适应字号填充一个矩形区域（段间可留 paraGap），返回 { svg, h } */
function mcFillText(text, o) {
  const paras = String(text ?? '').split('\n');
  const gap = o.paraGap || 0;
  let size = o.size, lines = [], lh = 0, total = 0;
  const calc = sz => {
    const bl = paras.map(p => mcLayout(p, sz, o.w, o.weight || 400)).filter(b => b.length);
    const l = Math.round(sz * (o.lineH || 1.58));
    return { bl, l, t: bl.reduce((a, b) => a + b.length * l, 0) + Math.max(0, bl.length - 1) * gap };
  };
  for (;;) {
    const r = calc(size);
    lines = r.bl; lh = r.l; total = r.t;
    if (total <= o.maxH || size <= (o.minSize || 15)) break;
    size -= 1;
  }
  let y = o.y + size * 0.86, out = '';
  lines.forEach((bl, bi) => {
    if (bi) y += gap;
    for (const ln of bl) {
      out += mcLineSvg(ln, o.x, y, size, o.fill || MC_INK, o.weight || 400, o.italic);
      y += lh;
    }
  });
  return { svg: out, h: total, size, lines: lines.flat() };
}
/* 竖排文字（自下而上，rotate(-90)） */
/** 竖排文字占多少个 em（CJK 1，其它 0.55）*/
function mcVUnits(txt) {
  let u = 0;
  for (const ch of String(txt || '')) u += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.56;
  return Math.max(u, 1);
}
function mcVText(txt, cx, cy, size, fill, weight = 700, track = 1) {
  return `<g transform="translate(${cx},${cy}) rotate(-90)"><text x="0" y="0" text-anchor="middle" dominant-baseline="central"
    font-family='${MC_FONT}' font-size="${size}" font-weight="${weight}" letter-spacing="${track}" fill="${fill}">${esc(txt)}</text></g>`;
}
/* 插画窗（724 坐标）：底版这里是 alpha=0 的洞，只有这一块能看到上传的图。
   v50 之前把整张卡铺图，结果图的下半截全被底版的正文面板压住 ——
   用户看到的只有上面 63%，所以喊「一部分图片被遮死了」。
   v51 起：默认把图**只映射到插画窗**，另给缩放/位移微调。
   v51b：缩放必须按图的实际比例算「cover 基准」，否则同比例框 + slice
   会裁出完全一样的画面，拖滑块等于没反应（100% 与 60% 一模一样）。 */
const MC_ART_WIN = { x: 0, y: 0, w: 724, h: 655 };
const MC_ART_BLEED = [[678, 655, 724, 1006]];   // 面板右侧那条出血插画

/* 图的比例：上传时记了实际像素；老存档没记就返回 0（退回旧算法） */
function mcImgAR(mc) {
  const w = +mc.imgW, h = +mc.imgH;
  return (w > 0 && h > 0) ? w / h : 0;
}
/* 把图映射到矩形 (x,y,w,h)：100% = cover（铺满该矩形、超出裁掉），
   小于 100% 时整张图缩进矩形里（能看全图），大于 100% 放大裁切。 */
function mcArtBox(mc, x, y, w, h) {
  const z = Math.max(.3, Math.min(3, (+mc.imgZoom || 100) / 100));
  const px = Math.max(-100, Math.min(100, +mc.imgX || 0));
  const py = Math.max(-100, Math.min(100, +mc.imgY || 0));
  const ar = mcImgAR(mc);
  let bw = w, bh = h;
  if (ar > 0) {                                  // cover：先算铺满所需尺寸
    bw = Math.max(w, h * ar); bh = bw / ar;
  }
  bw *= z; bh *= z;
  /* 位移：±100% 表示可以把图推到「两边刚好还剩一点」为止 */
  const spanX = Math.max(0, bw - w) / 2, spanY = Math.max(0, bh - h) / 2;
  const ox = (w - bw) / 2 + spanX * px / 100;
  const oy = (h - bh) / 2 + spanY * py / 100;
  return { x: x + ox, y: y + oy, w: bw, h: bh };
}
/* 背景：插画映射到插画窗（cover，可缩放/位移）；无图用斜纹占位 */
function mcSvgBg(mc, W, H) {
  let s = `<rect width="${W}" height="${H}" fill="#e6dfcb"/>`;
  if (mc.img) {
    const full = mc.imgFit === 'card';
    const W0 = full ? { x: 0, y: 0, w: MC_CW, h: MC_CH } : MC_ART_WIN;
    const b = mcArtBox(mc, W0.x, W0.y, W0.w, W0.h);
    s += `<image href="${esc(mc.img)}" x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${b.w.toFixed(1)}" height="${b.h.toFixed(1)}" preserveAspectRatio="xMidYMid slice"/>`;
    if (!full) {
      /* 窗口之外还剩一条贴面板右边的出血带：底版那里也是 alpha=0 的洞
         （原版的插画沿右边一直流到卡底）。
         早先按「cover 一个 46×351 的窄条」铺图 —— 等于把图里某个物体放大
         5 倍塞进去，出来一块莫名其妙的花斑；改成抹右缘颜色又太糊。
         现在用「镜像」：以插画窗下沿 y=655 为镜面把同一张图翻下来，
         接缝天然连续，往下是图右下的倒影，像正常出血。 */
      let cp = '';
      for (const [x0, y0, x1, y1] of MC_ART_BLEED) {
        cp += `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}"/>`;
      }
      s += `<clipPath id="mcbleed">${cp}</clipPath>`;
      /* 出血带用「镜像」接上：以插画窗下沿(y=655)为镜面，把同一张图翻下来。
         接缝处像素天然连续，往下看到的是图右下的倒影 —— 比平铺/拉伸都自然，
         也不会把图里某个物体放大成一块花斑。 */
      s += `<g clip-path="url(#mcbleed)"><g transform="translate(0,${2 * MC_ART_WIN.h}) scale(1,-1)">`
        + `<image href="${esc(mc.img)}" x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${b.w.toFixed(1)}" height="${b.h.toFixed(1)}" preserveAspectRatio="xMidYMid slice"/></g></g>`;
    }
  } else {
    s += `<g opacity=".3" stroke="#d6cdb4" stroke-width="18">`;
    for (let i = -4; i < 14; i++) s += `<line x1="${i * 90}" y1="0" x2="${i * 90 + 500}" y2="${H}"/>`;
    s += `</g><text x="${W / 2}" y="${(H - 300) / 2}" text-anchor="middle" font-family='${MC_FONT}' font-size="22" fill="#a89f88">（未上传插画 · 点左侧「上传插画」）</text>`;
  }
  return s;
}
/* 卡牌圆角裁切外壳 */
function mcSvgShell(inner, W, H, RX) {
  const rx = RX || 26;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <clipPath id="mclip"><rect width="${W}" height="${H}" rx="${rx}"/></clipPath>
      <linearGradient id="mtop" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#141310" stop-opacity=".62"/>
        <stop offset="1" stop-color="#141310" stop-opacity="0"/>
      </linearGradient>
      <filter id="msh" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="2" stdDeviation="2.4" flood-color="#000" flood-opacity=".35"/>
      </filter>
    </defs>
    <g clip-path="url(#mclip)">${inner}</g>
    <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="${rx - 1}" fill="none" stroke="#2f2c25" stroke-opacity=".35" stroke-width="2"/>
  </svg>`;
}

/* ---------- ① 行者牌（四色）v47：原版底版 + 原版图标，官方版式坐标 ----------
   底版 ranger_<attr>.png 直接取自原版扫描（724×1036，=1448×2072 的 1/2），
   已擦除文字与插画；手段符号取自原版字形 PNG；装备值方格按实测槽位绘制。 */
const MC_CW = 724, MC_CH = 1036;
const MC_FRAME_IMG = {
  know: 'assets/frames/ranger_know.webp', phy: 'assets/frames/ranger_phy.webp',
  foc: 'assets/frames/ranger_foc.webp', spi: 'assets/frames/ranger_spi.webp',
};
const MC_SYM_IMG = {
  heart: 'assets/symbols/heart.png', tri: 'assets/symbols/tri.png',
  spiral: 'assets/symbols/spiral.png', ring: 'assets/symbols/ring.png',
};
/* 原版字形在 724 卡面上的物理尺寸（实测） */
const MC_SYM_SIZE = { heart: [64, 53], tri: [66, 62], spiral: [68, 61], ring: [63, 80] };
const MC_SYM_SLOT = [{ cx: 77.5, cy: 223.5 }, { cx: 77.5, cy: 371.5 }];
const MC_GEAR = { x: 576.5, y: 100.5, size: 14, pitch: 19.5, count: 5, rx: 2 };
/* 文字槽（逐块实测：以原版扫描 1448×2072 的 1/2 坐标为准） */
const MC_SLOT = {
  feeNum: { cx: 56, base: 103.5, size: 76 },
  feeAttr: { cx: 55.5, base: 129.5, size: 21.5, track: 2 },
  name: { x: 133, base: 90, size: 41, track: 2.7 },
  type: { x: 131.5, base: 127, size: 24 },
  body: { x: 97, top: 683, base: 710, w: 546, bottom: 994, size: 32, lineH: 1.375 },
  req: { cx: 21.5, top: 620, bottom: 720, size: 24, track: 0 },
  deck: { cx: 20, top: 846, bottom: 1004, size: 26, track: 0 },
  /* v51 按原版实测重标：数字底边 269、字身 19×50.5；
     「点」贴数字右侧 (x 663.5–678.5, 底 263.5)；
     「充能」整行居中在块内 (x 642.5–678, 底 289)，比「点」大一号。 */
  token: { x: 619.5, y: 205, w: 83.5, h: 97, r: 8,
           numCx: 648.5, numBase: 269, numSize: 68,
           txtCx: 671, b1: 264, txtSize: 15,
           txtCx2: 660.5, b2: 289, txtSize2: 18.5, txtTrack: 0 },
  foot: { penX: 84, arX: 107.5, base: 1031, size: 16.8, crX: 700 },
};

function mcSvgRanger(mc, T) {
  const W = MC_CW, H = MC_CH, A = T.accent || '#5b8a4e';
  const has = v => v !== null && v !== undefined && String(v).trim() !== '';
  const attrName = has(mc.costAttr) ? mc.costAttr : (T.attrName || '知觉');
  const reqAttr = has(mc.reqAttr) ? mc.reqAttr : attrName;
  const reqVal = has(mc.reqVal) ? String(mc.reqVal) : '';
  const fam = String(mc.tpl || '').replace('ranger_', '');
  const symKeys0 = String(mc.symbols || '').split(',').map(x => x.trim()).filter(Boolean);
  const useSym = (symKeys0.length ? symKeys0 : [T.defSym]).filter(k => k).slice(0, 2);
  /* 原版：只有 1 个手段符号的牌只有 1 个面板，故按数量选底版 */
  const base = MC_FRAME_IMG[fam] || MC_FRAME_IMG.know;
  const frame = useSym.length > 1 ? base : base.replace('.webp', '_p1.webp');

  /* 插画层（用户上传），底版覆盖其上 */
  let s = mcSvgBg(mc, W, H);
  s += `<image href="${frame}" x="0" y="0" width="${W}" height="${H}"/>`;

  /* ① 费用：数字 + 属性名 */
  const F = MC_SLOT.feeNum, FA = MC_SLOT.feeAttr;
  s += `<text x="${F.cx}" y="${F.base}" text-anchor="middle" font-family='${MC_NUM_FONT}' font-size="${F.size}" font-weight="400" fill="#fff">${esc(has(mc.fee) ? mc.fee : '0')}</text>`;
  s += `<text x="${FA.cx}" y="${FA.base}" text-anchor="middle" font-family='${MC_FONT}' font-size="${FA.size}" font-weight="700" letter-spacing="${FA.track}" fill="#fff">${esc(attrName)}</text>`;

  /* ②③ 名称 + 类型·关键词 */
  s += `<text x="${MC_SLOT.name.x}" y="${MC_SLOT.name.base}" font-family='${MC_FONT}' font-size="${MC_SLOT.name.size}" font-weight="700" letter-spacing="${MC_SLOT.name.track}" fill="#232323">${esc(has(mc.name) ? mc.name : '未命名行者牌')}</text>`;
  s += `<text x="${MC_SLOT.type.x}" y="${MC_SLOT.type.base}" font-family='${MC_FONT}' font-size="${MC_SLOT.type.size}" font-weight="600" fill="#2b2b2b">${esc(has(mc.type) ? mc.type : (T.defType || '道具·科技'))}</text>`;

  /* ④ 装备值：右上 5 格，实心=已占用 */
  const gear = Math.max(0, Math.min(MC_GEAR.count, +mc.gear || 0));
  for (let i = 0; i < MC_GEAR.count; i++) {
    const gx = MC_GEAR.x + i * MC_GEAR.pitch;
    if (i < gear) {
      s += `<rect x="${gx}" y="${MC_GEAR.y}" width="${MC_GEAR.size}" height="${MC_GEAR.size}" rx="${MC_GEAR.rx}" fill="${A}"/>`;
    } else {
      s += `<rect x="${gx}" y="${MC_GEAR.y}" width="${MC_GEAR.size}" height="${MC_GEAR.size}" rx="${MC_GEAR.rx}" fill="none" stroke="${MC_INK}" stroke-opacity=".30" stroke-width="1.5"/>`;
    }
  }

  /* ⑥ 标记（右侧色块：大字数字 + 两行小字「点 / 名称」）
     v51：块体本身（连描边）留在底版里，这里只写字 —— 早先 JS 现画的
     平色块会把原版的「插座」描边一起盖掉，正是用户说的丢装饰线。 */
  if (has(mc.tokenNum) || has(mc.tokenName)) {
    const K = MC_SLOT.token;
    if (has(mc.tokenNum)) {
      s += `<text x="${K.numCx}" y="${K.numBase}" text-anchor="middle" font-family='${MC_NUM_FONT}' font-size="${K.numSize}" font-weight="400" fill="#fff">${esc(mc.tokenNum)}</text>`;
    }
    const tname = has(mc.tokenName) ? String(mc.tokenName) : '';
    if (tname) {
      /* 小字列：第一行「点」（小号），第二行标记名（大一号，原版如此） */
      const fit = (t, base) => Math.min(base, (K.w - 10) / mcVUnits(t));
      s += `<text x="${K.txtCx}" y="${K.b1}" text-anchor="middle" font-family='${MC_FONT}' font-size="${fit('点', K.txtSize).toFixed(1)}" font-weight="400" fill="#fff">点</text>`;
      s += `<text x="${K.txtCx2 || K.txtCx}" y="${K.b2}" text-anchor="middle" font-family='${MC_FONT}' font-size="${fit(tname, K.txtSize2).toFixed(1)}" font-weight="400" letter-spacing="${K.txtTrack}" fill="#fff">${esc(tname)}</text>`;
    }
  }

  /* ⑧ 手段符号：原版字形 PNG，居中放进底版自带的面板 */
  const use = useSym;
  use.forEach((k, i) => {
    const slot = MC_SYM_SLOT[i];
    if (!slot) return;
    const img = MC_SYM_IMG[k];
    if (img) {
      const sz = MC_SYM_SIZE[k] || [64, 60];
      const dw = sz[0] * 256 / 230.4, dh = sz[1] * 256 / 230.4;
      s += `<image href="${img}" x="${(slot.cx - dw / 2).toFixed(1)}" y="${(slot.cy - dh / 2).toFixed(1)}" width="${dw.toFixed(1)}" height="${dh.toFixed(1)}"/>`;
    } else if (MC_SYM[k]) {
      s += `<g transform="translate(${slot.cx - 33},${slot.cy - 33}) scale(.66)">${MC_SYM[k]}</g>`;
    }
  });

  /* ⑩ 属性需求（左缘色条的竖排文字） */
  if (reqVal) {
    const R = MC_SLOT.req;
    const txt = `${reqVal}点${reqAttr}`;
    const avail = (R.bottom - R.top) * 0.96;
    s += mcVText(txt, R.cx, (R.top + R.bottom) / 2, Math.min(R.size, avail / mcVUnits(txt)), '#fff', 600, R.track);
  }

  /* ⑪ 牌组信息（左下深色竖条：牌组名-编号/总数） */
  const setName = has(mc.setName) ? mc.setName : (T.band || '行者');
  const deckTxt = has(mc.setNum) ? `${setName}-${mc.setNum}${has(mc.setTotal) ? '/' + mc.setTotal : ''}` : setName;
  const D = MC_SLOT.deck;
  const dAvail = (D.bottom - D.top) * 0.96;
  s += mcVText(deckTxt, D.cx, (D.top + D.bottom) / 2, Math.min(D.size, dAvail / mcVUnits(deckTxt)), '#ece7d6', 600, D.track);

  /* ⑨ 能力与检定（面板内正文）+ 风味 */
  const B = MC_SLOT.body;
  const flav = has(mc.flavor) ? String(mc.flavor) : '';
  let bodyMax = B.bottom - B.top;
  let flavH = 0;
  let flavSvg = '';
  if (flav) {
    const fr = mcFillText(flav, { x: B.x, y: 0, w: B.w, maxH: 210, size: 26, minSize: 18, fill: '#6b6657', italic: true, lineH: 1.55 });
    flavH = fr.h + 18; flavSvg = fr.svg;
    bodyMax = B.bottom - B.top - flavH;
  }
  const body = mcFillText(has(mc.text) ? mc.text : '', {
    x: B.x, y: B.top, w: B.w, maxH: bodyMax, size: B.size, minSize: 18,
    fill: has(mc.text) ? '#22201c' : '#a49b84', lineH: B.lineH, paraGap: 15,
  });
  s += body.svg;
  if (flavSvg) {
    const dy = B.top + body.h + 16;
    s += `<g transform="translate(0,${dy})">${flavSvg}</g>`;
  }

  /* 卡底：画师 / 版权（画笔小图标留在底版里，文字从 x=107.5 起排） */
  const FT = MC_SLOT.foot;
  s += `<text x="${FT.arX}" y="${FT.base}" font-family='${MC_NUM_FONT}' font-size="${FT.size}" fill="#eef3e2">${esc(has(mc.artist) ? mc.artist : '')}</text>`;
  s += `<text x="${FT.crX}" y="${FT.base}" text-anchor="end" font-family='${MC_NUM_FONT}' font-size="${FT.size}" fill="#eef3e2">©2025 EBG</text>`;
  return mcSvgShell(s, W, H, 13);
}

/* ---------- ② 路径牌（道路 / 关键地点 / 通用 / 非关键地点） ---------- */
function mcSvgPath(mc, T) {
  const W = MC_VW, H = MC_VH, A = T.accent;
  const has = v => v !== null && v !== undefined && String(v).trim() !== '';
  const setName = has(mc.setName) ? mc.setName : (T.band || '道路');
  let s = mcSvgBg(mc, W, H);

  /* 顶部压暗，保证压图标题可读 */
  s += `<rect x="0" y="0" width="${W}" height="168" fill="url(#mtop)"/>`;

  /* 左上：牌组圆形徽标 */
  s += `<circle cx="52" cy="56" r="34" fill="${MC_PAPER}" fill-opacity=".95" stroke="${A}" stroke-width="3"/>`;
  const sym = String(mc.symbols || '').split(',')[0].trim();
  if (MC_SYM[sym]) {
    s += `<g transform="translate(${52 - 21},${56 - 21}) scale(.42)">${MC_SYM[sym].replace(/#f3efe3/g, A)}</g>`;
  } else {
    s += `<circle cx="52" cy="56" r="16" fill="none" stroke="${A}" stroke-width="5"/>`;
  }

  /* 名称 / 类型·关键词 */
  s += `<text x="100" y="56" font-family='${MC_FONT}' font-size="36" font-weight="800" fill="#fff">${esc(has(mc.name) ? mc.name : '未命名路径牌')}</text>`;
  s += `<text x="100" y="92" font-family='${MC_FONT}' font-size="19" font-weight="600" fill="#fff" fill-opacity=".9">${esc(has(mc.type) ? mc.type : (T.defType || '地标·动物'))}</text>`;

  /* 右上：页数引用 + 存在度（紫块） */
  if (has(mc.page)) {
    s += `<g transform="translate(592,26) scale(.36)">${MC_SYM.book.replace(/#f3efe3/g, '#fff')}</g>`;
    s += `<text x="634" y="52" font-family='${MC_FONT}' font-size="20" font-weight="700" fill="#fff">${esc(mc.page)}</text>`;
  }
  if (has(mc.ptop)) {
    s += `<rect x="674" y="26" width="52" height="52" rx="6" fill="#6b4a7a"/>`;
    s += `<text x="700" y="64" text-anchor="middle" font-family='${MC_FONT}' font-size="32" font-weight="800" fill="#fff">${esc(mc.ptop)}</text>`;
  }

  /* 右下：伤害阈值（红）/ 疲劳或耐久（青） */
  if (has(mc.pn1)) {
    s += `<rect x="576" y="676" width="54" height="54" rx="6" fill="#a6492f"/>`;
    s += `<text x="603" y="714" text-anchor="middle" font-family='${MC_FONT}' font-size="32" font-weight="800" fill="#fff">${esc(mc.pn1)}</text>`;
  }
  if (has(mc.pn2)) {
    s += `<rect x="638" y="676" width="66" height="54" rx="6" fill="#4d9a94"/>`;
    s += `<text x="671" y="714" text-anchor="middle" font-family='${MC_FONT}' font-size="30" font-weight="800" fill="#fff">${esc(mc.pn2)}</text>`;
  }
  /* 标记（如「4 块余烬」） */
  if (has(mc.tokenNum) || has(mc.tokenName)) {
    s += `<rect x="690" y="146" width="56" height="92" rx="6" fill="${A}" fill-opacity=".94"/>`;
    s += `<text x="718" y="188" text-anchor="middle" font-family='${MC_FONT}' font-size="27" font-weight="800" fill="#fff">${esc(mc.tokenNum || '')}</text>`;
    if (has(mc.tokenName)) s += mcVText(mc.tokenName, 718, 216, 13, '#fff', 700, 0.5);
  }

  /* 文本区：正文 + 最多 3 条彩色触发条 */
  const PX = 16, PW = W - 32, PY = 744, PB = 1020;
  const bars = [mc.bar1, mc.bar2, mc.bar3].filter(x => has(x));
  const barH = 56, barGap = 6;
  const bodyH = PB - PY - bars.length * (barH + barGap);
  s += `<rect x="${PX}" y="${PY}" width="${PW}" height="${bodyH}" fill="${MC_PAPER}" fill-opacity=".97"/>`;
  const body = mcFillText(has(mc.text) ? mc.text : '', { x: PX + 22, y: PY + 18, w: PW - 44, maxH: bodyH - 36, size: 22, minSize: 15, fill: MC_INK, lineH: 1.6, paraGap: 10 });
  s += body.svg;

  const barStyle = [
    { bg: '#d9a227', fg: '#3a2c0c', icon: 'sun' },
    { bg: '#3f6f8f', fg: '#f3efe3', icon: 'drop' },
    { bg: '#a6492f', fg: '#f3efe3', icon: 'paw' },
  ];
  bars.forEach((txt, i) => {
    const y = PB - (bars.length - i) * (barH + barGap) + barGap;
    const st = barStyle[i];
    s += `<rect x="${PX}" y="${y}" width="${PW}" height="${barH}" fill="${st.bg}"/>`;
    s += `<g transform="translate(${PX + 14},${y + 13}) scale(.3)">${MC_SYM[st.icon].replace(/#f3efe3/g, st.fg)}</g>`;
    s += mcFillText(txt, { x: PX + 52, y: y + 14, w: PW - 76, maxH: barH - 16, size: 19, minSize: 13, fill: st.fg, lineH: 1.4, italic: true }).svg;
  });

  /* 牌组信息：底部居中 */
  const deckTxt = has(mc.setNum) ? `${setName} - ${mc.setNum}${has(mc.setTotal) ? '/' + mc.setTotal : ''}` : setName;
  s += `<text x="${W / 2}" y="1038" text-anchor="middle" font-family='${MC_FONT}' font-size="17" font-weight="700" fill="#3a3629">${esc(deckTxt)}</text>`;
  s += `<text x="726" y="1038" text-anchor="end" font-family='${MC_FONT}' font-size="13" fill="#5a5542">©2025 EBG</text>`;
  return mcSvgShell(s, W, H);
}

/* ---------- ③ 瞬间牌 ---------- */
function mcSvgMoment(mc, T) {
  const W = MC_VW, H = MC_VH;
  const has = v => v !== null && v !== undefined && String(v).trim() !== '';
  const setName = has(mc.setName) ? mc.setName : (T.band || '瞬间');
  let s = mcSvgBg(mc, W, H);
  s += `<rect x="0" y="0" width="${W}" height="200" fill="url(#mtop)"/>`;
  /* 下半米白文本区 */
  s += `<rect x="0" y="352" width="${W}" height="${H - 352}" fill="${MC_PAPER}" fill-opacity=".96"/>`;
  s += `<line x1="0" y1="352" x2="${W}" y2="352" stroke="${MC_INK}" stroke-opacity=".18" stroke-width="2"/>`;

  s += `<text x="${W / 2}" y="76" text-anchor="middle" font-family='${MC_FONT}' font-size="38" font-weight="800" fill="#fff">${esc(has(mc.name) ? mc.name : '未命名瞬间牌')}</text>`;
  s += `<text x="${W / 2}" y="112" text-anchor="middle" font-family='${MC_FONT}' font-size="19" font-weight="600" fill="#fff" fill-opacity=".92">${esc(has(mc.type) ? mc.type : (T.defType || '瞬间·机遇'))}</text>`;

  /* 场景引子（斜体居中） */
  let y = 402;
  if (has(mc.scene)) {
    const h = mcCenterLines(mc.scene, 80, y, W - 160, 160, 22, 15, '#4a5c48', true, 1.7);
    s += h.svg;
    y = h.bottom + 20;
  }
  /* 「行者请选择：」 */
  if (has(mc.prompt) || has(mc.text)) {
    const prompt = has(mc.prompt) ? mc.prompt : '行者请选择：';
    s += `<text x="${W / 2}" y="${y + 24}" text-anchor="middle" font-family='${MC_FONT}' font-size="24" font-weight="800" fill="${MC_INK}">${esc(prompt)}</text>`;
    y += 62;
  }
  /* A/B 选项正文 */
  const body = mcFillText(has(mc.text) ? mc.text : '', { x: 56, y, w: W - 112, maxH: 968 - y, size: 22, minSize: 14, fill: MC_INK, lineH: 1.72, paraGap: 18 });
  s += body.svg;

  const deckTxt = has(mc.setNum) ? `${setName} - ${mc.setNum}${has(mc.setTotal) ? '/' + mc.setTotal : ''}` : setName;
  s += `<line x1="0" y1="986" x2="${W}" y2="986" stroke="${MC_INK}" stroke-opacity=".16" stroke-width="2"/>`;
  s += `<text x="${W / 2}" y="1028" text-anchor="middle" font-family='${MC_FONT}' font-size="19" font-weight="700" fill="#3a3629">${esc(deckTxt)}</text>`;
  s += `<text x="726" y="1028" text-anchor="end" font-family='${MC_FONT}' font-size="12" fill="#5a5542">©2025 EBG</text>`;
  return mcSvgShell(s, W, H);
}
/* 居中多行（瞬间 / 任务牌引子用），返回 { svg, bottom } */
function mcCenterLines(text, x, y, w, maxH, size, minSize, fill, italic, lineH) {
  let sz = size, lines = [], lh = 0;
  for (;;) {
    lines = mcLayout(text, sz, w, 400); lh = Math.round(sz * lineH);
    if (lines.length * lh <= maxH || sz <= minSize) break;
    sz -= 1;
  }
  let cy = y + sz * 0.86, out = '';
  for (const ln of lines) {
    const spans = ln.map(r => `<tspan font-weight="${r.bold ? 700 : 400}">${esc(r.t)}</tspan>`).join('');
    out += `<text x="${x + w / 2}" y="${cy}" text-anchor="middle" font-family='${MC_FONT}' font-size="${sz}" fill="${fill}"${italic ? ' font-style="italic"' : ''}>${spans}</text>`;
    cy += lh;
  }
  return { svg: out, bottom: y + lines.length * lh };
}

/* ---------- ④ 任务牌 ---------- */
function mcSvgTask(mc, T) {
  const W = MC_VW, H = MC_VH, A = T.accent || '#5a7846';
  const has = v => v !== null && v !== undefined && String(v).trim() !== '';
  const setName = has(mc.setName) ? mc.setName : (T.band || '任务');
  let s = mcSvgBg(mc, W, H);
  /* 上半插画带 → 下方米白正文区 */
  s += `<rect x="0" y="300" width="${W}" height="${H - 300}" fill="${MC_PAPER}" fill-opacity=".97"/>`;
  s += `<rect x="0" y="0" width="${W}" height="190" fill="url(#mtop)"/>`;
  s += `<text x="${W / 2}" y="84" text-anchor="middle" font-family='${MC_FONT}' font-size="40" font-weight="800" fill="#fff">${esc(has(mc.name) ? mc.name : '未命名任务牌')}</text>`;
  s += `<text x="${W / 2}" y="122" text-anchor="middle" font-family='${MC_FONT}' font-size="19" font-weight="600" fill="#fff" fill-opacity=".92">${esc(has(mc.type) ? mc.type : (T.defType || '任务·幕间'))}</text>`;
  s += `<line x1="0" y1="300" x2="${W}" y2="300" stroke="${A}" stroke-width="4"/>`;
  /* 下半留白处补一层淡山纹（对应官方任务牌的山水底纹） */
  s += `<g fill="none" stroke="${A}" stroke-opacity=".13" stroke-width="2.5">`;
  const PEAK = [46, 24, 38, 18, 52, 28, 40, 22, 44, 30];
  for (let r = 0; r < 3; r++) {
    const by = 700 + r * 104;
    let d2 = `M-30 ${by}`;
    for (let i = 0, x = 0; x <= W + 90; i++, x += 90) {
      const h2 = PEAK[(i + r * 3) % PEAK.length];
      d2 += ` Q${x + 45} ${by - h2} ${x + 90} ${by}`;
    }
    s += `<path d="${d2}"/>`;
  }
  s += `</g>`;

  let y = 330;
  if (has(mc.scene)) {
    s += mcCenterLines(mc.scene, 70, y, W - 140, 110, 21, 14, '#4a5c48', true, 1.7).svg;
    y += 58;
  }
  /* 绿色条件条 */
  if (has(mc.goal)) {
    const gy = Math.max(y + 6, 384);
    s += `<rect x="46" y="${gy}" width="${W - 92}" height="64" rx="8" fill="${A}"/>`;
    s += `<text x="${W / 2}" y="${gy + 41}" text-anchor="middle" font-family='${MC_FONT}' font-size="21" font-weight="700" fill="#f4efe0">${esc(mc.goal)}</text>`;
    y = gy + 86;
  }
  /* 补充说明正文（可空） */
  if (has(mc.text)) {
    s += mcFillText(mc.text, { x: 56, y: y + 6, w: W - 112, maxH: 980 - y, size: 21, minSize: 14, fill: MC_INK, lineH: 1.62, paraGap: 10 }).svg;
  }

  const deckTxt = has(mc.setNum) ? `${setName} - ${mc.setNum}${has(mc.setTotal) ? '/' + mc.setTotal : ''}` : setName;
  s += `<text x="${W / 2}" y="1034" text-anchor="middle" font-family='${MC_FONT}' font-size="18" font-weight="700" fill="#3a3629">${esc(deckTxt)}</text>`;
  s += `<text x="726" y="1034" text-anchor="end" font-family='${MC_FONT}' font-size="13" fill="#5a5542">©2025 EBG</text>`;
  return mcSvgShell(s, W, H);
}

/* 统一入口 */
function mcSVG(mc) {
  const T = MC_TPLS[mc.tpl] || {};
  const fam = mcFam(mc.tpl);
  if (fam === 'ranger') return mcSvgRanger(mc, T);
  if (fam === 'path') return mcSvgPath(mc, T);
  if (fam === 'moment') return mcSvgMoment(mc, T);
  if (fam === 'task') return mcSvgTask(mc, T);
  return '';
}
/* SVG → PNG（导出尺寸按 SVG 画布 4× ：行者牌 2896×4144） */
async function mcExportSvgPNG(mc) {
  const svg = mcSVG(mc);
  if (!svg) return false;
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const im = await mcLoadImg(url);
    const SC = 4;   /* 724×4=2896 / 1036×4=4144，与原版扫描 2 倍等宽 */
    const mm = svg.match(/width="(\d+)" height="(\d+)"/);
    const sw = mm ? +mm[1] : MC_VW, sh = mm ? +mm[2] : MC_VH;
    const cv = document.createElement('canvas');
    cv.width = sw * SC; cv.height = sh * SC;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(im, 0, 0, cv.width, cv.height);
    return await new Promise(res => cv.toBlob(b => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `自制_${MC_TPLS[mc.tpl]?.label || '卡'}_${(mc.name || '未命名').replace(/[\\/:*?"<>|]/g, '')}.png`;
      a.click(); URL.revokeObjectURL(a.href);
      res(true);
    }, 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}

const mcChips = a => Object.entries(a || {})
  .filter(([, v]) => v !== null && v !== undefined && v !== '')
  .map(([k, v]) => `<span class="chip-attr attr-${esc(k)}" title="${esc(ATTR_FULL[k] || k)}">${esc(k)}${esc(v)}</span>`).join(' ');

/* 预览卡 HTML（与 PNG 导出版式对应） */
function mcCardHTML(mc) {
  /* v46：官方版式家族统一走 SVG（预览 = 导出，不会两套版式漂移） */
  const _fam = mcFam(mc.tpl);
  if (MC_SVG_FAM[_fam] && mc.tpl !== 'ranger') {
    return `<div class="mcard mcard-svg">${mcSVG(mc)}</div>`;
  }
  const has = v => v !== null && v !== undefined && String(v).trim() !== '';
  const art = has(mc.img)
    ? `<img class="mcard-art" src="${esc(mc.img)}" alt="">`
    : `<label class="mcard-noart" for="mk-imgfile">点击「上传底图」<br>添加卡面插画<br>（留空则为纯色底）</label>`;
  const title = has(mc.name) ? `<div class="mcard-titlebar">${esc(mc.name)}</div>` : '';
  const tag = has(mc.type) ? `<span class="mcard-typetag">${esc(mc.type)}</span>` : '';
  const text = `<div class="mcard-text">${has(mc.text) ? mcTextHTML(mc.text) : '<span style="opacity:.5">（技能文本）</span>'}</div>`;
  const chips = mcChips(mc.attr);
  const attrRow = chips ? `<div class="mcard-attrs">${chips}</div>` : '';
  const T = MC_TPLS[mc.tpl];

  /* —— v45：四色行者牌 —— 框架 = accent 色；左上费用块；正文 + 风味斜体 */
  if (mcFam(mc.tpl) === 'ranger' && mc.tpl !== 'ranger') {
    const fee = (has(mc.fee) || has(mc.type))
      ? `<div class="mcard-fee" style="border-color:${T.accent}"><b>${has(mc.fee) ? esc(mc.fee) : '·'}</b>
         <span style="color:${T.accent}">${esc(mc.feeattr || T.feeAttr || '')}</span></div>` : '';
    const body = has(mc.text) ? mcTextHTML(mc.text) : '<span style="opacity:.5">（效果文本）</span>';
    const flav = has(mc.flavor) ? `<div class="mc-flavor">${esc(mc.flavor)}</div>` : '';
    return `<div class="mcard" style="--mc-accent:${T.accent}">${art}${fee}
      <div class="mcard-titlebar mc-rname">${has(mc.name) ? esc(mc.name) : '<span style="opacity:.55">未命名行者牌</span>'}</div>
      <span class="mcard-typetag mc-rtag">${has(mc.type) ? esc(mc.type) : esc(T.defType)}</span>
      <div class="mcard-text mc-rtext">${chips ? `<div class="mc-req">${chips}</div>` : ''}${body}${flav}</div>
      <div class="mcard-spine" style="background:${T.accent}"><i>${esc(T.band)}</i></div></div>`;
  }
  /* —— v45：路径牌 —— 右上数字 + 右下双数字块 */
  if (mcFam(mc.tpl) === 'path') {
    const ptop = has(mc.ptop) ? `<div class="mcard-pnum mc-ptop">${esc(mc.ptop)}</div>` : '';
    const prow = (has(mc.pn1) || has(mc.pn2))
      ? `<div class="mcard-prow"><span class="mcard-pnum">${has(mc.pn1) ? esc(mc.pn1) : '·'}</span>
         <span class="mcard-pnum b">${has(mc.pn2) ? esc(mc.pn2) : '·'}</span></div>` : '';
    return `<div class="mcard" style="--mc-accent:${T.accent}">${art}
      <div class="mcard-titlebar mc-rname">${has(mc.name) ? esc(mc.name) : '<span style="opacity:.55">未命名路径牌</span>'}</div>
      <span class="mcard-typetag mc-rtag">${has(mc.type) ? esc(mc.type) : esc(T.defType)}</span>
      ${ptop}${prow}${text}
      <div class="mcard-spine" style="background:${T.accent}"><i>${esc(T.band)}</i></div></div>`;
  }
  /* —— v45：任务牌 —— 居中名称 + 说明文本在上、目标条在下（与官方任务牌读序一致） */
  if (mc.tpl === 'task') {
    const hasGoal = has(mc.goal);
    const ttext = `<div class="mcard-text"${hasGoal ? ' style="bottom:236px"' : ''}>${has(mc.text) ? mcTextHTML(mc.text) : '<span style="opacity:.5">（说明文本）</span>'}</div>`;
    const goal = hasGoal ? `<div class="mcard-goal">${esc(mc.goal)}</div>` : '';
    return `<div class="mcard" style="--mc-accent:${T.accent}">${art}
      <div class="mcard-titlebar mc-center">${has(mc.name) ? esc(mc.name) : '<span style="opacity:.55">未命名任务牌</span>'}</div>
      <span class="mcard-typetag mc-rtag mc-rtag-c">${has(mc.type) ? esc(mc.type) : esc(T.defType)}</span>
      ${ttext}${goal}
      <div class="mcard-spine" style="background:${T.accent}"><i>${esc(T.band)}</i></div></div>`;
  }
  /* —— v45：瞬间牌 —— 居中名称 + 大文本区 */
  if (mc.tpl === 'moment') {
    return `<div class="mcard" style="--mc-accent:${T.accent}">${art}
      <div class="mcard-titlebar mc-center">${has(mc.name) ? esc(mc.name) : '<span style="opacity:.55">未命名瞬间牌</span>'}</div>
      <span class="mcard-typetag mc-rtag mc-rtag-c">${has(mc.type) ? esc(mc.type) : esc(T.defType)}</span>
      <div class="mcard-text mc-mtext">${has(mc.text) ? mcTextHTML(mc.text) : '<span style="opacity:.5">（效果文本，可写 A) / B) 选项）</span>'}</div>
      <div class="mcard-spine" style="background:${T.accent}"><i>${esc(T.band)}</i></div></div>`;
  }

  if (mc.tpl === 'ranger') {
    return `<div class="mcard">${art}
      <div class="mcard-band">
        <div class="mcard-bname">${has(mc.name) ? esc(mc.name) : '<span style="opacity:.6">未命名行者</span>'}</div>
        <div class="mcard-bdiv">◆</div>
        <div class="mcard-btext">${has(mc.text) ? mcTextHTML(mc.text) : '<span style="opacity:.5">（技能文本）</span>'}</div>
      </div>${attrRow}</div>`;
  }
  if (mc.tpl === 'blank') {
    return `<div class="mcard">${art}${title}${tag}
      ${chips ? `<div class="mcard-attrs mc-attrs-top">${chips}</div>` : ''}
      ${has(mc.text) ? text : ''}</div>`;
  }
  return `<div class="mcard">${art}${title}<span class="mcard-typetag">${has(mc.type) ? esc(mc.type) : '角色'}</span>${text}</div>`;
}

/* ---- PNG 导出（canvas 手绘，与预览版式一致） ---- */
function mcRR(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
const mcLoadImg = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
/* 文本 runs：首行引导词（消耗/响应/部署 等）加粗到冒号；精力/能量 琥珀色 */
function mcRuns(text) {
  const out = []; let rest = String(text ?? '');
  const m = rest.match(/^(消耗|响应|部署|行动|灵感|通灵)[：:]/);
  if (m) { out.push({ t: m[0], bold: true }); rest = rest.slice(m[0].length); }
  rest.split(/(精力|能量)/).forEach(seg => { if (seg) out.push({ t: seg, amber: seg === '精力' || seg === '能量' }); });
  return out;
}
async function mcExportPNG(mc) {
  /* v46：官方版式家族走 SVG 导出（与预览同一套版面） */
  const _fam = mcFam(mc.tpl);
  if (MC_SVG_FAM[_fam] && mc.tpl !== 'ranger') return await mcExportSvgPNG(mc);
  const W = 600, H = 840, PAPER = '#f2ecdc', INK = '#2c2a24', LINE = '#6f6752';
  const AMBER_L = '#c8951f', AMBER_D = '#e5b54f';
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const font = (w, s) => `${w} ${s}px "PingFang SC","Microsoft YaHei",sans-serif`;
  const has = v => v !== null && v !== undefined && String(v).trim() !== '';
  const chips = Object.entries(mc.attr || {}).filter(([, v]) => v !== null && v !== undefined && v !== '');

  /* 底图 cover */
  ctx.fillStyle = '#e9e2d2'; ctx.fillRect(0, 0, W, H);
  if (has(mc.img)) {
    try {
      const im = await mcLoadImg(mc.img);
      const s = Math.max(W / im.width, H / im.height);
      ctx.drawImage(im, (W - im.width * s) / 2, (H - im.height * s) / 2, im.width * s, im.height * s);
    } catch { /* 图片加载失败则用纯色底 */ }
  } else {
    /* 无底图：虚线占位框 */
    ctx.strokeStyle = '#a99f86'; ctx.lineWidth = 2; ctx.setLineDash([12, 9]);
    mcRR(ctx, 24, 24, W - 48, H - 48, 14); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#8d8468'; ctx.font = font(400, 20); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('（未上传底图）', W / 2, H / 2);
  }
  /* 外框 */
  ctx.strokeStyle = LINE; ctx.lineWidth = 5; mcRR(ctx, 7, 7, W - 14, H - 14, 22); ctx.stroke();

  /* runs → 行（逐字符换行，加粗/琥珀按 run 着色；\n 强制断行） */
  const layout = (text, size, maxW, boldable = true) => {
    const lines = []; let line = [], w = 0;
    for (const r of mcRuns(boldable ? text : String(text ?? ''))) {
      for (const ch of r.t) {
        if (ch === '\n') { if (line.length) { lines.push(line); line = []; w = 0; } continue; }
        ctx.font = font(boldable && r.bold ? 700 : 400, size);
        const cw = ctx.measureText(ch).width;
        if (w + cw > maxW && w > 0) { lines.push(line); line = []; w = 0; }
        line.push({ ch, bold: r.bold, amber: r.amber, cw }); w += cw;
      }
    }
    if (line.length) lines.push(line);
    return lines;
  };
  /* 风味文本：斜体、无加粗/琥珀，\n 强制断行 */
  const layoutFlavor = (text, size, maxW) => {
    const lines = []; let line = [], w = 0;
    for (const ch of String(text ?? '')) {
      if (ch === '\n') { if (line.length) { lines.push(line); line = []; w = 0; } continue; }
      ctx.font = `italic 400 ${size}px "PingFang SC","Microsoft YaHei",sans-serif`;
      const cw = ctx.measureText(ch).width;
      if (w + cw > maxW && w > 0) { lines.push(line); line = []; w = 0; }
      line.push({ ch, cw }); w += cw;
    }
    if (line.length) lines.push(line);
    return lines;
  };
  const drawLines = (lines, x, y, size, lineH, ink, amber) => {
    let cy = y;
    for (const ln of lines) {
      let cx = x;
      for (const r of ln) {
        ctx.font = font(r.bold ? 700 : 400, size);
        ctx.fillStyle = r.amber ? amber : ink;
        ctx.fillText(r.ch, cx, cy);
        cx += r.cw;
      }
      cy += lineH;
    }
    return cy;
  };
  const drawChips = (cy, size = 46, gap = 10) => {
    if (!chips.length) return;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const total = chips.length * size + (chips.length - 1) * gap;
    let cx = (W - total) / 2;
    for (const [k, v] of chips) {
      ctx.fillStyle = MC_ATTR_COLOR[k] || '#666';
      mcRR(ctx, cx, cy, size, size, 10); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = font(700, 21);
      ctx.fillText(`${k}${v}`, cx + size / 2, cy + size / 2 + 1);
      cx += size + gap;
    }
  };

  ctx.textBaseline = 'top';
  /* —— v45：四色行者牌 / 路径牌 / 瞬间牌 / 任务牌 —— 仿官方空白模板版式 */
  if ((mcFam(mc.tpl) === 'ranger' && mc.tpl !== 'ranger') || mcFam(mc.tpl) === 'path'
      || mc.tpl === 'moment' || mc.tpl === 'task') {
    const T = MC_TPLS[mc.tpl] || {};
    const ACC = T.accent || '#5a7846';
    const fam = mcFam(mc.tpl);
    const isRanger = fam === 'ranger', isPath = fam === 'path', isTask = mc.tpl === 'task';

    /* 外框：accent 粗框 + 内衬细线 */
    ctx.strokeStyle = ACC; ctx.lineWidth = 12;
    mcRR(ctx, 6, 6, W - 12, H - 12, 22); ctx.stroke();
    ctx.strokeStyle = 'rgba(44,42,36,.35)'; ctx.lineWidth = 2;
    mcRR(ctx, 16, 16, W - 32, H - 32, 14); ctx.stroke();

    const nameTxt = has(mc.name) ? mc.name
      : isRanger ? '未命名行者牌' : isPath ? '未命名路径牌' : isTask ? '未命名任务牌' : '未命名瞬间牌';
    const typeTxt = has(mc.type) ? mc.type : (T.defType || '');
    const centered = !isRanger && !isPath;           // 任务 / 瞬间：名称居中
    const nameY = 40, nameH2 = 66;
    const nx = isRanger ? 96 : 40, nw = W - nx - 40; // 行者牌给左上费用块让位
    ctx.fillStyle = 'rgba(244,239,224,.95)';
    mcRR(ctx, nx, nameY, nw, nameH2, 8); ctx.fill();
    ctx.strokeStyle = 'rgba(44,42,36,.45)'; ctx.lineWidth = 2; mcRR(ctx, nx, nameY, nw, nameH2, 8); ctx.stroke();
    ctx.fillStyle = INK; ctx.font = font(800, 30);
    ctx.textAlign = centered ? 'center' : 'left'; ctx.textBaseline = 'top';
    ctx.fillText(nameTxt, centered ? W / 2 : nx + 18, nameY + 16);
    if (typeTxt) {
      ctx.font = font(600, 17);
      const tw = ctx.measureText(typeTxt).width + 22;
      const tx = centered ? (W - tw) / 2 : nx + 8;
      ctx.fillStyle = 'rgba(244,239,224,.95)';
      mcRR(ctx, tx, nameY + nameH2 + 8, tw, 30, 5); ctx.fill();
      ctx.strokeStyle = 'rgba(44,42,36,.35)'; ctx.lineWidth = 1.5; mcRR(ctx, tx, nameY + nameH2 + 8, tw, 30, 5); ctx.stroke();
      ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(typeTxt, tx + tw / 2, nameY + nameH2 + 15);
    }
    /* 行者牌：左上费用块 */
    if (isRanger && (has(mc.fee) || typeTxt)) {
      ctx.fillStyle = 'rgba(244,239,224,.96)';
      mcRR(ctx, 26, 34, 60, 84, 9); ctx.fill();
      ctx.strokeStyle = ACC; ctx.lineWidth = 3; mcRR(ctx, 26, 34, 60, 84, 9); ctx.stroke();
      ctx.fillStyle = INK; ctx.font = font(800, 34); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(has(mc.fee) ? String(mc.fee) : '·', 56, 46);
      ctx.fillStyle = ACC; ctx.font = font(700, 19);
      ctx.fillText(has(mc.feeattr) ? mc.feeattr : (T.feeAttr || ''), 56, 90);
    }
    /* 路径牌：右上数字 + 右下双数字块 */
    if (isPath && has(mc.ptop)) {
      ctx.fillStyle = ACC; mcRR(ctx, W - 74, 36, 48, 48, 8); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = font(800, 26); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(String(mc.ptop), W - 50, 50);
    }
    if (isPath && (has(mc.pn1) || has(mc.pn2))) {
      const blocks = [[has(mc.pn1) ? String(mc.pn1) : '·', ACC], [has(mc.pn2) ? String(mc.pn2) : '·', '#8a3f2c']];
      let bx = W - 26 - 2 * 46 - 10;
      for (const [t2, col] of blocks) {
        ctx.fillStyle = col; mcRR(ctx, bx, H - 250, 46, 46, 7); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = font(800, 24); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(t2, bx + 23, H - 237);
        bx += 56;
      }
    }
    /* 任务牌：目标条（画在说明文本面板下方 —— 与官方任务牌读序一致） */
    const taskGoal = isTask && has(mc.goal);
    /* 文本面板：属性需求 + 正文 + 风味（右移给左下竖条让位） */
    const bodyLines = has(mc.text) ? layout(mc.text, 19, W - 130) : [];
    const flavLines = (isRanger && has(mc.flavor)) ? layoutFlavor(mc.flavor, 16, W - 130) : [];
    let goalY = H - 150;                             // 无面板时目标条的默认位置
    if (bodyLines.length || flavLines.length || (isRanger && chips.length) || (isTask && has(mc.text))) {
      const reqH = (isRanger && chips.length) ? 42 : 0;
      const panelH = reqH + bodyLines.length * 28 + flavLines.length * 24 + 26;
      const panelY = H - 30 - panelH;
      ctx.fillStyle = 'rgba(244,239,224,.96)';
      mcRR(ctx, 46, panelY, W - 70, panelH, 10); ctx.fill();
      ctx.strokeStyle = 'rgba(111,103,82,.5)'; ctx.lineWidth = 1.5; mcRR(ctx, 46, panelY, W - 70, panelH, 10); ctx.stroke();
      let ty = panelY + 14;
      if (reqH) { drawChips(panelY + 16, 34, 8); ty += reqH; }
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ty = drawLines(bodyLines, 60, ty, 19, 28, INK, AMBER_L);
      for (const ln of flavLines) {
        let cx2 = 60;
        for (const r of ln) {
          ctx.font = 'italic 400 16px "PingFang SC","Microsoft YaHei",sans-serif';
          ctx.fillStyle = 'rgba(44,42,36,.72)'; ctx.fillText(r.ch, cx2, ty); cx2 += r.cw;
        }
        ty += 24;
      }
      goalY = panelY - 56;
    }
    if (taskGoal) {
      ctx.font = font(600, 19);
      const gw = Math.min(W - 80, ctx.measureText(mc.goal).width + 40);
      ctx.fillStyle = 'rgba(90,120,70,.93)';
      mcRR(ctx, (W - gw) / 2, goalY, gw, 44, 10); ctx.fill();
      ctx.fillStyle = '#f4efe0'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(mc.goal, W / 2, goalY + 12);
    }
    /* 左下竖排色条（band 文字自下而上） */
    const spineH = Math.round(H * 0.44);
    ctx.fillStyle = ACC; ctx.fillRect(0, H - spineH, 34, spineH);
    ctx.save();
    ctx.translate(24, H - 14); ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#fff'; ctx.font = font(600, 16);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(T.band || '', 0, 0);
    ctx.restore();
    ctx.textBaseline = 'top';
  } else if (mc.tpl === 'ranger') {
    const lines = layout(mc.text, 19, W - 72);
    const nameH = 34, divH = 18, padT = 18, padB = 18;
    const bandH = padT + nameH + divH + (lines.length ? lines.length * 27 : 10) + padB;
    const bandY = H - bandH;
    ctx.fillStyle = 'rgba(47,64,47,.93)'; ctx.fillRect(0, bandY, W, bandH);
    ctx.textAlign = 'center';
    ctx.fillStyle = PAPER; ctx.font = font(800, 25);
    ctx.fillText(has(mc.name) ? mc.name : '未命名行者', W / 2, bandY + padT);
    ctx.font = font(400, 13); ctx.fillStyle = 'rgba(242,236,220,.65)';
    ctx.fillText('◆', W / 2, bandY + padT + nameH + 1);
    ctx.textAlign = 'left';
    if (lines.length) drawLines(lines, 36, bandY + padT + nameH + divH, 19, 27, PAPER, AMBER_D);
    drawChips(bandY - 60);
  } else {
    /* role / blank：顶部标题条 + 底部技能框 */
    if (has(mc.name)) {
      ctx.fillStyle = 'rgba(244,239,224,.95)';
      mcRR(ctx, 24, 34, W - 48, 64, 8); ctx.fill();
      ctx.strokeStyle = LINE; ctx.lineWidth = 2.5; mcRR(ctx, 24, 34, W - 48, 64, 8); ctx.stroke();
      ctx.fillStyle = INK; ctx.font = font(800, 33); ctx.textAlign = 'center';
      ctx.fillText(mc.name, W / 2, 52);
    }
    if (has(mc.type) || mc.tpl === 'role') {
      const t = has(mc.type) ? mc.type : '角色';
      ctx.font = font(600, 18);
      const tw = ctx.measureText(t).width + 22;
      ctx.fillStyle = 'rgba(244,239,224,.95)';
      mcRR(ctx, 30, 106, tw, 30, 5); ctx.fill();
      ctx.strokeStyle = LINE; ctx.lineWidth = 1.5; mcRR(ctx, 30, 106, tw, 30, 5); ctx.stroke();
      ctx.fillStyle = INK; ctx.textAlign = 'center';
      ctx.fillText(t, 30 + tw / 2, 113);
    }
    if (mc.tpl === 'blank' && chips.length) drawChips(H - 190);
    if (has(mc.text)) {
      const lines = layout(mc.text, 19, W - 84);
      const panelH = lines.length * 28 + 30;
      const panelY = H - 26 - panelH;
      ctx.fillStyle = 'rgba(244,239,224,.96)';
      mcRR(ctx, 24, panelY, W - 48, panelH, 10); ctx.fill();
      ctx.strokeStyle = 'rgba(111,103,82,.5)'; ctx.lineWidth = 1.5; mcRR(ctx, 24, panelY, W - 48, panelH, 10); ctx.stroke();
      ctx.textAlign = 'left';
      drawLines(lines, 40, panelY + 16, 19, 28, INK, AMBER_L);
    }
  }

  /* 下载（Promise 包裹 toBlob，便于调用方 await 完成时机） */
  return await new Promise(res => cv.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `自制_${MC_TPLS[mc.tpl]?.label || '卡'}_${(mc.name || '未命名').replace(/[\\/:*?"<>|]/g, '')}.png`;
    a.click(); URL.revokeObjectURL(a.href);
    res(true);
  }, 'image/png'));
}

function maker(v) {
  if (!featureState('maker').enabled) {
    v.innerHTML = `<h2 class="page-title">🎨 卡牌自制</h2>
      <p class="page-sub">功能暂时关闭</p>
      <div class="panel"><p class="muted small">卡牌自制正在内测，暂时对普通账号关闭。
      管理员可在「后台管理 → 功能开关」中开启，或把账号设为「内测」后使用。</p>
      <div style="margin-top:12px"><a class="btn" href="#cards">返回卡牌列表</a></div></div>`;
    return;
  }
  if (!MakerUI.draft) MakerUI.draft = { id: null, tpl: 'role', name: '', type: '', attr: {}, text: '', img: '' };
  const d = MakerUI.draft;
  const list = DB.makerCards || (DB.makerCards = []);
  /* v45：下拉按分组显示（旧 3 项一组，新模板按 group 分组） */
  const tplGroups = [];
  {
    const seen = new Set();
    for (const [k, t] of Object.entries(MC_TPLS)) {
      const g = t.group || '基础模板';
      let grp = tplGroups.find(x => x.g === g);
      if (!grp) { grp = { g, items: [] }; tplGroups.push(grp); }
      grp.items.push([k, t]); seen.add(g);
    }
  }
  const tplOptions = tplGroups.map(grp =>
    `<optgroup label="${esc(grp.g)}">${grp.items.map(([k, t]) =>
      `<option value="${k}" ${d.tpl === k ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</optgroup>`).join('');
  /* v46：当前模板是否使用官方 SVG 版式（表单两套切换） */
  const isSvgTpl = !!MC_SVG_FAM[mcFam(d.tpl)] && d.tpl !== 'ranger';

  v.innerHTML = `
    <h2 class="page-title">卡牌自制</h2>
    <p class="page-sub">按官方卡面 1:1 复刻（对照《规则手册》P25 行者牌详解的 11 个部位）：① 费用 ② 名称 ③ 类型·关键词 ④ 装备值 ⑤ 存在度 ⑥ 标记 ⑦ 伤害阈值 ⑧ 手段符号 ⑨ 能力与检定 ⑩ 属性需求 ⑪ 牌组信息。填数据 + 传插画即可出图，导出 2896×4144 PNG（原版扫描 2 倍）。</p>
    <div class="panel">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
        <select id="mk-tpl" style="min-width:170px">${tplOptions}</select>
        <span class="small muted" id="mk-tpldesc">${esc(MC_TPLS[d.tpl]?.desc || '')}</span>
        <span style="flex:1"></span>
        <button class="btn" id="mk-new">＋ 新建</button>
        <button class="btn btn-primary" id="mk-save">保存</button>
        <button class="btn" id="mk-png">导出 PNG</button>
      </div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start">
        <div style="flex:1;min-width:280px" id="mk-formwrap">
          <!-- ===== 旧模板（角色卡 / 行者卡 / 空白卡）===== -->
          <div id="mk-form-old" style="${isSvgTpl ? 'display:none' : ''}">
          <div class="grid-form">
            <label class="fld">名称<input type="text" id="mk-name" maxlength="24" value="${esc(d.name)}" placeholder="未命名"></label>
            <label class="fld">类型行（留空用模板默认）<input type="text" id="mk-type" maxlength="20" value="${esc(d.type)}"></label>
          </div>
          <div class="grid-form" style="margin-top:12px">
            <label class="fld">费用数字（左上，可空）<input type="number" id="mk-fee" min="0" max="9" value="${d.fee ?? ''}"></label>
            <label class="fld">费用属性<input type="text" id="mk-feeattr" maxlength="2" value="${esc(d.feeattr || '')}" placeholder="知 / 精 / 体 / 专"></label>
          </div>
          <div style="margin-top:12px">
            <div class="small muted" style="margin-bottom:6px">属性需求（可空，显示为彩色方块）</div>
            <div class="grid-form">
              <label class="fld">知觉（可空）<input type="number" id="mk-知" min="0" max="9" value="${d.attr?.知 ?? ''}"></label>
              <label class="fld">精神（可空）<input type="number" id="mk-精" min="0" max="9" value="${d.attr?.精 ?? ''}"></label>
              <label class="fld">体质（可空）<input type="number" id="mk-体" min="0" max="9" value="${d.attr?.体 ?? ''}"></label>
              <label class="fld">专注（可空）<input type="number" id="mk-专" min="0" max="9" value="${d.attr?.专 ?? ''}"></label>
            </div>
          </div>
          <label class="fld" style="margin-top:12px">效果文本（「消耗：」等引导词自动加粗）
            <textarea id="mk-text" rows="4" placeholder="例如：消耗：支付 1 点精力，来向 1 个科技增加 1 个标记。">${esc(d.text)}</textarea></label>
          <label class="fld" style="margin-top:12px">风味文本（可空，斜体灰字）
            <textarea id="mk-flavor" rows="2" placeholder="例如：母亲教会了你该如何使用各种工具。">${esc(d.flavor || '')}</textarea></label>
          </div>

          <!-- ===== v46：官方版式（行者牌 / 路径牌 / 瞬间牌 / 任务牌）===== -->
          <div id="mk-form-svg" style="${isSvgTpl ? '' : 'display:none'}">
            <div class="grid-form">
              <label class="fld">名称（②名称条）<input type="text" id="mk-name2" maxlength="24" value="${esc(d.name)}" placeholder="未命名"></label>
              <label class="fld">③ 卡牌类型·关键词<input type="text" id="mk-type2" maxlength="26" value="${esc(d.type)}" placeholder="道具·科技 / 地标·机械"></label>
            </div>

            <!-- 行者牌：①费用 ④装备值 ⑧手段符号 ⑩属性需求 -->
            <div data-mc-g="ranger" style="margin-top:12px">
              <div class="mk-hd">① 费用 · ④ 装备值 · ⑩ 属性需求</div>
              <div class="grid-form">
                <label class="fld">① 费用数字<input type="number" id="mk-fee2" min="0" max="9" value="${d.fee ?? ''}"></label>
                <label class="fld">① 费用属性<input type="text" id="mk-feeattr2" maxlength="2" value="${esc(d.feeattr || '')}" placeholder="知觉"></label>
                <label class="fld">④ 装备值（0-5 格）<input type="number" id="mk-gear" min="0" max="5" value="${d.gear ?? ''}"></label>
                <label class="fld">⑩ 需求数值<input type="number" id="mk-reqval" min="0" max="20" value="${d.reqVal ?? ''}"></label>
                <label class="fld">⑩ 需求属性<input type="text" id="mk-reqattr" maxlength="2" value="${esc(d.reqAttr || '')}" placeholder="知觉"></label>
              </div>
              <div class="mk-hd">⑧ 手段符号（点击选择，最多 3 个）</div>
              <div class="mk-syms" id="mk-syms">
                ${MC_SYM_KEYS.map(k => `<button type="button" class="mk-sym${String(d.symbols || '').includes(k) ? ' on' : ''}" data-sym="${k}" title="${esc(MC_SYM_LABEL[k] || k)}">${MC_SYM_IMG[k] ? `<img src="${MC_SYM_IMG[k]}" alt="">` : `<svg viewBox="0 0 100 100">${MC_SYM[k]}</svg>`}</button>`).join('')}
              </div>
            </div>

            <!-- ⑥ 标记（行者牌 / 路径牌共用） -->
            <div data-mc-g="ranger path" style="margin-top:12px">
              <div class="mk-hd">⑥ 标记（右侧绿块 · 可空，如「4 块余烬」）</div>
              <div class="grid-form">
                <label class="fld">标记数<input type="number" id="mk-token-num" min="0" max="99" value="${d.tokenNum ?? ''}"></label>
                <label class="fld">标记名<input type="text" id="mk-token-name" maxlength="8" value="${esc(d.tokenName || '')}" placeholder="余烬 / 充能"></label>
              </div>
            </div>

            <!-- 路径牌：右上存在度/页数 右下伤害/疲劳 标记 彩色条 -->
            <div data-mc-g="path" style="margin-top:12px">
              <div class="mk-hd">⑤ 存在度 · ⑦ 伤害阈值 · ⑥ 标记</div>
              <div class="grid-form">
                <label class="fld">⑤ 存在度（右上紫块）<input type="number" id="mk-ptop2" min="0" max="99" value="${d.ptop ?? ''}"></label>
                <label class="fld">右上 页数引用<input type="number" id="mk-page" min="0" max="999" value="${d.page ?? ''}"></label>
                <label class="fld">⑦ 伤害阈值（右下红块）<input type="number" id="mk-pn1b" min="0" max="99" value="${d.pn1 ?? ''}"></label>
                <label class="fld">右下 疲劳 / 耐久（青块）<input type="text" id="mk-pn2b" maxlength="4" value="${esc(d.pn2 ?? '')}" placeholder="1R"></label>

              </div>
              <div class="mk-hd">彩色触发条（留空不显示 · 最多 3 条）</div>
              <label class="fld">黄条（日）<input type="text" id="mk-bar1" maxlength="80" value="${esc(d.bar1 || '')}" placeholder="轻风吹灭了部分余火。"></label>
              <label class="fld" style="margin-top:8px">蓝条（水）<input type="text" id="mk-bar2" maxlength="80" value="${esc(d.bar2 || '')}" placeholder="向 1 只动物增加 1 点疲劳。"></label>
              <label class="fld" style="margin-top:8px">红条（兽）<input type="text" id="mk-bar3" maxlength="80" value="${esc(d.bar3 || '')}" placeholder="你吸入了一些残留的烟气。"></label>
            </div>

            <!-- 瞬间 / 任务：场景引子 -->
            <div data-mc-g="moment task" style="margin-top:12px">
              <div class="mk-hd" data-mc-g="moment">场景引子（斜体居中，写在插画与选项之间）</div>
              <div class="mk-hd" data-mc-g="task">说明引子（斜体居中，写在横幅插画下方）</div>
              <textarea id="mk-scene" rows="3" placeholder="例如：在你培训期间，凯吕普莎经常鼓励你适时驻足……">${esc(d.scene || '')}</textarea>
              <label class="fld" data-mc-g="moment" style="margin-top:8px">提示行<input type="text" id="mk-prompt" maxlength="20" value="${esc(d.prompt || '')}" placeholder="行者请选择："></label>
              <label class="fld" data-mc-g="task" style="margin-top:8px">绿色条件条<input type="text" id="mk-goal2" maxlength="60" value="${esc(d.goal || '')}" placeholder="抵达附属的地点时：1.50"></label>
            </div>

            <!-- ⑪ 牌组信息 -->
            <div class="mk-hd">⑪ 牌组信息（卡底编号）</div>
            <div class="grid-form">
              <label class="fld">牌组名<input type="text" id="mk-set-name" maxlength="10" value="${esc(d.setName || '')}" placeholder="创物者 / 山路"></label>
              <label class="fld">编号<input type="number" id="mk-set-num" min="0" max="999" value="${d.setNum ?? ''}"></label>
              <label class="fld">总数<input type="number" id="mk-set-total" min="0" max="999" value="${d.setTotal ?? ''}"></label>
              <label class="fld">画师<input type="text" id="mk-artist" maxlength="24" value="${esc(d.artist || '')}"></label>
            </div>

            <label class="fld" style="margin-top:12px">⑨ 能力与检定文本（用 **两个星号** 包住要加粗的字）
              <textarea id="mk-text2" rows="4" placeholder="例如：**响应：**在你执行**躲避**检定成功后，向本牌增加 1 点充能。">${esc(d.text)}</textarea></label>
            <label class="fld" data-mc-g="ranger" style="margin-top:10px">风味文本（斜体灰，可空）
              <textarea id="mk-flavor2" rows="2" placeholder="母亲教会了你该如何使用各种工具。">${esc(d.flavor || '')}</textarea></label>
          </div>

          <div style="display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap">
            <label class="btn" style="cursor:pointer">上传插画<input type="file" id="mk-imgfile" accept="image/*" hidden></label>
            ${d.img ? '<button class="btn btn-sm" id="mk-imgclr">清除插画</button>' : ''}
            <span class="small muted">上传后自动压缩为 JPEG ≤900px 存本机</span>
          </div>
          <div class="grid-form" data-mc-g="ranger" style="margin-top:10px">
            <label class="fld">插画适配
              <select id="mk-imgfit">
                <option value="win"${(d.imgFit || 'win') === 'win' ? ' selected' : ''}>只填插画窗（推荐）</option>
                <option value="card"${d.imgFit === 'card' ? ' selected' : ''}>整卡铺满（下半会压在面板下）</option>
              </select>
            </label>
            <label class="fld">缩放 <b id="mk-imgzoom-v">${d.imgZoom || 100}%</b>
              <input type="range" id="mk-imgzoom" min="60" max="250" step="1" value="${d.imgZoom || 100}"></label>
            <label class="fld">左右移 <b id="mk-imgx-v">${d.imgX || 0}</b>
              <input type="range" id="mk-imgx" min="-100" max="100" step="1" value="${d.imgX || 0}"></label>
            <label class="fld">上下移 <b id="mk-imgy-v">${d.imgY || 0}</b>
              <input type="range" id="mk-imgy" min="-100" max="100" step="1" value="${d.imgY || 0}"></label>
          </div>
          <div class="small muted" style="margin-top:4px">插画窗只有卡面上方 63%，图会被「等比裁切」后填满窗口；缩放调小可看全图，往下可看到图的下半。</div>
        </div>
        <div style="flex:none">
          <div id="mk-preview">${mcCardHTML(d)}</div>
          <div class="small muted" style="text-align:center;margin-top:6px">实时预览 · 官方版式导出 2896×4144</div>
        </div>
      </div>
    </div>
    <div class="panel">
      <h3 style="margin-bottom:8px">已保存的自制卡（${list.length}）</h3>
      <table class="tbl"><thead><tr><th>预览</th><th>名称</th><th>模板</th><th>属性 / 文本</th><th>操作</th></tr></thead>
      <tbody id="mk-list"></tbody></table>
    </div>`;

  const renderPreview = () => { v.querySelector('#mk-preview').innerHTML = mcCardHTML(d); };
  const renderList = () => {
    const tb = v.querySelector('#mk-list');
    tb.innerHTML = list.map(c => `
      <tr>
        <td>${c.img ? `<img src="${esc(c.img)}" style="height:44px;border-radius:5px">` : '<span class="muted small">无底图</span>'}</td>
        <td><b>${esc(c.name || '未命名')}</b></td>
        <td><span class="tag">${MC_TPLS[c.tpl]?.label || c.tpl}</span></td>
        <td class="small muted">${mcChips(c.attr)}<br>${esc((c.text || '').slice(0, 40))}${(c.text || '').length > 40 ? '…' : ''}</td>
        <td><button class="btn btn-sm" data-mc-load="${esc(c.id)}">载入</button>
            <button class="btn btn-sm" data-mc-png="${esc(c.id)}">PNG</button>
            <button class="btn btn-sm btn-danger" data-mc-del="${esc(c.id)}">删除</button></td>
      </tr>`).join('') || '<tr><td colspan="5" class="muted small">暂无。编辑上方内容后点「保存」。</td></tr>';
    tb.querySelectorAll('[data-mc-load]').forEach(b => b.onclick = () => {
      const c = list.find(x => x.id === b.dataset.mcLoad); if (!c) return;
      MakerUI.draft = { ...c, attr: { ...(c.attr || {}) } };
      renderRoute();   // 载入即整页重绘
    });
    tb.querySelectorAll('[data-mc-png]').forEach(b => b.onclick = () => {
      const cc = list.find(x => x.id === b.dataset.mcPng);
      if (cc) mcExportPNG(cc).then(() => toast('已导出 PNG'));
    });
    tb.querySelectorAll('[data-mc-del]').forEach(b => b.onclick = () => {
      if (!confirm('确定删除这张自制卡？')) return;
      DB.makerCards = DB.makerCards.filter(x => x.id !== b.dataset.mcDel);
      if (d.id === b.dataset.mcDel) d.id = null;
      saveDB(); renderRoute();
    });
  };

  /* 表单绑定：输入即更新草稿 + 预览（不重绘表单，避免失焦） */
  const bind = (sel, fn) => { const el = v.querySelector(sel); if (el) el.oninput = () => { fn(el.value); renderPreview(); }; };
  /* —— 旧模板 —— */
  bind('#mk-name', x => d.name = x);
  bind('#mk-type', x => { d.type = x; d._autoType = false; });
  bind('#mk-text', x => d.text = x);
  bind('#mk-fee', x => d.fee = x === '' ? null : Math.max(0, Math.min(9, +x || 0)));
  bind('#mk-feeattr', x => { d.feeattr = x.trim(); d._autoFee = false; });
  bind('#mk-flavor', x => d.flavor = x);
  bind('#mk-goal', x => d.goal = x);
  ATTRS.forEach(a => bind('#mk-' + a, x => { d.attr = d.attr || {}; d.attr[a] = x === '' ? null : Math.max(0, Math.min(9, +x || 0)); }));

  /* —— v46 官方版式字段 —— */
  const num = (x, max) => x === '' ? null : Math.max(0, Math.min(max, Math.round(+x || 0)));
  bind('#mk-name2', x => d.name = x);
  bind('#mk-type2', x => d.type = x);
  bind('#mk-text2', x => d.text = x);
  bind('#mk-flavor2', x => d.flavor = x);
  bind('#mk-fee2', x => d.fee = num(x, 9));
  bind('#mk-feeattr2', x => d.feeattr = x.trim());
  bind('#mk-gear', x => d.gear = num(x, 5));
  bind('#mk-reqval', x => d.reqVal = num(x, 20));
  bind('#mk-reqattr', x => d.reqAttr = x.trim());
  bind('#mk-ptop2', x => d.ptop = num(x, 99));
  bind('#mk-page', x => d.page = num(x, 999));
  bind('#mk-pn1b', x => d.pn1 = num(x, 99));
  bind('#mk-pn2b', x => d.pn2 = x.trim());
  bind('#mk-token-num', x => d.tokenNum = num(x, 99));
  bind('#mk-token-name', x => d.tokenName = x.trim());
  ['1', '2', '3'].forEach(i => bind('#mk-bar' + i, x => d['bar' + i] = x));
  bind('#mk-scene', x => d.scene = x);
  bind('#mk-prompt', x => d.prompt = x);
  bind('#mk-goal2', x => d.goal = x);
  bind('#mk-set-name', x => d.setName = x.trim());
  bind('#mk-set-num', x => d.setNum = num(x, 999));
  bind('#mk-set-total', x => d.setTotal = num(x, 999));
  bind('#mk-artist', x => d.artist = x.trim());

  /* 插画适配：缩放/位移（下拉用 change，range 用 input 实时刷）
     注意：这里不能把形参写成 v —— 会遮蔽外层的视图容器 v */
  const pct = (sel, txt) => { const e = v.querySelector(sel); if (e) e.textContent = txt; };
  const fitSel = v.querySelector('#mk-imgfit');
  if (fitSel) fitSel.onchange = () => { d.imgFit = fitSel.value; renderPreview(); };
  const zr = v.querySelector('#mk-imgzoom');
  if (zr) zr.oninput = () => { d.imgZoom = +zr.value; pct('#mk-imgzoom-v', zr.value); renderPreview(); };
  const xr = v.querySelector('#mk-imgx');
  if (xr) xr.oninput = () => { d.imgX = +xr.value; pct('#mk-imgx-v', xr.value); renderPreview(); };
  const yr = v.querySelector('#mk-imgy');
  if (yr) yr.oninput = () => { d.imgY = +yr.value; pct('#mk-imgy-v', yr.value); renderPreview(); };

  /* 手段符号：点选，最多 3 个 */
  v.querySelectorAll('.mk-sym').forEach(btn => btn.onclick = () => {
    const k = btn.dataset.sym;
    let arr = String(d.symbols || '').split(',').map(s => s.trim()).filter(Boolean);
    if (arr.includes(k)) arr = arr.filter(x => x !== k);
    else {
      const cap = String(d.tpl || '').startsWith('ranger_') ? 2 : 3;
      if (arr.length >= cap) { toast('最多 ' + cap + ' 个手段符号'); return; }
      arr.push(k);
    }
    d.symbols = arr.join(',');
    btn.classList.toggle('on', arr.includes(k));
    renderPreview();
  });

  /* 按模板家族显隐：两套表单 + 家族专属字段 */
  const syncTplFields = () => {
    const fam = mcFam(d.tpl);
    const svg = !!MC_SVG_FAM[fam] && d.tpl !== 'ranger';
    const oldBox = v.querySelector('#mk-form-old');
    const svgBox = v.querySelector('#mk-form-svg');
    if (oldBox) oldBox.style.display = svg ? 'none' : '';
    if (svgBox) {
      svgBox.style.display = svg ? '' : 'none';
      svgBox.querySelectorAll('[data-mc-g]').forEach(el => {
        el.style.display = el.dataset.mcG.split(/\s+/).includes(fam) ? '' : 'none';
      });
    }
  };
  v.querySelector('#mk-tpl').onchange = e => {
    d.tpl = e.target.value;
    const T = MC_TPLS[d.tpl] || {};
    v.querySelector('#mk-tpldesc').textContent = T.desc || '';
    if ((!String(d.type || '').trim() || d._autoType) && T.defType) {
      d.type = T.defType; d._autoType = true;
    }
    if ((!String(d.feeattr || '').trim() || d._autoFee) && T.feeAttr) {
      d.feeattr = T.feeAttr; d._autoFee = true;
    }
    if (!String(d.symbols || '').trim() && T.defSym) {
      d.symbols = T.defSym;
      v.querySelectorAll('.mk-sym').forEach(b => b.classList.toggle('on', b.dataset.sym === T.defSym));
    }
    ['#mk-type', '#mk-type2'].forEach(s => { const el = v.querySelector(s); if (el) el.value = d.type || ''; });
    ['#mk-feeattr', '#mk-feeattr2'].forEach(s => { const el = v.querySelector(s); if (el) el.value = d.feeattr || ''; });
    syncTplFields();
    renderPreview();
  };
  syncTplFields();
  v.querySelector('#mk-imgfile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const r = await shrinkImageInfo(f);
      d.img = r.url; d.imgW = r.w; d.imgH = r.h;
      saveDB(); renderRoute(); toast('底图已压缩载入');
    }
    catch { toast('图片读取失败'); }
  };
  const clr = v.querySelector('#mk-imgclr');
  if (clr) clr.onclick = () => { d.img = ''; saveDB(); renderRoute(); };
  v.querySelector('#mk-new').onclick = () => { MakerUI.draft = { id: null, tpl: d.tpl, name: '', type: '', attr: {}, text: '', img: '', fee: null, feeattr: '', ptop: null, pn1: null, pn2: null, flavor: '', goal: '', symbols: '', gear: null, reqVal: null, reqAttr: '', tokenNum: null, tokenName: '', page: null, scene: '', prompt: '', bar1: '', bar2: '', bar3: '', setName: '', setNum: null, setTotal: null, artist: '' }; renderRoute(); };
  v.querySelector('#mk-save').onclick = () => {
    const rec = { ...d, name: (d.name || '').trim() || '未命名', updated: Date.now() };
    delete rec._autoType; delete rec._autoFee;          // 内部标记不入库
    if (rec.id) {
      const i = list.findIndex(x => x.id === rec.id);
      if (i >= 0) list[i] = rec; else list.push(rec);
    } else { rec.id = 'mc' + uid(); d.id = rec.id; list.push(rec); }
    saveDB(); toast('已保存自制卡'); renderRoute();
  };
  v.querySelector('#mk-png').onclick = () => mcExportPNG(d).then(() => toast('已导出 PNG'));
  renderList();
}

/* ================= 6.6) 数据校对 ================= */
const PROOF_STATUS = {
  pending: { label: '待校对', cls: 'pf-pending', icon: '○' },
  ok:      { label: '已校对', cls: 'pf-ok',      icon: '✔' },
  issue:   { label: '有疑问', cls: 'pf-issue',   icon: '!' },
};
const ProofUI = { q: '', status: 'all', group: '', onlyReview: false, expertDiff: false, sel: null, checked: new Set() };
/* 供全局快捷键重绘校对界面 */
let PROOF_REDRAW = null;

const proofRec    = id => (DB.proof || {})[id] || null;
const proofStatus = id => proofRec(id)?.status || 'pending';
/* 属性对比用：忽略键顺序 */
const normAttr = a => JSON.stringify(Object.keys(a || {}).sort().map(k => [k, (a || {})[k]]));

function proofFiltered() {
  const q = ProofUI.q.trim().toLowerCase();
  return allCards().filter(c => {
    if (ProofUI.group && c.group !== ProofUI.group) return false;
    if (ProofUI.onlyReview && !c.review) return false;
    /* v43：只看「专家」判定两处不一致的（多半是 OCR 漏标） */
    if (ProofUI.expertDiff && !expertMismatch(c)) return false;
    if (ProofUI.status !== 'all' && proofStatus(c.id) !== ProofUI.status) return false;
    if (q && !`${c.name || ''}${c.deck || ''}${c.type || ''}${c.text || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}
function proofSet(id, status, note) {
  DB.proof = DB.proof || {};
  /* v37：填过「类型 / 需求 / 装备值 / 标记」的记录不能因为清状态被整条删掉 */
  if (status === 'pending' && !note && !rangerHasData(id)) delete DB.proof[id];
  else DB.proof[id] = {
    ...(DB.proof[id] || {}),                 // 保留已填的四项数据
    status, note: note || '',
    by: userPublicId() || (userEmail() ? userEmail().split('@')[0] : '') || '本机',
    at: new Date().toISOString(),
  };
  clearConflict(id);      // 手动改过 = 已人工裁定，该卡的冲突不再挂起
  saveDB();
  pushProofSoon();          // 云端共享校对表：与构筑 / 自定义卡一样自动上行
}

/* ============================================================
   v37：行者牌库卡的四项数据（类型 / 需求 / 装备值 / 标记）
   存在校对记录里（DB.proof[id]，与 status / note 并列），
   个人库同步时会一起上云，不需要改云端共享表结构。
   ============================================================ */
function rangerDataOf(id) {
  const r = proofRec(id) || {};
  const req = (r.rreq === '' || r.rreq == null) ? '' : Number(r.rreq);
  return {
    type: R_TYPE_ORDER.includes(r.rtype) ? r.rtype : '',
    req: (req === '' || isNaN(req)) ? '' : req,
    equip: Math.max(0, Math.min(R_EQ_MAX, Number(r.requip) || 0)),
    mark: String(r.rmark || ''),
  };
}
const rangerHasData = id => {
  const d = rangerDataOf(id);
  return !!(d.type || (d.req !== '' && d.req != null) || d.equip || d.mark);
};
/* 写入（局部更新）；四项全空且无状态 / 备注时，整条记录顺手清掉 */
function setRangerData(id, patch) {
  DB.proof = DB.proof || {};
  const d = { ...rangerDataOf(id), ...patch };
  if (d.type) d.type = R_TYPE_ORDER.includes(d.type) ? d.type : '';
  if (d.req !== '' && d.req != null) {
    const n = Number(d.req);
    d.req = isNaN(n) ? '' : Math.max(0, Math.min(99, Math.round(n)));
  }
  d.equip = Math.max(0, Math.min(R_EQ_MAX, Math.round(Number(d.equip) || 0)));
  d.mark = String(d.mark || '').trim().slice(0, 60);

  const empty = !d.type && (d.req === '' || d.req == null) && !d.equip && !d.mark;
  if (empty) {
    const rec = DB.proof[id];
    if (rec) {
      delete rec.rtype; delete rec.rreq; delete rec.requip; delete rec.rmark;
      if ((!rec.status || rec.status === 'pending') && !rec.note) delete DB.proof[id];
    }
  } else {
    const rec = DB.proof[id] || { status: 'pending', note: '' };
    rec.rtype = d.type; rec.rreq = d.req; rec.requip = d.equip; rec.rmark = d.mark;
    rec.at = new Date().toISOString();
    if (!rec.by) rec.by = userPublicId() || (userEmail() ? userEmail().split('@')[0] : '') || '本机';
    DB.proof[id] = rec;
  }
  saveDB();
  pushProofSoon();
  return rangerDataOf(id);
}
/* 「需求 2 点精神」—— 只填了数字没选类型时退化为「需求 2 点」 */
function rangerReqText(c) {
  const d = rangerDataOf(c.id);
  if (d.req === '' || d.req == null) return '';
  return d.type ? `需求 ${d.req} 点${ATTR_FULL[d.type]}` : `需求 ${d.req} 点`;
}
const rangerEqBar = n => '▣'.repeat(Math.max(0, Math.min(R_EQ_MAX, n))) + '▢'.repeat(R_EQ_MAX - Math.max(0, Math.min(R_EQ_MAX, n)));
/* 卡面 / 列表上那一行：类型 · 需求 N 点X · 装备值 ▣▣▢▢▢ · 标记… */
function rangerLineHTML(c, opts = {}) {
  if (!c || !hasRangerData(c)) return '';
  const d = rangerDataOf(c.id);
  if (!d.type && (d.req === '' || d.req == null) && !d.equip && !d.mark) return '';
  const bits = [];
  if (d.type) bits.push(`<span class="tag blue" title="行者类型">${esc(ATTR_FULL[d.type])}</span>`);
  const rt = opts.skipReq ? '' : rangerReqText(c);
  if (rt) bits.push(`<span class="ranger-req">${esc(rt)}</span>`);
  if (d.equip) bits.push(`<span class="ranger-eq" title="装备值 ${d.equip} / ${R_EQ_MAX}">装备 ${esc(rangerEqBar(d.equip))}</span>`);
  if (d.mark) bits.push(`<span class="ranger-mark" title="标记">${esc(d.mark)}</span>`);
  if (!bits.length) return '';
  return `<${opts.tag || 'span'} class="ranger-line">${bits.join('<span class="ranger-sep">·</span>')}</${opts.tag || 'span'}>`;
}
/* 校对页那块表单 */
function rangerFormHTML(c) {
  const d = rangerDataOf(c.id);
  return `<div class="pf-sec" id="pf-rsec" style="margin-top:12px">
    <div class="pf-sec-h">行者数据（类型 / 需求 / 装备值 / 标记）</div>
    <div class="pf-rgrid">
      <label class="fld">类型<select id="pf-rtype">
        <option value="">（未指定）</option>
        ${R_TYPE_ORDER.map(k => `<option value="${esc(k)}" ${d.type === k ? 'selected' : ''}>${esc(ATTR_FULL[k])}</option>`).join('')}
      </select></label>
      <label class="fld">需求<input type="number" id="pf-rreq" min="0" max="99" step="1" inputmode="numeric"
        placeholder="只填数字，如 2" value="${d.req === '' ? '' : esc(d.req)}">
        <span class="pf-rocr-wrap" id="pf-rocr">${rangerOcrHTML(c)}</span></label>
      <div class="fld">
        <span class="pf-rlbl">装备值<span class="pf-eq-t" id="pf-requip-t">${d.equip} / ${R_EQ_MAX}</span></span>
        <div class="pf-eq" id="pf-requip" role="group" aria-label="装备值，0 到 5 格">
          ${Array.from({ length: R_EQ_MAX }, (_, i) => `<button type="button" class="pf-eq-cell ${i < d.equip ? 'on' : ''}"
            data-eq="${i + 1}" title="填涂到第 ${i + 1} 格">${i + 1}</button>`).join('')}
        </div>
      </div>
      <label class="fld pf-rwide">标记<input type="text" id="pf-rmark" maxlength="60"
        placeholder="几个什么，如：2 个伤害 / 1 个疲劳" value="${esc(d.mark)}"></label>
    </div>
    <div class="pf-rtext" id="pf-rtext">${rangerPreviewHTML(c)}</div>
    <div class="small muted" style="margin-top:5px">装备值只能从左往右填：点第 N 格即填到第 N 格，再点一次退回一格。</div>
  </div>`;
}
/* 需求输入框下面那行对照：卡面 OCR 原值是多少，填了就以输入为准 */
function rangerOcrHTML(c) {
  const raw = (c && c.attr && Object.keys(c.attr).length) ? c.attr : null;
  const rawTxt = raw ? Object.entries(raw).map(([k, v]) => k + v).join(' ') : '（卡面无需求）';
  const d = rangerDataOf(c.id);
  const hasReq = d.req !== '' && d.req != null;
  let diff = false;
  if (hasReq && raw) {
    diff = d.type ? (raw[d.type] !== Number(d.req))
                  : (Object.keys(raw).length === 1 && Number(Object.values(raw)[0]) !== Number(d.req));
  }
  return `<span class="pf-rocr${diff ? ' diff' : ''}">卡面 OCR：${esc(rawTxt)}${
    diff ? ' · 与输入不一致，卡面显示与组牌校验都以输入为准' : ''}</span>`;
}
/* 表单下方那行「怎么显示」的预览 */
function rangerPreviewHTML(c) {
  const d = rangerDataOf(c.id);
  const bits = [];
  if (d.type) bits.push(`类型 <b>${esc(ATTR_FULL[d.type])}</b>`);
  const rt = rangerReqText(c);
  if (rt) bits.push(`<b>${esc(rt)}</b> ${reqChipsHTML(c)}`);
  bits.push(`装备值 <b class="pf-eq-bar">${esc(rangerEqBar(d.equip))}</b> <span class="muted">${d.equip}/${R_EQ_MAX}</span>`);
  if (d.mark) bits.push(`标记 <b>${esc(d.mark)}</b>`);
  return bits.length ? bits.join('　·　') : '<span class="muted">（未填写）</span>';
}
/* 表单绑定：改一项就即时落库（防抖上行云端），顺带重绘左侧列表行 */
function bindRangerForm(box, c, id, onDraw) {
  const refresh = () => {
    const t = box.querySelector('#pf-rtext');
    if (t) t.innerHTML = rangerPreviewHTML(c);
    const ro = box.querySelector('#pf-rocr');
    if (ro) ro.innerHTML = rangerOcrHTML(c);
    const d = rangerDataOf(id);
    const ct = box.querySelector('#pf-requip-t');
    if (ct) ct.textContent = `${d.equip} / ${R_EQ_MAX}`;
    box.querySelectorAll('#pf-requip .pf-eq-cell').forEach((b, i) => b.classList.toggle('on', i < d.equip));
    if (typeof onDraw === 'function') onDraw();      // 列表行上的摘要跟着变
  };
  const sel = box.querySelector('#pf-rtype');
  if (sel) sel.onchange = () => { setRangerData(id, { type: sel.value }); refresh(); };
  const rq = box.querySelector('#pf-rreq');
  if (rq) rq.oninput = () => {
    /* 全角数字先转半角，再只留数字 —— 中文输入法下也能正常填 */
    const half = String(rq.value).replace(/[\uFF10-\uFF19]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    const v = half.replace(/[^\d]/g, '');
    if (rq.value !== v) rq.value = v;
    setRangerData(id, { req: v === '' ? '' : Number(v) });
    refresh();
  };
  box.querySelectorAll('#pf-requip .pf-eq-cell').forEach(b => b.onclick = () => {
    const n = +b.dataset.eq, cur = rangerDataOf(id).equip;
    setRangerData(id, { equip: cur === n ? n - 1 : n });     // 再点一次退回一格
    refresh();
  });
  const mk = box.querySelector('#pf-rmark');
  if (mk) mk.oninput = () => { setRangerData(id, { mark: mk.value }); refresh(); };
}

/* ============================================================
   云端校对「自动同步」（默认开启，校对页可关）
   —— 双向：本机改动防抖上行到 proof_records（多人共享表）；
      进入校对页 / 登录时静默下行合并他人更新的记录（按时间取新）。
   ============================================================ */
let _proofPushTimer = null, _proofPulling = false, _lastProofPull = 0;
let PROOF_REFRESH_CLOUD = null;      // 由 proof() 注入：刷新「云端：…」那行字
const proofAutoOn = () => (DB.settings || {}).proofAutoSync !== false;
const proofRowsForPush = () => Object.entries(DB.proof || {})
  .filter(([, r]) => r && (r.status !== 'pending' || r.note))
  .map(([id, r]) => ({ card_id: id, status: r.status || 'ok', note: r.note || '' }));
const setCloudLine = t => { const el = document.querySelector('#pf-cloud'); if (el) el.textContent = t; };

/* 防抖上行 */
function pushProofSoon(ms = 900) {
  if (!cloudOn() || !cloudSessionOk() || !proofAutoOn()) return;
  clearTimeout(_proofPushTimer);
  _proofPushTimer = setTimeout(async () => {
    _proofPushTimer = null;
    await flushProofPush(true);
  }, ms);
}
/* 立即上行（关页面 / 切后台 / 手动点按钮时用） */
async function flushProofPush(quiet) {
  if (_proofPulling) return false;
  if (!cloudOn() || !cloudSessionOk() || !proofAutoOn()) return false;
  clearTimeout(_proofPushTimer); _proofPushTimer = null;
  const rows = proofRowsForPush();
  if (!rows.length) return false;
  if (!quiet) setCloudLine('上传中…');
  try {
    const r = await cloudPushProof(rows);
    if (r.error) { setCloudLine('自动上传失败：' + (r.error.message || '')); return false; }
    if (typeof PROOF_REFRESH_CLOUD === 'function') PROOF_REFRESH_CLOUD(` · 已同步 ${rows.length} 条`);
    return true;
  } catch (e) { return false; }
}
/* 下行合并 —— 重要：云端与本机「同一张卡内容不一致」时不覆盖，转进「待审阅区」由人裁定。
   只有「本机没有该卡记录」或「两边内容完全一致」才自动处理。 */
async function autoSyncProof(force) {
  if (!cloudOn() || !cloudSessionOk() || !proofAutoOn()) return;
  const now = Date.now();
  if (!force && now - _lastProofPull < 30000) return;      // 30 秒内不重复拉
  _lastProofPull = now;
  _proofPulling = true;
  try {
    const r = await cloudPullProof();
    if (r.error || !r.data?.length) return;
    let add = 0, cf = 0, skip = 0;
    for (const row of r.data) {
      if (!row || !row.card_id) continue;
      const cur = proofRec(row.card_id);
      const cloudRec = {
        status: row.status || 'ok',
        note: row.note || '',
        by: row.by_email ? String(row.by_email).split('@')[0] : '云端',
        at: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
      };
      if (!cur) { DB.proof = DB.proof || {}; DB.proof[row.card_id] = cloudRec; add++; continue; }
      if (sameProof(cur, cloudRec)) { skip++; continue; }               // 两边一致 → 无需处理
      /* 已裁定过、且云端那条内容没变 → 不再重复打扰 */
      const rs = (DB.proofResolved || {})[row.card_id];
      if (rs && sameProof(rs, cloudRec)) { skip++; continue; }
      /* 内容不一致：绝不静默覆盖，进待审阅区 */
      DB.proofConflicts = DB.proofConflicts || {};
      const old = DB.proofConflicts[row.card_id];
      DB.proofConflicts[row.card_id] =
        { local: { ...cur }, cloud: cloudRec, at: new Date().toISOString(), seen: old?.seen || false };
      cf++;
    }
    if (add || cf) {
      saveDB();                                            // 落本机（个人库也会一起上行）
      if (typeof PROOF_REDRAW === 'function') PROOF_REDRAW();
      toast(cf
        ? `云端同步：新增 ${add} 条 · ${cf} 条与本机不一致，已放入「待审阅区」待你裁定`
        : `已自动合并云端校对：新增 ${add}${skip ? ` · 一致 ${skip}` : ''}`, 4200);
    }
  } catch (e) { /* 拉取失败不影响使用 */ }
  finally { _proofPulling = false; }
}
/* 两条校对记录是否实质相同（状态 + 备注都一致） */
const sameProof = (a, b) => (a?.status || 'ok') === (b?.status || 'ok')
  && String(a?.note || '').trim() === String(b?.note || '').trim();
/* 待审阅区：cardId -> { local, cloud, at, seen } */
const proofConflicts = () => (DB && DB.proofConflicts && typeof DB.proofConflicts === 'object') ? DB.proofConflicts : {};
const conflictOf = id => proofConflicts()[id] || null;
function clearConflict(id) {
  if (!DB.proofConflicts) return;
  const cf = DB.proofConflicts[id];
  if (!cf) return;
  /* 记住这次裁定时的云端内容：只要云端没再变，就不再把同一条塞回待审阅区 */
  DB.proofResolved = DB.proofResolved || {};
  DB.proofResolved[id] = { status: cf.cloud.status, note: cf.cloud.note, at: new Date().toISOString() };
  delete DB.proofConflicts[id];
}
/* 裁定：'cloud' 采用云端 / 'local' 保留本机 / 'merge' 本机状态 + 云端备注 */
function resolveConflict(id, mode) {
  const cf = conflictOf(id);
  if (!cf) return false;
  if (mode === 'cloud') {
    DB.proof = DB.proof || {};
    DB.proof[id] = { ...cf.cloud };
  } else if (mode === 'merge') {
    const cur = proofRec(id) || cf.local;
    const notes = [cur.note, cf.cloud.note].map(s => String(s || '').trim()).filter(Boolean);
    DB.proof[id] = { ...cur, note: [...new Set(notes)].join(' / '), at: new Date().toISOString() };
  } else {
    /* 保留本机：把本机记录时间刷新，便于上行后压过云端那条 */
    DB.proof[id] = { ...(proofRec(id) || cf.local), at: new Date().toISOString() };
  }
  clearConflict(id);
  saveDB(); pushProofSoon();
  return true;
}

function proof(v) {
  DB.proof = DB.proof || {};
  v.innerHTML = `
    <h2 class="page-title">数据校对</h2>
    <p class="page-sub">逐张核对卡牌数据（名称 / 类型 / 费用 / 属性 / 文本）。发现错误可直接修正，有疑问可标记备注，进度与记录随账号保存。</p>
    <div class="panel" id="pf-stats"></div>
    <div class="panel proof-bar pf-bar2">
      <b style="font-size:12.5px">☁ 云端校对</b>
      <label class="pf-auto" title="开启后：本机改动自动上传到云端共享表，并自动合并他人更新的记录（同一张卡取较新的一条）">
        <input type="checkbox" id="pf-auto" ${proofAutoOn() ? 'checked' : ''}><span>自动同步</span>
      </label>
      <button class="btn btn-sm btn-primary" id="pf-push" title="通常无需手动点：改动后会自动上传">↑ 立即上传</button>
      <button class="btn btn-sm" id="pf-pull" title="通常无需手动点：进入本页会自动合并">↓ 立即合并</button>
      <span class="small muted" id="pf-cloud">（未登录时仅存本机）</span>
      <button class="btn btn-sm" id="pf-restore" title="从「被云端覆盖前」的本机备份里找回校对记录">↺ 找回备份</button>
      <span class="flex-spacer"></span>
      <span class="small muted">多人校对可互相合并：同一张卡取最新一条；两边不一致时进「待审阅区」，不自动覆盖</span>
    </div>
    <div class="panel pf-cfbox" id="pf-cfbox" hidden></div>
    <div class="panel proof-bar">
      <div class="pf-tabs">
        ${[['all', '全部'], ['pending', '待校对'], ['ok', '已校对'], ['issue', '有疑问']].map(([k, n]) =>
          `<button class="btn btn-sm pftab" data-pfs="${k}">${n}</button>`).join('')}
      </div>
      <select id="pf-group" style="min-width:110px">
        <option value="">全部类别</option>
        ${Object.entries(GROUPS).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}
      </select>
      <input type="text" id="pf-q" placeholder="搜索名称 / 牌组 / 文本…" style="min-width:170px">
      <label class="pf-check"><input type="checkbox" id="pf-rev"> 仅内置待校（OCR 未确认）</label>
      <label class="pf-check" title="类型行含「专家」但关键词没标，或反过来 —— 多半是 OCR 漏标，需人工复核"><input type="checkbox" id="pf-exdiff"> 仅专家判定不一致</label>
      <span class="flex-spacer"></span>
      <button class="btn btn-sm" id="pf-nextpending">跳到下一条待校</button>
      <button class="btn btn-sm" id="pf-batch">批量标记当前筛选为已校对</button>
    </div>
    <div class="panel proof-bar pf-bar2">
      <span id="pf-seln" class="pf-seln">已选 0 条</span>
      <button class="btn btn-sm" id="pf-sel-ok">标为已校对</button>
      <button class="btn btn-sm" id="pf-sel-issue">标为有疑问…</button>
      <button class="btn btn-sm" id="pf-sel-clear">清除状态</button>
      <span class="pf-sep"></span>
      <button class="btn btn-sm" id="pf-imp">导入修正 CSV</button>
      <button class="btn btn-sm" id="pf-tpl">下载 CSV 模板</button>
      <button class="btn btn-sm" id="pf-csv">导出报告 CSV</button>
      <button class="btn btn-sm" id="pf-json">导出记录 JSON</button>
      <input type="file" id="pf-file" accept=".csv,text/csv" hidden>
    </div>
    <div class="proof-grid">
      <div class="panel pf-listbox"><div id="pf-list"></div></div>
      <div class="panel" id="pf-detail"></div>
    </div>`;

  /* v43：专家牌盘点 —— 类型行 / 关键词两处判定是否一致 */
  const expertStatLine = all => {
    const ex = all.filter(isExpertCard);
    const diff = all.filter(expertMismatch);
    const byType = all.filter(c => typeHasExpert(c) && !kwHasExpert(c)).length;
    const byKw   = all.filter(c => kwHasExpert(c) && !typeHasExpert(c)).length;
    return `专家牌共 <b>${ex.length}</b> 张（关键词与类型行<b>取并集</b>：任一处含「专家」即算）；
      其中 <b>${byType}</b> 张只在类型行标了、<b>${byKw}</b> 张只在关键词标了 ——
      这 ${diff.length} 张判定不一致，多半是 OCR 漏标，勾「仅专家判定不一致」可逐张复核。
      专家牌在组牌时<b>不能作为爱好</b>。`;
  };

  const drawStats = () => {
    const all = allCards();
    const c = { all: all.length, pending: 0, ok: 0, issue: 0 };
    for (const x of all) c[proofStatus(x.id)] = (c[proofStatus(x.id)] || 0) + 1;
    const done = c.ok + c.issue;
    const pct = c.all ? Math.round(done / c.all * 100) : 0;
    const reviewN = all.filter(x => x.review).length;
    const reviewDone = all.filter(x => x.review && proofStatus(x.id) !== 'pending').length;
    /* 按类别分项进度 */
    const byGroup = {};
    for (const x of all) {
      const g = GROUPS[x.group] || '其他';
      const b = byGroup[g] || (byGroup[g] = { n: 0, ok: 0, issue: 0, pend: 0 });
      b.n++; const st = proofStatus(x.id);
      if (st === 'ok') b.ok++; else if (st === 'issue') b.issue++; else b.pend++;
    }
    v.querySelector('#pf-stats').innerHTML = `
      <div class="pf-stats">
        ${[['all', '全部条目'], ['pending', '待校对'], ['ok', '已校对'], ['issue', '有疑问']].map(([k, n]) =>
          `<div class="pf-stat ${k}"><div class="pf-stat-n">${c[k] || 0}</div><div class="pf-stat-l">${n}</div></div>`).join('')}
        <div class="pf-stat"><div class="pf-stat-n">${pct}%</div><div class="pf-stat-l">完成度</div></div>
      </div>
      <div class="pf-bar"><div class="pf-bar-in" style="width:${pct}%"></div></div>
      <p class="small muted" style="margin-top:8px">「待校对」＝<b>还没核对过</b>（${c.pending} 条）；
        原始数据由 OCR 抽取、未经人工确认的共 <b>${reviewN}</b> 条，其中已核对 <b>${reviewDone}</b> 条、
        还剩 <b>${reviewN - reviewDone}</b> 条。<b>已校对 / 有疑问都算已完成</b>，列表里不再显示「待校」。${
          Object.keys(proofConflicts()).length
            ? ` <b style="color:var(--red)">⚠ 待审阅 ${Object.keys(proofConflicts()).length} 条</b>（云端与本机不一致，请到下方「待审阅区」裁定）`
            : ''}</p>
      <p class="small muted" style="margin-top:8px">${expertStatLine(all)}</p>
      <div class="pf-break">
        <table class="tbl"><thead><tr><th>类别</th><th>已校对</th><th>有疑问</th><th>待校</th><th>合计</th><th>进度</th></tr></thead><tbody>
        ${Object.entries(byGroup).sort((a, b) => b[1].n - a[1].n).map(([g, b]) => {
          const p = b.n ? Math.round((b.ok + b.issue) / b.n * 100) : 0;
          return `<tr><td>${esc(g)}</td><td style="color:var(--green)">${b.ok}</td>
            <td style="color:var(--red)">${b.issue}</td><td>${b.pend}</td><td>${b.n}</td>
            <td style="min-width:120px"><div class="pf-mini"><div class="pf-mini-in${p === 100 ? ' full' : ''}" style="width:${p}%"></div></div>
            <span class="small muted">${p}%</span></td></tr>`;
        }).join('')}
        </tbody></table>
      </div>`;
  };

  /* ---- 待审阅区：云端与本机不一致的条目（不自动覆盖，等人裁定） ---- */
  const drawConflicts = () => {
    const box = v.querySelector('#pf-cfbox');
    if (!box) return;
    const cfs = Object.entries(proofConflicts())
      .sort((a, b) => String(b[1].at || '').localeCompare(String(a[1].at || '')));
    if (!cfs.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    const nm = id => { const c = cardById(id); return c ? `${c.name}` : id; };
    const line = r => `<div class="pf-cfrec">
      <span class="pf-badge ${PROOF_STATUS[r.status]?.cls || ''}">${PROOF_STATUS[r.status]?.icon || ''} ${PROOF_STATUS[r.status]?.label || r.status}</span>
      <span class="small">${esc(r.note || '（无备注）')}</span>
      <span class="small muted">${esc(r.by || '')} · ${String(r.at || '').slice(0, 16).replace('T', ' ')}</span></div>`;
    box.innerHTML = `
      <h3 class="panel-title">⚠ 待审阅 ${cfs.length} 条 · 云端与本机不一致</h3>
      <p class="small muted" style="margin-bottom:10px">同步时发现同一张卡两边记录不同，<b>已不自动覆盖</b>，单独放在这里等你裁定；裁定之前本机与云端都不改动。
        点卡名可跳到该卡详情核对。</p>
      <table class="tbl"><thead><tr><th>卡牌</th><th>本机记录</th><th>云端记录</th><th style="width:230px">裁定</th></tr></thead><tbody>
      ${cfs.map(([id, cf]) => `<tr>
        <td><a href="javascript:void 0" class="pf-cflink" data-cfgo="${esc(id)}">${esc(nm(id))}</a>
          <div class="small muted">${esc(id)}</div></td>
        <td>${line(cf.local)}</td>
        <td>${line(cf.cloud)}</td>
        <td><div class="pf-cfbtns">
          <button class="btn btn-sm btn-primary" data-cf="cloud" data-cfid="${esc(id)}">采用云端</button>
          <button class="btn btn-sm" data-cf="local" data-cfid="${esc(id)}">保留本机</button>
          <button class="btn btn-sm" data-cf="merge" data-cfid="${esc(id)}" title="本机状态 + 云端备注拼在一起">合并备注</button>
        </div></td>
      </tr>`).join('')}
      </tbody></table>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-sm" data-cfall="local">全部保留本机</button>
        <button class="btn btn-sm" data-cfall="cloud">全部采用云端</button>
      </div>`;
    box.querySelectorAll('[data-cf]').forEach(btn => btn.onclick = () => {
      const id = btn.dataset.cfid, mode = btn.dataset.cf;
      if (!resolveConflict(id, mode)) return;
      toast(mode === 'cloud' ? '已采用云端记录' : mode === 'merge' ? '已合并两边备注' : '已保留本机记录', 2400);
      refreshAll();
    });
    box.querySelectorAll('[data-cfgo]').forEach(a => a.onclick = () => {
      ProofUI.sel = a.dataset.cfgo; drawList(); drawDetail();
      document.querySelector('#pf-detail')?.scrollIntoView({ block: 'nearest' });
    });
    box.querySelectorAll('[data-cfall]').forEach(btn => btn.onclick = () => {
      const mode = btn.dataset.cfall;
      const ids = Object.keys(proofConflicts());
      if (!confirm(`把待审阅的 ${ids.length} 条全部${mode === 'cloud' ? '「采用云端」' : '「保留本机」'}？`)) return;
      ids.forEach(id => resolveConflict(id, mode));
      toast(`已处理 ${ids.length} 条`, 2600);
      refreshAll();
    });
  };

  const updateSelN = () => {
    const n = ProofUI.checked.size;
    const el = v.querySelector('#pf-seln');
    if (el) el.textContent = `已选 ${n} 条`;
  };

  const drawList = () => {
    const list = proofFiltered();
    const cur = ProofUI.sel;
    const ck = ProofUI.checked;
    const allChecked = list.length > 0 && list.every(c => ck.has(c.id));
    v.querySelector('#pf-list').innerHTML = `
      <div class="pf-listhead">
        <span class="small muted">当前筛选 ${list.length} 条</span>
        <span class="flex-spacer"></span>
        <label class="pf-check"><input type="checkbox" id="pf-all" ${allChecked ? 'checked' : ''}> 全选</label>
      </div>
      ${list.map(c => {
        const st = proofStatus(c.id);
        const p = PROOF_STATUS[st];
        return `<div class="pf-item ${cur === c.id ? 'sel' : ''}" data-pfid="${esc(c.id)}">
          <input type="checkbox" class="pf-ck" data-pfck="${esc(c.id)}" ${ck.has(c.id) ? 'checked' : ''} title="勾选后可批量操作">
          <span class="pf-dot ${p.cls}" title="${p.label}">${p.icon}</span>
          <span class="pf-iname">${esc(c.name)}</span>
          ${rangerLineHTML(c)}${expertTagHTML(c)}
          <span class="pf-imeta">${esc(GROUPS[c.group] || '')}${c.deck ? ' · ' + esc(c.deck) : ''}${
            /* 「待校」只表示「还没校对过」，一旦标成已校对 / 有疑问就不再显示，避免与
               原始数据自带的 review（OCR 未确认）标记混淆 —— 两者不是一回事 */
            st === 'pending' ? (c.review ? ' <span class="tag">待校</span>' : '')
              : (c.review ? ' <span class="tag gray" title="原始数据由 OCR 抽取，已人工核对过">已核</span>' : '')
          }${c.edited ? ' <span class="tag blue">已改</span>' : ''}${
            conflictOf(c.id) ? ' <span class="tag" style="background:var(--red);color:#fff" title="云端与本机记录不一致，待你裁定">⚠ 待审阅</span>' : ''}</span>
        </div>`;
      }).join('') || '<p class="muted small">没有符合条件的卡牌。</p>'}`;
    v.querySelectorAll('[data-pfid]').forEach(el => el.onclick = () => {
      ProofUI.sel = el.dataset.pfid; drawList(); drawDetail();
    });
    v.querySelectorAll('[data-pfck]').forEach(el => {
      el.onclick = e => e.stopPropagation();
      el.onchange = e => {
        e.stopPropagation();
        if (el.checked) ProofUI.checked.add(el.dataset.pfck); else ProofUI.checked.delete(el.dataset.pfck);
        updateSelN();
      };
    });
    const al = v.querySelector('#pf-all');
    if (al) al.onchange = e => {
      const ids = proofFiltered().map(c => c.id);
      if (e.target.checked) ids.forEach(i => ProofUI.checked.add(i));
      else ids.forEach(i => ProofUI.checked.delete(i));
      drawList(); updateSelN();
    };
    updateSelN();
  };

  const drawDetail = () => {
    const box = v.querySelector('#pf-detail');
    const id = ProofUI.sel;
    if (!id) { box.innerHTML = '<p class="muted small">从左侧选择一张卡牌开始校对。</p>'; return; }
    const c = cardById(id);
    if (!c) { box.innerHTML = '<p class="muted small">卡牌不存在（可能已被删除）。</p>'; ProofUI.sel = null; return; }
    const rec = proofRec(id);
    const st = proofStatus(id);
    const a = c.attr || {};
    box.innerHTML = `
      <div class="pf-detail">
        <div class="pf-dart">
          ${c.img ? `<img src="${esc(c.img)}" alt="" data-zoom="${esc(c.id)}" style="cursor:zoom-in">` : '<div class="pf-dnoart">无卡图</div>'}
        </div>
        <div class="pf-dform">
          <div class="pf-dhead">
            <span class="pf-badge ${PROOF_STATUS[st].cls}">${PROOF_STATUS[st].icon} ${PROOF_STATUS[st].label}</span>
            <span class="small muted">${esc(GROUPS[c.group] || '')}${c.deck ? ' · ' + esc(c.deck) : ''}${c.review ? ' · 内置待校' : ''}</span>
          </div>
          ${conflictOf(id) ? `<div class="pf-cfbar">⚠ 这张卡云端与本机记录不一致，已在「待审阅区」等你裁定（未自动覆盖）
            <div class="pf-cfbtns" style="margin-top:6px">
              <button class="btn btn-sm btn-primary" data-cf2="cloud">采用云端</button>
              <button class="btn btn-sm" data-cf2="local">保留本机</button>
              <button class="btn btn-sm" data-cf2="merge">合并备注</button>
            </div></div>` : ''}
          <div class="grid-form">
            <label class="fld">名称<input type="text" id="pf-name" value="${esc(c.name || '')}"></label>
            <label class="fld">类型行<input type="text" id="pf-type" value="${esc(c.type || '')}"></label>
            <label class="fld">费用<input type="text" id="pf-cost" value="${esc(c.cost ?? '')}"></label>
            <label class="fld">牌组<input type="text" id="pf-deck" value="${esc(c.deck || '')}"></label>
            ${c.group === 'attribute'
              /* 四维数值只保留在属性牌 */
              ? ATTRS.map(k => `<label class="fld">${esc(ATTR_FULL[k])}<input type="number" id="pf-a-${k}" min="0" max="9" value="${esc(a[k] ?? '')}"></label>`).join('')
              : (hasCardType(c)
                  /* 行者牌 / 奖励牌：改为「卡牌类型」四选一 */
                  ? `<label class="fld">卡牌类型<select id="pf-attrtype">
                       <option value="">（未指定）</option>
                       ${ATTRS.map(k => `<option value="${esc(k)}" ${c.attrType === k ? 'selected' : ''}>${esc(ATTR_FULL[k])}</option>`).join('')}
                     </select></label>`
                  : '')}
          </div>
          ${hasRangerData(c) ? rangerFormHTML(c) : ''}
          ${isExpertCard(c) ? `<div class="pf-expert${expertMismatch(c) ? ' warn' : ''}">
            ${expertTagHTML(c)}
            <span class="small">${expertMismatch(c)
              ? (expertFrom(c) === 'type'
                  ? '类型行含「专家」，但关键词没标 —— 按并集已算专家牌，建议补 keywords'
                  : '关键词含「专家」，但类型行没标 —— 按并集已算专家牌，请核对类型行')
              : '关键词与类型行都含「专家」，判定一致'}</span>
            <span class="small muted">组牌限制：专家牌不能作为爱好。</span>
          </div>` : ''}
          <div class="pf-sec" style="margin-top:12px">
            <div class="pf-sec-h">手段（可多选 · 可重复）</div>
            <div class="pf-means">
              <div class="pf-means-pick">
                <select id="pf-mean-sel">
                  <option value="">选择手段…</option>
                  ${MEANS.map(m => `<option value="${esc(m.key)}">${m.icon} ${esc(m.key)}</option>`).join('')}
                </select>
                <button class="btn btn-sm btn-primary" id="pf-mean-add" type="button">＋ 添加</button>
                <span class="pf-means-quick">${MEANS.map(m =>
                  `<button class="btn btn-sm pf-mean-q" type="button" data-mean="${esc(m.key)}" title="直接添加一个「${esc(m.key)}」">${m.icon} ${esc(m.key)}</button>`).join('')}</span>
              </div>
              <div class="pf-means-list" id="pf-means-list"></div>
            </div>
            <label class="fld" style="margin-top:8px">备注描述<textarea id="pf-desc" rows="2" placeholder="对手段 / 卡面的补充说明（例如：需消耗 1 点精力才能用该手段）">${esc(c.desc || '')}</textarea></label>
          </div>
          <div class="pf-sec" style="margin-top:12px">
            <div class="pf-sec-h">效果文本（一行一条目）</div>
            <div class="pf-lines" id="pf-lines"></div>
            <button class="btn btn-sm" id="pf-line-add" type="button" style="margin-top:6px">＋ 增加一行条目</button>
            <label class="fld" style="margin-top:10px">剧情描述性文本（风味 / 引言）<textarea id="pf-flavor" rows="2" placeholder="卡面底部的斜体描述文字，不属于规则效果">${esc(c.flavor || '')}</textarea></label>
          </div>
          <label class="fld" style="margin-top:10px">校对备注（疑问点 / 依据）<textarea id="pf-note" rows="2" placeholder="例如：官方勘误中费用应为 1">${esc(rec?.note || '')}</textarea></label>
          <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-primary" id="pf-savefix">保存修正并标为已校对</button>
            <button class="btn" id="pf-markok">标为已校对</button>
            <button class="btn" id="pf-markissue">标为有疑问</button>
            <button class="btn" id="pf-clear">清除校对状态</button>
            <a class="btn btn-link" href="#editor" title="在表单编辑中查看该卡">打开表单编辑</a>
          </div>
          <div class="small muted" style="margin-top:10px">
            ${rec ? `记录：${esc(rec.by || '本机')} · ${esc(String(rec.at || '').slice(0, 16).replace('T', ' '))}` : '尚无校对记录'}
            ${c.edited ? ' · <span style="color:var(--blue)">该卡已有字段修正</span>' : ''}
          </div>
        </div>
      </div>`;

    /* ---- 手段（可多选 / 可重复）与效果文本多行的即时编辑状态 ---- */
    let meansArr = Array.isArray(c.means) ? c.means.slice() : [];
    let linesArr = cardTextLines(c);
    if (!linesArr.length) linesArr = [''];

    const drawMeans = () => {
      const box2 = box.querySelector('#pf-means-list');
      if (!box2) return;
      box2.innerHTML = meansArr.length
        ? meansArr.map((k, i) => `<span class="chip-mean pf-mean-chip" title="点击 × 删除第 ${i + 1} 个">${meanIcon(k)}${esc(k)}
            <button type="button" class="pf-mean-x" data-mdel="${i}" aria-label="删除">×</button></span>`).join('')
        : '<span class="small muted">（未填）</span>';
      box2.querySelectorAll('[data-mdel]').forEach(b => b.onclick = () => {
        meansArr.splice(+b.dataset.mdel, 1); drawMeans();
      });
    };
    const addMean = k => { if (MEAN_ICON[k]) { meansArr.push(k); drawMeans(); } };
    box.querySelector('#pf-mean-add').onclick = () => {
      const s = box.querySelector('#pf-mean-sel');
      if (!s.value) { toast('先在下拉里选一个手段'); s.focus(); return; }
      addMean(s.value);
    };
    box.querySelector('#pf-mean-sel').onchange = e => { if (e.target.value) { addMean(e.target.value); e.target.value = ''; } };
    box.querySelectorAll('[data-mean]').forEach(b => b.onclick = () => addMean(b.dataset.mean));

    const drawLines = () => {
      const lb = box.querySelector('#pf-lines');
      if (!lb) return;
      lb.innerHTML = linesArr.map((t, i) => `<div class="pf-line-row">
          <span class="pf-line-n">${i + 1}</span>
          <input type="text" class="pf-line-inp" value="${esc(t)}" placeholder="第 ${i + 1} 条效果…">
          <button type="button" class="pf-line-x" data-ldel="${i}" title="删除这一行">×</button>
        </div>`).join('');
      lb.querySelectorAll('.pf-line-inp').forEach((inp, i) => inp.oninput = () => { linesArr[i] = inp.value; });
      lb.querySelectorAll('[data-ldel]').forEach(b => b.onclick = () => {
        linesArr.splice(+b.dataset.ldel, 1);
        if (!linesArr.length) linesArr = [''];
        drawLines();
      });
    };
    box.querySelector('#pf-line-add').onclick = () => { linesArr.push(''); drawLines(); box.querySelector('#pf-lines .pf-line-row:last-child .pf-line-inp')?.focus(); };

    drawMeans(); drawLines();
    if (hasRangerData(c)) bindRangerForm(box, c, id, drawList);

    box.querySelector('[data-zoom]')?.addEventListener('click', e =>
      openModal(e.currentTarget.dataset.zoom, proofFiltered().map(c => c.id)));
    /* 详情区里的冲突裁定按钮（与待审阅区同一套） */
    box.querySelectorAll('[data-cf2]').forEach(btn => btn.onclick = () => {
      if (!resolveConflict(id, btn.dataset.cf2)) return;
      toast('已裁定该条冲突', 2400);
      drawStats(); drawList(); drawDetail(); drawConflicts();
    });
    box.querySelector('#pf-markok').onclick = () => {
      proofSet(id, 'ok', box.querySelector('#pf-note').value.trim());
      toast('已标记为已校对'); drawStats(); drawList(); drawDetail();
    };
    box.querySelector('#pf-markissue').onclick = () => {
      const note = box.querySelector('#pf-note').value.trim();
      if (!note) { toast('请在备注里写下疑问点'); box.querySelector('#pf-note').focus(); return; }
      proofSet(id, 'issue', note); toast('已标记为有疑问'); drawStats(); drawList(); drawDetail();
    };
    box.querySelector('#pf-clear').onclick = () => {
      proofSet(id, 'pending', ''); toast('已清除校对状态'); drawStats(); drawList(); drawDetail();
    };
    box.querySelector('#pf-savefix').onclick = () => {
      const base = cardSource().find(x => x.id === id) || {};
      const val = s => (box.querySelector(s)?.value ?? '').toString().trim();
      const attr = {};
      ATTRS.forEach(k => { const s = val('#pf-a-' + k); if (s !== '') attr[k] = Number(s); });
      const next = { name: val('#pf-name'), type: val('#pf-type'), cost: val('#pf-cost'), deck: val('#pf-deck') };
      const ov = { ...(DB.overrides[id] || {}) };
      const eq = (x, y) => String(x ?? '') === String(y ?? '');
      for (const k of ['name', 'type', 'cost', 'deck']) {
        if (eq(next[k], base[k])) delete ov[k]; else ov[k] = next[k];
      }
      /* 四维数值只保留在属性牌；其余卡（行者 / 奖励）改存「卡牌类型」 */
      if (c.group === 'attribute') {
        if (normAttr(attr) === normAttr(base.attr)) delete ov.attr; else ov.attr = attr;
      }
      if (hasCardType(c)) {
        const t = val('#pf-attrtype');
        if (t) ov.attrType = t; else delete ov.attrType;
      }
      /* 手段（保留重复） */
      if (arrEq(meansArr, base.means || [])) delete ov.means; else ov.means = meansArr.slice();
      /* 备注描述 */
      const desc = box.querySelector('#pf-desc').value.trim();
      if (desc) ov.desc = desc; else delete ov.desc;
      /* 效果文本：多行列式条目 → textLines，并同步回 text（供检索 / 展示 / 导出） */
      const lines = linesArr.map(s => String(s).trim()).filter(Boolean);
      const baseLines = String(base.text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (arrEq(lines, baseLines)) { delete ov.textLines; delete ov.text; }
      else { ov.textLines = lines; ov.text = lines.join('\n'); }
      /* 剧情描述性文本 */
      const flavor = box.querySelector('#pf-flavor').value.trim();
      if (flavor) ov.flavor = flavor; else delete ov.flavor;

      if (Object.keys(ov).length) DB.overrides[id] = ov; else delete DB.overrides[id];
      proofSet(id, 'ok', box.querySelector('#pf-note').value.trim());
      saveDB(); toast('修正已保存（仅覆盖本机/当前档案）');
      drawStats(); drawList(); drawDetail();
    };
  };

  /* 工具栏 */
  v.querySelectorAll('[data-pfs]').forEach(b => b.onclick = () => {
    ProofUI.status = b.dataset.pfs;
    v.querySelectorAll('[data-pfs]').forEach(x => x.classList.toggle('active', x.dataset.pfs === ProofUI.status));
    drawList();
  });
  v.querySelectorAll('[data-pfs]').forEach(x => x.classList.toggle('active', x.dataset.pfs === ProofUI.status));
  v.querySelector('#pf-group').onchange = e => { ProofUI.group = e.target.value; drawList(); };
  v.querySelector('#pf-q').oninput = e => { ProofUI.q = e.target.value; drawList(); };
  v.querySelector('#pf-rev').onchange = e => { ProofUI.onlyReview = e.target.checked; drawList(); };
  v.querySelector('#pf-exdiff').onchange = e => { ProofUI.expertDiff = e.target.checked; drawList(); };

  v.querySelector('#pf-batch').onclick = () => {
    const list = proofFiltered();
    if (!list.length) { toast('当前筛选为空'); return; }
    if (!confirm(`把当前筛选的 ${list.length} 条全部标记为「已校对」？有疑问的记录会被覆盖。`)) return;
    for (const c of list) proofSet(c.id, 'ok', proofRec(c.id)?.note || '');
    toast(`已标记 ${list.length} 条`); drawStats(); drawList(); drawDetail();
  };

  /* ---- 勾选批量 ---- */
  const selIds = () => [...ProofUI.checked].filter(id => cardById(id));
  const refreshAll = () => { drawStats(); drawList(); drawDetail(); drawConflicts(); updateSelN(); };
  v.querySelector('#pf-sel-ok').onclick = () => {
    const ids = selIds();
    if (!ids.length) { toast('请先勾选条目（列表右上角「全选」）'); return; }
    if (!confirm(`把勾选的 ${ids.length} 条标记为「已校对」？`)) return;
    ids.forEach(id => proofSet(id, 'ok', proofRec(id)?.note || ''));
    toast(`已标记 ${ids.length} 条为已校对`); refreshAll();
  };
  v.querySelector('#pf-sel-issue').onclick = () => {
    const ids = selIds();
    if (!ids.length) { toast('请先勾选条目（列表右上角「全选」）'); return; }
    const note = prompt(`为勾选的 ${ids.length} 条写一句疑问备注（会覆盖原备注）：`);
    if (note == null) return;
    if (!note.trim()) { toast('备注不能为空'); return; }
    ids.forEach(id => proofSet(id, 'issue', note.trim()));
    toast(`已标记 ${ids.length} 条为有疑问`); refreshAll();
  };
  v.querySelector('#pf-sel-clear').onclick = () => {
    const ids = selIds();
    if (!ids.length) { toast('请先勾选条目（列表右上角「全选」）'); return; }
    if (!confirm(`清除勾选的 ${ids.length} 条的校对状态？`)) return;
    ids.forEach(id => proofSet(id, 'pending', ''));
    toast(`已清除 ${ids.length} 条`); refreshAll();
  };
  v.querySelector('#pf-nextpending').onclick = () => {
    const pend = allCards().filter(c => proofStatus(c.id) === 'pending');
    if (!pend.length) { toast('全部条目都已处理 🎉'); return; }
    const k = pend.findIndex(c => c.id === ProofUI.sel);
    const nx = pend[(k + 1) % pend.length];
    ProofUI.sel = nx.id; drawList(); drawDetail();
    v.querySelector('.pf-item.sel')?.scrollIntoView({ block: 'nearest' });
  };

  /* ---- CSV 导入修正 ---- */
  v.querySelector('#pf-imp').onclick = () => v.querySelector('#pf-file').click();
  v.querySelector('#pf-file').onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    let txt = '';
    try { txt = await f.text(); } catch { toast('文件读取失败'); return; }
    const rows = parseCSV(txt);
    if (rows.length < 2) { toast('CSV 至少需要表头 + 1 行数据'); return; }
    const head = rows[0].map(s => String(s).trim());
    const at = {};
    head.forEach((h, i) => {
      for (const [k, als] of Object.entries(PF_COLS)) if (als.includes(h) && at[k] == null) at[k] = i;
    });
    if (at.id == null && at.name == null) { toast('CSV 缺少「卡牌ID」或「名称」列'); return; }
    let upd = 0, ovN = 0, nf = 0;
    const byNameDeck = new Map();
    for (const c of allCards()) byNameDeck.set(`${c.name || ''}|${c.deck || ''}`, c);
    for (const r of rows.slice(1)) {
      const g = k => at[k] == null ? '' : String(r[at[k]] ?? '').trim();
      let c = g('id') ? cardById(g('id')) : null;
      if (!c && g('name')) c = byNameDeck.get(`${g('name')}|${g('deck')}`)
        || allCards().find(x => (x.name || '') === g('name'));
      if (!c) { nf++; continue; }
      const base = cardSource().find(x => x.id === c.id) || {};
      const ov = { ...(DB.overrides[c.id] || {}) };
      const eq = (x, y) => String(x ?? '') === String(y ?? '');
      const setF = (k, val) => { if (val === '') return; if (eq(val, base[k])) delete ov[k]; else ov[k] = val; };
      ['name', 'type', 'cost', 'deck'].forEach(k => setF(k, g(k)));
      /* 卡牌类型（行者牌 / 奖励牌）：支持「知觉」或「知」 */
      if (g('attrType') !== '') {
        const raw = g('attrType');
        const k = ATTRS.find(x => ATTR_FULL[x] === raw) || (ATTRS.includes(raw) ? raw : null);
        if (k) ov.attrType = k; else nf++;
      }
      /* 手段（保留重复） */
      if (g('means') !== '') {
        const m = parseMeansStr(g('means'));
        if (arrEq(m, base.means || [])) delete ov.means; else ov.means = m;
      }
      ['desc', 'flavor'].forEach(k => { if (g(k) !== '') ov[k] = g(k); });
      /* 效果文本：支持「｜ / | 」分隔的多条目，也兼容整段换行 */
      if (g('text') !== '') {
        const lines = String(g('text')).split(/\s*[|｜]\s*|\r?\n/).map(s => s.trim()).filter(Boolean);
        const baseLines = String(base.text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        if (arrEq(lines, baseLines)) { delete ov.textLines; delete ov.text; }
        else { ov.textLines = lines; ov.text = lines.join('\n'); }
      }
      if (g('attr') !== '') {
        const a = parseAttrStr(g('attr'));
        if (normAttr(a) === normAttr(base.attr)) delete ov.attr; else ov.attr = a;
      }
      /* v37：行者数据四项（类型 / 需求 / 装备值 / 标记） */
      const rpatch = {};
      if (g('rtype') !== '') {
        const raw = g('rtype');
        const k = ATTRS.find(x => ATTR_FULL[x] === raw) || (ATTRS.includes(raw) ? raw : null);
        if (k) rpatch.type = k; else nf++;
      }
      if (g('rreq') !== '') {
        const n = Number(String(g('rreq')).replace(/[^\d]/g, ''));
        if (!isNaN(n)) rpatch.req = n;
      }
      if (g('requip') !== '') {
        const s = g('requip');
        /* 兼容「3」与「▣▣▣▢▢」两种写法 */
        const n = /[▣▢]/.test(s) ? (s.match(/▣/g) || []).length : Number(String(s).replace(/[^\d]/g, ''));
        if (!isNaN(n)) rpatch.equip = n;
      }
      if (g('rmark') !== '') rpatch.mark = g('rmark');
      if (Object.keys(rpatch).length) setRangerData(c.id, rpatch);
      if (Object.keys(ov).length) { DB.overrides[c.id] = ov; ovN++; } else delete DB.overrides[c.id];
      const st = g('status');
      if (st) {
        const s = /已校对|^ok$/i.test(st) ? 'ok'
                : /有疑问|^issue$/i.test(st) ? 'issue'
                : /待校对|^pending$/i.test(st) ? 'pending' : null;
        if (s) proofSet(c.id, s, g('note'));
      } else if (g('note')) {
        const cur = proofStatus(c.id);
        proofSet(c.id, cur === 'pending' ? 'issue' : cur, g('note'));
      }
      upd++;
    }
    saveDB();
    toast(`导入完成：更新 ${upd} 条${ovN ? `（${ovN} 条含字段修正）` : ''}${nf ? `，${nf} 条未匹配` : ''}`);
    refreshAll();
  };
  v.querySelector('#pf-tpl').onclick = () => {
    const head = ['卡牌ID', '名称', '牌组', '类型', '费用', '属性', '卡牌类型', '手段', '备注描述', '效果文本', '剧情描述',
      '行者类型', '需求点数', '装备值', '标记', '状态', '备注'];
    const cell = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const sample = (ProofUI.status === 'pending' ? proofFiltered() : proofFiltered().filter(c => proofStatus(c.id) === 'pending')).slice(0, 10);
    const csv = '\uFEFF' + [head.join(','), ...sample.map(c =>
      [c.id, c.name, c.deck || '', c.type || '', c.cost ?? '',
       Object.entries(c.attr || {}).map(([k, v]) => k + v).join(' '),
       c.attrType || '', (c.means || []).join(' '), c.desc || '',
       cardTextLines(c).join(' | '), c.flavor || '',
       rangerDataOf(c.id).type ? ATTR_FULL[rangerDataOf(c.id).type] : '',
       rangerDataOf(c.id).req === '' ? '' : rangerDataOf(c.id).req,
       rangerDataOf(c.id).equip || 0, rangerDataOf(c.id).mark || '',
       '', ''].map(cell).join(','))].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `地缘行者_校对导入模板_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
    toast(`模板已下载（含 ${sample.length} 条待校条目，填好后再用「导入修正 CSV」）`);
  };

  const reportRows = () => proofFiltered().map(c => {
    const r = proofRec(c.id);
    return {
      id: c.id, name: c.name, group: GROUPS[c.group] || '', deck: c.deck || '', type: c.type || '',
      cost: c.cost ?? '', attr: Object.entries(c.attr || {}).map(([k, v]) => k + v).join(' '),
      attrType: ATTR_FULL[c.attrType] || '', means: (c.means || []).join(' '), desc: c.desc || '',
      text: cardTextLines(c).join(' | '), flavor: c.flavor || '',
      status: PROOF_STATUS[proofStatus(c.id)].label, note: r?.note || '', by: r?.by || '', at: r?.at || '',
      expert: isExpertCard(c) ? (expertMismatch(c) ? '专家(不一致)' : '专家') : '',
      rtype: ATTR_FULL[rangerDataOf(c.id).type] || '',
      rreq: rangerDataOf(c.id).req === '' ? '' : rangerDataOf(c.id).req,
      requip: rangerDataOf(c.id).equip || 0,
      rmark: rangerDataOf(c.id).mark || '',
    };
  });
  v.querySelector('#pf-csv').onclick = () => {
    const rows = reportRows();
    const head = ['卡牌ID', '名称', '类别', '牌组', '类型', '专家', '费用', '属性', '卡牌类型', '手段', '备注描述', '效果文本', '剧情描述',
      '行者类型', '需求点数', '装备值', '标记', '状态', '备注', '校对者', '时间'];
    const cell = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const csv = '\uFEFF' + [head.join(','), ...rows.map(r =>
      [r.id, r.name, r.group, r.deck, r.type, r.expert, r.cost, r.attr, r.attrType, r.means, r.desc, r.text, r.flavor,
       r.rtype, r.rreq, r.requip, r.rmark, r.status, r.note, r.by, r.at].map(cell).join(','))].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `地缘行者_校对报告_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
    toast(`已导出 ${rows.length} 条`);
  };
  v.querySelector('#pf-json').onclick = () => {
    const payload = { format: 'earthborne-rangers-proof/v1', by: exportBy() || undefined, exportedAt: new Date().toISOString(), rows: reportRows() };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' }));
    a.download = `地缘行者_校对记录_${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(a.href);
    toast('已导出校对记录');
  };

  /* ---- 云端校对同步 ---- */
  const cloudLine = v.querySelector('#pf-cloud');
  const fmtCloud = s => {
    if (!s || !s.total) return cloudOn() ? '云端暂无校对记录' : '云端未连接（仅存本机）';
    const last = s.last_at ? String(s.last_at).slice(0, 16).replace('T', ' ') : '—';
    return `云端：${s.total} 张 · 已校对 ${s.ok || 0} · 有疑问 ${s.issue || 0} · 参与 ${s.contributors || 0} 人 · 最近 ${last}`;
  };
  const refreshCloud = async (suffix) => {
    if (!cloudLine) return;
    if (!cloudOn() || !isSignedIn()) {
      cloudLine.textContent = proofAutoOn()
        ? '（登录后可自动同步云端校对）'
        : '（登录后可上传 / 下载云端校对 · 自动同步已关闭）';
      return;
    }
    const r = await cloudProofStats();
    const tail = suffix ? ` <b style="color:var(--green)">${esc(suffix.trim())}</b>` : '';
    cloudLine.innerHTML = r.error
      ? '云端读取失败：' + (r.error.message || '')
      : esc(fmtCloud(r.data)) + tail;
  };
  PROOF_REFRESH_CLOUD = refreshCloud;
  /* 自动同步开关（存进 DB.settings，随账号走） */
  v.querySelector('#pf-auto').onchange = e => {
    DB.settings = DB.settings || {};
    DB.settings.proofAutoSync = !!e.target.checked;
    saveDB();
    toast(DB.settings.proofAutoSync ? '已开启云端自动同步：改动会自动上传，也会自动合并他人更新' : '已关闭云端自动同步：仅存本机，需要时用「立即上传 / 立即合并」', 3600);
    refreshCloud();
    if (DB.settings.proofAutoSync) { autoSyncProof(true); pushProofSoon(300); }
  };
  v.querySelector('#pf-push').onclick = async () => {
    const recs = Object.entries(DB.proof || {}).filter(([, r]) => r && (r.status !== 'pending' || r.note));
    if (!recs.length) { toast('本机还没有校对记录'); return; }
    if (!isSignedIn()) { toast('请先登录再上传云端校对'); return; }
    const ok = await flushProofPush(false);
    if (!ok && cloudOn() && isSignedIn()) toast('上传失败，请稍后重试', 3200);
    else if (ok) toast(`已上传 ${recs.length} 条校对记录到云端`, 3000);
    refreshCloud();
  };
  /* 云端覆盖前的本机备份 → 逐条取新找回 */
  v.querySelector('#pf-restore').onclick = () => {
    let bk = null;
    try { bk = JSON.parse(localStorage.getItem(slotKey() + '_bak') || 'null') || null; } catch { bk = null; }
    const bn = bk && bk.proof ? Object.keys(bk.proof).length : 0;
    if (!bn) { toast('没有可找回的本机备份（本机还没被云端覆盖过）', 3200); return; }
    const before = Object.keys(DB.proof || {}).length;
    DB.proof = mergeProof(bk.proof, DB.proof);
    saveDB(); drawStats(); drawList(); drawDetail(); pushProofSoon();
    toast(`已从备份合并 ${bn} 条记录（现有 ${before} → ${Object.keys(DB.proof).length} 条，同卡取较新的一条）`, 4200);
  };
  v.querySelector('#pf-pull').onclick = async () => {
    if (!isSignedIn()) { toast('请先登录再下载云端校对'); return; }
    cloudLine.textContent = '下载中…';
    const before = Object.keys(DB.proof || {}).length;
    await autoSyncProof(true);
    drawStats(); drawList(); drawDetail();
    const after = Object.keys(DB.proof || {}).length;
    if (after === before) toast('云端没有比本机更新的记录', 2600);
    refreshCloud();
  };

  drawStats(); drawList(); drawDetail(); drawConflicts();
  PROOF_REDRAW = () => {
    drawStats(); drawList(); drawDetail(); drawConflicts();
    document.querySelector('.pf-item.sel')?.scrollIntoView({ block: 'nearest' });
  };
  refreshCloud();
  /* 进入本页自动下行一次（30 秒节流）：把他人更新的记录并进来 */
  autoSyncProof();
}

/* CSV 解析（支持引号包裹、转义双引号、CRLF） */
function parseCSV(s) {
  const rows = []; let row = [], cur = '', q = false;
  s = String(s).replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else {
      if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (ch !== '\r') cur += ch;
    }
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ''));
}

/* 属性串 → {知:1,体:2}，支持 JSON / 「知1 体2」/「知:1,体:2」 */
function parseAttrStr(s) {
  s = String(s || '').trim();
  if (!s) return {};
  if (s.startsWith('{')) { try { return JSON.parse(s); } catch { /* 继续按文本解析 */ } }
  const o = {};
  const re = /([知体精专])\s*[:：]?\s*(\d)/g;
  let m; while ((m = re.exec(s))) o[m[1]] = +m[2];
  return o;
}

/* 校对 CSV 列名（中文为主，兼容英文导出） */
const PF_COLS = {
  id:     ['卡牌ID', '卡ID', 'ID', 'id'],
  name:   ['名称', '卡名', 'name'],
  deck:   ['牌组', 'deck'],
  type:   ['类型', '类型行', 'type'],
  cost:   ['费用', 'cost'],
  attr:     ['属性', 'attr'],
  attrType: ['卡牌类型', '类型属性', 'attrType'],
  means:    ['手段', 'means'],
  desc:     ['备注描述', '描述', 'desc'],
  text:     ['效果文本', '文本', 'text'],
  flavor:   ['剧情描述', '剧情文本', '风味文本', 'flavor'],
  status:   ['状态', 'status'],
  note:     ['备注', 'note'],
  rtype:    ['行者类型', '校对类型', 'rtype'],
  rreq:     ['需求点数', '需求', 'rreq'],
  requip:   ['装备值', 'requip'],
  rmark:    ['标记', 'rmark'],
};

/* ================= 7) 导出 ================= */
function exportPage(v) {
  const decks = DB.decks || [];
  v.innerHTML = `
    <h2 class="page-title">导出</h2>
    <p class="page-sub">将构筑导出为结构化 JSON（外部平台通用）或 TTS 模组 JSON（Tabletop Simulator 自定义牌组）。
      ${exportBy() ? `<br>当前署名：<code>${esc(exportBy())}</code>` : '<br><span class="muted">未登录，导出不含署名</span>'}</p>
    ${decks.length ? `<div class="panel"><table class="tbl"><thead><tr><th>行者</th><th>构成</th><th>导出</th></tr></thead><tbody>
      ${decks.map(d => { const s = deckStatus(d); return `<tr>
        <td><b>${esc(d.name)}</b></td>
        <td class="small">${s.kinds}/${DECK_TOTAL.kinds} 种 · ${s.cards}/${DECK_TOTAL.cards} 张 ${s.problems.length ? '<span class="tag red">不完整</span>' : '<span class="tag">完整</span>'}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-sm" data-exp-json="${d.id}">JSON</button>
          <button class="btn btn-sm" data-exp-tts="${d.id}">TTS 牌组</button>
          <button class="btn btn-sm" data-exp-txt="${d.id}">文本清单</button>
        </td></tr>`; }).join('')}
    </tbody></table></div>` : '<p class="muted">暂无构筑，先去角色创建。</p>'}
    <div class="panel"><h3 style="margin-bottom:8px">TTS 导出说明</h3>
      <p class="small" style="line-height:2">
        · <b>TTS 牌组 JSON</b>：生成 Tabletop Simulator 自定义牌组（Custom Deck）对象，卡图 URL 指向本站 <code>images/</code> 目录。
        在 TTS 中：_objects → Objects → Custom Deck / 或直接把 JSON 拖入 TTS 场景即可生成牌堆。<br>
        · 部署到 GitHub Pages 后，URL 自动指向 <code>https://&lt;用户名&gt;.github.io/&lt;仓库&gt;/images/…</code>；本地预览时为相对路径（TTS 需要在线 URL，请部署后使用）。<br>
        · <b>JSON</b>：结构化构筑数据（卡 ID、名称、数量、角色、属性），可被外部工具二次处理；与本站「导入备份」格式兼容。
      </p></div>`;
  v.querySelectorAll('[data-exp-json]').forEach(b => b.onclick = () => exportDeck(DB.decks.find(x => x.id === b.dataset.expJson), 'json'));
  v.querySelectorAll('[data-exp-tts]').forEach(b => b.onclick = () => exportDeck(DB.decks.find(x => x.id === b.dataset.expTts), 'tts'));
  v.querySelectorAll('[data-exp-txt]').forEach(b => b.onclick = () => exportDeck(DB.decks.find(x => x.id === b.dataset.expTxt), 'txt'));
}

/* 导出署名：登录用户带专属 ID，游客不署名 */
function exportBy() {
  const id = (typeof userPublicId === 'function' ? userPublicId() : '') || '';
  return id ? `by 【${id}】` : '';
}
function deckExportData(d) {
  const st = deckStatus(d);
  const cards = [...st.kindsSet].map(id => { const c = cardById(id); return { id, name: c.name, deck: c.deck, group: GROUPS[c.group], type: c.type, cost: c.cost, attr: c.attr, copies: 2, img: c.img }; });
  /* 角色牌：空白行者卡用本构筑的自定义内容（roleCustom） */
  const roleCard = cardById(d.steps.role);
  const ri = roleInfo(d);
  const role = roleCard && {
    name: ri.name, text: ri.text || null,
    attr: ri.attr && Object.keys(ri.attr).length ? ri.attr : undefined,
    img: ri.img || roleCard.img, custom: ri.custom || undefined,
  };
  return {
    format: 'earthborne-rangers-deck/v1',
    name: d.name, created: d.created,
    by: exportBy() || undefined,
    attribute: cardById(d.steps.attribute) && { name: cardById(d.steps.attribute).name, attr: cardById(d.steps.attribute).attr, img: cardById(d.steps.attribute).img },
    role,
    background: d.steps.background?.deck, expertise: d.steps.expertise?.deck,
    valid: st.problems.length === 0, problems: st.problems,
    deckCards: cards,
  };
}
function download(name, content, mime = 'application/json') {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
function ttsURL(rel) {
  if (!rel) return '';
  if (location.protocol.startsWith('http')) return new URL(rel, location.href).href;
  return rel;   // 本地 file:// 预览时 TTS 无法访问，部署后再导出
}
function exportDeck(d, mode) {
  if (!d) return;
  const data = deckExportData(d);
  const by = exportBy();
  const fname = `行者_${d.name}${by ? '_' + by.replace(/\s/g, '') : ''}`;
  if (mode === 'json' || !mode) {
    download(`${fname}_构筑.json`, JSON.stringify(data, null, 1));
    toast('已导出 JSON' + (by ? '（含署名）' : ''));
  } else if (mode === 'txt') {
    let t = `地缘行者 · 行者构筑：${d.name}${by ? '  ' + by : ''}\n${'='.repeat(32)}\n`;
    t += `属性牌：${data.attribute?.name || '—'}\n角色牌：${data.role?.name || '—'}\n`;
    t += `背景牌组：${data.background || '—'}　专长牌组：${data.expertise || '—'}\n\n牌库（每种 2 张）：\n`;
    const byDeck = {};
    data.deckCards.forEach(c => (byDeck[c.deck || GROUPS[c.group]] = byDeck[c.deck || GROUPS[c.group]] || []).push(c.name));
    for (const [dk, names] of Object.entries(byDeck)) t += `\n【${dk}】\n` + names.map(n => ` · ${n}`).join('\n') + '\n';
    t += `\n合计：${data.deckCards.length} 种 × 2 张 = ${data.deckCards.length * 2} 张\n`;
    if (data.problems.length) t += `\n⚠ 校验提示：\n` + data.problems.map(p => ` · ${p}`).join('\n');
    download(`${fname}_清单.txt`, t, 'text/plain');
    toast('已导出文本清单');
  } else {
    /* TTS Custom Deck：每 2 张同名合成 1 张正面（Face），用网格图坐标模拟 ——
       采用最简方案：单卡 Deck，ContainedObjects 每张牌一个 Card 自定义正面 */
    const mkCard = (c, i) => ({
      Name: 'Card', Nickname: `${c.name} ×2`,
      Transform: { posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 180, rotZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 },
      CustomDeck: { '1': { FaceURL: ttsURL(c.img), BackURL: ttsURL('images/t0000.webp'), NumWidth: 1, NumHeight: 1, BackIsHidden: true, UniqueBack: false } },
      DeckIDs: [2000 + i, 2000 + i],
    });
    const deck = {
      SaveName: fname, Date: new Date().toISOString(),
      ObjectStates: [{
        Name: 'Deck', Nickname: `${d.name} · 行者牌库${by ? ' ' + by : ''}`,
        Transform: { posX: 0, posY: 1, posZ: 0, rotX: 0, rotY: 180, rotZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 },
        ContainedObjects: data.deckCards.map(mkCard),
        DeckIDs: data.deckCards.flatMap((c, i) => [2000 + i, 2000 + i]),
        CustomDeck: Object.fromEntries(data.deckCards.map((c, i) => [String(2000 + i), {
          FaceURL: ttsURL(c.img), BackURL: ttsURL('images/t0000.webp'),
          NumWidth: 1, NumHeight: 1, BackIsHidden: true, UniqueBack: false }])),
      }],
    };
    download(`${fname}_TTS.json`, JSON.stringify(deck, null, 1));
    toast(location.protocol.startsWith('http') ? '已导出 TTS 牌组 JSON' : '已导出（注意：本地预览的图片 URL 需部署后可用）');
  }
}

/* ================= 8) 个人中心（账号 / 云同步 / 手动导入导出） ================= */
function account(v) {
  const email = userEmail();
  const masked = email ? email.replace(/^(.{1,3}).*(@.*)$/, '$1***$2') : '—';
  const offline = !isSignedIn();
  v.innerHTML = `
    <h2 class="page-title">个人中心</h2>
    <p class="page-sub">${offline ? '离线模式（本机工作区）' : '账号信息 · 云端同步 · 数据备份'}</p>

    ${offline ? `<div class="panel" style="border-color:#c98b2e">
      <h3 style="margin-bottom:8px">未连接云端</h3>
      <p class="small muted">当前为离线模式：卡牌数据存于本机浏览器，构筑与导出可正常使用，
      但换设备/清缓存会丢失。请用下方「导出备份 JSON」定期备份，或改用支持云端的正式域名访问。</p>
    </div>` : `
    <div class="panel">
      <h3 style="margin-bottom:10px">个人信息</h3>
      <label class="field">
        <span class="field-label">显示名称</span>
        <input id="acc-name" class="input" type="text" maxlength="24"
               placeholder="留空则用邮箱前缀" value="${esc(userDisplayName())}">
      </label>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button class="btn btn-primary" id="acc-save-name">保存名称</button>
        <span id="acc-name-msg" class="small muted"></span>
      </div>
    </div>

    <div class="panel">
      <h3 style="margin-bottom:10px">账号</h3>
      <table class="tbl"><tbody>
        <tr><th style="width:120px">专属 ID</th><td>
          <code id="acc-pid">${esc(userPublicId() || '分配中…')}</code>
          <button class="btn btn-sm" id="acc-pid-copy" style="margin-left:8px">复制</button>
          ${userPublicId() ? '' : '<button class="btn btn-sm" id="acc-pid-retry" style="margin-left:6px">重新分配</button>'}
          <div class="small muted" style="margin-top:4px">${userPublicId()
            ? '导出的卡组会署名「by 【' + esc(userPublicId()) + '】」'
            : '尚未取到专属 ID（多因会话未与云端确认），可点「重新分配」重试'}</div>
        </td></tr>
        <tr><th>邮箱</th><td>${esc(masked)}</td></tr>
        <tr><th>密码</th><td>
          <button class="btn btn-sm" id="acc-chgpwd">修改密码</button>
          <div class="small muted" style="margin-top:4px">修改前会向邮箱 ${esc(masked)} 发一封验证码，
            填对验证码后即可设置新密码（无需旧密码）。</div>
        </td></tr>
        <tr><th>会话状态</th><td>${
          sessionState() === 'ok' ? '<span class="tag">✔ 云端已确认</span>'
            : sessionState() === 'restoring'
              ? '<span class="tag amber">⚠ 仅本机缓存，未与云端确认</span> <button class="btn btn-sm" id="acc-reconnect" style="margin-left:6px">重新连接</button>'
              : '<span class="tag gray">离线</span>'}</td></tr>
        <tr><th>角色</th><td><span class="tag${isAdmin() ? '' : userRole() === 'beta' ? ' blue' : ''}">${esc(ROLE_NAME[userRole()] || userRole())}</span>
          ${userRole() === 'beta' ? '<span class="small muted" style="margin-left:6px">可使用内测功能</span>' : ''}</td></tr>
        <tr><th>可见模块</th><td>${esc(ROUTE_META.filter(m => canSee(m.key)).map(m => m.label).join(' · ') || '（无）')}</td></tr>
        <tr><th>本机缓存</th><td>${esc(slotKey())}</td></tr>
        <tr><th>最近登录</th><td>${esc(PROFILE?.last_login_at ? String(PROFILE.last_login_at).slice(0, 16).replace('T', ' ') : '—')}</td></tr>
        <tr><th>累计登录</th><td>${PROFILE?.login_count ?? 0} 次${PROFILE?.invite_code ? ` · 邀请码 <code>${esc(PROFILE.invite_code)}</code>` : ''}</td></tr>
      </tbody></table>
      <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" id="acc-signout">退出登录</button>
      </div>
    </div>`}

    ${!offline ? `
    <div class="panel">
      <h3 style="margin-bottom:10px">云端同步</h3>
      <p class="small muted" style="margin-bottom:10px">
        已登录状态下，构筑与收藏会自动保存到云端（约 1 秒防抖）。换设备登录后自动读取。
        当前状态：<b id="acc-sync">${SYNC_TEXT[SYNC_STATE] || SYNC_STATE}</b>
      </p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-primary" id="acc-push">立即上传到云端</button>
        <button class="btn" id="acc-pull">从云端覆盖本机</button>
      </div>
    </div>` : ''}

    ${!offline ? `
    <div class="panel">
      <h3 style="margin-bottom:10px">🎟 内测邀请码</h3>
      <p class="small muted" style="margin-bottom:10px">
        已有账号也能随时兑换：填入邀请码后角色立即升级（内测 / 管理员由邀请码决定，不会降级）。
        ${PROFILE?.invite_code ? `当前已绑定：<code>${esc(PROFILE.invite_code)}</code>` : '当前账号还没有绑定邀请码。'}
      </p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <input type="text" id="acc-invite" class="input" style="min-width:150px;text-transform:uppercase"
               placeholder="邀请码" autocomplete="off">
        <button class="btn btn-primary" id="acc-invite-go">兑换</button>
        <span class="small muted" id="acc-invite-msg"></span>
      </div>
    </div>` : ''}

    <div class="panel">
      <h3 style="margin-bottom:10px">界面配色</h3>
      <p class="small muted" style="margin-bottom:10px">调整全站配色（只影响你本机，随档案保存在本机；换设备需在新的设备上重新设置）。</p>
      <div class="field-row">
        <span class="field-label">预设主题</span>
        <div class="th-presets">
          ${Object.entries(THEME_PRESETS).map(([k, p]) =>
            `<button class="btn btn-sm th-preset" data-thp="${k}" title="${esc(p.label)}">${esc(p.label)}</button>`).join('')}
        </div>
      </div>
      <div class="field-row">
        <span class="field-label">明暗</span>
        <div class="th-presets">
          ${[['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(([k, n]) =>
            `<button class="btn btn-sm th-mode" data-thm="${k}">${n}</button>`).join('')}
        </div>
      </div>
      <div class="th-picks">
        ${THEME_PICK.map(([k, n]) => `<label class="th-pick">
          <input type="color" data-thv="${k}" value="${esc(themePickVal(k))}">
          <span>${esc(n)}</span></label>`).join('')}
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;align-items:center">
        <button class="btn btn-primary" id="th-apply">应用自定义配色</button>
        <button class="btn" id="th-reset">恢复默认</button>
        <span class="small muted" id="th-msg">当前：${esc(themeName(themeOf()))} · ${{ auto: '跟随系统', light: '浅色', dark: '深色' }[themeOf().mode || 'auto']}</span>
      </div>
    </div>

    <div class="panel">
      <h3 style="margin-bottom:10px">手动导出 / 导入（离线端口）</h3>
      <p class="small muted" style="margin-bottom:10px">
        云端不可用或需要搬家时，用备份 JSON 搬运。备份包含收藏、自定义卡、字段修正与全部构筑。
      </p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" id="acc-export">导出备份 JSON</button>
        <button class="btn" id="acc-import">导入备份</button>
        <input type="file" id="acc-file" accept=".json" class="hidden">
      </div>
    </div>

    <div class="panel">
      <h3 style="margin-bottom:10px">连接诊断</h3>
      <p class="small muted" style="margin-bottom:10px">
        注册/同步出问题时，点「复制诊断信息」把结果发我即可定位。快捷键 Ctrl+Shift+D 可打开完整诊断面板查看原文。
      </p>
      <pre id="acc-diag" class="hidden" style="white-space:pre-wrap;font-size:11.5px;line-height:1.7;
        background:var(--panel2);padding:10px 12px;border-radius:8px;margin:0 0 10px"></pre>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" id="acc-diag-copy">复制诊断信息</button>
        <button class="btn" id="acc-diag-refresh">重新检测</button>
      </div>
    </div>`;

  /* 界面配色 */
  const thMsg = v.querySelector('#th-msg');
  const thSync = () => {
    const t = themeOf();
    v.querySelectorAll('[data-thp]').forEach(b => b.classList.toggle('active', b.dataset.thp === t.preset));
    v.querySelectorAll('[data-thm]').forEach(b => b.classList.toggle('active', b.dataset.thm === (t.mode || 'auto')));
    thMsg.textContent = `当前：${themeName(t)} · ${{ auto: '跟随系统', light: '浅色', dark: '深色' }[t.mode || 'auto']}`;
  };
  v.querySelectorAll('[data-thp]').forEach(b => b.onclick = () => {
    saveTheme({ preset: b.dataset.thp, mode: THEME_PRESETS[b.dataset.thp].mode, vars: {} });
    thSync(); account(v); toast('主题已应用');
  });
  v.querySelectorAll('[data-thm]').forEach(b => b.onclick = () => {
    const t = themeOf();
    saveTheme({ ...t, mode: b.dataset.thm });
    thSync(); toast('已切换明暗');
  });
  v.querySelector('#th-apply').onclick = () => {
    const vars = {};
    v.querySelectorAll('[data-thv]').forEach(i => { vars[i.dataset.thv] = i.value; });
    saveTheme({ preset: 'custom', mode: themeOf().mode || 'auto', vars });
    account(v); toast('自定义配色已应用');
  };
  v.querySelector('#th-reset').onclick = () => {
    saveTheme({ preset: 'moss', mode: 'auto', vars: {} });
    account(v); toast('已恢复默认配色');
  };
  thSync();

  const drawDiag = () => { const el = v.querySelector('#acc-diag'); if (el) el.textContent = JSON.stringify(cloudDiag(), null, 1); };
  drawDiag();
  v.querySelector('#acc-diag-copy').onclick = () => {
    navigator.clipboard?.writeText(JSON.stringify(cloudDiag(), null, 1));
    toast('诊断信息已复制');
  };
  v.querySelector('#acc-diag-refresh').onclick = async () => {
    if (cloudOn()) { await cloudProbe(); if (isSignedIn()) await cloudLoadProfile(); }
    drawDiag(); renderSyncBadge(); toast('已重新检测');
  };

  const so = v.querySelector('#acc-signout');
  if (so) so.onclick = doSignOut;

  /* v39：修改密码 —— 邮箱验证码 + 新密码，站内一次完成 */
  const cp = v.querySelector('#acc-chgpwd');
  if (cp) cp.onclick = () => openPwdFlow('change');

  /* 保存显示名称 */
  const sbn = v.querySelector('#acc-save-name');
  if (sbn) sbn.onclick = async () => {
    const val = v.querySelector('#acc-name').value.trim();
    const msg = v.querySelector('#acc-name-msg');
    msg.textContent = '正在保存…';
    const r = await cloudSetDisplayName(val);
    if (r.error) { msg.textContent = '保存失败：' + r.error.message; msg.style.color = 'var(--red)'; return; }
    msg.textContent = '已保存'; msg.style.color = 'var(--green)';
    renderTopRight(); toast('显示名称已更新');
  };
  const nm = v.querySelector('#acc-name');
  if (nm) nm.addEventListener('keydown', e => { if (e.key === 'Enter') sbn && sbn.click(); });
  const pr = v.querySelector('#acc-pid-retry');
  if (pr) pr.onclick = async () => {
    pr.disabled = true; pr.textContent = '分配中…';
    const id = await cloudEnsurePublicId();
    if (id) { toast('已分配专属 ID：' + id); renderRoute(); }
    else { toast('分配失败：' + (LAST_ERROR?.message || '会话未确认，请先重新连接')); pr.disabled = false; pr.textContent = '重新分配'; renderRoute(); }
  };
  const arc = v.querySelector('#acc-reconnect');
  if (arc) arc.onclick = async () => {
    arc.disabled = true; arc.textContent = '连接中…';
    const r = await cloudReconnect();
    toast(r.ok ? '已重新连接云端' : ('重连失败：' + r.msg), 3000);
    renderTopRight(); renderSidenav(); renderSessionBar(); renderRoute();
  };
  const pc = v.querySelector('#acc-pid-copy');
  if (pc) pc.onclick = () => {
    const id = v.querySelector('#acc-pid').textContent.trim();
    navigator.clipboard?.writeText(id); toast('ID 已复制：' + id);
  };
  const ap = v.querySelector('#acc-push');
  if (ap) ap.onclick = async () => {
    const ok = await cloudPush(DB); renderSyncBadge();
    v.querySelector('#acc-sync').textContent = SYNC_TEXT[SYNC_STATE];
    toast(ok ? '已上传到云端' : '上传失败，请检查网络');
  };
  const apu = v.querySelector('#acc-pull');
  if (apu) apu.onclick = async () => {
    await tryPullFromCloud(true); renderSyncBadge(); renderRoute(); toast('已用云端数据覆盖本机');
  };
  const aig = v.querySelector('#acc-invite-go');
  if (aig) aig.onclick = async () => {
    const inp = v.querySelector('#acc-invite'), msg = v.querySelector('#acc-invite-msg');
    const code = (inp?.value || '').trim();
    if (!code) { msg.textContent = '请填写邀请码'; return; }
    aig.disabled = true; aig.textContent = '兑换中…'; msg.textContent = '正在校验…';
    const r = await redeemInviteFlow(code);
    msg.textContent = r.msg;
    aig.disabled = false; aig.textContent = '兑换';
    if (r.ok) {
      inp.value = '';
      toast(r.msg, 3200);
      /* 面板里的「已绑定 / 角色」就地更新，不整页重绘（避免输入框被重建） */
      const note = v.querySelector('#acc-invite')?.closest('.panel')?.querySelector('p.small');
      if (note) note.innerHTML = `已绑定：<code>${esc(inp.dataset.used || code)}</code> · 当前角色「${esc(ROLE_NAME[userRole()] || userRole())}」`;
    }
  };
  v.querySelector('#acc-export').onclick = exportAllData;
  const fi = v.querySelector('#acc-file');
  v.querySelector('#acc-import').onclick = () => fi.click();
  fi.onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try { DB = { ...blankDB(), ...JSON.parse(rd.result) }; saveDB(); toast('导入成功'); renderRoute(); }
      catch { toast('文件解析失败'); }
    };
    rd.readAsText(f);
  };
}

/* 功能开关面板（后台管理） */
function renderFeaturePanel(v) {
  const box = v.querySelector('#adm-feat');
  if (!box) return;
  box.innerHTML = `
    <h3 style="margin-bottom:8px">功能开关</h3>
    ${OFFLINE_MODE ? `<p class="small" style="margin-bottom:10px;padding:8px 10px;border-radius:8px;
        background:rgba(196,146,66,.12);color:var(--ink2)">
      📴 离线版没有服务端：这里的开关<b>只读</b>（改动无法保存到任何地方）。下表显示的是随包发布的默认值，
      目前全部开放；要改默认值请直接改 <code>app.js</code> 的 <code>FEATURE_DEFS</code> 后重新打包。</p>` : ''}
    <p class="small muted" style="margin-bottom:10px">
      分为两大母选项：<b>🃏 卡牌管理系统</b> 与 <b>🗺️ 战役管理系统</b>（各自带总开关与最低权限）；
      <b>个人中心</b>、<b>后台管理</b> 独立于母选项之外，不可关闭，以免把自己关在门外。<br>
      母选项关闭后，其下所有子项一律不可用（子项自身设置会保留，重新打开即恢复）。保存后立即对所有人生效，无需重新部署。<br>
      要给<b>单个账号</b>单独放行 / 拒绝某个模块（不计其角色），在下方「账号管理」每行点 <b>权限</b>。
    </p>
    <table class="tbl tbl-feat"><thead><tr>
      <th>模块</th><th style="width:82px">开放</th><th style="width:150px">最低可见权限</th><th>说明</th>
    </tr></thead><tbody>
    ${FEATURE_ROWS.map(m => {
      const f = featureState(m.key);
      const pKey = m.parent;
      const pOff = pKey ? !featureSelfOn(pKey) : false;      // 母选项已关 → 子项不可操作
      const locked = FEATURE_LOCKED.has(m.key);
      const isParent = m.depth === 0 && FEATURE_GROUPS.some(g => g.key === m.key && g.children.length);
      return `<tr class="${m.depth ? 'feat-child' : 'feat-parent'}${isParent ? ' feat-group' : ''}${pOff ? ' feat-muted' : ''}">
        <td>${m.depth ? '<span class="feat-indent">└</span>' : ''}${m.icon} ${esc(f.label)}
          ${isParent ? '<span class="tag gray">母选项</span>' : ''}
          ${f.override === true ? '<div class="small" style="color:var(--green)">✅ 你被单独放行</div>' : ''}
          ${f.override === false ? '<div class="small" style="color:var(--red)">⛔ 你被单独拒绝</div>' : ''}
          ${pOff ? `<div class="small" style="color:var(--red)">母选项「${esc(FEATURE_DEFS[pKey]?.label || pKey)}」已关闭，本项暂不可用</div>` : ''}</td>
        <td>${locked
          ? '<span class="tag">常开</span>'
          : `<label class="sw"><input type="checkbox" data-fen="${esc(m.key)}" ${f.enabled ? 'checked' : ''}><span></span></label>`}</td>
        <td><select data-fmin="${esc(m.key)}" ${f.enabled ? '' : 'disabled'} style="width:100%">
          ${['guest', 'user', 'beta', 'admin'].map(k =>
            `<option value="${k}" ${f.min === k ? 'selected' : ''}>${ROLE_NAME[k]}</option>`).join('')}
        </select></td>
        <td class="small muted">${esc(FEATURE_HINT[m.key] || '')}${f.fromCloud ? '' : ' · 未配置（用默认值）'}</td>
      </tr>`;
    }).join('')}
    </tbody></table>`;

  const save = async (key, enabled, min) => {
    const r = await adminSetFeature(key, FEATURE_DEFS[key]?.label || key, enabled, min);
    if (r.error) { toast('保存失败：' + (r.error.message || ''), 3600); return false; }
    renderSidenav(); applyCampGates(); renderFeaturePanel(v);
    toast('已保存，全站即时生效');
    return true;
  };
  box.querySelectorAll('[data-fen]').forEach(cb => cb.onchange = () => {
    const key = cb.dataset.fen;
    const f = featureState(key);
    save(key, cb.checked, f.min);
  });
  box.querySelectorAll('[data-fmin]').forEach(sel => sel.onchange = () => {
    const key = sel.dataset.fmin;
    save(key, featureState(key).enabled, sel.value);
  });
}

/* ---------------- v33：后台「卡牌图集权限」面板（每种卡牌单独设定） ---------------- */
function renderCardPermPanel(v) {
  const box = v.querySelector('#adm-cardperm');
  if (!box) return;
  const builtin = window.BOOKS || (typeof BOOKS !== 'undefined' ? BOOKS : []);
  const infoOf = id => builtin.find(x => x.id === id);
  const parentOff = !featureSelfOn('textsys');
  const onN = CARD_BOOK_DEFS.filter(c => featureSelfOn(CARD_PERM_KEY(c.id))).length;

  box.innerHTML = `
    <h3 style="margin-bottom:8px">卡牌图集权限（每种卡牌单独设定）</h3>
    <p class="small muted" style="margin-bottom:10px">
      文本查询系统里每一种卡牌图集都有<b>独立的可见权限</b>：可以整类关闭，也可以设定「最低可见角色」
      （游客 / 登录用户 / 内测 / 管理员）。关闭后，该类卡牌在侧栏「卡牌图集」分组里消失，也<b>不会被检索到</b>。<br>
      目前开放 <b>${onN} / ${CARD_BOOK_DEFS.length}</b> 类${parentOff
        ? '　<span style="color:var(--red)">（母选项「📖 文本查询系统」已关闭，以下设置暂不生效）</span>' : ''}
    </p>
    <table class="tbl"><thead><tr>
      <th>卡牌图集</th><th style="width:82px">开放</th><th style="width:150px">最低可见权限</th><th>收录</th>
    </tr></thead><tbody>
    ${CARD_BOOK_DEFS.map(c => {
      const key = CARD_PERM_KEY(c.id);
      const f = featureState(key);
      const b = infoOf(c.id);
      const n = b ? (b.count || (b.pages || []).length) : 0;
      return `<tr class="feat-child${parentOff ? ' feat-muted' : ''}">
        <td>${c.icon} ${esc(c.label)}
          <div class="small muted">${esc(b && b.note ? b.note : '—')}</div></td>
        <td><label class="sw"><input type="checkbox" data-cen="${esc(c.id)}" ${f.enabled ? 'checked' : ''}><span></span></label></td>
        <td><select data-cmin="${esc(c.id)}" ${f.enabled ? '' : 'disabled'} style="width:100%">
          ${['guest', 'user', 'beta', 'admin'].map(k =>
            `<option value="${k}" ${f.min === k ? 'selected' : ''}>${ROLE_NAME[k]}</option>`).join('')}
        </select></td>
        <td class="small muted">${n} 张${f.fromCloud ? '' : ' · 未配置（默认游客可见）'}</td>
      </tr>`;
    }).join('')}
    </tbody></table>`;

  const save = async (id, enabled, min) => {
    const key = CARD_PERM_KEY(id);
    const def = CARD_BOOK_DEFS.find(c => c.id === id);
    const r = await adminSetFeature(key, def ? def.label : id, enabled, min);
    if (r.error) { toast('保存失败：' + (r.error.message || ''), 3600); return; }
    /* 文本系统已打开就立刻重绘（可见的卡牌马上出现 / 消失） */
    try { if (window.TextApp && window.TextApp.ready && window.TextApp.reload) window.TextApp.reload(); } catch (e) { /* 忽略 */ }
    renderCardPermPanel(v);
    toast(`已保存：${def ? def.label : id} → ${enabled ? '开放（最低 ' + (ROLE_NAME[min] || min) + '）' : '关闭'}`, 2600);
  };
  box.querySelectorAll('[data-cen]').forEach(cb => cb.onchange = () => {
    const id = cb.dataset.cen;
    save(id, cb.checked, featureState(CARD_PERM_KEY(id)).min);
  });
  box.querySelectorAll('[data-cmin]').forEach(sel => sel.onchange = () => {
    const id = sel.dataset.cmin;
    save(id, featureState(CARD_PERM_KEY(id)).enabled, sel.value);
  });
}

/* ---------------- v31：后台「书籍信息推送」面板 ---------------- */
async function renderBooksPanel(v) {
  const box = v.querySelector('#adm-books');
  if (!box) return;
  const f = featureState('textsys.metaedit');
  const rows = Object.entries(BOOK_META || {}).map(([id, m]) => ({ id, ...m }));
  const builtin = window.BOOKS || (typeof BOOKS !== 'undefined' ? BOOKS : []);
  const nameOf = id => {
    const b = builtin.find(x => x.id === id);
    return b ? (b._o ? b._o.title : b.title) : id;
  };

  box.innerHTML = `
    <h3 style="margin-bottom:8px">书籍信息推送（书名 / 类别标签）</h3>
    <p class="small muted" style="margin-bottom:10px">
      文本查询系统里每本书的<b>书名</b>与<b>类别标签（Tag）</b>可以由管理员直接改：开启下面的开关后，
      管理员在文本查询系统里点书名旁的 <b>✎</b> 即可编辑，保存后<b>立即推送给所有用户</b>（无需重新部署）。
      关掉开关，任何人都看不到编辑入口，界面回到只读。
    </p>
    <div class="bk-push">
      <label class="sw big"><input id="bk-push" type="checkbox" ${f.enabled ? 'checked' : ''}><span></span></label>
      <div class="bk-push-txt">
        <b>启用「书名 / 类别编辑并推送全站」</b>
        <div class="small muted">最低权限：${esc(ROLE_NAME[f.min] || f.min)}　·　${f.fromCloud ? '已在云端配置' : '未配置（用默认值）'}</div>
      </div>
      <span class="flex-spacer"></span>
      <span class="small muted" id="bk-msg"></span>
    </div>
    <h4 class="ver-sub">已推送的书籍信息（${rows.length}）</h4>
    <div class="bk-list">${rows.length ? rows.map(r => {
      const d = r.updated_at ? new Date(r.updated_at) : null;
      const ds = d && !isNaN(d.getTime())
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
        : '—';
      return `<div class="bk-item" data-bid="${esc(r.id)}">
        <div class="bk-item-head">
          <span class="tag blue">${esc(r.kind || '（未改类别）')}</span>
          <b>${esc(r.title || '（未改书名）')}</b>
          <span class="small muted">原书名：${esc(nameOf(r.id))}</span>
          <span class="small muted">${esc(ds)}</span>
          <span class="flex-spacer"></span>
          <button class="btn btn-sm danger" data-bdel="${esc(r.id)}">恢复内置</button>
        </div>
      </div>`;
    }).join('') : '<p class="small muted">还没有推送过任何书籍信息（当前全部显示内置书名与类别）。</p>'}</div>`;

  const msg = box.querySelector('#bk-msg');
  box.querySelector('#bk-push').onchange = async e => {
    const on = e.target.checked;
    msg.textContent = '保存中…';
    const r = await adminSetFeature('textsys.metaedit', FEATURE_DEFS['textsys.metaedit']?.label || '书籍信息编辑与推送', on, f.min);
    if (r.error) { msg.textContent = '保存失败：' + (r.error.message || ''); msg.style.color = 'var(--red)'; return; }
    toast(on ? '已开启：管理员可在文本查询系统里改书名 / 类别并推送全站' : '已关闭：编辑入口已隐藏', 3200);
    /* 立刻刷新已打开的文本系统，编辑入口马上显示 / 隐藏 */
    try { if (window.TextApp && window.TextApp.ready) window.TextApp.applyMeta(); } catch (e) { /* 忽略 */ }
    renderBooksPanel(v);
  };
  box.querySelectorAll('[data-bdel]').forEach(btn => btn.onclick = async () => {
    const id = btn.dataset.bdel;
    const res = await adminClearBookMeta(id);
    if (res.error) { toast('操作失败：' + (res.error.message || ''), 3200); return; }
    toast('已恢复内置书名 / 类别', 2400);
    renderBooksPanel(v);
  });
}

/* 后台：账号批量编辑 */
let ADMIN_USERS = [];
/* 后台「账号管理」的排序 / 筛选状态（模块级：重绘后保留） */
const ADMIN_UI = { sort: 'created_at', dir: 'desc', type: 'all', q: '' };
function parseEmails(s) {
  return [...new Set(String(s || '').split(/[\s,;，；\n\r]+/).map(x => x.trim()).filter(x => x.includes('@')))];
}
function renderBatchPanel(v) {
  const box = v.querySelector('#adm-batch');
  if (!box) return;
  box.innerHTML = `
    <h3 style="margin-bottom:8px">账号批量编辑</h3>
    <p class="small muted" style="margin-bottom:10px">每行一个邮箱（也支持逗号 / 空格分隔）；未匹配到邮箱的账号会被跳过。</p>
    <textarea id="bm-emails" rows="5" placeholder="you@example.com&#10;friend@example.com"
      style="width:100%;box-sizing:border-box;padding:8px 10px;font-size:13px;border:1px solid var(--line);
      border-radius:8px;background:var(--panel2);color:var(--ink);font-family:inherit"></textarea>
    <div class="proof-bar" style="padding:10px 0">
      <select id="bm-act" style="min-width:140px">
        <option value="beta">设为内测账号</option>
        <option value="admin">设为管理员</option>
        <option value="user">设为普通用户</option>
      </select>
      <button class="btn btn-primary btn-sm" id="bm-run">执行批量修改</button>
      <span class="small muted" id="bm-msg"></span>
      <span class="flex-spacer"></span>
      <span class="small muted">快捷填充：</span>
      <button class="btn btn-sm" data-bmf="all">全部账号</button>
      <button class="btn btn-sm" data-bmf="user">当前普通用户</button>
      <button class="btn btn-sm" data-bmf="beta">当前内测</button>
      <button class="btn btn-sm" data-bmf="admin">当前管理员</button>
      <button class="btn btn-sm" data-bmf="never">从未登录</button>
    </div>`;

  const ta = box.querySelector('#bm-emails');
  const msg = box.querySelector('#bm-msg');
  box.querySelectorAll('[data-bmf]').forEach(b => b.onclick = () => {
    const f = b.dataset.bmf;
    const pick = ADMIN_USERS.filter(r => {
      if (!r.email) return false;
      if (f === 'all') return true;
      if (f === 'never') return !r.last_login_at;
      return (r.role || 'user') === f;
    }).map(r => r.email);
    ta.value = pick.join('\n');
    msg.textContent = `已填充 ${pick.length} 个邮箱`;
  });
  box.querySelector('#bm-run').onclick = async () => {
    const emails = parseEmails(ta.value);
    if (!emails.length) { msg.textContent = '请填写至少一个邮箱'; return; }
    const act = box.querySelector('#bm-act');
    const roleName = { beta: '内测账号', admin: '管理员', user: '普通用户' }[act.value];
    if (!confirm(`把 ${emails.length} 个账号设为「${roleName}」？`)) return;
    msg.textContent = '执行中…';
    const r = await adminBatchSetRole(emails, act.value);
    if (r.error) { msg.textContent = '失败：' + (r.error.message || ''); return; }
    msg.textContent = `完成：实际变更 ${r.data} 个账号（其余已是该角色或邮箱未匹配）`;
    toast(`批量完成：实际变更 ${r.data} 个账号`, 3200);
    renderRoute();          // v41：回到当前子页（批量编辑页自身）
  };
}

/* 后台：内测邀请码 */
async function renderInvitePanel(v) {
  const box = v.querySelector('#adm-invite');
  if (!box) return;
  box.innerHTML = `
    <h3 style="margin-bottom:8px">内测邀请码</h3>
    <p class="small muted" style="margin-bottom:10px">
      注册时在登录框填入邀请码，账号会自动升级为对应角色（默认内测账号）。使用上限 0 表示不限次数。
    </p>
    <div class="proof-bar" style="padding:0 0 10px">
      <input type="text" id="iv-code" placeholder="邀请码，如 BETA2026" style="min-width:150px;text-transform:uppercase">
      <input type="text" id="iv-label" placeholder="备注（可空）" style="min-width:130px">
      <select id="iv-role" style="min-width:120px">
        <option value="beta">授予：内测账号</option>
        <option value="admin">授予：管理员</option>
        <option value="user">授予：普通用户</option>
      </select>
      <input type="number" id="iv-max" min="0" placeholder="上限" style="width:88px" title="0 = 不限次数">
      <label class="pf-check"><input type="checkbox" id="iv-active" checked> 启用</label>
      <button class="btn btn-primary btn-sm" id="iv-add">新增 / 更新</button>
      <button class="btn btn-sm" id="iv-rand">随机生成</button>
      <span class="small muted" id="iv-msg"></span>
    </div>
    <div id="iv-list"><p class="muted small">正在加载…</p></div>`;

  const msg = box.querySelector('#iv-msg');
  box.querySelector('#iv-rand').onclick = () => {
    const abc = 'ACDEFGHJKLMNPQRTUVWXY3479';
    let s = 'EBR-';
    for (let i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
    box.querySelector('#iv-code').value = s;
  };
  box.querySelector('#iv-add').onclick = async () => {
    const code = box.querySelector('#iv-code').value.trim();
    if (!code) { msg.textContent = '请填写邀请码'; return; }
    const r = await adminUpsertInvite(code,
      box.querySelector('#iv-label').value.trim(),
      box.querySelector('#iv-role').value,
      Number(box.querySelector('#iv-max').value) || 0,
      box.querySelector('#iv-active').checked);
    if (r.error) { msg.textContent = '失败：' + (r.error.message || ''); return; }
    msg.textContent = r.data === 'ok' ? '已保存' : r.data;
    box.querySelector('#iv-code').value = ''; box.querySelector('#iv-label').value = '';
    renderInvitePanel(v);
  };

  const list = await adminListInvites();
  const el = box.querySelector('#iv-list');
  if (list.error) { el.innerHTML = `<p class="small" style="color:var(--red)">读取失败：${esc(list.error.message || '')}</p>`; return; }
  const rows = list.data || [];
  el.innerHTML = rows.length ? `<table class="tbl"><thead><tr>
      <th>邀请码</th><th>备注</th><th style="width:110px">授予角色</th><th style="width:90px">已用 / 上限</th>
      <th style="width:70px">状态</th><th style="width:150px">创建时间</th><th style="width:150px">操作</th></tr></thead><tbody>
    ${rows.map(c => `<tr>
      <td><code>${esc(c.code)}</code></td>
      <td class="small muted">${esc(c.label || '—')}</td>
      <td>${esc(ROLE_NAME[c.grant_role] || c.grant_role)}</td>
      <td>${c.uses} / ${c.max_uses > 0 ? c.max_uses : '∞'}</td>
      <td>${c.active ? '<span class="tag">启用</span>' : '<span class="tag gray">停用</span>'}</td>
      <td class="small muted">${esc(String(c.created_at || '').slice(0, 16).replace('T', ' '))}</td>
      <td>
        <button class="btn btn-sm" data-ivtog="${esc(c.code)}" data-active="${c.active ? '0' : '1'}">${c.active ? '停用' : '启用'}</button>
        <button class="btn btn-sm" data-ivcopy="${esc(c.code)}">复制</button>
        <button class="btn btn-sm btn-danger" data-ivdel="${esc(c.code)}">删除</button>
      </td></tr>`).join('')}
    </tbody></table>` : '<p class="muted small">还没有邀请码。可点击「随机生成」快速创建一个。</p>';

  el.querySelectorAll('[data-ivtog]').forEach(b => b.onclick = async () => {
    const c = rows.find(x => x.code === b.dataset.ivtog); if (!c) return;
    await adminUpsertInvite(c.code, c.label, c.grant_role, c.max_uses, b.dataset.active === '1');
    renderInvitePanel(v);
  });
  el.querySelectorAll('[data-ivcopy]').forEach(b => b.onclick = () => {
    navigator.clipboard?.writeText(b.dataset.ivcopy); toast('邀请码已复制：' + b.dataset.ivcopy);
  });
  el.querySelectorAll('[data-ivdel]').forEach(b => b.onclick = async () => {
    if (!confirm(`确定删除邀请码「${b.dataset.ivdel}」？已用记录会一并消失。`)) return;
    const r = await adminDeleteInvite(b.dataset.ivdel);
    if (r.error) { toast('删除失败：' + (r.error.message || '')); return; }
    toast('已删除'); renderInvitePanel(v);
  });
}

/* 后台：登录记录 */
async function renderLoginPanel(v, limit) {
  const box = v.querySelector('#adm-logins');
  if (!box) return;
  const lim = limit || Number(box.querySelector('#lg-limit')?.value) || 50;
  box.innerHTML = `
    <h3 style="margin-bottom:8px">登录记录</h3>
    <div class="proof-bar" style="padding:0 0 10px">
      <span class="small muted">最近</span>
      <select id="lg-limit" style="min-width:90px">
        ${[20, 50, 100, 300].map(n => `<option value="${n}" ${lim === n ? 'selected' : ''}>${n} 条</option>`).join('')}
      </select>
      <button class="btn btn-sm" id="lg-refresh">刷新</button>
      <span class="small muted" id="lg-msg"></span>
    </div>
    <div id="lg-list"><p class="muted small">正在加载…</p></div>`;
  box.querySelector('#lg-limit').onchange = () => renderLoginPanel(v);
  box.querySelector('#lg-refresh').onclick = () => renderLoginPanel(v);

  const r = await adminRecentLogins(lim);
  const el = box.querySelector('#lg-list');
  if (r.error) { el.innerHTML = `<p class="small" style="color:var(--red)">读取失败：${esc(r.error.message || '')}</p>`; return; }
  const rows = r.data || [];
  el.innerHTML = rows.length ? `<table class="tbl"><thead><tr>
      <th style="width:180px">时间</th><th>邮箱</th><th>设备 / 浏览器</th></tr></thead><tbody>
    ${rows.map(l => `<tr>
      <td class="small muted">${esc(String(l.at || '').slice(0, 16).replace('T', ' '))}</td>
      <td>${esc(l.email || '(未记录)')}</td>
      <td class="small muted" title="${esc(l.ua || '')}">${esc(String(l.ua || '—').slice(0, 60))}</td>
    </tr>`).join('')}
    </tbody></table>` : '<p class="muted small">暂无登录记录（新功能上线后登录才会记录）。</p>';
  box.querySelector('#lg-msg').textContent = `共 ${rows.length} 条`;
}

/* ================= 9) 后台管理（仅管理员） ================= */
/* ---------------- v41：后台管理 · 多级结构 ----------------
 * 原来是 10 个面板堆在同一个长页面里，一进去就要把它们全部拉一遍；
 * 现在改成「概览 + 左侧分组导航 + 右侧单页内容」的三级结构：
 *   #admin          → 概览（统计卡片 + 快捷入口）
 *   #admin/<key>    → 对应子页，如 #admin/users、#admin/feat
 * 每个子页只渲染自己那一块。URL 可直达 / 可刷新 / 可浏览器前进后退。
 * 各 render*Panel(v) 仍按 id 找自己的容器（#adm-<key>），因此零改动即可复用。 */
const ADMIN_PAGES = [
  { key: 'overview', icon: '🏠', label: '概览',         group: '',           hint: '站点数据概览与快捷入口',           render: renderOverviewPanel },
  { key: 'feat',     icon: '🎛', label: '功能开关',     group: '功能与权限', hint: '各模块总开关与最低可见角色',       render: renderFeaturePanel },
  { key: 'cardperm', icon: '🃏', label: '卡牌图集权限', group: '功能与权限', hint: '文本系统里每类卡牌图集单独设权限', render: renderCardPermPanel },
  { key: 'version',  icon: '📢', label: '版本公告',     group: '内容与数据', hint: '发布版本说明，全站可见',           render: renderVersionPanel },
  { key: 'packs',    icon: '📦', label: '数据更新',     group: '内容与数据', hint: '上传卡牌 / 书籍 / 性格分组数据包',  render: renderPackPanel },
  { key: 'books',    icon: '📚', label: '书籍管理',     group: '内容与数据', hint: '书名与分类的云端覆盖',             render: renderBooksPanel },
  { key: 'cards',    icon: '🗂', label: '卡牌数据',     group: '内容与数据', hint: '内置卡牌条目与校对进度',           render: renderCardsStatPanel },
  { key: 'users',    icon: '👥', label: '账号管理',     group: '账号与邀请', hint: '角色、角色锁定、单账号权限',       render: renderUserPanel },
  { key: 'batch',    icon: '✏️', label: '批量编辑',     group: '账号与邀请', hint: '一次改动多个账号的角色',           render: renderBatchPanel },
  { key: 'invite',   icon: '🎟', label: '邀请码',       group: '账号与邀请', hint: '注册时填入即自动升级角色',         render: renderInvitePanel },
  { key: 'logins',   icon: '📋', label: '登录记录',     group: '账号与邀请', hint: '最近的登录日志',                   render: renderLoginPanel },
];
const adminPage = k => ADMIN_PAGES.find(p => p.key === k);
/* 当前子页：从 hash 取（#admin/users → users），非法 / 未知值一律回落概览 */
function adminSub() {
  const r = String(location.hash || '').replace(/^#/, '').split('?')[0];
  const m = r.match(/^admin\/([A-Za-z0-9_-]*)$/);
  return adminPage(m ? m[1] : '') ? m[1] : 'overview';
}
/* 面包屑：后台管理 › 分组 › 子页 */
function adminCrumb(pg) {
  const parts = ['后台管理'];
  if (pg.group) parts.push(pg.group);
  if (pg.key !== 'overview') parts.push(pg.label);
  return parts.join(' › ');
}

async function admin(v) {
  const pg = adminPage(adminSub()) || ADMIN_PAGES[0];
  const groups = [];
  for (const p of ADMIN_PAGES) {
    if (!p.group) continue;
    let g = groups.find(x => x.name === p.group);
    if (!g) { g = { name: p.group, items: [] }; groups.push(g); }
    g.items.push(p);
  }
  const navItem = p => `<a class="adm-navi${p.key === pg.key ? ' on' : ''}" href="#admin/${p.key}"
    title="${esc(p.hint || p.label)}"><span class="adm-nico">${p.icon}</span>${esc(p.label)}</a>`;
  v.innerHTML = `
    <h2 class="page-title">${esc(pg.key === 'overview' ? '后台管理' : pg.label)}</h2>
    <p class="page-sub">${esc(adminCrumb(pg))}${pg.hint ? ' · ' + esc(pg.hint) : ''}</p>
    <div class="adm-wrap">
      <nav class="adm-nav" aria-label="后台管理导航">
        ${navItem(ADMIN_PAGES[0])}
        ${groups.map(g => `<div class="adm-ngrp"><div class="adm-ngt">${esc(g.name)}</div>${g.items.map(navItem).join('')}</div>`).join('')}
      </nav>
      <div class="adm-main">
        <div class="panel" id="adm-${pg.key}"><p class="muted small">正在加载…</p></div>
      </div>
    </div>`;
  await pg.render(v);
}

/* 概览：静态统计立刻出，需要联网的两项（账号数 / 数据包数）异步补，不堵首屏 */
async function renderOverviewPanel(v) {
  const box = v.querySelector('#adm-overview');
  if (!box) return;
  const cardsAll = allCards();
  const pf = { pending: 0, ok: 0, issue: 0 };
  for (const c of cardsAll) pf[proofStatus(c.id)] = (pf[proofStatus(c.id)] || 0) + 1;
  const ver = SITE_VERSION || {};
  const stat = (n, l) => `<div class="adm-stat"><b>${esc(n)}</b><span>${esc(l)}</span></div>`;
  box.innerHTML = `
    <h3 style="margin-bottom:10px">站点概览</h3>
    <div class="adm-cards">
      ${stat(cardsAll.length, '卡牌条目')}
      ${stat(cardsAll.filter(c => c.review).length, '待校对条目')}
      ${stat(pf.ok, '已校对')}
      ${stat(pf.issue, '有疑问')}
      ${stat(ver.version || '—', '当前版本')}
      ${stat(Object.keys(DB.proof || {}).length, '本机校对记录')}
      <div class="adm-stat" id="adm-ov-users"><b>…</b><span>账号总数</span></div>
      <div class="adm-stat" id="adm-ov-packs"><b>…</b><span>生效数据包</span></div>
    </div>
    <h3 style="margin:18px 0 10px">快捷入口</h3>
    <div class="adm-cards">
      ${ADMIN_PAGES.filter(p => p.key !== 'overview').map(p => `
        <a class="adm-tile" href="#admin/${p.key}">
          <div class="adm-tico">${p.icon}</div>
          <div class="adm-tt">${esc(p.label)}</div>
          <div class="adm-td">${esc(p.hint || '')}</div>
        </a>`).join('')}
    </div>`;
  /* 两项要联网，异步补上、不堵首屏；云端不可用（含 SDK 缺方法）一律显示「—」，不抛未捕获异常 */
  (async () => {
    let n = '—';
    try { const u = await adminUserStats(); if (!u.error) n = String((u.data || []).length); } catch (e) { /* 忽略 */ }
    const el = box.querySelector('#adm-ov-users b');
    if (el) el.textContent = n;
  })();
  (async () => {
    let n = '—';
    try { const p = await cloudListPacks(); if (!p.error) n = String((p.data || []).filter(r => r.active).length); } catch (e) { /* 忽略 */ }
    const el = box.querySelector('#adm-ov-packs b');
    if (el) el.textContent = n;
  })();
}

/* 卡牌数据（内置）：条目数与校对进度 */
function renderCardsStatPanel(v) {
  const box = v.querySelector('#adm-cards');
  if (!box) return;
  const cardsAll = allCards();
  const pf = { pending: 0, ok: 0, issue: 0 };
  for (const c of cardsAll) pf[proofStatus(c.id)] = (pf[proofStatus(c.id)] || 0) + 1;
  box.innerHTML = `
    <h3 style="margin-bottom:10px">卡牌数据（内置）</h3>
    <table class="tbl"><tbody>
      <tr><th style="width:120px">卡牌条目</th><td>${cardsAll.length}</td></tr>
      <tr><th>待校对条目</th><td>${cardsAll.filter(c => c.review).length}</td></tr>
      <tr><th>校对进度</th><td>已校对 ${pf.ok} · 有疑问 ${pf.issue} · 待校对 ${pf.pending}（本机记录 ${Object.keys(DB.proof || {}).length} 条）</td></tr>
      <tr><th>自定义卡（我的）</th><td>${(DB.customs || []).length}</td></tr>
      <tr><th>字段修正（我的）</th><td>${Object.keys(DB.overrides || {}).length}</td></tr>
    </tbody></table>
    <p class="small muted" style="margin-top:10px">卡牌主数据随站点静态文件发布；管理员可在「表单编辑」中生成覆盖，或在 data/data-cards.js 中修订后重新部署。</p>`;
}

async function renderUserPanel(v) {
  const box = v.querySelector('#adm-users');
  if (!box) return;
  const noAdmin = !(await cloudHasAnyAdmin());
  const stats = await adminUserStats();
  if (stats.error) {
    box.innerHTML = `<h3 style="margin-bottom:10px">账号管理</h3>
      <p class="small" style="color:#b4462f">读取用户列表失败：${esc(stats.error.message || '未知错误')}</p>`;
    return;
  }
  const rows = stats.data || [];
  ADMIN_USERS = rows;              // 供「批量编辑」快捷填充
  const selfEmail = userEmail().toLowerCase();

  const claimBtn = noAdmin ? `
    <div class="panel" style="border-color:#c98b2e">
      <h3 style="margin-bottom:8px">尚未设置管理员</h3>
      <p class="small muted" style="margin-bottom:10px">站点还没有任何管理员。你是当前登录账号，可直接成为第一个管理员（此后只有管理员能增减管理员）。</p>
      <button class="btn btn-primary" id="adm-claim">把我设为首个管理员</button>
    </div>` : '';

  /* ---- 账号管理：集成排序 / 类型筛选（状态存模块级，重绘后保留） ---- */
  const SORTERS = {
    email:        r => String(r.email || '').toLowerCase(),
    display_name: r => String(r.display_name || '').trim().toLowerCase(),
    role:         r => ROLE_LEVEL[['admin', 'beta', 'user'].includes(r.role) ? r.role : 'user'] || 0,
    last_login:   r => String(r.last_login_at || ''),
    login_count:  r => Number(r.login_count) || 0,
    created_at:   r => String(r.created_at || ''),
    deck_count:   r => Number(r.deck_count) || 0,
  };
  /* 日期 / 数字默认降序（新的在前），文本默认升序 */
  const SORT_DEF_DIR = { email: 'asc', display_name: 'asc', role: 'asc', last_login: 'desc', login_count: 'desc', created_at: 'desc', deck_count: 'desc' };
  const TYPE_FILTERS = {
    all:    () => true,
    admin:  r => r.role === 'admin',
    beta:   r => r.role === 'beta',
    user:   r => !['admin', 'beta'].includes(r.role),
    locked: r => !!r.role_locked,
    invite: r => !!r.invite_code,
    never:  r => !r.last_login_at,
    active: r => !!r.last_login_at,
  };

  box.innerHTML = `
    <h3 style="margin-bottom:10px">账号管理（${rows.length} 个账号）</h3>
    ${rows.length ? `
    <div class="adm-tools">
      <label class="adm-tf small">类型
        <select id="adm-type">
          ${[['all', '全部账号'], ['admin', '管理员'], ['beta', '内测账号'], ['user', '普通用户'],
             ['locked', '🔒 已锁定角色'], ['invite', '🎟 有邀请码'], ['active', '已登录过'], ['never', '从未登录']]
            .map(([k, n]) => `<option value="${k}" ${ADMIN_UI.type === k ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
      </label>
      <label class="adm-tf small">排序
        <select id="adm-sort">
          ${[['email', '邮箱'], ['display_name', '显示名称'], ['role', '角色权限'],
             ['last_login', '最近登录'], ['login_count', '登录次数'], ['created_at', '注册时间'],
             ['deck_count', '构筑数']]
            .map(([k, n]) => `<option value="${k}" ${ADMIN_UI.sort === k ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
      </label>
      <button class="btn btn-sm" id="adm-dir" title="切换升序 / 降序">
        ${ADMIN_UI.dir === 'asc' ? '↑ 升序' : '↓ 降序'}</button>
      <input type="text" id="adm-q" class="adm-tq" placeholder="搜索邮箱 / 名称 / 邀请码…" value="${esc(ADMIN_UI.q)}">
      <span class="flex-spacer"></span>
      <span class="small muted" id="adm-cnt"></span>
    </div>
    <table class="tbl"><thead><tr>
      ${[['email', '邮箱', 0], ['display_name', '显示名称', 0], ['role', '角色权限', 150],
         ['last_login', '最近登录', 120], ['login_count', '登录次数', 80], ['created_at', '注册时间', 0], ['deck_count', '构筑数', 0]]
        .map(([k, n, w]) => `<th class="adm-th" data-sort="${k}"${w ? ` style="width:${w}px"` : ''}
          title="点击按「${n}」排序">${n}<span class="adm-arr">${
            ADMIN_UI.sort === k ? (ADMIN_UI.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>`).join('')}
      <th style="width:60px" title="单账号权限：为该账号单独设定每个模块的允许 / 拒绝">⚙</th>
    </tr></thead><tbody id="adm-ubody"></tbody></table>
      <p class="small muted" style="margin-top:8px">点表头即可排序（再点一次切换升 / 降）；角色说明：普通用户＝常规功能；内测账号＝可提前使用内测中的模块（如卡牌自制）；管理员＝全部模块与后台。改动即时生效。</p>` : '<p class="muted small">还没有账号数据。</p>'}`;

  const drawUsers = () => {
    const tb = box.querySelector('#adm-ubody');
    if (!tb) return;
    const q = ADMIN_UI.q.trim().toLowerCase();
    let list = rows.filter(r => (TYPE_FILTERS[ADMIN_UI.type] || TYPE_FILTERS.all)(r));
    if (q) list = list.filter(r =>
      `${r.email || ''} ${r.display_name || ''} ${r.invite_code || ''}`.toLowerCase().includes(q));
    const get = SORTERS[ADMIN_UI.sort] || SORTERS.created_at;
    const dir = ADMIN_UI.dir === 'asc' ? 1 : -1;
    list = list.slice().sort((a, b) => {
      const x = get(a), y = get(b);
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
      return String(x).localeCompare(String(y), 'zh') * dir
        || String(a.email || '').localeCompare(String(b.email || ''));
    });
    tb.innerHTML = list.map(r => {
      const em = r.email || '(未记录邮箱)';
      const me = String(em).toLowerCase() === selfEmail;
      const role = ['admin', 'beta', 'user'].includes(r.role) ? r.role : 'user';
      const last = r.last_login_at ? String(r.last_login_at).slice(0, 16).replace('T', ' ') : '—';
      return `<tr>
        <td>${esc(em)}${me ? ' <span class="tag">我</span>' : ''}${r.invite_code ? ` <span class="tag blue" title="邀请码">${esc(r.invite_code)}</span>` : ''}</td>
        <td class="small muted">${esc(r.display_name || '—')}</td>
        <td><select data-role-for="${esc(em)}" ${(me || r.role_locked) ? 'disabled title="不能修改" style="width:100%;opacity:.6"' : 'style="width:100%"'}>
          ${[['user', '普通用户'], ['beta', '内测账号'], ['admin', '管理员']].map(([k, n]) =>
            `<option value="${k}" ${role === k ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
        ${r.role_locked
          ? `<div class="small" style="margin-top:3px;color:var(--amber,#c8951f)">🔒 永久管理员（已锁定）</div>`
          : `<button class="btn-link" data-lock-for="${esc(em)}" title="锁定后该账号角色不可被任何人降级">🔓 锁定角色</button>`}</td>
        <td class="small muted">${esc(last)}</td>
        <td>${r.login_count ?? 0}</td>
        <td class="small muted">${esc(String(r.created_at || '').slice(0, 10))}</td>
        <td>${r.deck_count ?? 0}</td>
        <td>${r.email
          ? `<button class="btn btn-sm adm-perm" data-perm-for="${esc(em)}" data-perm-role="${esc(role)}" title="单账号权限：为「${esc(em)}」单独设定每个模块的允许 / 拒绝">⚙</button>`
          : '<span class="small muted" title="该账号没有邮箱，无法单独设定">—</span>'}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" class="muted small">没有符合条件的账号。</td></tr>';
    const cnt = box.querySelector('#adm-cnt');
    if (cnt) cnt.textContent = `显示 ${list.length} / ${rows.length} 个账号`;
    /* 行内按钮重新绑定（表格重绘后旧节点失效） */
    box.querySelectorAll('[data-perm-for]').forEach(b => b.onclick = () =>
      openPermModal(b.dataset.permFor, ROLE_NAME[b.dataset.permRole] || ''));
    box.querySelectorAll('[data-lock-for]').forEach(b => b.onclick = async () => {
      const em = b.dataset.lockFor;
      if (!confirm(`锁定「${em}」的角色？\n锁定后任何人都无法再改动或降级该账号的角色（管理员也不能，除非先在数据库解锁）。`)) return;
      const r = await adminSetRoleLock(em, true);
      if (r.error) { toast('锁定失败：' + (r.error.message || '')); return; }
      if (r.data === 'not_found') { toast('未找到该账号'); return; }
      toast('已锁定：' + em); renderRoute();
    });
    box.querySelectorAll('[data-role-for]').forEach(sel => sel.onchange = async () => {
      const em = sel.dataset.roleFor, to = sel.value;
      const cur = (sel.querySelector('option[selected]')?.value) || 'user';
      if (to === cur) return;
      const name = { user: '普通用户', beta: '内测账号', admin: '管理员' }[to];
      if (!confirm(`确定把「${em}」设为「${name}」？`)) { sel.value = cur; return; }
      const r = await adminSetRole(em, to);
      if (r.error) { toast('失败：' + (r.error.message || '')); sel.value = cur; return; }
      if (r.data === 'not_found') { toast('未找到该账号（可能还没记录邮箱）'); sel.value = cur; return; }
      if (r.data === 'locked') { toast('该账号已锁定角色，无法改动'); sel.value = cur; return; }
      if (r.data === 'self') { toast('不能降级自己'); sel.value = cur; return; }
      toast('已更新为' + name);
      renderRoute();
    });
  };

  /* 工具栏：类型 / 排序 / 升降 / 搜索 */
  const sortSel = box.querySelector('#adm-sort');
  const typeSel = box.querySelector('#adm-type');
  const dirBtn = box.querySelector('#adm-dir');
  if (sortSel) {
    sortSel.onchange = () => {
      ADMIN_UI.sort = sortSel.value;
      ADMIN_UI.dir = SORT_DEF_DIR[ADMIN_UI.sort] || 'asc';
      syncSortUI(); drawUsers();
    };
    typeSel.onchange = () => { ADMIN_UI.type = typeSel.value; drawUsers(); };
    dirBtn.onclick = () => {
      ADMIN_UI.dir = ADMIN_UI.dir === 'asc' ? 'desc' : 'asc';
      syncSortUI(); drawUsers();
    };
    const qi = box.querySelector('#adm-q');
    qi.oninput = () => { ADMIN_UI.q = qi.value; drawUsers(); };
    box.querySelectorAll('[data-sort]').forEach(th => th.onclick = () => {
      const k = th.dataset.sort;
      if (ADMIN_UI.sort === k) ADMIN_UI.dir = ADMIN_UI.dir === 'asc' ? 'desc' : 'asc';
      else { ADMIN_UI.sort = k; ADMIN_UI.dir = SORT_DEF_DIR[k] || 'asc'; }
      syncSortUI(); drawUsers();
    });
    drawUsers();
  }
  /* 排序状态写回表头箭头与下拉（表头点击后也要同步） */
  function syncSortUI() {
    if (sortSel) sortSel.value = ADMIN_UI.sort;
    if (dirBtn) dirBtn.textContent = ADMIN_UI.dir === 'asc' ? '↑ 升序' : '↓ 降序';
    box.querySelectorAll('[data-sort]').forEach(th => {
      const k = th.dataset.sort;
      const a = th.querySelector('.adm-arr');
      if (a) a.textContent = ADMIN_UI.sort === k ? (ADMIN_UI.dir === 'asc' ? '▲' : '▼') : '⇅';
      th.classList.toggle('on', ADMIN_UI.sort === k);
    });
  }
  syncSortUI();

  if (claimBtn) {
    box.insertAdjacentHTML('beforebegin', claimBtn);
    v.querySelector('#adm-claim').onclick = async () => {
      const r = await cloudClaimFirstAdmin();
      if (r.error) { toast('设置失败：' + (r.error.message || '')); return; }
      toast('已设为管理员'); renderSidenav(); renderTopRight(); renderRoute();
    };
  }
  /* 行内的角色下拉 / 权限 / 锁定按钮由 drawUsers() 在每次重绘后重新绑定（表格行会重建） */
}

/* ---------------- 登录弹窗 ---------------- */
function openLogin(tab) {
  $('#login-modal').classList.remove('hidden');
  $('#login-tabs')?.classList.remove('hidden');   // 正常登录时页签可见（改密模式会单独隐藏）
  /* 「免注册开始」只在后端支持匿名登录时出现：Supabase 版支持，WorkBuddy 云不支持，
     不隐藏的话点了只会提示「当前后端不支持」，反而误导。 */
  const anonOk = typeof cloudSignInAnon === 'function';
  $$('#login-modal .anon-box, #login-modal .anon-divider')
    .forEach(el => el.classList.toggle('hidden', !anonOk));
  switchLoginTab(tab || 'pw');
}
function closeLogin() { $('#login-modal').classList.add('hidden'); }
function switchLoginTab(tab) {
  $$('#login-modal .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $('#form-pw').classList.toggle('hidden', tab !== 'pw');
  $('#form-otp').classList.toggle('hidden', tab !== 'otp');
  $('#form-reset').classList.toggle('hidden', tab !== 'reset');   // v39
}
function loginMsg(sel, text, bad, raw) {
  const el = $(sel); if (!el) return;
  el.textContent = text || '';
  el.className = 'form-msg' + (bad ? ' bad' : '');
  if (raw && !String(text || '').includes(String(raw))) {   /* 原文已包含在提示里就不重复贴一遍 */
    const i = document.createElement('i');
    i.className = 'form-raw';
    i.textContent = '云端原文：' + raw;
    el.appendChild(i);
    console.warn('[auth]', raw);
  }
}

/* ---------------- v44：登录 / 验证码错误 → 说人话 ----------------
 * 以前不管云端返回什么（网络断了、云端没起来、邮箱没验证、没注册、被限流…）
 * 都只显示一句「邮箱或密码不正确」，凭据其实没错的用户只能反复改密码。
 * 现在按云端原文分类：只有真正的凭据错才说凭据错，其余各自报各自的原因，
 * 并把云端原文以小字附在提示下面。 */
function authErrText(err, kind) {
  const isOtp = kind === 'otp' || kind === 'reset';
  let raw = String((err && (err.message || err.error_description || err.msg || err.error)) || '').trim();
  const code = err && (err.code || err.status || err.error_code);   /* 有错误码就一并附上，便于照着查 */
  if (code && !new RegExp('\\b' + String(code) + '\\b').test(raw)) raw += `（错误码 ${code}）`;
  const m = raw.toLowerCase();
  const R = (msg, keepRaw, alt) => ({ msg, raw: keepRaw === false ? '' : raw, alt: !!alt });

  if (!raw || m === 'unknown' || m === '[object object]') {
    return R(isOtp ? '验证失败，请稍后重试' : '登录失败，请稍后重试', false);
  }
  /* 顺序：越具体越靠前；「凭据错」这条放最后兜底，避免误吞其它原因 */
  if (/未就绪|not ready|publishable|sdk|initializ/i.test(m)) {
    return R('云端服务未就绪，请刷新页面重试；反复如此请在个人中心打开「连接诊断」');
  }
  /* 云端环境被停用（数据库欠费/到期隔离）—— 与账号密码完全无关，
     必须单独说清楚，否则用户会以为密码错了，反复改密码。 */
  if (/DATABASE_RESOURCE_ISOLATED|resource is isolated|资源已隔离|服务已停用|service.?unavailable|\b503\b/i.test(m)) {
    return R('云端数据库已停用（服务欠费或到期），需要在云开发控制台续费后才能登录；这不是账号或密码的问题', true);
  }
  if (/网络|超时|timeout|timed out|failed to fetch|fetch failed|network|econn|abort|连接失败|enotfound/i.test(m)) {
    return R('网络异常，没能连上云端，请检查网络后重试');
  }
  if (/频繁|rate.?limit|too many|429|稍后再试|try again later/i.test(m)) {
    return R('尝试过于频繁，云端已限流，请 1 分钟后再试');
  }
  if (isOtp && /过期|expire|已使用|used|不正确|错误|invalid|wrong|无效/i.test(m)) {
    return R('验证码不正确或已过期，请重新获取');
  }
  if (/未验证|未确认|未激活|not confirmed|unconfirmed|confirm your email|unverified/i.test(m)) {
    return R('该邮箱尚未完成验证，请到「验证码登录 / 注册」页签用邮箱验证码登录一次', true, true);
  }
  if (/未设置密码|没有密码|no password|password not set|need.*password/i.test(m)) {
    return R('该账号还没有设置密码，请用「忘记密码」走邮箱验证码设一个，或先用验证码登录', true, true);
  }
  if (/不存在|未注册|尚未注册|not found|no user|no such user|user not exist|email not registered/i.test(m)) {
    return R('该邮箱尚未注册，请到「验证码登录 / 注册」页签注册，或检查邮箱是否填错', true, true);
  }
  if (/已禁用|disabled|banned|封禁|冻结/i.test(m)) {
    return R('该账号已被停用，请联系管理员');
  }
  if (/长度|至少|too short|weak|minimum/i.test(m)) {
    return R('密码长度不符合要求（至少 ' + PWD_MIN + ' 位）');
  }
  if (/invalid login|invalid credential|invalid_credential|invalid email or password|邮箱或密码|密码错误|密码不正确|wrong password|incorrect password|bad credentials|unauthorized|^401|\b401\b/i.test(m)) {
    return R('邮箱或密码不正确（注意大小写、输入法全角字符，以及密码前后的空格）', false);
  }
  return R(raw, false);                        /* 认不出来的：直接把云端原话显示出来 */
}

/* ---------------- v39：邮箱验证改密（登录页「重置」/ 个人中心「修改密码」共用） ----------------
 * 流程：填邮箱 → 获取验证码（云端以 PASSWORD_RESET 用途发信）→ 填验证码 + 新密码
 *      → 云端校验验证码并改密，同时用新密码直接登录，返回会话。
 * 于是用户全程留在站内：验证一次邮箱即可改密并登录，不必去邮箱点重置链接。 */
const PWD_MIN = 6;
let PWD_MODE = 'login';        // 'login'：登录页重置并登录；'change'：个人中心已登录状态下改密
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/* 邮箱打码：a12***@163.com（个人中心与改密面板共用） */
const maskEmail = e => {
  const s = String(e || '').trim();
  return s ? s.replace(/^(.{1,3}).*(@.*)$/, '$1***$2') : '—';
};

/* 打开改密面板：mode='login' 用于登录页（邮箱可填）；mode='change' 用于个人中心（邮箱锁定为当前账号） */
function openPwdFlow(mode, presetEmail) {
  PWD_MODE = mode === 'change' ? 'change' : 'login';
  const em = $('#reset-email');
  if (em) {
    em.readOnly = (PWD_MODE === 'change');
    em.value = PWD_MODE === 'change' ? (presetEmail || userEmail() || '') : (presetEmail || em.value || '');
  }
  const note = $('#reset-note');
  if (note) {
    /* 国内站用「旧密码 → 新密码」，不发邮件；旧的邮件验证码流程只在切回 WorkBuddy 后端时使用 */
    const local = typeof cloudChangePassword === 'function' && isSignedIn();
    note.innerHTML = local
      ? (PWD_MODE === 'change'
        ? '输入当前密码即可设置新密码，改完下次登录用新密码。'
        : '输入当前密码即可设置新密码。')
      : (PWD_MODE === 'change'
        ? '向账号邮箱 <b>' + esc(maskEmail(userEmail())) + '</b> 发一封验证码，填对后即可设置新密码（改完会自动用新密码登录一次）。'
        : '忘记密码时用邮箱找回：验证一次邮箱即可设置新密码，并<b>直接用新密码登录</b>，不需要去邮箱点链接。');
  }
  const go = $('#reset-go');
  if (go) go.textContent = '保存新密码';
  /* 每次打开都是一次新流程：清掉上一轮可能还在跑的发送冷却 */
  const sbtn = $('#reset-send');
  if (sbtn && sbtn._cdTimer) { clearInterval(sbtn._cdTimer); sbtn._cdTimer = null; }
  if (sbtn) { sbtn.disabled = false; sbtn.textContent = '获取验证码'; }
  loginMsg('#reset-msg', '');
  openLogin('reset');
  /* 改密模式下把登录页签收起来，避免误切到「密码登录」造成困惑 */
  const tabs = $('#login-tabs');
  if (tabs) tabs.classList.toggle('hidden', PWD_MODE === 'change');
}

/* ---------------- 后台：单账号权限（可为某个账号单独放行 / 拒绝某个模块） ---------------- */
let PERM_EMAIL = '';
let PERM_ROWS = [];                       // 当前弹窗里的功能行（用于「全部恢复继承」）
function openPermModal(email, roleName) {
  PERM_EMAIL = email;
  $('#perm-sub').textContent =
    `为「${email}」${roleName ? `（${roleName}）` : ''}单独设定模块权限 —— 允许：无视其角色直接放行；拒绝：即使角色满足也不可用；继承：按全站开关与角色判定。`;
  $('#perm-modal').classList.remove('hidden');
  renderPermModal();
}
async function renderPermModal() {
  const body = $('#perm-body');
  const msg = $('#perm-msg');
  if (!body) return;
  body.innerHTML = '<p class="muted small">正在加载…</p>';
  const r = await adminListUserOverrides(PERM_EMAIL);
  if (r.error) { body.innerHTML = `<p class="small" style="color:var(--red)">读取失败：${esc(r.error.message || '')}</p>`; return; }
  const cur = {};
  for (const row of r.data || []) cur[row.feature_key] = { allow: row.allow !== false, note: row.note || '' };
  const rows = FEATURE_ROWS;
  PERM_ROWS = rows.map(m => m.key);
  const setN = Object.keys(cur).length;
  body.innerHTML = `
    <p class="small muted" style="margin-bottom:8px">当前有 <b>${setN}</b> 项单独设定；未列出的模块按角色继承。
      模块处于「全站关闭」时，单项放行暂不生效（需先在上方功能开关中开放）。</p>
    <table class="tbl"><thead><tr>
      <th>模块</th><th style="width:132px">单账号设定</th><th>备注</th>
    </tr></thead><tbody>
    ${rows.map(m => {
      const f = featureState(m.key);
      const c = cur[m.key];
      const val = c ? (c.allow ? 'allow' : 'deny') : 'inherit';
      const locked = FEATURE_LOCKED.has(m.key);
      return `<tr class="${m.depth ? 'feat-child' : 'feat-parent'}">
        <td>${m.depth ? '<span class="feat-indent">└</span>' : ''}${m.icon} ${esc(f.label)}
          ${m.parent ? `<span class="small muted">（属 ${esc(FEATURE_DEFS[m.parent]?.label || m.parent)}）</span>` : ''}
          <div class="small muted">全站：${f.enabled ? '开放' : '关闭'} · 最低 ${esc(ROLE_NAME[f.min] || f.min)}</div></td>
        <td><select data-pk="${esc(m.key)}" style="width:100%">
          <option value="inherit" ${val === 'inherit' ? 'selected' : ''}>继承</option>
          <option value="allow" ${val === 'allow' ? 'selected' : ''}>✅ 允许</option>
          <option value="deny" ${val === 'deny' ? 'selected' : ''} ${locked ? 'disabled' : ''}>⛔ 拒绝</option>
        </select></td>
        <td><input type="text" data-pn="${esc(m.key)}" value="${esc(c?.note || '')}"
             placeholder="备注（可空）" style="width:100%"></td>
      </tr>`;
    }).join('')}
    </tbody></table>`;

  body.querySelectorAll('[data-pk]').forEach(sel => {
    const key = sel.dataset.pk;
    sel.onchange = async () => {
      const v = sel.value;
      const allow = v === 'inherit' ? null : (v === 'allow');
      const note = body.querySelector(`[data-pn="${key}"]`)?.value || '';
      msg.textContent = '保存中…';
      const rr = await adminSetUserOverride(PERM_EMAIL, key, allow, note);
      if (rr.error) { msg.textContent = '失败：' + (rr.error.message || ''); return; }
      if (rr.data === 'not_found') { msg.textContent = '未找到该账号（可能还没有邮箱记录）'; return; }
      if (rr.data === 'protected') { msg.textContent = '管理员 / 已锁定账号不能被拒绝访问后台'; return; }
      msg.textContent = allow === null ? '已恢复继承' : (allow ? '已单独放行' : '已单独拒绝');
      toast(allow === null ? `${FEATURE_DEFS[key]?.label || key}：恢复继承` :
        `${FEATURE_DEFS[key]?.label || key}：${allow ? '单独放行' : '单独拒绝'}`, 2600);
      renderPermModal();
    };
  });
  body.querySelectorAll('[data-pn]').forEach(inp => {
    inp.onchange = async () => {
      const key = inp.dataset.pn;
      if (!Object.prototype.hasOwnProperty.call(cur, key)) return;   // 未设定的项不必保存备注
      const rr = await adminSetUserOverride(PERM_EMAIL, key, cur[key].allow, inp.value);
      if (!rr.error) msg.textContent = '备注已保存';
    };
  });
}

/* ---------------- 启动 ---------------- */
$('#btn-account').addEventListener('click', () => {
  if (isSignedIn()) { doSignOut(); return; }
  // 探测失败只提示，不硬拦：让用户可以照常尝试，由具体错误告知原因
  if (CLOUD_DOWN) toast('云端探测未通过，如注册/登录失败请查看「诊断」', 3200);
  openLogin('pw');
});
$('#login-close').addEventListener('click', closeLogin);
/* 免注册开始：匿名账号（Supabase 原生支持，不消耗邮件额度）。
   公开站的主入口 —— 大多数人不会为了组个牌去注册邮箱。 */
{
  const anonBtn = $('#lg-anon');
  if (anonBtn) anonBtn.addEventListener('click', async () => {
    if (typeof cloudSignInAnon !== 'function') {
      loginMsg('#lg-anon-msg', '当前后端不支持免注册登录，请用邮箱登录', true); return;
    }
    const label = anonBtn.textContent;
    anonBtn.disabled = true; anonBtn.textContent = '正在创建…';
    loginMsg('#lg-anon-msg', '');
    const r = await cloudSignInAnon();
    anonBtn.disabled = false; anonBtn.textContent = label;
    if (r.error) { loginMsg('#lg-anon-msg', '创建失败：' + (r.error.message || '未知错误'), true, r.error.message); return; }
    closeLogin();
    await afterSignIn();
    toast('已开始使用匿名账号，数据会自动存到云端', 3000);
  });
}
$('#login-modal').addEventListener('click', e => { if (e.target.id === 'login-modal') closeLogin(); });
$$('#login-modal .tab').forEach(t => t.addEventListener('click', () => switchLoginTab(t.dataset.tab)));

$('#form-pw').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('#pw-email').value.trim(), pass = $('#pw-pass').value;
  if (!email || !pass) { loginMsg('#pw-msg', '请填写邮箱与密码', true); return; }
  loginMsg('#pw-msg', '正在登录…');
  const r = await cloudSignInPassword(email, pass);
  if (r.error) {
    /* v44：不再一律显示「邮箱或密码不正确」，按云端真实原因给出对应提示；
       若原因不是凭据错（未注册 / 未验证 / 没密码），顺带给出「改用验证码登录」入口 */
    const e = authErrText(r.error, 'pw');
    loginMsg('#pw-msg', e.msg, true, e.raw);
    const alt = $('#pw-alt'); if (alt) alt.classList.toggle('hidden', !e.alt);
    return;
  }
  /* 登录成功：收起「改用验证码登录」入口 */
  const altB = $('#pw-alt'); if (altB) altB.classList.add('hidden');
  /* 登录成功后如有邀请码：直接兑换（老账号也能升级为内测） */
  const pwi = ($('#pw-invite')?.value || '').trim();
  if (pwi) {
    loginMsg('#pw-msg', '正在校验邀请码…');
    const iv = await redeemInviteFlow(pwi);
    loginMsg('#pw-msg', iv.msg, !iv.ok);
    if (iv.ok) $('#pw-invite').value = '';
    await new Promise(r2 => setTimeout(r2, iv.ok ? 900 : 1400));
  } else loginMsg('#pw-msg', '登录成功');
  closeLogin(); await afterSignIn();
});
/* 国内站（EdgeOne 自建后端）没有可靠的免费发信通道，改密邮件不可用。
   如需找回密码请联系站长手工重置；切回 WorkBuddy 后端时可用 openPwdFlow。 */
$('#pw-forgot').addEventListener('click', () => {
  const em = ($('#pw-email').value || '').trim();
  loginMsg('#pw-msg',
    '暂时只能由站长手工重置密码' + (em ? `，请把注册邮箱「${em}」发给站长` : '，请把注册邮箱发给站长'), true);
});
/* 密码登录报的错不是凭据错时，给一条直接切到注册页签的捷径（带邮箱过去） */
$('#pw-alt').addEventListener('click', () => {
  const em = ($('#pw-email').value || '').trim();
  if (em) $('#otp-email').value = em;
  loginMsg('#pw-msg', '');
  $('#pw-alt').classList.add('hidden');
  switchLoginTab('otp');
  $('#otp-pass')?.focus();
});

/* v39：改密 —— 获取验证码（与登录验证码共用 60 秒冷却，但各自独立计时） */
function startOtpCooldown(btn, label) {
  if (!btn) return null;
  const txt = label || '获取验证码';
  let left = OTP_COOLDOWN;
  const tick = () => {
    if (left <= 0) {
      clearInterval(btn._cdTimer); btn._cdTimer = null;
      btn.disabled = false; btn.textContent = txt; return;
    }
    btn.disabled = true; btn.textContent = `${left} 秒后重发`;
  };
  tick();
  clearInterval(btn._cdTimer);
  btn._cdTimer = setInterval(() => { --left; tick(); }, 1000);
  return btn._cdTimer;
}
$('#reset-send').addEventListener('click', async () => {
  const btn = $('#reset-send'), em = ($('#reset-email').value || '').trim();
  if (!EMAIL_RE.test(em)) { loginMsg('#reset-msg', '请填写正确的邮箱', true); return; }
  btn.disabled = true; btn.textContent = '发送中…';
  loginMsg('#reset-msg', '正在向 ' + esc(maskEmail(em)) + ' 发送验证码…');
  const r = await cloudSendResetCode(em);
  if (r.error) {
    const e = authErrText(r.error, 'send');           /* v44：同上 */
    loginMsg('#reset-msg', e.msg ? ('发送失败：' + e.msg) : '发送失败', true, e.raw);
    btn.disabled = false; btn.textContent = '获取验证码';
    return;
  }
  startOtpCooldown(btn);
  loginMsg('#reset-msg', `验证码已发送至 ${esc(maskEmail(em))}，15 分钟内有效（${OTP_COOLDOWN} 秒后可重发）`);
  $('#reset-code').focus();
});
$('#reset-email').addEventListener('input', () => {
  /* 换了邮箱就作废上一次的验证码，避免用 A 的验证码去改 B 的密码 */
  if (resetPendingEmail() && resetPendingEmail() !== ($('#reset-email').value || '').trim()) {
    const btn = $('#reset-send');
    if (btn && btn._cdTimer) { clearInterval(btn._cdTimer); btn._cdTimer = null; }
    if (btn) { btn.disabled = false; btn.textContent = '获取验证码'; }
  }
});
$('#form-reset').addEventListener('submit', async e => {
  e.preventDefault();
  const em = ($('#reset-email').value || '').trim();
  const code = ($('#reset-code').value || '').trim();      /* 国内站：这里是「当前密码」 */
  const p1 = $('#reset-pass').value, p2 = $('#reset-pass2').value;
  if (!code) { loginMsg('#reset-msg', '请填写当前密码', true); return; }
  if (!p1) { loginMsg('#reset-msg', '请填写新密码', true); return; }
  if (p1.length < PWD_MIN) { loginMsg('#reset-msg', `新密码至少 ${PWD_MIN} 位`, true); return; }
  if (p1 !== p2) { loginMsg('#reset-msg', '两次输入的新密码不一致', true); return; }

  const goBtn = $('#reset-go');
  goBtn.disabled = true; goBtn.textContent = '处理中…';

  /* 已登录 + 后端支持 → 走「旧密码换新密码」；
     否则回退到旧的邮件验证码流程（切回 WorkBuddy 后端时仍可用） */
  const localChange = typeof cloudChangePassword === 'function' && isSignedIn();
  loginMsg('#reset-msg', localChange ? '正在修改密码…' : '正在校验验证码并修改密码…');
  const r = localChange ? await cloudChangePassword(code, p1) : await cloudResetPassword(em, code, p1);
  if (r.error) {
    const e = authErrText(r.error, 'reset');          /* v44：同上 */
    loginMsg('#reset-msg', e.msg, true, e.raw);
    goBtn.disabled = false; goBtn.textContent = '保存新密码';
    return;
  }
  /* 清空密码框，避免留在内存/自动填充里 */
  $('#reset-pass').value = ''; $('#reset-pass2').value = ''; $('#reset-code').value = '';
  goBtn.disabled = false; goBtn.textContent = '保存新密码';

  if (localChange || PWD_MODE === 'change') {
    loginMsg('#reset-msg', localChange ? '密码已修改，下次登录请用新密码' : '密码已修改，已用新密码重新登录');
    toast('密码已修改', 3000);
    await new Promise(r2 => setTimeout(r2, 900));
    closeLogin();
    renderTopRight(); renderSidenav(); renderSessionBar(); renderRoute();
  } else {
    loginMsg('#reset-msg', '密码已重置，正在登录…');
    await new Promise(r2 => setTimeout(r2, 600));
    closeLogin(); await afterSignIn();
    toast('密码已重置，已用新密码登录', 3200);
  }
});
/* 获取验证码：60 秒冷却，防止重复发送（登录验证码与改密验证码各自独立计时） */
const OTP_COOLDOWN = 60;
$('#otp-send').addEventListener('click', async () => {
  const email = $('#otp-email').value.trim();
  if (!EMAIL_RE.test(email)) { loginMsg('#otp-msg', '请填写正确的邮箱', true); return; }
  $('#otp-send').disabled = true; $('#otp-send').textContent = '发送中…';
  loginMsg('#otp-msg', '正在发送验证码…');
  const r = await cloudSendCode(email);
  if (r.error) {
    const e = authErrText(r.error, 'send');           /* v44：发送失败也要区分限流 / 网络 / 未就绪 */
    loginMsg('#otp-msg', e.msg ? ('发送失败：' + e.msg) : '发送失败', true, e.raw);
    $('#otp-send').disabled = false; $('#otp-send').textContent = '获取验证码';
    return;
  }
  startOtpCooldown($('#otp-send'));
  loginMsg('#otp-msg', `验证码已发送至 ${esc(email)}，10 分钟内有效（${OTP_COOLDOWN} 秒后可重发）`);
  $('#otp-code').focus();
});
/* 注册：国内站改为「邮箱 + 密码」，不再走邮件验证码 */
$('#form-otp').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('#otp-email').value.trim();
  const pass = $('#otp-pass').value;
  const pass2 = ($('#otp-code')?.value || '');
  const invite = ($('#otp-invite')?.value || '').trim();

  if (!email || !pass) { loginMsg('#otp-msg', '请填写邮箱与密码', true); return; }
  if (pass.length < 6) { loginMsg('#otp-msg', '密码至少 6 位', true); return; }
  if (pass2 && pass2 !== pass) { loginMsg('#otp-msg', '两次输入的密码不一致', true); return; }
  if (typeof cloudSignUp !== 'function') {
    loginMsg('#otp-msg', '当前后端不支持密码注册，请改用「免注册，直接开始」', true);
    return;
  }

  loginMsg('#otp-msg', '正在注册…');
  const r = await cloudSignUp(email, pass);
  if (r.error) {
    const er = authErrText(r.error, 'otp');
    loginMsg('#otp-msg', er.msg, true, er.raw);
    return;
  }
  if (invite) {
    loginMsg('#otp-msg', '正在校验邀请码…');
    const iv = await redeemInviteFlow(invite);
    loginMsg('#otp-msg', iv.msg, !iv.ok);
    if (iv.ok) $('#otp-invite').value = '';
    await new Promise(r2 => setTimeout(r2, iv.ok ? 900 : 1400));
  } else loginMsg('#otp-msg', '注册成功');
  closeLogin();
  await afterSignIn();
  if (typeof toast === 'function') toast('注册成功，收藏与构筑会自动同步到云端', 2600);
});

$('#nav-toggle').addEventListener('click', () => $('#main').classList.toggle('side-collapsed'));

/* 单账号权限弹窗 */
$('#perm-close').addEventListener('click', () => $('#perm-modal').classList.add('hidden'));
$('#perm-modal').addEventListener('click', e => { if (e.target.id === 'perm-modal') $('#perm-modal').classList.add('hidden'); });
$('#perm-refresh').addEventListener('click', () => renderPermModal());
$('#perm-reset').addEventListener('click', async () => {
  if (!PERM_EMAIL) return;
  if (!confirm(`把「${PERM_EMAIL}」的全部单账号设定恢复为继承角色默认？`)) return;
  const msg = $('#perm-msg');
  msg.textContent = '处理中…';
  let n = 0;
  for (const key of PERM_ROWS) {
    const r = await adminSetUserOverride(PERM_EMAIL, key, null, '');
    if (!r.error && (r.data === 'cleared' || r.data === 'ok')) n++;
  }
  msg.textContent = `已清除 ${n} 项设定`;
  toast('已全部恢复继承', 2600);
  renderPermModal();
});

/* 诊断弹窗：Ctrl+Shift+D（游客也可用），便于把真实错误报给我 */
function openDiag() {
  const m = $('#diag-modal'); if (!m) return;
  $('#diag-text').textContent = JSON.stringify(cloudDiag(), null, 1);
  m.classList.remove('hidden');
}
$('#diag-close').addEventListener('click', () => $('#diag-modal').classList.add('hidden'));
$('#diag-modal').addEventListener('click', e => { if (e.target.id === 'diag-modal') $('#diag-modal').classList.add('hidden'); });
$('#diag-copy').addEventListener('click', () => {
  navigator.clipboard?.writeText($('#diag-text').textContent);
  toast('诊断信息已复制');
});
window.addEventListener('keydown', e => {
  if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) { e.preventDefault(); openDiag(); }
});
$('#modal-close').addEventListener('click', () => closeModal());
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

/* 大图左右浏览：箭头按钮 / 键盘 ←→Esc / 手机滑动 */
$$('#modal [data-mstep]').forEach(b =>
  b.addEventListener('click', () => modalStep(Number(b.dataset.mstep))));
document.addEventListener('keydown', e => {
  const m = $('#modal');
  if (!m || m.classList.contains('hidden')) return;
  if (e.key === 'ArrowLeft')  { e.preventDefault(); modalStep(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); modalStep(1); }
  else if (e.key === 'Escape') closeModal();
});
(() => {
  const box = document.querySelector('#modal .modal-box');
  if (!box) return;
  box.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { GALLERY.touch = null; return; }
    GALLERY.touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  box.addEventListener('touchend', e => {
    const s = GALLERY.touch; GALLERY.touch = null;
    if (!s || !e.changedTouches.length) return;
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) modalStep(dx < 0 ? 1 : -1);
  }, { passive: true });
})();

/* 校对页：↑ / ↓ 切换条目（焦点不在输入框、大图未打开时） */
document.addEventListener('keydown', e => {
  if (location.hash !== '#proof' || !PROOF_REDRAW) return;
  const t = e.target;
  if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
  const m = $('#modal'); if (m && !m.classList.contains('hidden')) return;
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const ids = proofFiltered().map(c => c.id);
  if (!ids.length) return;
  const k = ids.indexOf(ProofUI.sel);
  const nk = e.key === 'ArrowDown'
    ? Math.min(ids.length - 1, k < 0 ? 0 : k + 1)
    : Math.max(0, k < 0 ? 0 : k - 1);
  if (nk === k) return;
  ProofUI.sel = ids[nk];
  e.preventDefault(); PROOF_REDRAW();
});

/* 顶部系统切换：卡牌 / 战役 / 文本查询 / 后台管理（无权限时由 renderRoute 显示说明页） */
const SYS_HASH = { cards: '#cards', campaign: '#campaign', text: '#text', music: '#music', admin: '#admin' };
$$('#sys-switch .sys-tab').forEach(b => b.addEventListener('click', () => {
  gotoHash(SYS_HASH[b.dataset.sys] || '#cards');
}));
/* 个人中心：顶栏左右两侧的人头都能进 */
$('#btn-me').addEventListener('click', () => gotoHash('#account'));
const _meL = $('#btn-me-l');
if (_meL) _meL.addEventListener('click', () => gotoHash('#account'));
$('#current-profile').addEventListener('click', () => { if (isSignedIn()) gotoHash('#account'); });

(async function init() {
  initCloud();
  restoreIdentity();   // 先按本机缓存的身份渲染（含管理员标记），避免刷新瞬间掉回游客
  DB = slotDB();
  applyTheme();
  renderTopRight(); renderSidenav();
  initAutoHideBars();      // v25：下滑隐藏顶部两栏 / 上滑或鼠标移到顶部显现
  const h0 = location.hash.slice(1).split('?')[0];
  /* v41：后台管理支持二级路由 #admin/<子页>（如 #admin/users），
     校验时按「顶级名 + 子页是否登记过」判断，否则刷新后台子页会被踢回卡牌页 */
  const h0Top = h0.split('/')[0];
  const h0Ok = h0Top === 'campaign' || ROUTE_META.some(m => m.key === h0Top)
    || (h0Top === 'admin' && /^admin\/[A-Za-z0-9_-]+$/.test(h0) && !!adminPage(h0.slice(6)));
  if (!h0 || !h0Ok) location.hash = '#cards';
  renderRoute();
  if (cloudOn()) {
    await cloudBoot();
    await cloudLoadFeatures();
    await cloudLoadOverrides();     // 我的单账号权限覆盖
    await cloudProbe();
    if (isSignedIn()) await tryPullFromCloud(true);
    /* v30：站点版本 / 更新公告 + 云端数据包（管理员上传的数据，覆盖内置静态数据） */
    await cloudLoadVersion();
    await cloudLoadBookMeta();      // v31：书籍书名 / 类别的云端覆盖
    await applyCloudPacks();
  } else {
    console.warn('[cloud] SDK 未加载，仅本机模式');
  }
  DB = DB && DB.settings ? DB : slotDB();
  applyTheme();        // 云端档案回来后（可能换到账号数据槽 / 拉到云端主题）重新上色
  renderTopRight(); renderSidenav(); renderRoute(); renderSessionBar();

  renderVerChip();                 // v30：顶栏版本号（点开看公告）
  maybeShowRelease();              // v30：新版本首次进入弹一次公告

  /* 刷新后只恢复了本机缓存身份（云端会话暂未确认）→ 冷却结束后静默补一次，
     成功则自动补全专属 ID / 管理员权限 / 云同步，不必手动登出重登 */
  if (cloudOn() && sessionState() === 'restoring') scheduleSilentReconnect(2500);

  /* 已登录却没有专属 ID：补一次（多见于首次登录或会话刚恢复时） */
  if (cloudOn() && sessionState() === 'ok' && !userPublicId()) {
    const id = await cloudEnsurePublicId().catch(() => null);
    if (id) { renderTopRight(); renderRoute(); }
  }

  /* SDK 侧会话变化（如另一标签页登录 / 令牌补发）→ 同步界面 */
  try {
    cloud?.auth?.onAuthStateChange?.((_e, s) => {
      if (!s || !s.user) return;
      if (sessionState() !== 'ok') cloudReconnect().then(r => {
        if (!r.ok) return;
        applyTheme(); renderTopRight(); renderSidenav(); renderSessionBar(); renderRoute();
      });
    });
  } catch (e) { /* 老版本 SDK 无此接口，忽略 */ }
})();
