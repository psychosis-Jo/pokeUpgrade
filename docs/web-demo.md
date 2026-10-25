# 网页人机体验

## 已部署的固定访问地址

https://cloud1-d6g6wlodae4bf1192-1516105269.tcloudbaseapp.com/upgrade/index.html

腾讯云默认测试域名首次浏览可能显示访问提示，等3秒点击“确定访问”即可进入。地址由云端托管，不依赖本机开机；持续可用取决于云环境与平台默认域名政策。无需修改联机服务。去掉提示页需另行配置自定义域名。

2026-10-25：上传10个文件，远端文件校验通过。浏览器已通过平台提示页进入Canvas游戏。部署路径 `upgrade`，未覆盖其他路径。

更新部署命令：`npm exec --yes --package=@cloudbase/cli -- tcb hosting deploy ./web-dist upgrade --env-id cloud1-d6g6wlodae4bf1192 --verify --json`

复用小游戏的规则、牌局控制、Canvas 绘制和客厅素材，只增加浏览器兼容入口。网页不接入微信登录或联机，等级保存在当前浏览器，与微信联机成绩独立。

构建：`node scripts/build-web.cjs`

启动：`python3 -m http.server 8765 --bind 127.0.0.1 --directory web-dist`

临时公网访问（另开终端）：`cloudflared tunnel --url http://127.0.0.1:8765 --no-autoupdate`

只公开 web-dist 中的游戏文件，不公开项目目录、后端或凭证。临时域名以工具当次输出为准；电脑休眠、断网或关闭进程后链接不可用。固定网址可将 web-dist 作为纯静态站点部署。

验证：原有41项测试通过；390×844浏览器加载全部7张图片，无脚本错误；实际点击开始后进入发牌与叫庄。临时公网首页HTTP 200。手机微信内置浏览器与国内网络可达性需实际设备确认。
