// Crafting tab — recipe list + material requirements + one-click crafting.
//
// MVP scope:
//   - show all registered recipes
//   - compare required inputs against the hero's personal bag
//   - allow immediate crafting when requirements are met and no activity is running
//
// Deliberately omitted for now:
//   - queueing / timed progress bars
//   - batch crafting
//   - recipe discovery / unlock states

import { useMemo, useState } from "react";
import { getContent } from "../core/content";
import type { RecipeDef } from "../core/content/types";
import type { Inventory, InventorySlot } from "../core/inventory";
import type { GameStore } from "./store";
import { useStore } from "./useStore";

export function CraftingView({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const cc = s.getFocusedCharacter();
  const hero = cc.hero;
  const [actionError, setActionError] = useState<string | null>(null);
  const content = getContent();

  const recipes = useMemo(
    () => Object.values(content.recipes).sort((a, b) => a.name.localeCompare(b.name)),
    [content],
  );

  if (!hero) return null;

  const inventory = s.state.inventories[hero.id] ?? null;
  if (!inventory) {
    return <EmptyState title="合成" message="角色背包不存在，无法进行合成。" />;
  }

  if (recipes.length === 0) {
    return <EmptyState title="合成" message="当前还没有可用配方。" />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={sectionStyle}>
        <div style={headerStyle}>合成台</div>
        <div style={{ fontSize: 12, lineHeight: 1.6, opacity: 0.68 }}>
          用背包里的材料直接制作装备。当前制作会立刻完成；后续如果做排队或耗时条，再接到同一套配方数据上。
        </div>
      </div>

      {actionError && <ErrorBanner message={actionError} />}

      {recipes.map((recipe) => {
        const skillLevel = hero.skills[recipe.skill]?.level ?? 1;
        const blockedByActivity = cc.isRunning();
        const blockedBySkill = skillLevel < recipe.requiredLevel;
        const blockedByMaterials = recipe.inputs.some(
          (input) => countItemInInventory(inventory, input.itemId) < input.qty,
        );
        const disabled = blockedByActivity || blockedBySkill || blockedByMaterials;

        return (
          <RecipeCard
            key={recipe.id}
            recipe={recipe}
            inventory={inventory}
            skillLevel={skillLevel}
            disabled={disabled}
            blockedByActivity={blockedByActivity}
            blockedBySkill={blockedBySkill}
            blockedByMaterials={blockedByMaterials}
            onCraft={() => {
              try {
                cc.craftRecipe(recipe.id);
                setActionError(null);
              } catch (error) {
                setActionError(error instanceof Error ? error.message : "合成失败");
              }
            }}
          />
        );
      })}
    </div>
  );
}

function RecipeCard({
  recipe,
  inventory,
  skillLevel,
  disabled,
  blockedByActivity,
  blockedBySkill,
  blockedByMaterials,
  onCraft,
}: {
  recipe: RecipeDef;
  inventory: Inventory;
  skillLevel: number;
  disabled: boolean;
  blockedByActivity: boolean;
  blockedBySkill: boolean;
  blockedByMaterials: boolean;
  onCraft: () => void;
}) {
  const content = getContent();
  const skillName = content.skills[recipe.skill]?.name ?? recipe.skill;

  return (
    <div style={sectionStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 4 }}>{recipe.name}</div>
          <div style={{ fontSize: 12, opacity: 0.58 }}>
            {skillName} Lv {recipe.requiredLevel}+ · {recipe.durationTicks} tick · +{recipe.xpReward} XP
          </div>
        </div>
        <button
          onClick={onCraft}
          disabled={disabled}
          style={{
            ...primaryButtonStyle,
            opacity: disabled ? 0.45 : 1,
            cursor: disabled ? "default" : "pointer",
          }}
        >
          合成
        </button>
      </div>

      <div style={gridStyle}>
        <RecipeGroup title="材料需求">
          {recipe.inputs.map((input) => {
            const held = countItemInInventory(inventory, input.itemId);
            const ok = held >= input.qty;
            return (
              <RecipeLine
                key={`in:${input.itemId}`}
                name={content.items[input.itemId]?.name ?? input.itemId}
                right={`${held} / ${input.qty}`}
                ok={ok}
              />
            );
          })}
        </RecipeGroup>

        <RecipeGroup title="产出结果">
          {recipe.outputs.map((output) => {
            const item = content.items[output.itemId];
            const label = item?.slot ? `${item.name}（${slotLabel(item.slot)}）` : item?.name ?? output.itemId;
            return (
              <RecipeLine
                key={`out:${output.itemId}`}
                name={label}
                right={`×${output.qty}`}
                ok={true}
              />
            );
          })}
        </RecipeGroup>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        <HintPill active={!blockedBySkill}>当前技能 Lv {skillLevel}</HintPill>
        <HintPill active={!blockedByMaterials}>材料齐全</HintPill>
        <HintPill active={!blockedByActivity}>当前未在活动中</HintPill>
      </div>
    </div>
  );
}

function RecipeGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#1b1b1b", borderRadius: 4, padding: 10 }}>
      <div style={{ fontSize: 11, opacity: 0.5, letterSpacing: 0.4, marginBottom: 8 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{children}</div>
    </div>
  );
}

function RecipeLine({
  name,
  right,
  ok,
}: {
  name: string;
  right: string;
  ok: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}>
      <span style={{ color: ok ? "#ddd" : "#f3aaaa" }}>{name}</span>
      <span style={{ color: ok ? "#8fd1af" : "#f3aaaa", fontVariantNumeric: "tabular-nums" }}>{right}</span>
    </div>
  );
}

function HintPill({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span
      style={{
        padding: "4px 8px",
        borderRadius: 999,
        fontSize: 11,
        background: active ? "#20372f" : "#3a1f1f",
        color: active ? "#9ad0b4" : "#f3aaaa",
      }}
    >
      {children}
    </span>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: "8px 10px",
        background: "#3a1f1f",
        border: "1px solid #6d3636",
        borderRadius: 4,
        fontSize: 12,
        color: "#ffb3b3",
      }}
    >
      {message}
    </div>
  );
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div style={sectionStyle}>
      <div style={headerStyle}>{title}</div>
      <div style={{ fontSize: 12, lineHeight: 1.6, opacity: 0.68 }}>{message}</div>
    </div>
  );
}

function countItemInInventory(inventory: Inventory, itemId: string): number {
  return inventory.slots.reduce((total, slot) => total + countItemInSlot(slot, itemId), 0);
}

function countItemInSlot(slot: InventorySlot, itemId: string): number {
  if (!slot) return 0;
  if (slot.kind === "stack") return slot.itemId === itemId ? slot.qty : 0;
  return slot.instance.itemId === itemId ? 1 : 0;
}

function slotLabel(slot: string): string {
  switch (slot) {
    case "weapon":
      return "武器";
    case "offhand":
      return "副手";
    case "helmet":
      return "头部";
    case "chest":
      return "胸甲";
    case "gloves":
      return "手部";
    case "boots":
      return "鞋子";
    case "ring":
      return "戒指";
    case "amulet":
      return "项链";
    default:
      return slot;
  }
}

const sectionStyle: React.CSSProperties = {
  padding: 10,
  background: "#222",
  borderRadius: 4,
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontWeight: 600,
  marginBottom: 8,
  fontSize: 13,
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 10,
};

const primaryButtonStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 4,
  border: "1px solid #2f7a5f",
  background: "#2a5",
  color: "#fff",
  fontFamily: "inherit",
  fontSize: 12,
};
