import { useState } from "react";
import { getContent } from "../core/content";
import {
  getAttr,
  isCharacter,
  isEnemy,
  isPlayer,
  type Actor,
  type Character,
  type PlayerCharacter,
} from "../core/entity/actor";
import type { AttrDef, EffectDef, Modifier } from "../core/content/types";
import type { GameStore } from "./store";
import { T, fmt } from "./text";
import { useStore } from "./useStore";

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

const tabStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const panelStyle: React.CSSProperties = {
  background: "#222",
  borderRadius: 6,
  padding: 12,
  border: "1px solid #333",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  opacity: 0.55,
  letterSpacing: 0.5,
  textTransform: "uppercase",
  marginBottom: 8,
};

const inputStyle: React.CSSProperties = {
  padding: "4px 8px",
  fontSize: 12,
  background: "#111",
  border: "1px solid #444",
  borderRadius: 4,
  color: "#fff",
  fontFamily: "inherit",
};

const buttonStyle: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 12,
  borderRadius: 4,
  border: "1px solid #4b657c",
  background: "#2a2a2a",
  color: "#fff",
  cursor: "pointer",
  fontFamily: "inherit",
};

const metaLabelStyle: React.CSSProperties = {
  fontSize: 11,
  opacity: 0.55,
};

export function DebugView({ store }: { store: GameStore }) {
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
  const itemEntries = Object.entries(content.items).sort((a, b) => a[1].name.localeCompare(b[1].name, "zh-Hans-CN"));
  const resolvedItem = itemId ? content.items[itemId] : undefined;

  function setError(message: string): void {
    setFeedback({ kind: "error", message });
  }

  function setSuccess(message: string): void {
    setFeedback({ kind: "success", message });
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
    <div style={tabStyle}>
      <div style={panelStyle}>
        <div style={sectionTitleStyle}>{T.debugTools}</div>
        <div style={{ fontSize: 12, opacity: 0.65 }}>{T.debugOnlyInDev}</div>
      </div>

      <div style={panelStyle}>
        <div style={sectionTitleStyle}>{T.debugOverview}</div>
        <InfoGrid
          rows={[
            { label: T.debugTick, value: String(s.state.tick) },
            { label: T.debugWallClock, value: wallClockStr },
            { label: T.debugActors, value: String(actors.length) },
            { label: T.debugSpeed, value: `${s.getSpeedMultiplier()}x` },
          ]}
        />
      </div>

      <div style={panelStyle}>
        <div style={sectionTitleStyle}>{T.debugActorInspector}</div>
        {actors.length === 0 ? (
          <MutedText>{T.debugActorNone}</MutedText>
        ) : (
          <>
            <LabeledControl label={T.debugActorSelect}>
              <select
                value={actorId}
                onChange={(event) => setSelectedActorId(event.target.value)}
                style={{ ...inputStyle, width: "100%" }}
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
      </div>

      <div style={panelStyle}>
        <div style={sectionTitleStyle}>{T.debugCheats}</div>
        {feedback && <FeedbackBanner kind={feedback.kind} message={feedback.message} />}
        {heroes.length === 0 ? (
          <MutedText>{T.debugCheatNoHero}</MutedText>
        ) : (
          <>
            <LabeledControl label={T.debugCheatTargetHero}>
              <select
                value={heroId}
                onChange={(event) => setSelectedHeroId(event.target.value)}
                style={{ ...inputStyle, width: "100%" }}
              >
                {heroes.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name} · Lv {entry.level} · {entry.id}
                  </option>
                ))}
              </select>
            </LabeledControl>

            <CheatSection title={T.debugCheatTime} hint={T.debugCheatTimeHint}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <input
                  type="number"
                  min="0.1"
                  step="0.5"
                  value={hours}
                  onChange={(event) => setHours(event.target.value)}
                  style={{ ...inputStyle, width: 96 }}
                />
                <span style={metaLabelStyle}>{T.debugCatchUpHours}</span>
                <button onClick={handleCatchUp} style={buttonStyle}>
                  {T.debugCatchUpRun}
                </button>
              </div>
            </CheatSection>

            <CheatSection title={T.debugCheatLevels} hint={T.debugCheatLevelsHint}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={levels}
                  onChange={(event) => setLevels(event.target.value)}
                  style={{ ...inputStyle, width: 96 }}
                />
                <button onClick={handleGrantLevels} style={buttonStyle}>
                  {T.debugCheatGrantLevels}
                </button>
              </div>
            </CheatSection>

            <CheatSection title={T.debugCheatItems} hint={resolvedItem ? fmt(T.debugResolvedItem, { name: resolvedItem.name }) : undefined}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <input
                  list="debug-item-ids"
                  value={itemId}
                  onChange={(event) => setItemId(event.target.value)}
                  placeholder={T.debugCheatItemId}
                  style={{ ...inputStyle, minWidth: 220, flex: "1 1 220px" }}
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
                  style={{ ...inputStyle, width: 96 }}
                />
                <button onClick={handleGiveItem} style={buttonStyle}>
                  {T.debugCheatGiveItem}
                </button>
              </div>
            </CheatSection>
          </>
        )}
      </div>
    </div>
  );
}

function ActorInspector({ actor }: { actor: Actor }) {
  const content = getContent();
  const infoRows = buildActorInfoRows(actor, content.attributes);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 4 }}>{actor.name}</div>
        <InfoGrid rows={infoRows} />
      </div>

      {isCharacter(actor) ? (
        <>
          <CompactAttrGrid actor={actor} attrDefs={content.attributes} />
          <EffectList actor={actor} />
        </>
      ) : (
        <MutedText>{T.debugActorNoCharacterData}</MutedText>
      )}
    </div>
  );
}

function CompactAttrGrid({
  actor,
  attrDefs,
}: {
  actor: Character;
  attrDefs: Readonly<Record<string, AttrDef>>;
}) {
  const attrIds = collectVisibleAttrIds(actor, attrDefs);

  return (
    <div>
      <div style={sectionTitleStyle}>{T.debugActorAttrs}</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 8,
        }}
      >
        {attrIds.map((attrId) => (
          <div key={attrId} style={{ background: "#1a1a1a", borderRadius: 4, padding: "8px 10px", border: "1px solid #303030" }}>
            <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 3 }}>{attrDefs[attrId]?.name ?? attrId}</div>
            <div style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
              {formatNumber(getAttr(actor, attrId, attrDefs))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EffectList({ actor }: { actor: Character }) {
  const content = getContent();

  return (
    <div>
      <div style={sectionTitleStyle}>{T.debugActorEffectsTitle}</div>
      {actor.activeEffects.length === 0 ? (
        <MutedText>{T.debugActorEffectsEmpty}</MutedText>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {actor.activeEffects.map((effect, index) => {
            const def = safeGetEffectDef(effect.effectId);
            const modifiers = resolveEffectModifiers(def, effect);
            const reactionCount = def?.reactions ? Object.keys(def.reactions).length : 0;
            const stateSummary = formatStateSummary(effect.state);

            return (
              <div key={`${effect.sourceId}:${index}`} style={{ background: "#1a1a1a", borderRadius: 4, padding: 10, border: "1px solid #303030" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
                  <div style={{ fontWeight: 600, color: "#fff" }}>{def?.name ?? effect.effectId}</div>
                  <div style={{ fontSize: 12, opacity: 0.72, fontVariantNumeric: "tabular-nums" }}>
                    {formatRemainingActions(effect.remainingActions)}
                    {effect.stacks > 1 ? ` · ${fmt(T.debugEffectStacks, { count: effect.stacks })}` : ""}
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 10px", fontSize: 12 }}>
                  <span style={metaLabelStyle}>{T.debugEffectId}</span>
                  <span>{effect.effectId}</span>
                  {effect.sourceTalentId ? (
                    <>
                      <span style={metaLabelStyle}>{T.debugEffectSourceTalent}</span>
                      <span>{content.talents[effect.sourceTalentId]?.name ?? effect.sourceTalentId}</span>
                    </>
                  ) : null}
                  <span style={metaLabelStyle}>{T.debugEffectSourceActor}</span>
                  <span>{effect.sourceActorId}</span>
                  {def?.tags?.length ? (
                    <>
                      <span style={metaLabelStyle}>{T.debugEffectTags}</span>
                      <span>{def.tags.join(" · ")}</span>
                    </>
                  ) : null}
                  {modifiers.length > 0 ? (
                    <>
                      <span style={metaLabelStyle}>{T.debugEffectModifiers}</span>
                      <span>{modifiers.map((modifier) => formatModifier(modifier, content.attributes)).join(" · ")}</span>
                    </>
                  ) : null}
                  {modifiers.length === 0 && reactionCount > 0 ? (
                    <>
                      <span style={metaLabelStyle}>{T.debugEffectModifiers}</span>
                      <span>{T.debugEffectReactions}</span>
                    </>
                  ) : null}
                  {stateSummary ? (
                    <>
                      <span style={metaLabelStyle}>{T.debugEffectState}</span>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 4 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#fff" }}>{title}</div>
      {hint ? <div style={{ fontSize: 11, opacity: 0.6 }}>{hint}</div> : null}
      {children}
    </div>
  );
}

function LabeledControl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
      <div style={metaLabelStyle}>{label}</div>
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
      style={{
        marginBottom: 12,
        padding: "8px 10px",
        borderRadius: 4,
        border: kind === "success" ? "1px solid #356a48" : "1px solid #6d3636",
        background: kind === "success" ? "#1d3022" : "#3a1f1f",
        color: kind === "success" ? "#b8efc8" : "#ffb3b3",
        fontSize: 12,
      }}
    >
      {message}
    </div>
  );
}

function InfoGrid({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", fontSize: 12 }}>
      {rows.map((row) => (
        <FragmentRow key={`${row.label}:${row.value}`} label={row.label} value={row.value} />
      ))}
    </div>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span style={metaLabelStyle}>{label}</span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </>
  );
}

function MutedText({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, opacity: 0.6 }}>{children}</div>;
}

function buildActorInfoRows(
  actor: Actor,
  attrDefs: Readonly<Record<string, AttrDef>>,
): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [
    { label: T.debugActorKind, value: actorKindLabel(actor) },
    { label: T.debugActorId, value: actor.id },
  ];

  if (isCharacter(actor)) {
    rows.push(
      {
        label: T.debugActorHp,
        value: `${formatNumber(actor.currentHp)} / ${formatNumber(getAttr(actor, "max_hp", attrDefs))}`,
      },
      {
        label: T.debugActorMp,
        value: `${formatNumber(actor.currentMp)} / ${formatNumber(getAttr(actor, "max_mp", attrDefs))}`,
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
  const value = getAttr(actor, attrId, attrDefs);
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
