// Save schema version + migrations.
//
// Alpha-stage policy: schema changes bump SAVE_VERSION and break old saves.
// We write a migration for each bump so existing dev saves can be upgraded
// without a full reset.

export const SAVE_VERSION = 4;

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
    // v2 → v3: add currencies and worldRecord fields introduced in the
    // currency + global-upgrade feature. Old saves have neither field.
    fromVersion: 2,
    apply(data) {
      return {
        ...data,
        currencies: (data["currencies"] as Record<string, number> | undefined) ?? {},
        worldRecord: (data["worldRecord"] as { upgrades: Record<string, number> } | undefined) ?? {
          upgrades: {},
        },
      };
    },
  },
];
