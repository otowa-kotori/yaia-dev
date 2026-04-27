// Debug panel — dev-only tools for inspecting game state and cheating.
//
// Shows:
//   - Runtime overview (tick, wall clock, actor count, speed, battle mode)
//   - Battle scheduler mode toggle (ATB / turn)
//   - Actor inspector with attribute grid and active effects
//   - Cheat section: time skip, grant levels, give items

import { useState } from "react";
import type { BattleSchedulerMode } from "../../core/combat/battle";
import { getContent } from "../../core/content";

import {
  getAttr,
  isCharacter,
  isEnemy,
  isPlayer,
  type Actor,
  type Character,
} from "../../core/entity/actor";

import type { AttrDef, EffectDef, Modifier } from "../../core/content/types";
import type { GameStore } from "../store";
import { T, fmt } from "../text";
import { useStore } from "../hooks/useStore";
import { Card } from "../components/Card";

const ATTR_PRIORITY = [
  "max_hp",
  "max_mp",
  "patk",
  "matk",
  "pdef",
  "mres",
  "str",
  "dex",
  "int",
  "spd",
];

export function DebugPanel({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const content = getContent();
  const actors = s.state.actors;
  const heroes = s.listHeroes();

  const [selectedActorId, setSelectedActorId] = useState("");
  const [selectedHeroId, setSelectedHeroId] = useState("");
  const [hours, setHours] = useState("1");
  const [levels, setLevels] = useState("1");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("1");
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const focusedHeroId = s.focusedCharId || heroes[0]?.id || "";
  const actorId = pickExistingId(selectedActorId, actors.map((actor) => actor.id), focusedHeroId);
  const heroId = pickExistingId(selectedHeroId, heroes.map((hero) => hero.id), focusedHeroId);
  const actor = actors.find((entry) => entry.id === actorId) ?? null;
  const hero = heroes.find((entry) => entry.id === heroId) ?? null;
  const wallClockStr = s.state.lastWallClockMs
    ? new Date(s.state.lastWallClockMs).toLocaleString()
    : "—";
  const schedulerMode = s.getBattleSchedulerMode();
  const itemEntries = Object.entries(content.items).sort((a, b) =>
    a[1].name.localeCompare(b[1].name, "zh-Hans-CN")
  );
  const resolvedItem = itemId ? content.items[itemId] : undefined;

  function setError(message: string): void {
    setFeedback({ kind: "error", message });
  }

  function setSuccess(message: string): void {
    setFeedback({ kind: "success", message });
  }

  function schedulerModeLabel(mode: BattleSchedulerMode): string {
    switch (mode) {
      case "atb":
        return T.debugBattleMode_atb;
      case "turn":
        return T.debugBattleMode_turn;
    }
  }

  function handleSchedulerModeChange(mode: BattleSchedulerMode): void {
    s.setBattleSchedulerMode(mode);
    setSuccess(fmt(T.debugBattleModeApplied, { mode: schedulerModeLabel(mode) }));
  }

  function handleCatchUp(): void {
    const parsed = Number(hours);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError(T.debugInvalidPositiveNumber);
      return;
    }
    s.debugSimulateCatchUp(parsed);
    setSuccess(T.debugCatchUpQueued);
  }

  function handleGrantLevels(): void {
    if (!hero) {
      setError(T.debugCheatNoHero);
      return;
    }
    const parsed = Number(levels);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      setError(T.debugInvalidPositiveInteger);
      return;
    }

    try {
      const gained = s.debugGrantHeroLevels(hero.id, parsed);
      if (gained <= 0) {
        setSuccess(fmt(T.debugLevelUpMaxed, { name: hero.name }));
        return;
      }
      setSuccess(fmt(T.debugLevelUpDone, { name: hero.name, levels: gained }));
    } catch (error) {
      setError(error instanceof Error ? error.message : T.debugActionError);
    }
  }

  function handleGiveItem(): void {
    if (!hero) {
      setError(T.debugCheatNoHero);
      return;
    }
    const parsedQty = Number(qty);
    if (!Number.isInteger(parsedQty) || parsedQty <= 0) {
      setError(T.debugInvalidPositiveInteger);
      return;
    }
    if (!resolvedItem) {
      setError(T.debugUnknownItem);
      return;
    }

    try {
      s.debugGiveItem(hero.id, itemId, parsedQty);
      setSuccess(
        fmt(T.debugGiveItemDone, {
          name: hero.name,
          qty: parsedQty,
          itemName: resolvedItem.name,
        }),
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : T.debugActionError);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <Card className="p-3">
        <div className="text-[11px] opacity-55 tracking-wide uppercase mb-2">{T.debugTools}</div>
        <div className="text-xs opacity-65">{T.debugOnlyInDev}</div>
      </Card>

      {/* Overview */}
      <Card className="p-3">
        <div className="text-[11px] opacity-55 tracking-wide uppercase mb-2">{T.debugOverview}</div>
        <InfoGrid
          rows={[
            { label: T.debugTick, value: String(s.state.tick) },
            { label: T.debugWallClock, value: wallClockStr },
            { label: T.debugActors, value: String(actors.length) },
            { label: T.debugSpeed, value: `${s.getSpeedMultiplier()}x` },
            { label: T.debugBattleMode, value: schedulerModeLabel(schedulerMode) },
          ]}
        />
      </Card>

      {/* Battle mode toggle */}
      <Card className="p-3">
        <div className="text-[11px] opacity-55 tracking-wide uppercase mb-2">{T.debugBattleMode}</div>
        <div className="text-xs opacity-70">{T.debugBattleModeHint}</div>
        <div className="flex gap-2 flex-wrap mt-2.5">
          {(["atb", "turn"] as const).map((mode) => {
            const active = schedulerMode === mode;
            return (
              <button
                key={mode}
                onClick={() => handleSchedulerModeChange(mode)}
                className={`px-2.5 py-1 text-xs rounded border font-[inherit] cursor-pointer ${
                  active
                    ? "border-blue-500 bg-blue-950/60 text-blue-200"
                    : "border-[#4b657c] bg-[#2a2a2a] text-white hover:bg-[#333]"
                }`}
              >
                {schedulerModeLabel(mode)}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Actor inspector */}
      <Card className="p-3">
        <div className="text-[11px] opacity-55 tracking-wide uppercase mb-2">{T.debugActorInspector}</div>
        {actors.length === 0 ? (
          <MutedText>{T.debugActorNone}</MutedText>
        ) : (
          <>
            <LabeledControl label={T.debugActorSelect}>
              <select
                value={actorId}
                onChange={(event) => setSelectedActorId(event.target.value)}
                className="w-full px-2 py-1 text-xs bg-[#111] border border-gray-700 rounded text-white font-[inherit]"
              >
                {actors.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {buildActorOptionLabel(entry)}
                  </option>
                ))}
              </select>
            </LabeledControl>
            {!actor ? (
              <MutedText>{T.debugActorNoSelection}</MutedText>
            ) : (
              <ActorInspector actor={actor} />
            )}
          </>
        )}
      </Card>

      {/* Cheats */}
      <Card className="p-3">
        <div className="text-[11px] opacity-55 tracking-wide uppercase mb-2">{T.debugCheats}</div>
        {feedback && <FeedbackBanner kind={feedback.kind} message={feedback.message} />}
        {heroes.length === 0 ? (
          <MutedText>{T.debugCheatNoHero}</MutedText>
        ) : (
          <>
            <LabeledControl label={T.debugCheatTargetHero}>
              <select
                value={heroId}
                onChange={(event) => setSelectedHeroId(event.target.value)}
                className="w-full px-2 py-1 text-xs bg-[#111] border border-gray-700 rounded text-white font-[inherit]"
              >
                {heroes.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name} · Lv {entry.level} · {entry.id}
                  </option>
                ))}
              </select>
            </LabeledControl>

            <CheatSection title={T.debugCheatTime} hint={T.debugCheatTimeHint}>
              <div className="flex gap-2 flex-wrap items-center">
                <input
                  type="number"
                  min="0.1"
                  step="0.5"
                  value={hours}
                  onChange={(event) => setHours(event.target.value)}
                  className="w-24 px-2 py-1 text-xs bg-[#111] border border-gray-700 rounded text-white font-[inherit]"
                />
                <span className="text-[11px] opacity-55">{T.debugCatchUpHours}</span>
                <button
                  onClick={handleCatchUp}
                  className="px-2.5 py-1 text-xs rounded border border-[#4b657c] bg-[#2a2a2a] text-white cursor-pointer hover:bg-[#333] font-[inherit]"
                >
                  {T.debugCatchUpRun}
                </button>
              </div>
            </CheatSection>

            <CheatSection title={T.debugCheatLevels} hint={T.debugCheatLevelsHint}>
              <div className="flex gap-2 flex-wrap items-center">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={levels}
                  onChange={(event) => setLevels(event.target.value)}
                  className="w-24 px-2 py-1 text-xs bg-[#111] border border-gray-700 rounded text-white font-[inherit]"
                />
                <button
                  onClick={handleGrantLevels}
                  className="px-2.5 py-1 text-xs rounded border border-[#4b657c] bg-[#2a2a2a] text-white cursor-pointer hover:bg-[#333] font-[inherit]"
                >
                  {T.debugCheatGrantLevels}
                </button>
              </div>
            </CheatSection>

            <CheatSection
              title={T.debugCheatItems}
              hint={resolvedItem ? fmt(T.debugResolvedItem, { name: resolvedItem.name }) : undefined}
            >
              <div className="flex gap-2 flex-wrap items-center">
                <input
                  list="debug-item-ids"
                  value={itemId}
                  onChange={(event) => setItemId(event.target.value)}
                  placeholder={T.debugCheatItemId}
                  className="min-w-[220px] flex-[1_1_220px] px-2 py-1 text-xs bg-[#111] border border-gray-700 rounded text-white font-[inherit]"
                />
                <datalist id="debug-item-ids">
                  {itemEntries.map(([id, item]) => (
                    <option key={id} value={id} label={item.name} />
                  ))}
                </datalist>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={qty}
                  onChange={(event) => setQty(event.target.value)}
                  aria-label={T.debugCheatItemQty}
                  className="w-24 px-2 py-1 text-xs bg-[#111] border border-gray-700 rounded text-white font-[inherit]"
                />
                <button
                  onClick={handleGiveItem}
                  className="px-2.5 py-1 text-xs rounded border border-[#4b657c] bg-[#2a2a2a] text-white cursor-pointer hover:bg-[#333] font-[inherit]"
                >
                  {T.debugCheatGiveItem}
                </button>
              </div>
            </CheatSection>
          </>
        )}
      </Card>
    </div>
  );
}

// ---------- ActorInspector ----------

function ActorInspector({ actor }: { actor: Actor }) {
  const content = getContent();
  const infoRows = buildActorInfoRows(actor);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-base font-bold text-white mb-1">{actor.name}</div>
        <InfoGrid rows={infoRows} />
      </div>

      {isCharacter(actor) ? (
        <>
          <CompactAttrGrid actor={actor} />
          <EffectList actor={actor} />
        </>
      ) : (
        <MutedText>{T.debugActorNoCharacterData}</MutedText>
      )}
    </div>
  );
}

// ---------- CompactAttrGrid ----------

function CompactAttrGrid({
  actor,
}: {
  actor: Character;
}) {
  const attrDefs = getContent().attributes;
  const attrIds = collectVisibleAttrIds(actor, attrDefs);

  return (
    <div>
      <div className="text-[11px] opacity-55 tracking-wide uppercase mb-2">{T.debugActorAttrs}</div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2">
        {attrIds.map((attrId) => (
          <div key={attrId} className="bg-[#1a1a1a] rounded p-2 border border-[#303030]">
            <div className="text-[11px] opacity-55 mb-0.5">{attrDefs[attrId]?.name ?? attrId}</div>
            <div className="text-sm font-semibold tabular-nums">
              {formatNumber(getAttr(actor, attrId))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- EffectList ----------

function EffectList({ actor }: { actor: Character }) {
  const content = getContent();

  return (
    <div>
      <div className="text-[11px] opacity-55 tracking-wide uppercase mb-2">{T.debugActorEffectsTitle}</div>
      {actor.activeEffects.length === 0 ? (
        <MutedText>{T.debugActorEffectsEmpty}</MutedText>
      ) : (
        <div className="flex flex-col gap-2">
          {actor.activeEffects.map((effect, index) => {
            const def = safeGetEffectDef(effect.effectId);
            const modifiers = resolveEffectModifiers(def, effect);
            const reactionCount = def?.reactions ? Object.keys(def.reactions).length : 0;
            const stateSummary = formatStateSummary(effect.state);

            return (
              <div key={`${effect.sourceId}:${index}`} className="bg-[#1a1a1a] rounded p-2.5 border border-[#303030]">
                <div className="flex justify-between gap-3 flex-wrap mb-1.5">
                  <div className="font-semibold text-white">{def?.name ?? effect.effectId}</div>
                  <div className="text-xs opacity-72 tabular-nums">
                    {formatRemainingActions(effect.remainingActions)}
                    {effect.stacks > 1 ? ` · ${fmt(T.debugEffectStacks, { count: effect.stacks })}` : ""}
                  </div>
                </div>
                <div className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1 text-xs">
                  <span className="text-[11px] opacity-55">{T.debugEffectId}</span>
                  <span>{effect.effectId}</span>
                  {effect.sourceTalentId ? (
                    <>
                      <span className="text-[11px] opacity-55">{T.debugEffectSourceTalent}</span>
                      <span>{content.talents[effect.sourceTalentId]?.name ?? effect.sourceTalentId}</span>
                    </>
                  ) : null}
                  <span className="text-[11px] opacity-55">{T.debugEffectSourceActor}</span>
                  <span>{effect.sourceActorId}</span>
                  {def?.tags?.length ? (
                    <>
                      <span className="text-[11px] opacity-55">{T.debugEffectTags}</span>
                      <span>{def.tags.join(" · ")}</span>
                    </>
                  ) : null}
                  {modifiers.length > 0 ? (
                    <>
                      <span className="text-[11px] opacity-55">{T.debugEffectModifiers}</span>
                      <span>{modifiers.map((modifier) => formatModifier(modifier, content.attributes)).join(" · ")}</span>
                    </>
                  ) : null}
                  {modifiers.length === 0 && reactionCount > 0 ? (
                    <>
                      <span className="text-[11px] opacity-55">{T.debugEffectModifiers}</span>
                      <span>{T.debugEffectReactions}</span>
                    </>
                  ) : null}
                  {stateSummary ? (
                    <>
                      <span className="text-[11px] opacity-55">{T.debugEffectState}</span>
                      <span>{stateSummary}</span>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- Layout helpers ----------

function CheatSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <div className="text-xs font-semibold text-white">{title}</div>
      {hint ? <div className="text-[11px] opacity-60">{hint}</div> : null}
      {children}
    </div>
  );
}

function LabeledControl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 mb-3">
      <div className="text-[11px] opacity-55">{label}</div>
      {children}
    </div>
  );
}

function FeedbackBanner({
  kind,
  message,
}: {
  kind: "success" | "error";
  message: string;
}) {
  return (
    <div
      className={`mb-3 px-2.5 py-2 rounded text-xs border ${
        kind === "success"
          ? "border-green-800/60 bg-green-950/40 text-green-300"
          : "border-red-800/60 bg-red-950/40 text-red-300"
      }`}
    >
      {message}
    </div>
  );
}

function InfoGrid({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
      {rows.map((row) => (
        <FragmentRow key={`${row.label}:${row.value}`} label={row.label} value={row.value} />
      ))}
    </div>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-[11px] opacity-55">{label}</span>
      <span className="tabular-nums">{value}</span>
    </>
  );
}

function MutedText({ children }: { children: React.ReactNode }) {
  return <div className="text-xs opacity-60">{children}</div>;
}

// ---------- Pure helpers ----------

function buildActorInfoRows(
  actor: Actor,
): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [
    { label: T.debugActorKind, value: actorKindLabel(actor) },
    { label: T.debugActorId, value: actor.id },
  ];

  if (isCharacter(actor)) {
    rows.push(
      {
        label: T.debugActorHp,
        value: `${formatNumber(actor.currentHp)} / ${formatNumber(getAttr(actor, "max_hp"))}`,
      },
      {
        label: T.debugActorMp,
        value: `${formatNumber(actor.currentMp)} / ${formatNumber(getAttr(actor, "max_mp"))}`,
      },
      {
        label: T.debugActorEffectCount,
        value: String(actor.activeEffects.length),
      },
    );
  }

  if (isPlayer(actor)) {
    rows.push(
      { label: T.debugActorLevel, value: String(actor.level) },
      { label: T.debugActorHeroConfig, value: actor.heroConfigId },
      { label: T.debugActorLocation, value: actor.locationId ?? "—" },
      { label: T.debugActorStage, value: actor.stageId ?? "—" },
    );
  } else if (isEnemy(actor)) {
    rows.push({ label: T.debugActorDefId, value: actor.defId });
  } else if ("defId" in actor && typeof actor.defId === "string") {
    rows.push({ label: T.debugActorDefId, value: actor.defId });
  }

  return rows;
}

function actorKindLabel(actor: Actor): string {
  if (isPlayer(actor)) return T.debugActorKind_player;
  if (isEnemy(actor)) return T.debugActorKind_enemy;
  return T.debugActorKind_resourceNode;
}

function buildActorOptionLabel(actor: Actor): string {
  return `${actor.name} · ${actorKindLabel(actor)} · ${actor.id}`;
}

function collectVisibleAttrIds(
  actor: Character,
  attrDefs: Readonly<Record<string, AttrDef>>,
): string[] {
  const priorityOrder = new Map(ATTR_PRIORITY.map((attrId, index) => [attrId, index]));
  const allAttrIds = Array.from(
    new Set([...Object.keys(attrDefs), ...Object.keys(actor.attrs.base)]),
  );

  return allAttrIds
    .filter((attrId) => shouldShowAttr(actor, attrId, attrDefs, priorityOrder))
    .sort((left, right) => compareAttrIds(left, right, attrDefs, priorityOrder));
}

function shouldShowAttr(
  actor: Character,
  attrId: string,
  attrDefs: Readonly<Record<string, AttrDef>>,
  priorityOrder: Map<string, number>,
): boolean {
  if (priorityOrder.has(attrId)) return true;
  if (attrId in actor.attrs.base) return true;
  const value = getAttr(actor, attrId);
  const defaultBase = attrDefs[attrId]?.defaultBase ?? 0;
  return Math.abs(value - defaultBase) > 0.0001;
}

function compareAttrIds(
  left: string,
  right: string,
  attrDefs: Readonly<Record<string, AttrDef>>,
  priorityOrder: Map<string, number>,
): number {
  const leftPriority = priorityOrder.get(left);
  const rightPriority = priorityOrder.get(right);
  if (leftPriority !== undefined || rightPriority !== undefined) {
    if (leftPriority === undefined) return 1;
    if (rightPriority === undefined) return -1;
    return leftPriority - rightPriority;
  }
  const leftName = attrDefs[left]?.name ?? left;
  const rightName = attrDefs[right]?.name ?? right;
  return leftName.localeCompare(rightName, "zh-Hans-CN");
}

function resolveEffectModifiers(def: EffectDef | undefined, effect: Character["activeEffects"][number]): Modifier[] {
  if (!def) return [];
  return def.computeModifiers ? def.computeModifiers(effect.state) : (def.modifiers ?? []);
}

function safeGetEffectDef(effectId: string): EffectDef | undefined {
  return getContent().effects[effectId];
}

function formatModifier(
  modifier: Modifier,
  attrDefs: Readonly<Record<string, AttrDef>>,
): string {
  const attrName = attrDefs[modifier.stat]?.name ?? modifier.stat;
  const value = formatModifierValue(modifier);
  return `${attrName} ${value}`;
}

function formatModifierValue(modifier: Modifier): string {
  const sign = modifier.value >= 0 ? "+" : "-";
  const magnitude = Math.abs(modifier.value);
  if (modifier.op === "flat") {
    return `${sign}${formatNumber(magnitude)}`;
  }
  return `${sign}${formatPercent(magnitude)}`;
}

function formatRemainingActions(remainingActions: number): string {
  if (remainingActions === -1) return T.debugEffectInfinite;
  return fmt(T.debugEffectActions, { count: remainingActions });
}

function formatStateSummary(state: Record<string, unknown>): string {
  const entries = Object.entries(state);
  if (entries.length === 0) return "";
  return entries
    .map(([key, value]) => `${key}: ${formatUnknownValue(value)}`)
    .join(" · ");
}

function formatUnknownValue(value: unknown): string {
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(value);
}

function formatNumber(value: number): string {
  if (Math.abs(value - Math.round(value)) < 0.0001) {
    return String(Math.round(value));
  }
  return value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function formatPercent(value: number): string {
  return `${formatNumber(value * 100)}%`;
}

function pickExistingId(selectedId: string, ids: string[], fallbackId: string): string {
  if (selectedId && ids.includes(selectedId)) return selectedId;
  if (fallbackId && ids.includes(fallbackId)) return fallbackId;
  return ids[0] ?? "";
}
