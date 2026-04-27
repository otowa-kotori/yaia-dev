# JSON 规格

三个脚本都使用 JSON 规格文件；路径既可以写绝对路径，也可以写相对工作区根目录的路径。

## 1. 候选界面 `render_candidate_gallery.mjs`

```json
{
  "title": "骑士技能图标候选",
  "workspaceRoot": "c:/path/to/workspace",
  "pngRoot": "external-assets/game-icons/png-black-white/icons/000000/ffffff/1x1",
  "skills": [
    {
      "id": "talent.knight.power_strike",
      "label": "重击",
      "summary": "高系数单体物理攻击",
      "candidates": [
        {
          "author": "lorc",
          "slug": "sword-slice",
          "status": "已选",
          "note": "动作感强，缩小后稳定"
        },
        {
          "author": "lorc",
          "slug": "deadly-strike",
          "status": "备选",
          "note": "爆发感强，但略复杂"
        }
      ]
    }
  ]
}
```

## 2. 填色对比 `render_fill_preview.mjs`

```json
{
  "title": "骑士技能图标填色对比",
  "workspaceRoot": "c:/path/to/workspace",
  "svgRoot": "external-assets/game-icons/svg-black-transparent/icons/000000/transparent/1x1",
  "slotSize": 56,
  "icons": [
    {
      "id": "talent.knight.power_strike",
      "label": "重击",
      "author": "lorc",
      "slug": "sword-slice",
      "note": "攻击技，斩击感强",
      "colorLight": "#F39A62",
      "colorBase": "#D96A32",
      "colorDark": "#B44A1B"
    }
  ]
}
```

## 3. 正式导出 `export_icons.mjs`

直接复用“填色对比”的 JSON；`export_icons.mjs` 只读取 `icons` 数组。

## 输出约定

- 候选页默认输出：`.codebuddy/skills/yaia-skill-icons/out/candidate-gallery.html`
- 填色页默认输出：`.codebuddy/skills/yaia-skill-icons/out/fill-preview.html`
- 正式 SVG 默认输出：`src/assets/icons/...`
