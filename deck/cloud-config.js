/* ============================================================
 * 离线版配置（由 edgeone/pack_offline.mjs 生成，别手改线上产物）
 * ------------------------------------------------------------
 * 这一版没有服务端：所有数据存在浏览器 localStorage 里，
 * 不上传、不需要登录、不产生任何网络请求。
 *
 * 跨设备/换浏览器要搬数据：个人中心 → 导出备份 JSON → 新设备导入。
 * ============================================================ */
window.CLOUD_CONFIG = {
  backend: 'offline',
  enabled: false,   /* 关闭云端：前端自动降级为纯本地模式 */
  apiBase: '',
  endpoint: '',
  oauthRelayBaseUrl: '',
  publishableKey: '',
  supabaseUrl: '',
  supabaseAnonKey: '',
};
