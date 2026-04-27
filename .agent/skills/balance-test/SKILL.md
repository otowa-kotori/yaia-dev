---
name: balance-test
description: |
  Game balance testing CLI tool for simulating combat and analyzing hero/monster balance.
  Use when: (1) user asks to test or analyze combat balance, hero performance, monster difficulty,
  XP/gold farming efficiency, talent builds, or equipment impact; (2) user asks to run balance
  simulations, compare builds, or check if a monster is too strong/weak; (3) user modifies
  monster stats, talent params, damage formulas, or equipment values and wants to verify impact;
  (4) user asks to create or update balance test profiles or scenarios.
  Trigger keywords: balance, sim, simulate, farming, DPS, win rate, death rate, XP efficiency.
---

# Balance Testing CLI

`scripts/balance/cli.ts` — headless combat simulation driven entirely by `GameSession` API.
No game logic is duplicated; all combat rules, rewards, and recovery phases execute as in-game.

## File Layout

```
scripts/balance/
  cli.ts              Entry point (commander-based)
  config.ts           Config types, JSON loading, glob expansion
  setup.ts            Hero setup via GameSession API
  simulate.ts         Drives CombatActivity lifecycle, collects event data
  stats.ts            Computes balance metrics from raw data
  report.ts           Terminal table + JSON output
  profiles/           Stable hero build templates
    knight.json       Knight profiles at various levels/builds
```

## Commands

### list — Show available content IDs

```bash
bun run scripts/balance/cli.ts list              # all
bun run scripts/balance/cli.ts list heroes
bun run scripts/balance/cli.ts list zones
bun run scripts/balance/cli.ts list items
bun run scripts/balance/cli.ts list talents
```

Always run `list` first to discover valid IDs before writing profiles.

### quick — Single ad-hoc test

```bash
bun run scripts/balance/cli.ts quick <heroId> <zoneId> [-l <level>] [--weapon <id>] [-w <waves>]
```

### run (glob mode) — Profiles file + globs

```bash
bun run scripts/balance/cli.ts run <profiles.json> -p <glob> -z <glob> [-w <waves>] [--json]
```

`*` matches any substring. `-p` and `-z` are repeatable.

```bash
# All knight profiles vs all prairie zones
bun run scripts/balance/cli.ts run scripts/balance/profiles/knight.json \
  -p "knight_lv*" -z "combatzone.prairie.*"
# Lv10 talent variants vs one zone
bun run scripts/balance/cli.ts run scripts/balance/profiles/knight.json \
  -p "knight_lv10_copper_*" -z "combatzone.twilight.2_1_mushroom"
```

### run (config mode) — Full scenario file

```bash
bun run scripts/balance/cli.ts run <config.json> [-s <filter>] [-w <waves>] [--json]
```

Example config at `.agent/skills/balance-test/balance-example.json`.

## Profile Format

```json
{
  "heroProfiles": {
    "knight_lv5_copper": {
      "heroId": "hero.knight",
      "level": 5,
      "equipment": ["item.weapon.copper_sword"],
      "talents": { "talent.knight.power_strike": 1 },
      "equippedTalents": ["talent.knight.power_strike"]
    }
  }
}
```

Fields: `heroId` (required), `level` (default 1), `equipment` (auto-equip),
`talents` (`id -> level`, must respect prereqs), `equippedTalents` (battle slots).

### Knight talent prereqs

```
power_strike  (none)        fortitude  (none)
rage          <- ps Lv5     guard      <- fort Lv5
                             warcry     <- fort Lv5
                             retaliation <- warcry Lv5
```

TP budget: `(level - 1) * 3`.

## Output Metrics

| Column | Meaning |
|--------|---------|
| DPS | damage/tick in fighting phase |
| Death rate | deathRecovering entries per wave |
| XP/min | XP earned per simulated minute |
| gold/min | gold per simulated minute |

## Typical Workflows

- **Verify monster change**: edit `early-game.ts`, run `-z` on that zone vs knight levels.
- **Compare talent builds**: Lv10 profiles with different talents vs same zone.
- **Farming curve**: one profile vs all zones in a region (`-z "combatzone.prairie.*"`).
- **Difficulty cliff**: win rate 100% -> 0% between adjacent zones = gap too large.

## Key Source Files

- Profiles: `scripts/balance/profiles/`
- Monster defs: `src/content/default/monsters/early-game.ts`
- Hero defs: `src/content/default/heroes.ts`
- Combat zones: `src/content/default/combat-zones.ts`
- Talent defs: `src/content/behaviors/talents/knight.ts`
