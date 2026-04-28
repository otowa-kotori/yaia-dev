// Crafting panel — recipe list + material requirements + one-click crafting.
//
// Tailwind v4 rewrite of the original CraftingView. Functionality is identical:
//   - show all registered recipes
//   - compare required inputs against the hero's personal bag
//   - allow immediate crafting when requirements are met and no activity is running
//
// Each recipe card is wrapped in Card for consistent styling.

import { useMemo, useState } from "react";
import { getContent } from "../../core/content";
import type { RecipeDef } from "../../core/content/types";
import type { Inventory, InventorySlot } from "../../core/inventory";
import type { GameStore } from "../store";
import { useStore } from "../hooks/useStore";
import { T, slotLabel } from "../text";
import { Card } from "../components/Card";

export function CraftPanel({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const cc = s.focused;
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
    return <EmptyState title={T.craftingTitle} message={T.craftingNoBag} />;
  }

  if (recipes.length === 0) {
    return <EmptyState title={T.craftingTitle} message={T.craftingNoRecipes} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <Card className="p-3">
        <div className="flex justify-between font-semibold mb-2 text-[13px]">{T.craftingBench}</div>
        <div className="text-xs leading-relaxed opacity-68">
          {T.craftingBenchHint}
        </div>
      </Card>

      {actionError && <ErrorBanner message={actionError} />}

      {recipes.map((recipe) => {
        const skillLevel = hero.skills[recipe.skill]?.level ?? 1;
        const blockedByActivity = cc.isRunning();
        const blockedBySkill = skillLevel < recipe.requiredLevel;
        const blockedByMaterials = (recipe.cost.items ?? []).some(
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
                setActionError(error instanceof Error ? error.message : T.craftFailed);
              }
            }}
          />
        );
      })}
    </div>
  );
}

// ---------- RecipeCard ----------

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
  const xpAmount = recipe.rewards.xp?.find((e) => e.skillId === recipe.skill)?.amount ?? 0;

  return (
    <Card className="p-3">
      <div className="flex justify-between gap-3 items-start mb-2.5">
        <div>
          <div className="text-base font-bold text-white mb-1">{recipe.name}</div>
          <div className="text-xs opacity-58">
            {skillName} Lv {recipe.requiredLevel}+ · {recipe.durationTicks} tick{xpAmount > 0 ? ` · +${xpAmount} XP` : ""}
          </div>
        </div>
        <button
          onClick={onCraft}
          disabled={disabled}
          className={`px-3 py-2 rounded border border-green-700 bg-green-700 text-white text-xs font-inherit shrink-0 ${
            disabled ? "opacity-45 cursor-default" : "cursor-pointer hover:bg-green-600"
          } transition-colors`}
        >
          {T.btn_craft}
        </button>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2.5">
        <RecipeGroup title={T.materialsRequired}>
          {(recipe.cost.items ?? []).map((input) => {
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

        <RecipeGroup title={T.outputResults}>
          {(recipe.rewards.items ?? []).map((output) => {
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

      <div className="flex flex-wrap gap-2 mt-2.5">
        <HintPill active={!blockedBySkill}>{T.currentSkillLv} {skillLevel}</HintPill>
        <HintPill active={!blockedByMaterials}>{T.materialsSufficient}</HintPill>
        <HintPill active={!blockedByActivity}>{T.notInActivity}</HintPill>
      </div>
    </Card>
  );
}

// ---------- Sub-components ----------

function RecipeGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-dim rounded p-2.5">
      <div className="text-[11px] opacity-50 tracking-wide mb-2">{title}</div>
      <div className="flex flex-col gap-1.5">{children}</div>
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
    <div className="flex justify-between gap-2.5 text-xs">
      <span className={ok ? "text-gray-300" : "text-red-300"}>{name}</span>
      <span className={`tabular-nums ${ok ? "text-accent" : "text-red-300"}`}>{right}</span>
    </div>
  );
}

function HintPill({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`px-2 py-1 rounded-full text-[11px] ${
        active
          ? "bg-accent/20 text-accent"
          : "bg-red-900/30 text-red-300"
      }`}
    >
      {children}
    </span>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="px-2.5 py-2 bg-red-900/30 border border-red-700/40 rounded text-xs text-red-300">
      {message}
    </div>
  );
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <Card className="p-3">
      <div className="flex justify-between font-semibold mb-2 text-[13px]">{title}</div>
      <div className="text-xs leading-relaxed opacity-68">{message}</div>
    </Card>
  );
}

// ---------- Helpers ----------

function countItemInInventory(inventory: Inventory, itemId: string): number {
  return inventory.slots.reduce((total, slot) => total + countItemInSlot(slot, itemId), 0);
}

function countItemInSlot(slot: InventorySlot, itemId: string): number {
  if (!slot) return 0;
  if (slot.kind === "stack") return slot.itemId === itemId ? slot.qty : 0;
  return slot.instance.itemId === itemId ? 1 : 0;
}
