/* 路由与启动 */
(function () {
  const routes = [
    { re: /^#\/cards(?:\/(.*))?$/, view: () => ViewCards, nav: 'cards' },
    { re: /^#\/deck(?:\/(.*))?$/, view: () => ViewDeck, nav: 'deck' },
    { re: /^#\/errata\/?$/, view: () => ViewErrata, nav: 'errata' },
  ];

  function route() {
    const hash = location.hash || '#/cards';
    const el = document.getElementById('view');
    for (const r of routes) {
      const m = r.re.exec(hash);
      if (m) {
        document.querySelectorAll('#topbar nav a').forEach(a =>
          a.classList.toggle('active', a.dataset.nav === r.nav));
        r.view().render(el, m[1] ? [m[1]] : []);
        window.scrollTo(0, 0);
        return;
      }
    }
    location.hash = '#/cards';
  }

  window.addEventListener('hashchange', route);
  DB.ready.then(route).catch(err => {
    document.getElementById('view').innerHTML =
      '<div class="empty-hint">数据加载失败：' + err.message +
      '<br>请先运行 tools-site\\build_data.py 生成数据文件，并通过 http 服务访问（python -m http.server）。</div>';
  });
})();
