// Fill in test environment identifiers only. Never put SESSION_SECRET in the client.
module.exports = {
  env: 'cloud1-d6g6wlodae4bf1192',
  service: 'upgrade-game',
  // 独立云托管（upgrade-test 环境）公网 WebSocket 地址。connectContainer 要求服务部署在
  // 云开发环境的云托管内，而本服务实际在独立云托管，故改用直连公网域名。
  // 真机需在小程序后台「开发设置 → socket 合法域名」添加该域名（开发工具可临时关闭域名校验）。
  // 如日后把服务迁回 cloud1 云开发内的云托管，把 wsUrl 留空即可自动回退到 connectContainer。
  wsUrl: 'wss://upgrade-game-334719-12-1516105269.sh.run.tcloudbase.com/ws',
  // Local development only: ws://127.0.0.1:8080/ws; leave empty for cloud hosting.
  localUrl: '',
  localPlayer: '',
};
