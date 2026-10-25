# 客厅牌局首版素材

使用 imagegen 备用 CLI、OpenAI Next / gpt-image-2 生成，共7张源图。密钥不包含在素材、提示词或脚本中。游戏代码未改动。

- background.png：1024×1536客厅背景。
- table.png：透明底茶几。
- teammate.png、left.png、right.png、self.png：透明底半身人物。
- 对应的 *-avatar.png：512×512头像裁切。
- whiskers.png：透明底猫胡须覆盖层。
- *-source.png：保留原始色键背景源图。
- asset-sheet.jpg：素材总览。
- composite-preview.jpg：独立素材拼合的示意图，不是游戏运行截图。
- jobs.jsonl：茶几、人物和贴纸的实际生图提示词。
- prepare_assets.py：仅用于本地抠底、头像裁切和预览合成，无网络请求。

背景实际提示词：Portrait mobile game environment background, cozy everyday apartment living room, soft stylized 3D animation aesthetic for adult friends. Beige sofa at upper edge, restrained warm floor lamp and houseplant at outer edges, hints of side armchairs, pale rug across center and lower half. Elevated downward camera, central 65 percent calm open rug for a separate coffee table added later. Pale oak, cream fabrics, soft upper-left light. Environment only: NO coffee table, people, cards, text, UI, casino imagery or watermark. Clear empty bottom area.

## 已检查与限制

透明素材均有0～255的alpha范围，四角完全透明；已用浅色底检查整体轮廓。头像及合成图已生成并检查。

这是首版素材，不代表已通过真机验收。人物为半身图，下缘需由桌子或界面遮挡；独立生成的风格和透视仍存在差异。茶几偏斜，正式接入前需要调整。精细发丝边缘仍需在实际显示尺寸下复查。

预览里的牌面、昵称、分数均为布局示意，不构成真实合法牌局快照；没有接入规则、联机或触摸操作。涂鸦仍是独立覆盖层，尚未按人物五官校准位置。真机手牌可读性、33张扣底布局、包体大小及动画性能待后续验证。
