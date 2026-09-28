/* 卡牌浏览器：筛选 + 无限滚动 + 详情弹窗 */
window.ViewCards = (function () {
  const PAGE = 60;
  let state = { q: '', set: '', pack: '', type: '', aspect: '', onlyUnreviewed: false, shown: 0 };
  let observer = null;

  function options(arr) {
    return arr.map(([v, l]) => `<option value="${UI.esc(v)}">${UI.esc(l)}</option>`).join('');
  }

  function unique(field, labelField) {
    const m = new Map();
    DB.cards.forEach(c => {
      const v = c[field];
      if (v && !m.has(v)) m.set(v, c[labelField] || v);
    });
    return [...m.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'zh'));
  }

  function filtered() {
    const q = state.q.trim().toLowerCase();
    return DB.cards.filter(c => {
      if (state.set && c.set_id !== state.set) return false;
      if (state.pack && c.pack_id !== state.pack) return false;
      if (state.type && c.type_id !== state.type) return false;
      if (state.aspect && c.aspect_id !== state.aspect) return false;
      if (state.onlyUnreviewed && c.reviewed) return false;
      if (q) {
        const hay = [c.name_en, c.name_zh, c.text_en, c.text_zh, (c.traits_zh || []).join(' '), (c.traits || []).join(' ')]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function tile(c) {
    const tags = [];
    // 属性需求徽章：有 cost 时显示 "3 AWA"，否则只显示属性名
    if (c.cost != null && c.aspect_id) tags.push(`<span class="tag cost asp-${c.aspect_id}">${c.cost} ${c.aspect_id}</span>`);
    else if (c.aspect_zh) tags.push(`<span class="tag asp-${c.aspect_id}">${c.aspect_zh}</span>`);
    if (c.type_zh) tags.push(`<span class="tag">${c.type_zh}</span>`);
    if (c.pack_id) tags.push(`<span class="tag pack-${c.pack_id}">${UI.esc(c.pack_name_zh || c.pack_name_en || '')}</span>`);
    if (c.errata) tags.push('<span class="tag errata">勘误</span>');
    if (!c.reviewed) tags.push('<span class="tag noreview">未精翻</span>');
    return `<div class="card-tile" data-id="${c.id}">
      ${UI.imgTag(c)}
      <div class="ct-body">
        <div class="ct-name">${UI.esc(c.name_zh || c.name_en)}</div>
        <div class="ct-name-en">${UI.esc(c.name_en)}</div>
        <div class="ct-tags">${tags.join('')}</div>
      </div></div>`;
  }

  function renderList(reset) {
    const list = filtered();
    const grid = document.getElementById('card-grid');
    const info = document.getElementById('count-info');
    if (reset) { grid.innerHTML = ''; state.shown = 0; }
    const slice = list.slice(state.shown, state.shown + PAGE);
    grid.insertAdjacentHTML('beforeend', slice.map(tile).join(''));
    state.shown += slice.length;
    info.textContent = `显示 ${state.shown} / ${list.length} 张（共 ${DB.cards.length} 张）`;
    const sentinel = document.getElementById('scroll-sentinel');
    if (sentinel) sentinel.style.display = state.shown < list.length ? 'block' : 'none';
  }

  function render(el, params) {
    const sets = unique('set_id', 'set_name_zh');
    const packs = unique('pack_id', 'pack_name_zh');
    const types = unique('type_id', 'type_zh');
    const aspects = [['AWA', '知觉 AWA'], ['FIT', '体质 FIT'], ['FOC', '专注 FOC'], ['SPI', '精神 SPI']];
    el.innerHTML = `
      <h2 class="view-title">卡牌浏览</h2>
      <div class="filters">
        <input type="text" id="f-q" placeholder="搜索卡名 / 正文（中英文）" value="${UI.esc(state.q)}">
        <select id="f-set"><option value="">全部套牌</option>${options(sets)}</select>
        <select id="f-pack"><option value="">全部游戏盒</option>${options(packs)}</select>
        <select id="f-type"><option value="">全部类型</option>${options(types)}</select>
        <select id="f-aspect"><option value="">全部属性</option>${options(aspects)}</select>
        <label><input type="checkbox" id="f-unrev" ${state.onlyUnreviewed ? 'checked' : ''}> 仅看未精翻</label>
        <span class="count-info" id="count-info"></span>
      </div>
      <div class="card-grid" id="card-grid"></div>
      <div id="scroll-sentinel"></div>`;

    document.getElementById('f-set').value = state.set;
    document.getElementById('f-pack').value = state.pack;
    document.getElementById('f-type').value = state.type;
    document.getElementById('f-aspect').value = state.aspect;

    const rerender = () => renderList(true);
    document.getElementById('f-q').addEventListener('input', e => { state.q = e.target.value; rerender(); });
    document.getElementById('f-set').addEventListener('change', e => { state.set = e.target.value; rerender(); });
    document.getElementById('f-pack').addEventListener('change', e => { state.pack = e.target.value; rerender(); });
    document.getElementById('f-type').addEventListener('change', e => { state.type = e.target.value; rerender(); });
    document.getElementById('f-aspect').addEventListener('change', e => { state.aspect = e.target.value; rerender(); });
    document.getElementById('f-unrev').addEventListener('change', e => { state.onlyUnreviewed = e.target.checked; rerender(); });

    document.getElementById('card-grid').addEventListener('click', e => {
      const t = e.target.closest('.card-tile');
      if (t && DB.byId[t.dataset.id]) UI.cardDetail(DB.byId[t.dataset.id]);
    });

    if (observer) observer.disconnect();
    observer = new IntersectionObserver(es => {
      if (es.some(x => x.isIntersecting)) renderList(false);
    });
    observer.observe(document.getElementById('scroll-sentinel'));

    renderList(true);
    if (params && params[0] && DB.byId[params[0]]) UI.cardDetail(DB.byId[params[0]]);
  }

  return { render };
})();
