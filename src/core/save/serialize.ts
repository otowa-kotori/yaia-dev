// Serialize / deserialize GameState.
//
// Key invariant: only SOURCE-of-TRUTH fields are written. Derived fields on
// characters (attrs.modifiers, attrs.cache, runtime abilities list) are
// stripped by the serializer and reconstructed by rebuildCharacterDerived
// on load. See CLAUDE.md "persisted actor fields" for the canonical list.
//
// Why strip rather than include: derived fields depend on content. If an
// item/effect is hot-replaced between saves, a serialized modifier stack
// can diverge from what the current content implies. Rebuilding keeps
// "content is truth" intact.
//
// Format: JSON with a `version` envelope. Versioning + migrations live in
// ./migrations.ts.

import type { GameState } from "../state/types";
import type { Actor, Character, PlayerCharacter } from "../actor";
import { isCharacter, rebuildCharacterDerived } from "../actor";
import type { AttrDef } from "../content/types";
import { getMonster } from "../content/registry";
import { SAVE_VERSION, migrations } from "./migrations";

// ---------- Serialize ----------

/** Produce a JSON string of the current GameState, omitting derived fields. */
export function serialize(state: GameState): string {
  // Deep clone via JSON round-trip to isolate what we're about to mutate
  // (stripping derived fields) from the live state. This is the cheap path
  // and keeps the code simple; revisit if serialization ever shows up hot.
  const clone = JSON.parse(JSON.stringify(state)) as GameState;

  // Strip derived fields from characters.
  for (const a of clone.actors) {
    if (!isCharacter(a as Actor)) continue;
    const c = a as Character;
    // attrs.modifiers and attrs.cache are derived from equipped gear +
    // active effects. Base values ARE source of truth and are kept.
    c.attrs.modifiers = [];
    c.attrs.cache = null;
    // Runtime abilities list is derived (from knownAbilities for players,
    // MonsterDef for enemies). Blanked here; rebuilt on load.
    c.abilities = [];
  }

  return JSON.stringify({ version: SAVE_VERSION, state: clone });
}

// ---------- Deserialize ----------

export interface DeserializeOptions {
  attrDefs: Readonly<Record<string, AttrDef>>;
  /** If true, run the migration pipeline before hydration. Default true. */
  runMigrations?: boolean;
}

/** Parse a save string and return a ready-to-use GameState. Throws on
 *  structural problems or version mismatch without available migrations. */
export function deserialize(raw: string, opts: DeserializeOptions): GameState {
  const runMigrations = opts.runMigrations ?? true;
  const parsed = JSON.parse(raw) as {
    version: number;
    state: Record<string, unknown>;
  };
  if (typeof parsed.version !== "number") {
    throw new Error("save: missing version field");
  }

  let data = parsed.state;
  let version = parsed.version;

  if (runMigrations) {
    while (version < SAVE_VERSION) {
      const m = migrations.find((x) => x.fromVersion === version);
      if (!m) {
        throw new Error(
          `save: no migration from v${version} to v${version + 1}`,
        );
      }
      data = m.apply(data);
      version += 1;
    }
  }

  if (version !== SAVE_VERSION) {
    throw new Error(
      `save: version ${version} does not match SAVE_VERSION ${SAVE_VERSION}`,
    );
  }

  const state = data as unknown as GameState;

  // Rebuild derived state on every character.
  for (const a of state.actors) {
    if (!isCharacter(a as Actor)) continue;
    // For enemies, rebuildCharacterDerived expects abilities to already be
    // populated (from MonsterDef). Re-derive them now.
    const c = a as Character;
    if (c.kind === "enemy") {
      // Pull monster def abilities back in from content — ids, not the
      // derived runtime list. `getMonster` throws if the def has been
      // removed since the save was written, which is the correct alpha
      // behaviour (surface the broken reference rather than silently
      // producing a toothless enemy).
      const mdef = getMonster((c as unknown as { defId: string }).defId);
      c.abilities = mdef.abilities.slice() as unknown as typeof c.abilities;
    } else if (c.kind === "player") {
      const pc = c as PlayerCharacter;
      pc.abilities = pc.knownAbilities.slice();
    }
    rebuildCharacterDerived(c, opts.attrDefs);
  }

  return state;
}
