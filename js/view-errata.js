/* 官方勘误页：与 earthbornegames.com 同步的勘误列表 */
window.ViewErrata = (function () {
  function render(el) {
    const items = DB.errata || [];
    el.innerHTML = `<h2 class="view-title">官方卡牌勘误
        <span style="font-size:.8rem;color:var(--fg-dim);font-weight:400">
        （来源：earthbornegames.com · Living Valley，以勘误文本为准）</span></h2>
      ${items.map(e => {
        const card = e.card_id ? DB.byId[e.card_id] : null;
        const nameHtml = card
          ? `<a href="#/cards/${card.id}">${UI.esc(card.name_zh || card.name_en)}</a>
             <span class="attached-badge">已关联卡牌</span>`
          : UI.esc(e.title || e.slug);
        return `<div class="errata-item">
          <h3>${nameHtml}</h3>
          <div class="ei-slug">${UI.esc(e.title || '')} · ${UI.esc(e.slug)}</div>
          <div class="ei-text">${UI.renderText(e.text_en_fixed || '')}</div>
          <a class="ei-link" href="${UI.esc(e.url)}" target="_blank">在官网查看 ↗</a>
        </div>`;
      }).join('') || '<div class="empty-hint">暂无勘误数据</div>'}
      <p style="color:var(--fg-dim);font-size:.8rem;margin-top:10px">
        数据同步方式：运行 tools-site\\update_all.bat 重新抓取官网勘误。</p>`;
  }
  return { render };
})();
