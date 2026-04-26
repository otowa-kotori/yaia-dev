// Talent icon registry for UI.
//
// Convention:
//   talent.knight.power_strike -> src/assets/icons/knight/power_strike.svg
//   talent.basic.attack        -> src/assets/icons/basic/attack.svg
//
// Alpha rule: missing icon assets should fail loudly so content gaps are visible.

const talentIconModules = import.meta.glob("../assets/icons/**/*.svg", {
  eager: true,
  import: "default",
}) as Record<string, string>;

function iconModuleKey(talentId: string): string {
  const parts = talentId.split(".");
  if (parts.length < 3 || parts[0] !== "talent") {
    throw new Error(`ui: unsupported talent icon id "${talentId}"`);
  }
  return `../assets/icons/${parts.slice(1, -1).join("/")}/${parts.at(-1)}.svg`;
}

export function getTalentIconUrl(talentId: string): string {
  const key = iconModuleKey(talentId);
  const url = talentIconModules[key];
  if (!url) {
    throw new Error(`ui: no talent icon asset for "${talentId}" (expected ${key})`);
  }
  return url;
}
