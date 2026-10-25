# 熟人局升级：客厅牌局首版素材

状态：素材制作规格与提示词已准备；尚未调用生图，尚无分层成品。游戏代码不改动。

## 统一风格

以 game-cover-party-v2.png 为视觉参考：温馨家常客厅，成人朋友聚会，柔和立体卡通人物，浅木家具、奶油织物、暖灯。避免赌场、筹码、钱币、金色豪华装饰。光源统一来自左上方。背景装饰克制，主体轮廓清晰。

图片里的扑克牌、字样和数字不作为素材沿用。所有牌面、文字及动态状态后续由代码绘制。

## 01 客厅背景

建议画布：1024×1536。不含茶几、人物、扑克牌、界面及文字。上方米色沙发，侧边只保留少量落地灯、植物和扶手椅。中央至下方为大块干净浅色地毯，用于之后叠加独立茶几。近俯视三分之四视角，竖屏手机游戏场景，不能做成海报。边缘允许裁切。

Prompt: Create a portrait 1024x1536 mobile card-game environment background, warm everyday apartment living room, soft stylized 3D animation aesthetic for adult friends. Beige sofa at the upper edge, restrained floor lamp and houseplant near outer edges, hints of two side armchairs, pale rug across the center and lower half. Camera elevated looking downward, coherent perspective for a coffee table added later. Central 65 percent of the image is calm open rug space. Soft warm lighting from upper left, pale oak and cream fabrics. Environment only: no coffee table, people, cards, text, numbers, UI, chips, casino imagery or watermark. No strong details near the bottom hand-card area.

## 02 独立茶几

建议画布：1024×1024。圆角浅木长方形茶几，完整轮廓与桌腿，近俯视，桌面大面积留白。无花瓶、杯子、扑克牌。生成后需抠透明底；不能把棋盘格当作透明。

Prompt: One pale oak rounded rectangular coffee table for a cozy mobile card game, soft stylized 3D animation look. Elevated three-quarter overhead view, long axis vertical, short visible legs, broad clean empty tabletop occupying most of the silhouette. Subtle wood grain, soft upper-left lighting. No props, cards, people, text or UI. Entire object visible with generous margin. Perfectly flat solid magenta #ff00ff background for extraction, no floor plane, no cast shadow on the background, no gradients or texture in the background. Do not use magenta on the table.

## 03–06 四个默认人物

每人建议1024×1024，独立图片，完整头部、上身和双手。成人朋友而非儿童。默认手中不画扑克牌，以免把牌背、牌数固定进人物。统一人物比例、光照、取景大小。头像从最终人物图裁切，不再单独随机生成。

共同 Prompt: One friendly young adult character for a cozy friends-only Chinese card game, polished soft stylized 3D animation aesthetic, expressive face, adult proportions with gently oversized head, warm upper-left lighting, waist-up seated pose, both hands relaxed and visible near lower chest, empty hands, full hair and elbows inside frame, generous padding, no chair or table. Perfectly flat solid magenta #ff00ff background for extraction, no shadows or lighting variation on background; no magenta clothing. No text, cards, props, watermark or UI.

- 对家：短卷发男生，湖蓝连帽衫，正面略向下看，轻松微笑。
  Add: Front-facing young adult man, short wavy dark hair, lake-blue hoodie, looking gently downward toward the player, relaxed smile.
- 左侧对手：齐肩深发女生，燕麦色针织衫，身体与脸朝画面右侧转约30度，视线向右下。
  Add: Young adult woman with shoulder-length dark hair, oatmeal knit sweater, three-quarter pose turned 30 degrees toward image right, looking down and right toward the table, playful smile.
- 右侧对手：短发眼镜男生，鼠尾草绿连帽衫，身体与脸朝画面左侧转约30度，视线向左下。
  Add: Young adult man with short dark hair and rounded glasses, muted sage-green hoodie, three-quarter pose turned 30 degrees toward image left, looking down and left toward the table, amused smile. Clean unpainted face; graffiti will be a separate overlay.
- 自己头像：深发女生，暖白卫衣，正面，开心自然；首版自己只展示头像，避免背影遮挡手牌。
  Add: Front-facing young adult woman with dark hair tied in a casual bun, warm-white sweatshirt, welcoming natural smile, clearly visible face suitable for a circular avatar crop.

## 07 猫胡须涂鸦

建议512×512，两组各三条深棕手绘胡须，中间小猫鼻，大片透明留白。独立覆盖层，不含人物皮肤和脸。实际显示按人物脸的位置与缩放单独校准。

Prompt: A playful face-paint overlay sticker only: two symmetric groups of three hand-drawn dark brown cat whiskers and a tiny coral cat nose at the center, soft rounded strokes, large open gaps, no face outline, no eyes, no skin, no head, no text. Centered with generous padding on a perfectly uniform solid green #00ff00 chroma-key background. No shadows, gradients or background texture. Do not use green in the sticker.

## 加工与验收

- 抠底后实际检查alpha通道、透明四角及发丝/衣服边缘；去除品红或绿色溢色。
- 从人物成品裁切四张512×512头像，保证头顶不被切掉。
- 先合成一张竖屏预览，再检查人物与茶几透视、侧边人物遮挡、手牌区域留白。
- 保留高清源文件；真机验证后再决定缩放与WebP压缩，避免提前牺牲清晰度。
- 所有生图结果须逐张检查，不能把未审核的生成图直接接入游戏。
