// Save schema version + migrations.
//
// Alpha-stage policy: we reserve the migration interface but do NOT write
// migrations yet. When a structural change lands:
//   - bump SAVE_VERSION
//   - append a migration entry to `migrations` that maps version N -> N+1
//   - deserialize will run the migrations in order
//
// Until migrations exist, mismatched versions throw; the caller (Store) is
// expected to surface a "can't read save, reset?" affordance to the user
// rather than silently wiping progress.
//
// Version history:
//   v1 → v2 (alpha, intentionally incompatible, no migration):
//     - inventories: Record<string, ItemStack[]>
//       → Record<string, { capacity, slots: (StackEntry | GearEntry | null)[] }>
//     - PlayerCharacter.equipped: Record<string, string | null>
//       → Record<string, GearInstance | null>
//     v1 saves will fail the structural checks in deserialize and the Store
//     falls back to a fresh state. Acceptable for alpha; write a real
//     migration the next time we change a shipped save shape.

export const SAVE_VERSION = 2;

/** A migration transforms serialized save data from `fromVersion` to
 *  `fromVersion + 1`. Migrations operate on the parsed JSON object to keep
 *  them resilient to interior renames without pulling in type definitions
 *  of older schemas. */
export interface Migration {
  /** Version this migration upgrades FROM. The output is fromVersion + 1. */
  fromVersion: number;
  /** Accepts the parsed previous-version save object; returns the new one. */
  apply(data: Record<string, unknown>): Record<string, unknown>;
}

/** In-order list of migrations. Empty for alpha — see module doc. */
export const migrations: Migration[] = [];
