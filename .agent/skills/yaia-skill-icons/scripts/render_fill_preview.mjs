import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function resolveArg(index, fallback) {
  return process.argv[index] ?? fallback;
}

function toAbs(workspaceRoot, target) {
  return path.isAbsolute(target) ? target : path.join(workspaceRoot, target);
}

function escapeHtml(text = "") {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function applySvgFill(rawSvg, icon, mode) {
  const gradientId = `grad-${icon.id.replaceAll(".", "-")}`;
  const base = rawSvg.trim();
  if (mode === "flat") {
    return base
      .replaceAll(/fill="#(?:000|000000)"/g, `fill="${icon.colorBase}"`)
      .replaceAll(/fill:#(?:000|000000)/g, `fill:${icon.colorBase}`);
  }

  const defs = `<defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${icon.colorLight}"/><stop offset="52%" stop-color="${icon.colorBase}"/><stop offset="100%" stop-color="${icon.colorDark}"/></linearGradient></defs>`;
  return base
    .replace(">", `>${defs}`)
    .replaceAll(/fill="#(?:000|000000)"/g, `fill="url(#${gradientId})"`)
    .replaceAll(/fill:#(?:000|000000)/g, `fill:url(#${gradientId})`);
}

async function main() {
  const workspaceRoot = resolveArg(2, process.cwd());
  const specPath = resolveArg(3);
  const outPath = resolveArg(4, path.join(workspaceRoot, ".codebuddy/skills/yaia-skill-icons/out/fill-preview.html"));

  if (!specPath) {
    throw new Error("用法: node render_fill_preview.mjs <workspaceRoot> <spec.json> [out.html]");
  }

  const spec = JSON.parse(await readFile(toAbs(workspaceRoot, specPath), "utf8"));
  const svgRoot = toAbs(
    spec.workspaceRoot ?? workspaceRoot,
    spec.svgRoot ?? "external-assets/game-icons/svg-black-transparent/icons/000000/transparent/1x1",
  );
  const slotSize = Number(spec.slotSize ?? 56);

  const sections = [];
  for (const icon of spec.icons ?? []) {
    const svgPath = path.join(svgRoot, icon.author, `${icon.slug}.svg`);
    const rawSvg = await readFile(svgPath, "utf8");
    const flatSvg = applySvgFill(rawSvg, icon, "flat");
    const gradientSvg = applySvgFill(rawSvg, icon, "gradient");

    sections.push(`
      <section class="card">
        <header>
          <h2>${escapeHtml(icon.label ?? icon.id)}</h2>
          <p>${escapeHtml(icon.id)} · ${escapeHtml(icon.note ?? "")}</p>
        </header>
        <div class="grid">
          <div class="variant">
            <h3>纯色 fill</h3>
            <div class="frame">${flatSvg}</div>
            <div class="slot" style="width:${slotSize}px;height:${slotSize}px">${flatSvg}</div>
          </div>
          <div class="variant">
            <h3>渐变 fill</h3>
            <div class="frame">${gradientSvg}</div>
            <div class="slot" style="width:${slotSize}px;height:${slotSize}px">${gradientSvg}</div>
          </div>
        </div>
      </section>
    `);
  }

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(spec.title ?? "技能图标填色对比")}</title>
  <style>
    body { margin: 0; font-family: Inter, "Segoe UI", system-ui, sans-serif; background: #0e1320; color: #edf2ff; }
    main { max-width: 1200px; margin: 0 auto; padding: 32px 20px 64px; }
    h1 { margin: 0 0 20px; }
    .card { margin: 0 0 24px; padding: 20px; border: 1px solid rgba(255,255,255,.08); border-radius: 18px; background: #171d2b; }
    header p { color: #99a7c6; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .variant { padding: 14px; border: 1px solid rgba(255,255,255,.06); border-radius: 16px; background: #1d2433; }
    .frame { min-height: 220px; display: grid; place-items: center; margin-bottom: 12px; border-radius: 14px; background: radial-gradient(circle at 30% 25%, rgba(255,255,255,.06), transparent 35%), #0f1521; }
    .frame svg { width: 148px; height: 148px; }
    .slot { display: grid; place-items: center; border-radius: 14px; border: 1px solid rgba(255,255,255,.08); background: #0f1521; }
    .slot svg { width: 60%; height: 60%; }
    @media (max-width: 860px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(spec.title ?? "技能图标填色对比")}</h1>
    ${sections.join("\n")}
  </main>
</body>
</html>`;

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, html, "utf8");
  console.log(outPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
