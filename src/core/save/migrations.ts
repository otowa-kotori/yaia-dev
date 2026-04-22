// Save schema version + migrations.
//
// Alpha-stage policy: schema changes bump SAVE_VERSION and break old saves.
// We write a migration for each bump so existing dev saves can be upgraded
// without a full reset.

export const SAVE_VERSION = 5;

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

/** In-order list of migrations. Empty by default in alpha. */
export const migrations: Migration[] = [];

