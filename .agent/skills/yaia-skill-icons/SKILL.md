---
name: yaia-skill-icons
description: This skill should be used when selecting, previewing, recoloring, or exporting YAIA skill icons, especially when matching `talent.*` IDs to final SVG assets under `src/assets/icons/` from the local icon database or the local `external-assets/game-icons/` mirror.
---

# YAIA 技能图标流程

## 概览

用本项目既定习惯完成技能图标整理：先找候选，再看候选界面，再看纯色/渐变填色对比，最后把正式 SVG 落到 `src/assets/icons/`。

## 工作流

### 1. 先找候选

- 优先读取**本地图标数据库 / 本地索引**，按技能 `id`、中文名、描述、职业语义检索。
- 如果当前工作区没有暴露数据库文件，就退回本地离线素材镜像：
  - `external-assets/game-icons/png-black-white/` 用于看图
  - `external-assets/game-icons/svg-black-transparent/` 用于最终导出
- 每个技能先收 3 到 5 个候选，不要只看文件名，必须生成可视界面再判断。

### 2. 生成候选界面

- 准备一个 JSON 规格文件，格式见 `references/spec-format.md`。
- 运行 `scripts/render_candidate_gallery.mjs` 生成自包含 HTML。
- 在候选页里给每个技能写一句简短判断：为什么贴题、为什么不选。

### 3. 生成填色对比

- 先为已选图标指定语义色，再运行 `scripts/render_fill_preview.mjs`。
- 同时看大图和 `56px` 按钮态。
- 默认优先比较 `纯色 fill` 和 `轻渐变 fill`；如果小尺寸变糊，就回到纯色。

### 4. 颜色语义

- 攻击 / 爆发：红、橙
- 防御 / 反制 / 保护：蓝、青
- 号令 / 鼓舞 / 战吼：金、橙黄
- 狂怒 / 姿态切进攻：深红
- 同一职业内优先保持色系稳定，不要每个技能都跳色。

### 5. 导出正式资产

- 保持原始黑白素材库不变，不在 `external-assets/game-icons/` 里改图。
- 运行 `scripts/export_icons.mjs` 导出正式 SVG。
- 路径直接从技能 ID 推导，不额外建 mapping 文件：
  - `talent.knight.power_strike` → `src/assets/icons/knight/power_strike.svg`
  - `talent.basic.attack` → `src/assets/icons/basic/attack.svg`
- 导出 SVG 时保留来源注释，写明 `game-icons` 页面、作者、`CC BY 3.0`。

### 6. 收尾

- 删除临时 HTML、截图、一次性说明文档，除非用户明确要求保留。
- 向用户只汇报三件事：最终选了什么、正式资产落在哪、原始素材是否保持未污染。

## 资源

- `scripts/render_candidate_gallery.mjs`：生成候选图标画廊 HTML
- `scripts/render_fill_preview.mjs`：生成纯色 / 渐变填色对比 HTML
- `scripts/export_icons.mjs`：按 ID 习惯导出正式 SVG
- `references/spec-format.md`：三个脚本共用的 JSON 规格说明
