// Save schema version + migrations.
//
// Alpha-stage policy: schema changes bump SAVE_VERSION and break old saves.
// We write a migration for each bump so existing dev saves can be upgraded
// without a full reset.

export const SAVE_VERSION = 6;

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

/** In-order list of migrations. */
export const migrations: Migration[] = [
  {
    fromVersion: 5,
    apply(data) {
      // Add lastWallClockMs field for offline catch-up.
      // Default to current time so the first catch-up after migration is a
      // no-op rather than a spurious 24-hour fast-forward.
      if (data.lastWallClockMs === undefined) {
        data.lastWallClockMs = Date.now();
      }
      return data;
    },
  },
];

