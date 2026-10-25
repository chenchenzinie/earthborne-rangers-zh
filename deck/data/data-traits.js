/* ============================================================
 * 性格牌（trait）四色分组
 * —— 由卡图实测主色聚类得出（取样脚本：_extract/probe_trait_color.js）
 *    24 张 = 4 色 × 6 张，同一颜色的性格牌归为一组。
 * —— 颜色 → 属性的对应关系由用户裁定（绿=知 / 蓝=专 / 红=体 / 黄=精），
 *    如需改动只改这里即可，界面与规则都从这里读。
 * —— req：该性格牌的「属性需求」点数。卡图上的小字需求尚未 OCR 校对，
 *    统一按 1 处理（数据补全后在这里按 card_id 覆写即可）。
 * ============================================================ */
'use strict';

const TRAIT_GROUPS = [
  { key: 'green',  label: '绿', attr: '知', color: '#84ad60',
    cards: ['tr-base-8', 'tr-base-10', 'tr-base-11', 'tr-base-14', 'tr-valley-1', 'tr-valley-5'] },
  { key: 'blue',   label: '蓝', attr: '专', color: '#7fb4c8',
    cards: ['tr-base-1', 'tr-base-3', 'tr-base-6', 'tr-base-13', 'tr-valley-4', 'tr-valley-7'] },
  { key: 'red',    label: '红', attr: '体', color: '#d44c49',
    cards: ['tr-base-4', 'tr-base-5', 'tr-base-9', 'tr-base-12', 'tr-valley-2', 'tr-valley-8'] },
  { key: 'yellow', label: '黄', attr: '精', color: '#dba86c',
    cards: ['tr-base-2', 'tr-base-7', 'tr-base-15', 'tr-base-16', 'tr-valley-3', 'tr-valley-6'] },
];

/* cardId -> 分组对象 */
const TRAIT_GROUP_OF = {};
TRAIT_GROUPS.forEach(g => g.cards.forEach(id => { TRAIT_GROUP_OF[id] = g; }));

/* cardId -> 需求点数（未校对：一律 1）。校对后在这里加 'tr-base-1': 2 之类即可 */
const TRAIT_REQ_FIX = {};

const traitGroup = id => TRAIT_GROUP_OF[id] || null;
const traitGroupKey = id => (TRAIT_GROUP_OF[id] || {}).key || 'other';
/* 需求点数：卡自带 attr 优先，其次人工覆写，都没有则 1（待校对） */
function traitReq(c) {
  if (!c) return 1;
  if (c.attr && Object.keys(c.attr).length) {
    const g = TRAIT_GROUP_OF[c.id];
    const k = g ? g.attr : Object.keys(c.attr)[0];
    return c.attr[k] ?? Math.max(...Object.values(c.attr));
  }
  return TRAIT_REQ_FIX[c.id] ?? 1;
}
/* 该性格牌是否已校对过需求（用于界面标注「需求待校对」） */
const traitReqPending = c => !c || (!(c.attr && Object.keys(c.attr).length) && TRAIT_REQ_FIX[c.id] == null);

if (typeof window !== 'undefined') {
  window.TRAIT_GROUPS = TRAIT_GROUPS;
  window.TRAIT_GROUP_OF = TRAIT_GROUP_OF;
  window.traitGroup = traitGroup;
  window.traitReq = traitReq;
}
