/**
 * 身份桥（content script，注入到 ds 网页里执行）。
 *
 * 目的：插件本身不知道你登录的是谁 —— 它上报走的是 @Public 接口（无登录态），
 * 所以采集数据原本一律 storeId=null（只归超管「全部」视图）。
 *
 * 这里在 ds 网页（登录页/主界面）里读取当前登录态（localStorage.ds_token + ds_user），
 * 推给 background 存起来；后台采集上报时带上 Authorization 头 → 后端解析出员工所在店铺 → 数据归店。
 *
 * 只在 ds 自己的域名下运行（见 manifest.content_scripts.matches），不碰其它站点。
 */
(function () {
  const TOKEN_KEY = 'ds_token';
  const USER_KEY = 'ds_user';
  let lastSig = '';

  function readIdentity() {
    try {
      const token = localStorage.getItem(TOKEN_KEY) || '';
      let u = null;
      try { u = JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (e) { u = null; }
      return {
        token: token,
        userId: u && u.id != null ? u.id : null,
        username: u ? u.username : null,
        nickname: u ? u.nickname : null,
        role: u ? u.role : null,
        storeId: u && u.storeId != null ? u.storeId : null,
        storeName: u ? u.storeName : null,
      };
    } catch (e) {
      return { token: '', userId: null, username: null, nickname: null, role: null, storeId: null, storeName: null };
    }
  }

  function push() {
    const id = readIdentity();
    const sig = JSON.stringify(id);
    if (sig === lastSig) return; // 没变化就不打扰后台
    lastSig = sig;
    try {
      chrome.runtime.sendMessage({ type: 'DS_SET_IDENTITY', identity: id });
    } catch (e) { /* 扩展上下文失效（重载中）时忽略 */ }
  }

  push();
  // storage 事件只在「其它标签页」改动时触发；同标签页登录/登出走下面这个低频轮询兜底
  window.addEventListener('storage', push);
  setInterval(push, 4000);
})();
