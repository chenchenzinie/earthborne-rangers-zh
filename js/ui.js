/* UI 公共组件：弹窗、卡文渲染、图片地址 */
window.UI = (function () {
  const REMOTE_IMG = 'https://static.rangersdb.com/';

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

  /* 图片：本地优先，加载失败回退 RangersDB 远程 */
  function imgTag(card, cls) {
    const local = card.image || '';
    const remote = REMOTE_IMG + local;
    return `<img ${cls ? `class="${cls}"` : ''} loading="lazy" src="${esc(local)}"
      onerror="if(!this.dataset.fb){this.dataset.fb=1;this.src='${esc(remote)}'}else{this.style.visibility='hidden'}"
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
          ${card.cost != null ? ' · 费用 ' + card.cost : ''}
          ${card.deck_limit != null ? ' · 牌组上限 ' + card.deck_limit : ''}</div>
        <div class="cd-row">${aspectTag} ${traits}
          <span class="tag">${esc(card.set_name_zh || card.set_name_en || '')}</span>
          ${card.errata ? '<span class="tag errata">有勘误</span>' : ''}
          ${card.reviewed ? '' : '<span class="tag noreview">未精翻</span>'}</div>
        <div class="cd-text">${renderText(txt)}${mtBadge}</div>
        ${card.text_zh ? `<div class="cd-text-en">${renderText(card.text_en)}</div>` : ''}
        ${errataHtml}
      </div></div>`);
  }

  return { esc, renderText, imgTag, openModal, closeModal, cardDetail };
})();
