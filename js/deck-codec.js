/* 牌组分享码编解码：EBR1.<base64url(JSON)>
 * payload v2 = {v:2, b:背景id, s:专长id, a:属性数组[AWA,FIT,FOC,SPI], r:角色卡id,
 *               p:[4张性格卡id], k:[背景选卡×5], j:[专长选卡×5], i:[兴趣卡×1]}
 * 数量恒定：性格/选卡每张 2 副本，总牌数 = 2×(4+5+5+1) = 30
 * 注：旧版 a 字段是属性卡 id 字符串，新版改为 4 维数值数组；
 *     decode 时不做迁移，由 view-deck.js renderAspect/loadCurrent 负责字符串→数组的兜底转换
 */
window.DeckCodec = (function () {
  function b64urlEncode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    bytes.forEach(b => bin += String.fromCharCode(b));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(b64) {
    b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  return {
    encode(deck) {
      if (!deck.background || !deck.specialty) return '';
      const payload = {
        v: 2,
        b: deck.background, s: deck.specialty,
        a: deck.aspect || null, r: deck.role || null,
        p: deck.personalities || [], k: deck.bgPicks || [], j: deck.spPicks || [],
        i: deck.interest ? [deck.interest] : [],
      };
      return 'EBR1.' + b64urlEncode(JSON.stringify(payload));
    },
    decode(code) {
      const m = /^EBR1\.([A-Za-z0-9\-_]+)$/.exec((code || '').trim());
      if (!m) return null;
      try {
        const p = JSON.parse(b64urlDecode(m[1]));
        if (p.v !== 2) return null;
        return {
          name: '分享的牌组',
          aspect: p.a || null, background: p.b, specialty: p.s, role: p.r || null,
          personalities: Array.isArray(p.p) ? p.p : [],
          bgPicks: Array.isArray(p.k) ? p.k : [],
          spPicks: Array.isArray(p.j) ? p.j : [],
          interest: (p.i && p.i[0]) || null,
        };
      } catch (e) { return null; }
    },
  };
})();
