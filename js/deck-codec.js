/* 牌组分享码编解码：EBR1.<base64url(JSON)>
 * payload = {b:背景id, s:专长id, p:性格code, a:属性code, d:{卡id:数量}}
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
      const payload = { b: deck.background, s: deck.specialty, p: deck.personality, a: deck.aspect, d: deck.cards };
      return 'EBR1.' + b64urlEncode(JSON.stringify(payload));
    },
    decode(code) {
      const m = /^EBR1\.([A-Za-z0-9\-_]+)$/.exec(code.trim());
      if (!m) return null;
      try {
        const p = JSON.parse(b64urlDecode(m[1]));
        return { background: p.b, specialty: p.s, personality: p.p, aspect: p.a, cards: p.d || {} };
      } catch (e) { return null; }
    },
  };
})();
