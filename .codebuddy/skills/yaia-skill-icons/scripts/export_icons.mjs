import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function resolveArg(index, fallback) {
  return process.argv[index] ?? fallback;
}

function toAbs(workspaceRoot, target) {
  return path.isAbsolute(target) ? target : path.join(workspaceRoot, target);
}

function buildGradientId(id) {
  return `grad-${id.replaceAll(".", "-")}`;
}

function exportSvg(rawSvg, icon) {
  const gradientId = buildGradientId(icon.id);
  const comment = `<!-- Source: https://game-icons.net/1x1/${icon.author}/${icon.slug}.html | Author: ${icon.author} | License: CC BY 3.0 -->`;
  const defs = `<defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${icon.colorLight}"/><stop offset="52%" stop-color="${icon.colorBase}"/><stop offset="100%" stop-color="${icon.colorDark}"/></linearGradient></defs>`;
  return `${rawSvg.trim()
    .replace(">", `>${comment}${defs}`)
    .replaceAll(/fill="#(?:000|000000)"/g, `fill="url(#${gradientId})"`)
    .replaceAll(/fill:#(?:000|000000)/g, `fill:url(#${gradientId})`)}\n`;
}

function outputPathForId(workspaceRoot, id) {
  const parts = id.split(".");
  if (parts.length < 3 || parts[0] !== "talent") {
    throw new Error(`暂不支持的技能 ID: ${id}`);
  }
  const fileName = `${parts.at(-1)}.svg`;
  const dirs = parts.slice(1, -1);
  return path.join(workspaceRoot, "src/assets/icons", ...dirs, fileName);
}

async function main() {
  const workspaceRoot = resolveArg(2, process.cwd());
  const specPath = resolveArg(3);
  const explicitSvgRoot = resolveArg(4);

  if (!specPath) {
    throw new Error("用法: node export_icons.mjs <workspaceRoot> <spec.json> [svgRoot]");
  }

  const spec = JSON.parse(await readFile(toAbs(workspaceRoot, specPath), "utf8"));
  const svgRoot = toAbs(
    spec.workspaceRoot ?? workspaceRoot,
    explicitSvgRoot ?? spec.svgRoot ?? "external-assets/game-icons/svg-black-transparent/icons/000000/transparent/1x1",
  );

  for (const icon of spec.icons ?? []) {
    const srcPath = path.join(svgRoot, icon.author, `${icon.slug}.svg`);
    const outPath = outputPathForId(workspaceRoot, icon.id);
    const rawSvg = await readFile(srcPath, "utf8");
    const finalSvg = exportSvg(rawSvg, icon);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, finalSvg, "utf8");
    console.log(outPath);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
