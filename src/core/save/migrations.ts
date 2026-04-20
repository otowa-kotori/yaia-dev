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

export const SAVE_VERSION = 1;

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
