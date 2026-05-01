// Strike odds preview for battle UI — mirrors hit_rate_v1 / crit_rate_v1 baseline.
// Does NOT apply reaction hooks (resolve_hit_rate / resolve_crit_rate).

import type { Character } from "../entity/actor";
import { getAttr } from "../entity/actor";
import { ATTR } from "../entity/attribute";
import { evalFormula } from "../infra/formula";

export interface StrikeOddsPreview {
  hitRate: number;
  critRate: number;
}

export function previewStrikeOdds(attacker: Character, defender: Character): StrikeOddsPreview {
  const hitRate = evalFormula(
    { kind: "hit_rate_v1" },
    { vars: { hit: getAttr(attacker, ATTR.HIT), eva: getAttr(defender, ATTR.EVA) } },
  );
  const critRate = evalFormula(
    { kind: "crit_rate_v1" },
    {
      vars: {
        crit_rate: getAttr(attacker, ATTR.CRIT_RATE),
        crit_res: getAttr(defender, ATTR.CRIT_RES),
      },
    },
  );
  return { hitRate, critRate };
}
