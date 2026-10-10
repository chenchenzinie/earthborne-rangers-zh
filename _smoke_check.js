/* 冒烟自检：用最小 DOM stub 加载 ui.js / view-cards.js，验证渲染产物 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const W = path.resolve(__dirname);
const read = f => fs.readFileSync(path.join(W, f), 'utf8');

/* ---- 极简 DOM stub ---- */
function mkEl(id) {
  const el = {
    id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {},
    querySelectorAll: () => [], querySelector: () => null,
    insertAdjacentHTML(pos, html) { el.innerHTML += html; },
    appendChild() {}, closest: () => null,
    firstElementChild: null, getAttribute: () => null,
  };
  return el;
}
const els = {};
const document = {
  getElementById: id => (els[id] = els[id] || mkEl(id)),
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
};
const sandbox = {
  window: null, document, console,
  IntersectionObserver: class { constructor() {} observe() {} disconnect() {} },
  TextEncoder, TextDecoder, btoa, atob, location: { hash: '', origin: '', pathname: '' },
  fetch: () => Promise.reject(new Error('no fetch in stub')),
};
sandbox.window = sandbox;
vm.createContext(sandbox);

vm.runInContext(read('js/ui.js'), sandbox);
vm.runInContext(read('js/view-cards.js'), sandbox);

const UI = sandbox.UI, ViewCards = sandbox.ViewCards;

/* ---- 构造 280 张卡数据的精简版，覆盖 4 属性 ---- */
const cards = [
  { id: '01003', name_en: 'Strider', name_zh: '健行者', type_id: 'attribute', type_zh: '属性',
    aspect_id: 'FIT', aspect_zh: '体质', cost: null, image: 'img/card/core/01003.jpg' },
  { id: '01100', name_en: 'Bold', name_zh: '果敢', type_id: 'attribute', type_zh: '属性',
    aspect_id: 'SPI', aspect_zh: '精神', cost: null, image: 'img/card/core/01100.jpg' },
  { id: '01200', name_en: 'Watcher', name_zh: '守望', type_id: 'moment', type_zh: '瞬间',
    aspect_id: 'AWA', aspect_zh: '知觉', cost: 2, image: 'img/card/core/01200.jpg' },
  { id: '01300', name_en: 'Thinker', name_zh: '沉思', type_id: 'moment', type_zh: '瞬间',
    aspect_id: 'FOC', aspect_zh: '专注', cost: 3, image: 'img/card/core/01300.jpg' },
  { id: '01400', name_en: 'NoImg', name_zh: '无图卡', type_id: 'gear', type_zh: '装备',
    aspect_id: null, aspect_zh: null, cost: null, image: null },
];
const byId = {}; cards.forEach(c => { byId[c.id] = c; });
sandbox.DB = { cards, byId, ranger: null, errata: [], meta: null };

/* ---- 断言 1：imgTag 本地路径带版本号；远程回退不变；空图不产生裸 src ---- */
const tagWithImg = UI.imgTag(byId['01003']);
const tagNoImg = UI.imgTag(byId['01400']);
console.assert(tagWithImg.includes('img/card/core/01003.jpg?v=20261010'),
  'FAIL 卡图未带版本号: ' + tagWithImg);
console.assert(tagWithImg.includes("static.rangersdb.com/img/card/core/01003.jpg"),
  'FAIL 远程回退地址异常: ' + tagWithImg);
console.assert(!/<img[^>]*src=""/.test(tagNoImg), 'FAIL 无图卡产生空 src: ' + tagNoImg);
console.assert(tagNoImg.includes('data:image/svg+xml'), 'FAIL 无图卡未用占位图: ' + tagNoImg);
console.log('[1] 卡图版本戳: ' + (tagWithImg.match(/src="([^"]+)"/) || [])[1]);
console.log('[1] 无图卡 src: data:image/svg+xml,…（占位图，符合预期）');

/* ---- 断言 2：属性下拉从数据聚合，顺序 AWA/FIT/FOC/SPI，含中文名 ---- */
const el = mkEl('view');
ViewCards.render(el, []);
const html = el.innerHTML;
const opts = [...html.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)]
  .map(m => [m[1], m[2]]);
const aspectOpts = opts.filter(o => ['AWA', 'FIT', 'FOC', 'SPI'].includes(o[0]));
console.log('[2] 属性下拉项: ' + JSON.stringify(aspectOpts));
console.assert(aspectOpts.length === 4, 'FAIL 属性下拉应为 4 项，实际 ' + aspectOpts.length);
console.assert(aspectOpts.map(o => o[0]).join(',') === 'AWA,FIT,FOC,SPI',
  'FAIL 属性顺序应为 AWA,FIT,FOC,SPI，实际 ' + aspectOpts.map(o => o[0]).join(','));
console.assert(aspectOpts.every(o => /[一-鿿]/.test(o[1])),
  'FAIL 属性下拉缺少中文名: ' + JSON.stringify(aspectOpts));

/* ---- 断言 3：卡牌列表渲染正常，计数信息存在 ---- */
console.assert(html.includes('卡牌浏览'), 'FAIL 视图标题缺失');
const count = els['count-info'] ? els['count-info'].textContent : '';
console.log('[3] 计数信息: ' + count);
console.assert(/显示 \d+ \/ \d+ 张/.test(count), 'FAIL 计数信息格式异常: ' + count);

/* ---- 断言 4：data.js 内容检查（静态源码级） ---- */
const dataSrc = read('js/data.js');
console.assert(/cache:\s*'no-cache'/.test(dataSrc), 'FAIL data.js 未加 cache:no-cache');
console.log('[4] data.js 强制 revalidate: ' + (/cache:\s*'no-cache'/.test(dataSrc) ? '已启用' : '缺失'));

/* ---- 断言 5：index.html 版本号一致 ---- */
const idx = read('index.html');
const vers = [...idx.matchAll(/\?v=(\d+)/g)].map(m => m[1]);
console.log('[5] index.html 版本号: ' + JSON.stringify([...new Set(vers)]));
console.assert(new Set(vers).size === 1 && vers[0] === '20261010',
  'FAIL index.html 版本号未统一为 20261010: ' + JSON.stringify([...new Set(vers)]));
console.assert(idx.includes('http-equiv="Cache-Control"'), 'FAIL index.html 缺 meta no-cache');

console.log('\n—— 冒烟自检完成（无 FAIL 即通过）——');
