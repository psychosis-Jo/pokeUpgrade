// Fill in test environment identifiers only. Never put SESSION_SECRET in the client.
module.exports = {
  env: 'cloud1-d6g6wlodae4bf1192',
  service: 'upgrade-game',
  // 服务已部署在 cloud1 环境的云托管内，与客户端 wx.cloud.init(env=cloud1) 同环境，
  // 故留空 wsUrl，online.js 自动回退到 wx.cloud.connectContainer 走微信内网连接。
  // （需要直连公网域名调试时再填；真机须在「开发设置 → socket 合法域名」加该域名。）
  wsUrl: '',
  // Local development only: ws://127.0.0.1:8080/ws; leave empty for cloud hosting.
  localUrl: '',
  localPlayer: '',
};
