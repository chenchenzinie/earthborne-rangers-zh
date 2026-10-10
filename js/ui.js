/* UI 公共组件：弹窗、卡文渲染、图片地址 */
window.UI = (function () {
  const REMOTE_IMG = 'https://static.rangersdb.com/';
  /* 资产版本号：替换 img/ 下卡图（如换汉化图）时同步 +1，游客即可立即看到新图 */
  const IMG_VER = '20261010';

  function esc(s) {
    return (s == null ? '' : String(s))
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* 卡文渲染：保留 <b>/<f>，[AWA] 等转彩色徽章 */
  function renderText(text) {
    let t = esc(text || '');
    t = t.replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>');
    t = t.replace(/&lt;f&gt;/g, '<span class="flv">').replace(/&lt;\/f&gt;/g, '</span>');
    t = t.replace(/\[(AWA|FIT|FOC|SPI)\]/g, '<span class="tok tok-$1">$1</span>');
    t = t.replace(/\[harm\]/g, '<span class="tok tok-harm">伤害</span>');
    t = t.replace(/\[(\d+|X)\]/g, '<span class="tok">$1</span>');
    return t;
  }

  /* 图片：本地优先，加载失败回退 RangersDB 远程；本地路径带版本号防缓存。
     无图卡用内联 SVG 占位——空 src 会被浏览器当作页面自身 URL 触发多余请求 */
  const PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="420">' +
    '<rect width="100%" height="100%" fill="#d8d3c8"/>' +
    '<text x="50%" y="50%" font-size="20" fill="#8a857a" text-anchor="middle" dominant-baseline="middle">暂无卡图</text></svg>');
  function imgTag(card, cls) {
    const local = card.image || '';
    const withVer = local ? local + '?v=' + IMG_VER : '';
    const remote = REMOTE_IMG + local;
    const src = withVer || PLACEHOLDER;
    return `<img ${cls ? `class="${cls}"` : ''} loading="lazy" src="${esc(src)}"
      onerror="if(!this.dataset.fb){this.dataset.fb=1;this.src='${esc(remote || PLACEHOLDER)}'}else{this.style.visibility='hidden'}"
      alt="${esc(card.name_zh || card.name_en)}">`;
  }

  function openModal(html) {
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="modal-mask"><div class="modal">
      <button class="modal-close" aria-label="关闭">×</button>${html}</div></div>`;
    const mask = root.firstElementChild;
    mask.addEventListener('click', e => { if (e.target === mask) closeModal(); });
    mask.querySelector('.modal-close').addEventListener('click', closeModal);
    document.addEventListener('keydown', escClose);
  }
  function escClose(e) { if (e.key === 'Escape') closeModal(); }
  function closeModal() {
    document.getElementById('modal-root').innerHTML = '';
    document.removeEventListener('keydown', escClose);
  }

  /* 卡牌详情弹窗（浏览器与组牌器共用） */
  function cardDetail(card) {
    const aspectTag = card.aspect_zh ? `<span class="tag asp-${card.aspect_id}">${card.aspect_zh} ${card.aspect_id}</span>` : '';
    const traits = (card.traits_zh || []).map(t => `<span class="tag">${esc(t)}</span>`).join('');
    const txt = card.text_zh || card.text_zh_mt || card.text_en || '';
    const mtBadge = card.text_zh ? '' :
      (card.text_zh_mt ? '<span class="mt-badge">机翻待校对</span>'
        : (card.text_en ? '<span class="mt-badge">英文原文（待翻译）</span>' : ''));
    // 属性需求徽章：有 cost 时显示 "3 AWA"（仿 RangersDB 原站）
    const costBadge = card.cost != null
      ? `<span class="tag cost asp-${card.aspect_id || 'none'}">${card.cost}${card.aspect_id ? ' ' + card.aspect_id : ''}</span>`
      : '';
    const packTag = card.pack_id
      ? `<span class="tag pack-${card.pack_id}">${esc(card.pack_name_zh || card.pack_name_en || '')}</span>`
      : '';
    let errataHtml = '';
    if (card.errata) {
      const e = (DB.errata.find(x => x.slug === card.errata.slug)) || {};
      errataHtml = `<div class="errata-box"><h4>⚠ 官方勘误 — 以修正文本为准
        <a class="errata-toggle" href="${esc(card.errata.url)}" target="_blank">官网原文 ↗</a></h4>
        <div class="cd-text">${renderText(e.text_en_fixed || '')}</div></div>`;
    }
    openModal(`<div class="card-detail">
      ${imgTag(card)}
      <div class="cd-info">
        <h2>${esc(card.name_zh || card.name_en)}</h2>
        <div class="cd-en">${esc(card.name_en)}</div>
        <div class="cd-row">${esc(card.type_zh || card.type_en || '')}
          ${costBadge ? ' · 属性需求 ' + costBadge : ''}
          ${card.deck_limit != null ? ' · 牌组上限 ' + card.deck_limit : ''}</div>
        <div class="cd-row">${aspectTag} ${traits}
          <span class="tag">${esc(card.set_name_zh || card.set_name_en || '')}</span>
          ${packTag}
          ${card.errata ? '<span class="tag errata">有勘误</span>' : ''}
          ${card.reviewed ? '' : '<span class="tag noreview">未精翻</span>'}</div>
        <div class="cd-text">${renderText(txt)}${mtBadge}</div>
        ${card.text_zh ? `<div class="cd-text-en">${renderText(card.text_en)}</div>` : ''}
        ${errataHtml}
      </div></div>`);
  }

  return { esc, renderText, imgTag, openModal, closeModal, cardDetail };
})();
