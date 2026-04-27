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

async function pngToDataUrl(filePath) {
  const buffer = await readFile(filePath);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

async function main() {
  const workspaceRoot = resolveArg(2, process.cwd());
  const specPath = resolveArg(3);
  const outPath = resolveArg(4, path.join(workspaceRoot, ".codebuddy/skills/yaia-skill-icons/out/candidate-gallery.html"));

  if (!specPath) {
    throw new Error("用法: node render_candidate_gallery.mjs <workspaceRoot> <spec.json> [out.html]");
  }

  const spec = JSON.parse(await readFile(toAbs(workspaceRoot, specPath), "utf8"));
  const pngRoot = toAbs(
    spec.workspaceRoot ?? workspaceRoot,
    spec.pngRoot ?? "external-assets/game-icons/png-black-white/icons/000000/ffffff/1x1",
  );

  const sections = [];
  for (const skill of spec.skills ?? []) {
    const cards = [];
    for (const candidate of skill.candidates ?? []) {
      const pngPath = path.join(pngRoot, candidate.author, `${candidate.slug}.png`);
      const dataUrl = await pngToDataUrl(pngPath);
      cards.push(`
        <article class="card">
          <img src="${dataUrl}" alt="${escapeHtml(candidate.slug)}" />
          <div class="body">
            <div class="slug">${escapeHtml(candidate.author)}/${escapeHtml(candidate.slug)}</div>
            <div class="status">${escapeHtml(candidate.status ?? "候选")}</div>
            <p>${escapeHtml(candidate.note ?? "")}</p>
          </div>
        </article>
      `);
    }

    sections.push(`
      <section class="skill-block">
        <header>
          <h2>${escapeHtml(skill.label ?? skill.id)}</h2>
          <p>${escapeHtml(skill.id)}</p>
          <p>${escapeHtml(skill.summary ?? "")}</p>
        </header>
        <div class="grid">${cards.join("")}</div>
      </section>
    `);
  }

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(spec.title ?? "技能图标候选")}</title>
  <style>
    body { margin: 0; font-family: Inter, "Segoe UI", system-ui, sans-serif; background: #10141d; color: #eef2ff; }
    main { max-width: 1200px; margin: 0 auto; padding: 32px 20px 64px; }
    h1 { margin: 0 0 20px; }
    .skill-block { margin: 0 0 28px; padding: 20px; border: 1px solid rgba(255,255,255,.08); border-radius: 18px; background: #171c27; }
    .skill-block header p { margin: 4px 0; color: #98a4bf; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-top: 16px; }
    .card { border: 1px solid rgba(255,255,255,.06); border-radius: 16px; background: #1d2330; overflow: hidden; }
    .card img { width: 100%; aspect-ratio: 1 / 1; object-fit: contain; padding: 18px; background: radial-gradient(circle at 30% 25%, rgba(255,255,255,.06), transparent 35%), #0f1521; }
    .body { padding: 12px 14px 16px; }
    .slug { font-weight: 600; font-size: 14px; }
    .status { margin-top: 6px; color: #f0bb5c; font-size: 13px; }
    .body p { margin: 8px 0 0; color: #c6d0ea; font-size: 14px; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(spec.title ?? "技能图标候选")}</h1>
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
