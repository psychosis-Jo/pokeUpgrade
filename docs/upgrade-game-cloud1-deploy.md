# 升级游戏（Upgrade）后端 → cloud1 云托管 部署记录

> 整理自多轮排查对话。目标：把微信小游戏「升级」的多人 WebSocket 后端 `upgrade-game`，从独立云托管环境 `upgrade-test` 迁移进 **cloud1 环境的云托管**，并打通数据库访问。

---

## 1. 背景与目标

小游戏客户端在代码里**硬编码**了容器连接参数：

- `env: cloud1-d6g6wlodae4bf1192`
- `service: upgrade-game`

但 cloud1 环境一开始**没有**这个云托管服务，导致客户端 `wx.cloud.connectContainer` 始终连不上 WebSocket。
因此决定：把后端服务部署到 cloud1 的云托管里，让硬编码的连接参数生效。

### 环境信息

| 项 | 值 |
|---|---|
| cloud1 环境 ID | `cloud1-d6g6wlodae4bf1192`（个人版，存数据库） |
| 旧独立云托管环境 | `upgrade-test-d6gkflvty39012e3e`（按量付费，已弃用） |
| 云托管服务名 | `upgrade-game` |
| 公网域名 | `https://upgrade-game-334898-11-1516105269.sh.run.tcloudbase.com` |
| 镜像仓库 | `ccr.ccs.tencentyun.com/tcb-100054173354-yvtl/ca-locatxsh_upgrade-game` |
| tcb CLI 版本 | 3.8.9 |
| 登录云函数 | `login`（已部署在 cloud1，负责签发 token） |

---

## 2. 关键决策（与用户确认过的）

1. **迁移到 cloud1 云托管**（而非在独立云托管控制台切换环境）——因为独立云托管环境是手动创建的、无法切换 env。
2. **环境变量注入方式**：先尝试 `tcb cloudrun deploy --env-params`（失败，CLI bug），回退到**临时写进 Dockerfile**；最终用户选择**控制台手动配置**为长期方案（密钥不进镜像）。
3. **`SESSION_SECRET` 必须与 cloud1 的 `login` 云函数完全一致**，且仅用 cloud1 的一份值（客户端不持有密钥，只转发 token）。

---

## 3. 排查时间线（含踩坑）

### 3.1 授权与迁移准备
- 子账号加好 TCBR 权限后，用 `tcb login` 设备流授权（用户码 `QQHV-3ELM`）。
- `tcb env:list` 确认两个环境可见；`tcb cloudrun list` 确认 **cloud1 云托管已开通**（服务列表为空）。
- 本机**无 Docker**，改用 `tcb cloudrun deploy --source .` 触发 CODING 云端构建（无需本地 Docker）。

### 3.2 第一次部署 v001 失败（缺环境变量）
- 部署成功构建出镜像，但容器 `Back-off restarting failed container`。
- 原因：没有 `SESSION_SECRET`，`server/index.js` 启动即 `throw Error('SESSION_SECRET至少32个字符')`。
- 同时确认 `tcb cloudrun deploy` **没有**传环境变量的 flag；`tcb run service:deploy`（已废弃）对 env-id 处理有 bug；`tcb api tcbr <Action>` 均 `InvalidAction`。

### 3.3 发现 `--env-params` 这个 flag，但它是坏的
- `tcb cloudrun deploy --help` 显示支持 `--env-params`，于是改用它传 `CLOUD_ENV` + `SESSION_SECRET`，**不污染镜像**。
- 非交互部署坑：`CI=true` 不跳过灰度发布询问；`< /dev/null` 会因 EOF 退出；`script` 喂换行会发成 `^D`。
- 最终用 **Python PTY feeder**（`/tmp/feed_deploy.py`）在灰度提示出现时发送 Enter，部署才成功提交。
- v002 部署后 `tcb cloudrun detail` 显示 `"EnvParams": "{}"` —— **CLI 的 `--env-params` 在本版本根本没持久化**，容器依旧没收到变量，继续崩溃。

### 3.4 真正的密钥 bug：SESSION_SECRET 长度不足
- `server/index.js:10` 要求 `SESSION_SECRET.length >= 32`。
- 此前规划用的 `38b620ae74df21510b9457b4f` 只有 **25 字符**（截断值），无论如何都会崩溃。
- 从 cloud1 的 `login` 云函数环境拉取（`tcb fn env pull login`），拿到**真正的 64 位值**：
  `38b620ae74df21510b9457b4b89a8e0dd432376435b0ca9afe8a89cfaf567c09`
- 客户端不持有密钥：客户端调 `wx.cloud.callFunction({name:'login'})` 拿 token → 转给游戏服务器 → 服务器用同一 `SESSION_SECRET` 验签。故**游戏服务器必须等于 login 函数的密钥**。

### 3.5 v003 跑通启动 + 鉴权（密钥写进镜像）
- 把 `CLOUD_ENV` + 正确的 64 位 `SESSION_SECRET` 临时写进 `Dockerfile` 并重新部署 v003。
- 结果：服务 `normal`、流量 100%、不再崩溃循环。
- `/healthz` → `200 ok`（说明 `store.init()` 已通过、服务已监听）。
- WebSocket 冒烟测试：构造带签名的 `auth`，服务器**成功验签**（证明 `SESSION_SECRET` 与 login 函数完全一致），仅在读库时抛 `secret id error ... SIGN_PARAM_INVALID`。

### 3.6 数据库访问失败：容器没有云凭证
- `wx-server-sdk` / `cloud.database()` 报 `SIGN_PARAM_INVALID` —— 容器里没有 `TENCENTCLOUD_SECRETID/SECRETKEY`。
- 加 `/diag` 接口（`server/index.js:17`，返回环境变量**键名**不返回值）验证：
  ```json
  { "envKeys": ["SESSION_SECRET","CLOUD_ENV"],
    "hasSecretId": false, "hasSecretKey": false,
    "cloudEnv": "cloud1-d6g6wlodae4bf1192" }
  ```
  **结论：这个云托管容器不会自动注入云凭证**，与官方文档“同环境云托管自动注入”的描述不符（以实测为准）。本机 shell 也无静态密钥（tcb 用设备授权）。

### 3.7 当前卡点 → 用户选择控制台手动配置
- CLI 没有可靠的传环境变量通道（`--env-params` 写 `{}`；`logs process` 只显示部署事件、看不到运行时 stdout，需靠 `/diag` 这类 HTTP 接口看容器内状态）。
- 请用户在 **cloud1 云托管控制台 → upgrade-game → 服务设置/环境变量** 手动添加 3 个变量（截图确认当时仍显示 `--`，即尚未配置）：
  | 变量名 | 值 |
  |---|---|
  | `TENCENTCLOUD_SECRETID` | cloud1 环境访问凭证（环境设置 → 访问凭证） |
  | `TENCENTCLOUD_SECRETKEY` | 对应 SecretKey |
  | `SESSION_SECRET` | `38b620ae74df21510b9457b4b89a8e0dd432376435b0ca9afe8a89cfaf567c09` |

---

## 4. 关键技术结论（可复用）

1. **`tcb cloudrun deploy` 在本版本（3.8.9）无法可靠注入环境变量**：`--env-params` 实际写入 `{}`。写进 Dockerfile 的变量**确实能进容器**（已用 `/diag` 验证）；控制台 UI 配置是另一条通道，按理应生效。
2. **云托管容器不自动注入 `TENCENTCLOUD_SECRETID/SECRETKEY`**（实测 cloud1 如此）。访问同环境数据库必须显式提供这对凭证，或在代码里用 `@cloudbase/node-sdk` + 显式凭证初始化。
3. **`SESSION_SECRET` 必须 ≥32 字符，且游戏服务器与 login 云函数必须一致**。规划阶段用的 25 位截断值是个隐蔽坑。
4. **客户端不持有密钥**：token 由 login 云函数签发、客户端转发、游戏服务器验签。
5. **非交互部署**：用 Python PTY feeder 在灰度发布提示处发 Enter（`/tmp/feed_deploy.py`）。
6. **看容器内日志**：`tcb cloudrun logs process` 只看部署事件；没配 CLS 日志集时，靠临时 `/diag` HTTP 接口返回环境变量键名来诊断。
7. **本机无 Docker** → 一律走 `tcb cloudrun deploy --source .` 云端构建。

---

## 5. 最终状态（2026-10-25 完成）

- ✅ **v010 已部署**：`normal`、流量 100%、无崩溃循环（干净镜像，已移除调试代码）。
- ✅ `/healthz` → 200 `ok`；WebSocket **鉴权 + 数据库读写端到端打通**（返回带 `_id` 的真实档案文档）。
- ✅ 控制台环境变量注入成功：`TENCENTCLOUD_SECRETID` / `TENCENTCLOUD_SECRETKEY` / `SESSION_SECRET` 三者均进入容器（`/dbtest` 实测 `plainRead`/`transaction`/`write` 全部 `ok:true`）。
- ✅ 子账号已加 `QcloudTCBFullAccess`，解决数据库授权被拒（`tcb:QueryDocument`/`RunTransaction`/`UpdateDocument` 均 `not authorized`）的问题。
- ✅ 清理完成：删除临时 `/diag`、`/dbtest` 接口与 `[diag]` 日志；`SESSION_SECRET` 从 Dockerfile 移除（仅留 `CLOUD_ENV`，非密钥）；更新过时注释。
- ✅ 客户端回退：清空 `minigame/online-config.js` 的 `wsUrl`，`online.js` 自动走 `connectContainer(cloud1-d6g6wlodae4bf1192, upgrade-game)`。

> 唯一未由本机自动验证的项：微信开发者工具/真机模拟器里的“连接好友房”实际连接（需用户侧用 devtools 跑一次确认 `connectContainer` 走通）。服务端公网链路已用 WebSocket 冒烟测试证明可用，connectContainer 指向同一后端，功能等价。

---

## 6. 收尾清单（已全部完成）

1. ✅ `curl /diag`（v007）确认 `hasSecretId:true` —— 控制台环境变量确实注入容器。
2. ✅ 子账号加 `QcloudTCBFullAccess` 后 `curl /dbtest`（v009）三项全 `ok:true`。
3. ✅ 清理镜像：删 `/diag`、`/dbtest`、`[diag]` 日志；`SESSION_SECRET` 移出 Dockerfile（仅留控制台）。
4. ✅ WebSocket 冒烟测试（v009/v010）确认「登录鉴权 + 数据库读写」端到端打通。
5. ✅ 客户端回退 `wsUrl` 为空 → `connectContainer(cloud1, upgrade-game)`。
6. ✅ 部署干净镜像 v010 并复验。

---

## 7. 常用命令速查

```bash
# 环境与服务
tcb env:list
tcb cloudrun list --env-id cloud1-d6g6wlodae4bf1192
tcb cloudrun detail --env-id cloud1-d6g6wlodae4bf1192 --service-name upgrade-game
tcb cloudrun record list --env-id cloud1-d6g6wlodae4bf1192
tcb fn list --env-id cloud1-d6g6wlodae4bf1192
tcb fn env pull login --env-id cloud1-d6g6wlodae4bf1192 --output-file /tmp/login-env.json

# 非交互部署（PTY 喂 Enter 跳过灰度提示）
python3 /tmp/feed_deploy.py
# 其本质是：
# tcb cloudrun deploy --service-name upgrade-game --env-id cloud1-d6g6wlodae4bf1192 \
#   --source . --port 8080 --force

# 验证
curl -s https://upgrade-game-334898-11-1516105269.sh.run.tcloudbase.com/healthz
curl -s https://upgrade-game-334898-11-1516105269.sh.run.tcloudbase.com/diag
```

---

## 8. 涉及文件

| 文件 | 作用 / 当前状态 |
|---|---|
| `Dockerfile` | 第 7–10 行临时写死 `CLOUD_ENV` + `SESSION_SECRET`（64 位）；清理时删 `SESSION_SECRET` 行 |
| `server/index.js` | 入口；含临时 `/diag`（17 行）与 `[diag]` 日志（131 行），待删；137–138 注释过时待改 |
| `server/store.js` | `CloudStore` 用 `cloud.database()` 访问 cloud1 库 |
| `server/auth.js` | `verify` 要求 uid 为 64 位 hex（`sha256(APPID:OPENID)`） |
| `cloudfunctions/login/index.js` | login 云函数，签发 token；`SESSION_SECRET` 须与游戏服务器一致 |
| `minigame/online-config.js` | `wsUrl` 当前指向旧 upgrade-test 域名；清理后清空以回退 `connectContainer` |
| `minigame/online.js` | 连接逻辑：`wsUrl` 非空走直连，空则走 `connectContainer` |

# 升级扑克牌 · 规则与起源手册

> 整理自一次关于「升级」玩法的问答对话。升级又称 **拖拉机、80 分、双升、双抠**，是国内最普遍的四人扑克玩法，核心是两副牌、两两配合、抢分升级。
>
> ⚠️ 可信度提示：规则部分来自联众游戏、百度百科等公开资料，属通行规则；起源部分含民间传说，文中已逐条标注可信度，请勿当作定论引用。

---

## 一、游戏规则（两副牌标准版）

### 1. 基本设置

- **人数与队伍**：4 人，对家（正对面）是队友，左右 vs 上下两阵营对抗。
- **用牌**：通常用 **两副完整扑克（含大小王）共 108 张**。也有一副牌（40 分 / 打百分）、三副牌的玩法，但两副最主流。
- **分牌**：每张 **5 = 5 分、10 = 10 分、K = 10 分**，两副牌合计 **200 分**，是全场争夺的目标。

### 2. 核心概念

- **级牌**：从打 **2** 开始升级，当前庄家的级别就是级牌（如打 2 时所有 2 是主牌，打到 K 时 K 是级牌）。
- **主花色（亮主）**：发牌后玩家可亮出级牌来「叫主」，选定某花色为主花色。最后亮出 / 反主的级牌花色即主花色。
- **主牌 = 大小王 + 级牌 + 主花色牌**；其余全是 **副牌**。主牌整体大于副牌。
- **牌的大小顺序**：
  - 主牌内：**大王 > 小王 > 主花色级牌 > 其他花色级牌 > 主花色 A > K > Q > J > … > 2**
  - 副牌内：**A > K > Q > J > 10 > … > 2**（级牌除外）

### 3. 一局流程

1. **发牌**：每人 25 张，留 **8 张底牌**。
2. **亮主定庄**：抓到级牌者可叫主（选花色）；有人反主则由反主者坐庄，没人叫则随机定。第一局亮主方坐庄。
3. **扣底**：底牌归庄家，庄家从手中选 8 张替换进底牌（通常把分牌、难控的花色压进去）。
4. **出牌**：庄家先出，之后逆时针轮转，**每轮赢家下一轮先出**。
   - 跟牌：有首出花色 **必须跟同花色**；首出对子，你有同花色对子要优先跟对。
   - **拖拉机**：同花色相邻对子连成（如副牌 KKQQ、主牌里一对小王 + 一对主 10），是核心牌型，主副牌不能混组。
   - 无同花色时可 **用主牌「毙 / 杀」** 或垫其他花色。
   - 首出方可「甩牌」（一次甩出某花色多手没法被压的牌）。
5. **结算**：手牌打完即结束。每轮赢家收走本轮分牌的分数。

### 4. 抠底（关键翻盘机制）

- 最后一轮若 **闲家赢**，则触发「抠底」：底牌里的分数 **翻倍** 计入闲家得分。
- 倍数看末轮牌型（两副牌常见规则）：

| 末轮牌型    | 倍数              |
| ------- | --------------- |
| 单张抠底    | ×2              |
| 对子 / 两对 | ×4              |
| 三对      | ×6              |
| 拖拉机     | ×8（即 2 × 2^len） |

> 三副牌还有「泰坦尼克」（相邻三同张）等更高倍数规则，此处不展开。

### 5. 升级与胜负判定（两副牌标准）

闲家抓分决定本局结果：

| 闲家得分        | 结果                                             |
| ----------- | ---------------------------------------------- |
| **0 分**     | 庄家方连升 3 级（大光）                                  |
| **1–40 分**  | 庄家方升 1 级                                       |
| **40–80 分** | 双方不升级，轮换庄家（庄家留庄）                               |
| **≥ 80 分**  | 闲家上台，每满 20 分升 1 级（80–100 升 1 级，之后每 40 分多升 1 级） |

通常 **先打到 A（或 K）的一方获胜**。

---

## 二、历史与起源

> 结论先行：没有找到「某个人在某年发明了升级」的盖棺定论。它和大部分民间扑克游戏一样，是 **从桥牌演变简化、在市井里慢慢长出来的**，没有单一发明人。

### 1. 主线：从桥牌简化而来（主流说法）

升级被认为是 **桥牌的「平民化」版本**。原版桥牌要叫牌、算墩数、记约定，门槛高；升级把它大幅简化：

- 用 **「亮主」** 代替桥牌的「叫牌 / 定约」；
- 用 **5 / 10 / K 计分** 代替「赢了多少墩」计分；
- 保留桥牌最核心的 **四人两两配合、对抗拿分** 结构。

这样一改，不用记复杂约定也能玩，先在华人圈子里传开。

### 2. 一个流传很广的「归侨故事」（可信度低）

有资料讲了个具体来路：升级早年是 **海外华侨** 之间的扑克娱乐，从当时火热的桥牌竞技里演变出来。**上世纪 50 年代初的归国潮** 中，华侨把它带回国内，在各地「落地开花」，逐渐演成天南地北的本地规则（摔小二、双抠等别称）。

> ⚠️ 这个「华侨起源说」主要出自一个棋牌推广号文章，带情怀营销色彩，**没有学术考据背书**，只能当民间传说听。百度百科的说法更保守——只说「起源于中国，最初用一副牌，后扩展为两副、三副」。

### 3. 名字是怎么来的

- **「升级」**：核心机制就是赢够分就升一级，名字直接来自玩法。
- **「80 分 / 双升」**：两副牌玩法里，闲家抓满 80 分才能上台，所以叫 80 分。
- **「拖拉机」**：说法是 **上世纪 80 年代在华北地区兴起**，因为玩时要不断「拖」牌、堆底牌，动作像开拖拉机，被形象叫成这名。后来 QQ 游戏等平台把「两副牌 + 拖拉机连对 + 双抠翻倍」定型，名字才彻底叫开。
- **单副牌**那版最古老，叫「40 分」或「打百分」。

### 4. 它又生出了新玩法

升级的「四人组队抢分」框架生命力很强，后来直接衍生出爆款：

- **掼蛋**：据淮安南闸镇溯源，60 年代末当地就在玩升级 / 80 分雏形，后分化出自成一派的打法，即现在江浙皖爆火的掼蛋（明确吸收了「升级」打法）。
- **炒地皮、五主过河** 等地方变体，都是升级的亲戚。

### 5. 线上化

2000 年前后，联众、QQ 游戏等平台把升级推向全国，成为国民级游戏。

---

## 三、玩法演进时间线（简表）

| 时期        | 形态                   | 说明                     |
| --------- | -------------------- | ---------------------- |
| 较早        | 单副牌「40 分 / 打百分」      | 最古老形态，一副牌              |
| 桥牌简化期     | 升级雏形                 | 用亮主替叫牌、分牌计分替墩数，源自桥牌平民化 |
| 上世纪 50 年代 | 归国华侨带入国内（民间传说）       | 无考据背书，存疑               |
| 上世纪 80 年代 | 两副牌「80 分 / 拖拉机」在华北兴起 | 因「拖」底牌动作得名「拖拉机」        |
| 2000 年前后  | 联众、QQ 游戏线上化          | 规则定型、全国普及              |
| 60 年代末起   | 衍生出「掼蛋」等             | 淮安南闸镇分化出的新打法，后爆火       |

---

## 附：资料来源

- 联众游戏《升级游戏介绍》
- 百度百科「升级 / 升级 80 分」
- 北方网体育节拍《升级（拖拉机）》
- 微信公开文章（含「华侨起源说」，可信度低，已标注）
- 淮安掼蛋溯源报道（掼蛋与升级的关系）

*整理日期：2026-10-25*
