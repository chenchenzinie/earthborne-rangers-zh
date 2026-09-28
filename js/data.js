/* 数据加载与索引 */
window.DB = {
  cards: [], byId: {}, ranger: null, errata: [], meta: null,
  ready: null,
};
(function () {
  const files = {
    cards: 'data/cards.zh.json',
    ranger: 'data/ranger.zh.json',
    errata: 'data/errata.json',
    meta: 'data/meta.json',
  };
  DB.ready = Promise.all(Object.entries(files).map(([k, url]) =>
    fetch(url).then(r => {
      if (!r.ok) throw new Error(url + ' 加载失败: ' + r.status);
      return r.json();
    }).then(d => { DB[k] = d; })
  )).then(() => {
    DB.cards.forEach(c => { DB.byId[c.id] = c; });
    const mi = document.getElementById('meta-info');
    if (mi && DB.meta) {
      mi.textContent = `卡牌 ${DB.meta.card_count} · 中文名 ${DB.meta.name_zh_count} · 精修 ${DB.meta.text_zh_count} · 勘误 ${DB.meta.errata_total}`;
    }
  });
})();
