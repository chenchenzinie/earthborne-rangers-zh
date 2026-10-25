/* ============================================================
 * 云端账户与数据同步层 —— 国内站版（腾讯云 EdgeOne Pages）
 * ------------------------------------------------------------
 * 与 cloud.js 的区别：
 *   1. 后端换成自建的 EdgeOne 边缘函数（/api/*），不再依赖
 *      WorkBuddy 云或 Supabase —— 两者一个按资源点计费、一个被墙。
 *   2. 鉴权自建：邮箱 + 密码（PBKDF2），token 存 localStorage，
 *      刷新后无需联网即可恢复身份。
 *   3. 数据按用户整体存一份 KV，但保留了「内容指纹去重」，
 *      内容没变时一个请求都不发。
 *   4. 自制卡插画从主数据里拆出来，单独存键，避免主数据
 *      超过 KV 单值上限（这是旧后端最烧资源的地方）。
 *
 * 对外函数签名与 cloud.js 完全一致，app.js 不需要改动。
 * ============================================================ */
'use strict';

/* ---------------- 状态（与 cloud.js 同名同义） ---------------- */
let cloud = null;
let CLOUD_OK = false;
let CLOUD_DOWN = false;
let SESSION = null;
let SESSION_CONFIRMED = false;
let PROFILE = null;
let ADMIN = false;
let SESSION_EMAIL = '';
let LAST_ERROR = null;
let _pending = null;
let _resetPending = null;
let _pushPending = null;
let SYNC_STATE = 'off';
let _pushTimer = null;
let _lastPushSig = null;
let FEATURES = {};
let MY_OVERRIDES = {};
let BOOK_META = {};

/* 站点版本：**任何时候都必须是对象**，不能是 null。
   离线版（enabled:false）拿不到后端配置，如果这里是 null，app.js 里
   renderVerChip / maybeShowRelease 会直接读 .title / .notes 而抛 TypeError。 */
const SITE_VERSION_FALLBACK = 'v46-gg';
let SITE_VERSION = { version: SITE_VERSION_FALLBACK, title: '', notes: '', published_at: '' };
const LS_TOKEN = 'ebr_eo_token';
const LS_IDENTITY = 'ebr_dm_identity';
const LS_TOUCH = 'ebr_eo_touch_day';

/* 开发者/站长的固定管理员邮箱（与后端 BOOT_ADMIN_EMAILS 对应） */
const IMMUTABLE_ADMINS = ['chenchenzi@local'];
const isImmutableAdmin = () => {
  const e = (SESSION?.user?.email || PROFILE?.email || SESSION_EMAIL || '').trim().toLowerCase();
  return !!e && IMMUTABLE_ADMINS.some(x => x.toLowerCase() === e);
};

/* ---------------- 基础状态判断 ---------------- */
function initCloud() {
  if (typeof window.CLOUD_CONFIG === 'undefined') return false;
  const cfg = window.CLOUD_CONFIG || {};
  if (cfg.enabled === false) { CLOUD_OK = false; return false; }
  cloud = { apiBase: String(cfg.apiBase || '').replace(/\/+$/, '') };
  CLOUD_OK = true;
  return true;
}

const cloudOn = () => CLOUD_OK && !!cloud;
/* 离线版：配置显式关掉了云端（enabled:false）。此时没有任何服务端可登录，
   权限判定要按「本机使用者」来放行，而不是按游客。 */
const OFFLINE_MODE = (() => {
  try { return !!(window.CLOUD_CONFIG && window.CLOUD_CONFIG.enabled === false); } catch (e) { return false; }
})();
const isSignedIn = () => !!SESSION;
const sessionState = () => (!isSignedIn() ? 'off' : (SESSION_CONFIRMED ? 'ok' : 'restoring'));
const cloudSessionOk = () => !!SESSION && SESSION_CONFIRMED;
const isAdmin = () => ADMIN;
const isBeta = () => !!PROFILE && PROFILE.role === 'beta';

const userRole = () => {
  if (isSignedIn()) {
    if (ADMIN || isImmutableAdmin()) return 'admin';
    const r = PROFILE?.role;
    if (r === 'admin' || r === 'beta' || r === 'user') return r;
    return 'user';
  }
  /* 离线版（enabled:false）没有账号体系，也就无处登录 ——
     如果这里的游客身份照旧返回 'guest'，构筑器 / 校对这些最低要求
     'user' 的页面会永远进不去，等于整站残废。
     所以离线模式下「本机使用者」直接按最高权限对待：这台机器上只有
     作者自己，没有别人可防；数据本来也只存在本机。 */
  if (OFFLINE_MODE) return 'admin';
  return CLOUD_DOWN ? 'user' : 'guest';
};

const featureFlags = () => FEATURES;
const featureOf = key => FEATURES[key] || null;
const userEmail = () => SESSION?.user?.email || PROFILE?.email || SESSION_EMAIL || '';
const userPublicId = () => PROFILE?.public_id || '';
const userDisplayName = () => (PROFILE?.display_name || '').trim();
const userTag = () => SESSION?.user?.id || PROFILE?.owner_id || '';

function noteError(where, e) {
  const msg = (typeof e === 'string') ? e
    : (e && (e.message || e.error_description || e.msg)) || (e ? JSON.stringify(e).slice(0, 200) : '未知错误');
  LAST_ERROR = { where, message: String(msg), at: new Date().toISOString() };
  console.warn('[cloud:' + where + ']', msg);
  return LAST_ERROR;
}

/* ---------------- 身份本机缓存 ---------------- */
function saveIdentity() {
  try {
    const uid = SESSION?.user?.id || PROFILE?.owner_id || '';
    if (!uid) return;
    localStorage.setItem(LS_IDENTITY, JSON.stringify({
      uid, email: userEmail() || '',
      role: PROFILE?.role || (ADMIN ? 'admin' : 'user'),
      public_id: PROFILE?.public_id || '',
      admin: !!ADMIN, at: Date.now(),
    }));
  } catch (e) { /* 隐私模式下忽略 */ }
}

function clearIdentity() { try { localStorage.removeItem(LS_IDENTITY); } catch (e) {} }

function restoreIdentity() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_IDENTITY) || 'null');
    if (!s || !s.uid) return null;
    if (!SESSION) SESSION = { user: { id: s.uid, email: s.email || undefined } };
    if (!PROFILE) PROFILE = { owner_id: s.uid, email: s.email || null, role: s.role || 'user', public_id: s.public_id || null };
    if (s.email && !SESSION_EMAIL) SESSION_EMAIL = s.email;
    if (s.admin || s.role === 'admin') ADMIN = true;
    return s;
  } catch (e) { return null; }
}

/* ---------------- HTTP ---------------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));

function getToken() { try { return localStorage.getItem(LS_TOKEN) || ''; } catch (e) { return ''; } }
function setToken(t) { try { t ? localStorage.setItem(LS_TOKEN, t) : localStorage.removeItem(LS_TOKEN); } catch (e) {} }

/** 统一请求；返回 {ok, ...} 或 {ok:false, error:{message}}，永不抛异常 */
async function api(action, body, method) {
  const m = method || (body == null ? 'GET' : 'POST');
  const url = (cloud ? cloud.apiBase : '') + '/api/' + action;
  try {
    const headers = { 'Content-Type': 'application/json' };
    const tk = getToken();
    if (tk) headers['Authorization'] = 'Bearer ' + tk;
    const r = await fetch(url, {
      method: m,
      headers,
      body: m === 'GET' ? undefined : JSON.stringify(body || {}),
      cache: 'no-store',
    });
    let data = null;
    const text = await r.text();
    try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { ok: false, error: { message: '返回内容不是 JSON：' + text.slice(0, 120) } }; }
    if (!r.ok && data && data.ok !== false) data = { ok: false, error: { message: 'HTTP ' + r.status } };
    if (data && data.error && !data.error.message) data.error.message = '请求失败（HTTP ' + r.status + '）';
    CLOUD_DOWN = false;
    return data || { ok: false, error: { message: '空响应' } };
  } catch (e) {
    CLOUD_DOWN = true;
    return { ok: false, error: { message: (e && e.message) || '网络不可达' } };
  }
}

function applyProfile(p) {
  if (!p) return;
  PROFILE = {
    owner_id: p.uid || p.owner_id,
    email: p.email || null,
    display_name: p.display_name || null,
    role: p.role || 'user',
    public_id: p.public_id || null,
    anon: !!p.anon,
    created_at: p.created_at || null,
  };
  ADMIN = PROFILE.role === 'admin' || isImmutableAdmin();
  if (PROFILE.email) SESSION_EMAIL = PROFILE.email;
  if (!SESSION) SESSION = { user: { id: PROFILE.owner_id, email: PROFILE.email || undefined } };
}

/** 用本机 token 换回身份；无网络时保留缓存身份（不误判为未登录） */
async function cloudBoot() {
  if (!cloudOn()) return null;
  if (!getToken()) {
    SESSION = null; SESSION_CONFIRMED = false; SYNC_STATE = 'off';
    return null;
  }
  const r = await api('whoami', null, 'GET');
  if (r && r.ok && r.profile) {
    SESSION = { user: { id: r.profile.uid, email: r.profile.email || undefined } };
    SESSION_CONFIRMED = true;
    applyProfile(r.profile);
    saveIdentity();
    return SESSION;
  }
  // 401 = token 失效（过期或密钥换了）；网络错误则保留本机身份
  const msg = (r && r.error && r.error.message) || '';
  if (/登录|失效|未登录|401/.test(msg)) {
    setToken('');
    SESSION = null; SESSION_CONFIRMED = false; PROFILE = null; ADMIN = false;
    SYNC_STATE = 'off';
    return null;
  }
  SESSION_CONFIRMED = false;
  return null;
}

async function cloudProbe() {
  const r = await api('health', null, 'GET');
  const ok = !!(r && r.ok && r.kv);
  CLOUD_DOWN = !ok;
  return ok;
}

function cloudDiag() {
  return {
    sdk: cloudOn(),
    config: typeof window.CLOUD_CONFIG !== 'undefined',
    endpoint: (window.CLOUD_CONFIG && window.CLOUD_CONFIG.apiBase) || '(同源)',
    backend: 'edgeone',
    origin: typeof location !== 'undefined' ? location.origin : '',
    cloudOn: cloudOn(),
    cloudDown: CLOUD_DOWN,
    signedIn: isSignedIn(),
    sessionState: sessionState(),
    uid: userTag() || null,
    email: userEmail() || null,
    publicId: userPublicId() || null,
    profile: PROFILE ? { owner_id: PROFILE.owner_id, email: PROFILE.email, role: PROFILE.role } : null,
    admin: ADMIN,
    role: userRole(),
    features: FEATURES,
    overrides: MY_OVERRIDES,
    sync: SYNC_STATE,
    lastError: LAST_ERROR,
  };
}

async function cloudReconnect() {
  const s = await cloudBoot();
  if (!s) return { ok: false, msg: '仍未取到会话，可能需要重新登录' };
  await cloudLoadFeatures();
  await cloudLoadVersion();
  await cloudTouchLogin();
  return { ok: true, msg: '已重新连接' };
}

/* ---------------- 登录 / 注册 ---------------- */
function afterAuth(r) {
  if (!r || !r.ok) return r || { error: { message: '登录失败' } };
  setToken(r.token || '');
  SESSION = { user: { id: r.profile.uid, email: r.profile.email || undefined } };
  SESSION_CONFIRMED = true;
  applyProfile(r.profile);
  saveIdentity();
  return r;
}

async function cloudSignInPassword(email, password) {
  if (!cloudOn()) return { error: { message: '云端服务未就绪，请刷新页面重试' } };
  const r = await api('login', { email, password });
  if (!r.ok) { noteError('signIn', r.error); return { error: { message: r.error.message } }; }
  return afterAuth(r);
}

/** 免注册：直接开一个匿名账号（数据照样存云端） */
async function cloudSignInAnon() {
  if (!cloudOn()) return { error: { message: '云端服务未就绪，请刷新页面重试' } };
  const r = await api('anon', {});
  if (!r.ok) { noteError('signInAnon', r.error); return { error: { message: r.error.message } }; }
  return afterAuth(r);
}

/** 注册：国内站用邮箱 + 密码，不走邮件验证码（免费额度里没有可靠发信通道） */
async function cloudSignUp(email, password) {
  if (!cloudOn()) return { error: { message: '云端服务未就绪，请刷新页面重试' } };
  const r = await api('reg', { email, password });
  if (!r.ok) { noteError('signUp', r.error); return { error: { message: r.error.message } }; }
  return afterAuth(r);
}

/** 匿名账号升级为正式账号 */
async function cloudBindEmail(email, password) {
  const r = await api('bind', { email, password });
  if (!r.ok) return { error: { message: r.error.message } };
  applyProfile(r.profile);
  saveIdentity();
  return r;
}

/** 验证码登录已停用：国内站没有可靠的免费发信通道 */
async function cloudSendCode(_email) {
  return { error: { message: '国内站已改为「邮箱 + 密码」登录，请用密码页签；不需要验证码' } };
}

async function cloudVerifyCode(_email, _code, _password) {
  return { error: { message: '国内站已改为「邮箱 + 密码」登录，请用密码页签' } };
}

async function cloudSendResetCode(_email) {
  return { error: { message: '暂不支持自助改密邮件；如需重置请找站长' } };
}

async function cloudResetPassword(_email, _code, _newPassword) {
  return { error: { message: '暂不支持自助改密邮件；如需重置请找站长' } };
}

async function cloudForgotPassword(_email) {
  return { error: { message: '暂不支持自助改密邮件；如需重置请找站长' } };
}

/** 改密：需已登录，用旧密码换新密码 */
async function cloudChangePassword(oldPw, newPw) {
  const r = await api('pw', { old: oldPw, new: newPw });
  if (!r.ok) return { error: { message: r.error.message } };
  return r;
}

async function cloudSignOut() {
  setToken('');
  _pending = null; _resetPending = null;
  SESSION = null; PROFILE = null; ADMIN = false; SYNC_STATE = 'off';
  SESSION_CONFIRMED = false; MY_OVERRIDES = {}; _lastPushSig = null;
  clearIdentity();
}

/** 登录打点：一天最多写一次（旧实现每次刷新都写一条登录日志） */
async function cloudTouchLogin() {
  if (!cloudOn() || !SESSION) return false;
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem(LS_TOUCH) === today) return true;   // 今天打过卡，直接跳过
    localStorage.setItem(LS_TOUCH, today);
    return true;
  } catch (e) { return false; }
}

/* ---------------- 资料 ---------------- */
async function cloudLoadProfile(_retry) {
  if (!cloudOn() || !SESSION) { PROFILE = null; ADMIN = false; return; }
  const r = await api('whoami', null, 'GET');
  if (r && r.ok && r.profile) {
    applyProfile(r.profile);
    SESSION_CONFIRMED = true;
    saveIdentity();
  }
  return PROFILE;
}

async function cloudEnsurePublicId() {
  if (!cloudOn() || !SESSION) return null;
  if (PROFILE?.public_id) return PROFILE.public_id;
  await cloudLoadProfile();
  return PROFILE?.public_id || null;
}

async function cloudSetDisplayName(name) {
  if (!cloudOn() || !SESSION) return { error: { message: '未登录' } };
  const r = await api('name', { name });
  if (!r.ok) { noteError('setName', r.error); return { error: { message: r.error.message } }; }
  applyProfile(r.profile);
  saveIdentity();
  return { data: PROFILE };
}

/* ---------------- 站点配置 ---------------- */
async function cloudLoadFeatures() {
  if (!cloudOn()) return FEATURES;
  const r = await api('site', null, 'GET');
  if (r && r.ok && r.features) FEATURES = r.features;
  return FEATURES;
}

async function cloudLoadVersion() {
  if (!cloudOn()) return SITE_VERSION;
  const r = await api('site', null, 'GET');
  if (r && r.ok && r.version) SITE_VERSION = r.version;
  else if (!SITE_VERSION) SITE_VERSION = { version: SITE_VERSION_FALLBACK, title: '', notes: '', published_at: '' };
  return SITE_VERSION;
}

async function cloudLoadOverrides() {
  MY_OVERRIDES = {};
  return MY_OVERRIDES;
}

async function cloudListPacks() {
  return { data: [], error: null };
}

async function cloudPackPayload(_id) {
  return { data: null, error: { message: '国内站暂不提供线上资源包' } };
}

async function cloudLoadBookMeta() {
  return { data: BOOK_META, error: null };
}

async function cloudLoadReleases() {
  return { data: [], error: null };
}

/* ---------------- 数据同步 ---------------- */
/** 把 makerCards 里的 dataURL 提取成独立图片键，主数据只留 imgId */
async function extractMakerImages(db) {
  const cards = Array.isArray(db.makerCards) ? db.makerCards : [];
  const ids = [];
  const out = [];
  for (const c of cards) {
    if (!c || typeof c !== 'object') { out.push(c); continue; }
    const img = String(c.img || '');
    if (img.startsWith('data:image/')) {
      const id = String(c.id || c.uid || '').replace(/[^A-Za-z0-9]/g, '') || ('m' + ids.length);
      // 只有内容变了才重传（用长度 + 尾部 8 字符做指纹，几乎不会撞）
      const fp = img.length + ':' + img.slice(-8);
      if (c.imgId === id && c.imgFp === fp) {
        ids.push(id);
        out.push({ ...c, img: '', imgId: id, imgFp: fp });
        continue;
      }
      const up = await api('img_put', { id, data: img });
      if (up && up.ok) {
        ids.push(id);
        out.push({ ...c, img: '', imgId: id, imgFp: fp });
      } else {
        // 上传失败时保留原图在本地，主数据不塞 base64（否则整份数据超限）
        out.push({ ...c, img: '', imgErr: (up && up.error && up.error.message) || '图片未同步' });
      }
    } else {
      if (c.imgId) ids.push(c.imgId);
      out.push(c);
    }
  }
  return { cards: out, ids };
}

/** 拉取后把独立图片键还原成 dataURL，供渲染层直接使用 */
async function mergeMakerImages(cards) {
  if (!Array.isArray(cards) || !cards.length) return cards || [];
  const need = cards.filter(c => c && c.imgId && !c.img);
  if (!need.length) return cards;
  const r = await api('img_all', {});
  const map = (r && r.ok && r.data) || {};
  return cards.map(c => {
    if (c && c.imgId && !c.img && map[c.imgId]) return { ...c, img: map[c.imgId] };
    return c;
  });
}

async function cloudPush(db) {
  if (!cloudOn() || !SESSION) return false;
  SYNC_STATE = 'syncing';
  try {
    const { cards } = await extractMakerImages(db);
    const lib = {
      collection: db.collection || {},
      ownAll: db.ownAll !== false,
      customs: db.customs || [],
      overrides: db.overrides || {},
      settings: db.settings || {},
      makerCards: cards,
    };
    const decks = db.decks || [];
    const proof = db.proof || {};

    /* 内容指纹：与上次成功推送一致时，一个请求都不发。
       只在成功后写入，失败不更新，避免把没推上去的内容误判为已同步。 */
    const sig = JSON.stringify({ l: lib, d: decks, p: proof });
    if (sig === _lastPushSig) { SYNC_STATE = 'synced'; return true; }

    const r = await api('push', { lib, decks, proof, campaigns: db.campaigns || [] });
    if (!r.ok) throw new Error(r.error.message);

    _lastPushSig = sig;
    SYNC_STATE = 'synced';
    return true;
  } catch (e) {
    noteError('push', e);
    SYNC_STATE = 'error';
    return false;
  }
}

async function cloudPull() {
  if (!cloudOn() || !SESSION) return null;
  SYNC_STATE = 'syncing';
  try {
    const r = await api('data', null, 'GET');
    if (!r.ok) throw new Error(r.error.message);
    let library = r.lib || null;
    if (library && Array.isArray(library.makerCards)) {
      library = { ...library, makerCards: await mergeMakerImages(library.makerCards) };
    }
    SYNC_STATE = 'synced';
    return { library, decks: r.decks || [] };
  } catch (e) {
    noteError('pull', e);
    SYNC_STATE = 'error';
    return null;
  }
}

function cloudPushSoon(db, ms = 3000) {
  if (!cloudOn() || !SESSION) return;
  SYNC_STATE = 'dirty';
  clearTimeout(_pushTimer);
  _pushPending = db;
  _pushTimer = setTimeout(async () => {
    _pushTimer = null; _pushPending = null;
    const ok = await cloudPush(db);
    if (typeof renderSyncBadge === 'function') renderSyncBadge();
    if (ok && typeof toast === 'function') toast('已同步到云端', 1200);
  }, ms);
}

function flushPendingPush() {
  if (typeof flushProofPush === 'function') { try { flushProofPush(true); } catch (e) { /* ignore */ } }
  if (!_pushTimer || !_pushPending) return;
  clearTimeout(_pushTimer);
  _pushTimer = null;
  const db = _pushPending; _pushPending = null;
  try { cloudPush(db); } catch (e) { /* 来不及就算了，本机已存盘 */ }
}

/* ---------------- 校对 ---------------- */
async function cloudPullProof() {
  if (!cloudOn()) return { data: null, error: { message: '云端服务未就绪' } };
  if (!cloudSessionOk()) return { data: null, error: { message: '请先登录后再下载' } };
  const r = await api('proofs', null, 'GET');
  if (!r.ok) { noteError('pullProof', r.error); return { data: null, error: { message: r.error.message } }; }
  return { data: r.data || [] };
}

async function cloudPushProof(rows) {
  if (!cloudOn()) return { data: null, error: { message: '云端服务未就绪' } };
  if (!cloudSessionOk()) return { data: null, error: { message: '请先登录后再上传' } };
  const list = rows || [];
  if (!list.length) return { data: true };
  const proof = {};
  for (const row of list) {
    const id = row.card_id || row.cardId || row.id;
    if (!id) continue;
    proof[id] = {
      status: row.status || null,
      note: row.note || '',
      updated_at: row.updated_at || new Date().toISOString(),
    };
  }
  const r = await api('push', { proof });
  if (!r.ok) { noteError('pushProof', r.error); return { data: null, error: { message: r.error.message } }; }
  return { data: true };
}

async function cloudProofStats() {
  if (!cloudOn()) return { data: null, error: { message: '云端服务未就绪' } };
  const r = await api('proofs', null, 'GET');
  if (!r.ok) { noteError('proofStats', r.error); return { data: null, error: { message: r.error.message } }; }
  return { data: r.stats || {} };
}

/* ---------------- 战役存档 ---------------- */
async function cloudPullCampaign() {
  if (!cloudOn()) return { data: [], error: { message: '云端服务未就绪' } };
  if (!cloudSessionOk()) return { data: [], error: { message: '请先登录账号后再使用云端存档' } };
  const r = await api('data', null, 'GET');
  if (!r.ok) { noteError('pullCampaign', r.error); return { data: [], error: { message: r.error.message } }; }
  return { data: r.campaigns || [], error: null };
}

async function cloudPushCampaign(slotNo, payload, label) {
  if (!cloudOn()) return { data: null, error: { message: '云端服务未就绪' } };
  if (!cloudSessionOk()) return { data: null, error: { message: '请先登录账号后再上传' } };
  const no = Math.min(3, Math.max(1, Number(slotNo) || 1));
  const row = { slot_no: no, label: String(label || ''), payload: payload || {}, updated_at: new Date().toISOString() };
  const r = await api('push', { campaigns: [row] });
  if (!r.ok) { noteError('pushCampaign', r.error); return { data: null, error: { message: r.error.message } }; }
  return { data: true, error: null };
}

async function cloudDeleteCampaign(slotNo) {
  if (!cloudSessionOk()) return { data: null, error: { message: '请先登录账号' } };
  const r = await api('push', { deletedSlots: [Number(slotNo) || 1] });
  if (!r.ok) { noteError('delCampaign', r.error); return { data: null, error: { message: r.error.message } }; }
  return { data: true, error: null };
}

/* ---------------- 邀请码 / 管理员认领 ---------------- */
async function cloudRedeemInvite(_code) {
  return { data: 'off', error: null };
}

async function cloudClaimFirstAdmin() {
  return { data: 'off', error: null };
}

async function cloudHasAnyAdmin() {
  const r = await api('has_admin', null, 'GET');
  return { data: true, error: null };
}

/* ---------------- 管理后台：能在国内站生效的部分 ---------------- */
/* 离线版（cloudOn()=false）没有服务端：后台的账号统计 / 登录记录 / 功能开关
   一律返回空，绝不发注定 404 的 /api 请求（否则控制台会报错，也违背
   「打开就是完整站点、零后端依赖」的承诺）。 */
async function adminSetFeature(key, enabled, minRole) {
  if (!cloudOn()) return { error: { message: '离线版没有服务端，功能开关不可修改（默认值已在 app.js 里）' } };
  const r = await api('set_feature', { key, enabled, min_role: minRole });
  if (!r.ok) return { error: { message: r.error.message } };
  FEATURES = r.features || FEATURES;
  return { data: true };
}

async function adminUserStats() {
  if (!cloudOn()) return { data: [], users: [] };
  const r = await api('user_stats', null, 'GET');
  if (!r.ok) return { data: null, error: { message: r.error.message } };
  return { data: r.data, users: r.users || [] };
}

async function adminRecentLogins() {
  if (!cloudOn()) return { data: [] };
  const r = await api('recent_logins', null, 'GET');
  if (!r.ok) return { data: [], error: { message: r.error.message } };
  return { data: r.data || [] };
}

/* 以下管理功能国内过渡站第一版不提供（邀请码/资源包/版本发布/权限覆盖），
   统一返回"未启用"而不是报错，避免后台页面白屏。 */
const NOT_ENABLED = { error: { message: '国内站暂未启用该功能' } };
async function adminSetRole() { return NOT_ENABLED; }
async function adminBatchSetRole() { return NOT_ENABLED; }
async function adminSetRoleLock() { return NOT_ENABLED; }
async function adminSetUserOverride() { return NOT_ENABLED; }
async function adminListUserOverrides() { return { data: [] }; }
async function adminListInvites() { return { data: [] }; }
async function adminUpsertInvite() { return NOT_ENABLED; }
async function adminDeleteInvite() { return NOT_ENABLED; }
async function adminUploadPack() { return NOT_ENABLED; }
async function adminSetPackActive() { return NOT_ENABLED; }
async function adminDeletePack() { return NOT_ENABLED; }
async function adminPublishVersion() {
  const r = await api('set_version', { version: arguments[0], title: arguments[1], notes: arguments[2] });
  return r && r.ok ? { data: true } : NOT_ENABLED;
}
async function adminSetBookMeta() { return NOT_ENABLED; }
async function adminClearBookMeta() { return NOT_ENABLED; }
