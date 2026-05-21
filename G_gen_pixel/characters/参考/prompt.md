# 像素游戏四向行走图生成 Prompt

基于角色参考图/home/gaoxueqing/2026/Agent_JRPG_Tongji/G_gen_pixel/characters/prompt1/char1_female.png，生成 RPG Maker 风格的四方向行走精灵图（Sprite Sheet）放在/home/gaoxueqing/2026/Agent_JRPG_Tongji/G_gen_pixel/characters/Sprite Sheet。

---

## 模板格式说明

```
┌──────────────────────────────────────┐
│ 站立  迈步1  迈步2  迈步3  ← 向下走 │  ← 第1行
│ 站立  迈步1  迈步2  迈步3  ← 向左走 │  ← 第2行
│ 站立  迈步1  迈步2  迈步3  ← 向右走 │  ← 第3行
│ 站立  迈步1  迈步2  迈步3  ← 向上走 │  ← 第4行
└──────────────────────────────────────┘
     4列（4帧） × 4行（4方向）
```

- **总画布**：约 236×236 像素（可根据需要调整，但要保证每个精灵格大小一致）
- **单个精灵帧**：约 48×56 像素
- **背景**：纯白色 `#FFFFFF`
- **布局**：4 行（方向）× 4 列（动画帧），共 16 个精灵帧
  - 第 1 列：站立/待机姿态
  - 第 2-4 列：行走动画 3 帧

---

## Prompt（中文版）

```
请根据我提供的角色参考图，生成一张像素游戏风格的四方向行走精灵图（Sprite Sheet），严格遵循以下规范：

【整体布局】
- 画布为白色背景，精灵按 4行×4列 排列
- 共16个精灵帧，每个精灵帧大小约 48×56 像素
- 帧与帧之间有适当间距，整体画布约 236×236 像素

【4行 = 4个行走方向】（从上到下）
- 第1行：向下走
- 第2行：向左走
- 第3行：向右走
- 第4行：向上走

【4列 = 4个动画帧】（从左到右）
- 第1列：站立/待机姿势
- 第2列：迈出第一步
- 第3列：迈出第二步（重心转移）
- 第4列：迈出第三步（回到类似站立但略有位移）

【动画细节】
- 向下走：角色面朝前方，双脚交替迈步，手臂自然摆动
- 向左走：角色面朝左侧，侧身行走，左右脚交替
- 向右走：角色面朝右侧，侧身行走（与向左镜像但不完全相同）
- 向上走：角色面朝后方（背对镜头），能看到后脑勺和背部

【像素画风格要求】
- 纯像素画风，使用明确的像素块，锯齿边缘（hard edges）
- 角色全身带有深色描边/轮廓线（outline），使角色在任何背景下都清晰可见
- 色彩简洁，使用有限的调色板（每个精灵约 20-40 种颜色）
- 有明确的明暗面和阴影（shading），光源从上方照射
- 角色脚底应有简单的阴影/投影表示站立在地面上
- 保持与参考图一致的 chibi/Q版 身材比例（2-3头身）

【角色一致性】
- 所有16个帧必须是同一个角色，服装、发型、配饰完全一致
- 仅姿态和朝向改变，角色外观特征保持统一
- 角色的标志性特征（如发色、服装颜色、武器等）在所有帧中保持一致

【输出格式】
- PNG 格式
- 白色背景
- 不压缩像素（避免模糊）
```

---

## Prompt（English Version）

```
Generate a pixel-art RPG character sprite sheet for 4-directional walking, based on my reference character image. Strictly follow these specifications:

[Overall Layout]
- White background canvas, sprites arranged in a 4-row × 4-column grid
- 16 sprite frames total, each frame approximately 48×56 pixels
- Appropriate spacing between frames, total canvas roughly 236×236 pixels

[4 Rows = 4 Walking Directions] (top to bottom)
- Row 1: Walking Down (facing forward/toward viewer)
- Row 2: Walking Left (facing left)
- Row 3: Walking Right (facing right)
- Row 4: Walking Up (facing away from viewer)

[4 Columns = 4 Animation Frames] (left to right)
- Column 1: Standing/idle pose
- Column 2: First step forward
- Column 3: Second step (weight shift, mid-stride)
- Column 4: Third step (returning toward standing position)

[Animation Details]
- Down walk: Character faces forward, feet alternate stepping, arms swing naturally
- Left walk: Character faces left, side-view walking, legs alternate
- Right walk: Character faces right, side-view walking (mirrored from left but not identical)
- Up walk: Character faces away (back to viewer), back of head and back visible

[Pixel Art Style]
- Clean pixel art with hard edges (no anti-aliasing, no blur)
- Dark outline/border around the entire character for clarity on any background
- Limited color palette (approximately 20-40 colors per sprite)
- Clear highlights and shadows with top-down lighting
- Small shadow/drop shadow at feet to indicate standing on ground
- Chibi/SD proportions (2-3 heads tall) matching the reference character

[Character Consistency]
- All 16 frames must show the exact same character with identical outfit, hairstyle, and accessories
- Only pose and direction change; all visual identity traits remain uniform
- Signature features (hair color, clothing, accessories) must match across every frame

[Output Format]
- PNG format
- White background (#FFFFFF)
- Pixel-perfect (no compression artifacts, no interpolation)
```

---

## 使用方法

1. 将你的角色图（正面站立图或概念设计图）作为参考图
2. 将上面的 Prompt 发给 AI 绘图工具（如 DALL-E 3、Midjourney、Stable Diffusion 等）
3. 加上你的参考图，生成四向行走图
4. 如果一次生成不理想，可以：
   - 先让 AI 生成单个方向的行走帧，确认风格
   - 再用排列组合的方式拼接成完整 Sprite Sheet
   - 或用 Aseprite / Photoshop 做后期微调

---

## 常见引擎兼容性

| 引擎 | 格式 | 单帧尺寸 | 列×行 |
|------|------|----------|-------|
| RPG Maker XP/VX/Ace | 4×4 | 可变 | 4列×4行 |
| RPG Maker MV/MZ | 3×4 | 48×48 | 3列×4行 |
| Godot / Unity | 自定义 | 可变 | 可自定义 |

如需适配 MV/MZ 格式（3帧），去掉每行最后一列即可。
