// RewardDisplay — 通用奖励展示组件。
//
// 接收 RewardBundle，展示：
//   - items（保底物品）：名称 + 数量，标注"保底"
//   - drops（摇号掉落）：名称 + 概率百分比
//   - currencies：货币名称 + 数量
//   - charXp / skillXp：经验值
//
// 多人场景下如需展示分配后的期望值，请在传入前自行计算；
// 本组件只展示 bundle 原始数据。

import { getContent } from "../../core/content";
import type { RewardBundle } from "../../core/economy/types";
import { currencyName } from "../text";

export interface RewardDisplayProps {
  bundle: RewardBundle;
  className?: string;
  /** 展示模式。"compact" 省略零值；"full" 全部展示。默认 "compact" */
  mode?: "compact" | "full";
}

export function RewardDisplay({
  bundle,
  className = "",
  mode = "compact",
}: RewardDisplayProps) {
  const content = getContent();
  const hasAnything =
    bundle.items?.length ||
    bundle.drops?.length ||
    (bundle.currencies && Object.keys(bundle.currencies).some((k) => (bundle.currencies![k] ?? 0) > 0)) ||
    (bundle.charXp && bundle.charXp > 0) ||
    bundle.xp?.some((e) => e.amount > 0);

  if (!hasAnything && mode === "compact") return null;

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {/* 保底物品 */}
      {bundle.items?.map(({ itemId, qty }) => {
        const itemDef = content.items[itemId];
        return (
          <RewardLine
            key={`item:${itemId}`}
            label={itemDef?.name ?? itemId}
            right={`×${qty}`}
            tag="保底"
            tagColor="text-accent"
          />
        );
      })}

      {/* 摇号掉落 */}
      {bundle.drops?.map(({ itemId, chance, minQty, maxQty }) => {
        const itemDef = content.items[itemId];
        const pct = Math.round(chance * 100);
        const qtyStr = minQty === maxQty ? `×${minQty}` : `×${minQty}~${maxQty}`;
        return (
          <RewardLine
            key={`drop:${itemId}`}
            label={itemDef?.name ?? itemId}
            right={`${qtyStr} (${pct}%)`}
            tag={`${pct}%`}
            tagColor={pct >= 100 ? "text-accent" : "text-yellow-400"}
          />
        );
      })}

      {/* 货币 */}
      {bundle.currencies &&
        Object.entries(bundle.currencies)
          .filter(([, v]) => mode === "full" || v > 0)
          .map(([currId, amount]) => (
            <RewardLine
              key={`curr:${currId}`}
              label={currencyName(currId)}
              right={`+${amount}`}
              tagColor="text-yellow-300"
            />
          ))}

      {/* 角色经验 */}
      {bundle.charXp != null && (mode === "full" || bundle.charXp > 0) && (
        <RewardLine
          label="角色经验"
          right={`+${bundle.charXp}`}
          tagColor="text-blue-300"
        />
      )}

      {/* 技能经验 */}
      {bundle.xp
        ?.filter((e) => mode === "full" || e.amount > 0)
        .map(({ skillId, amount }) => {
          const skillDef = content.skills[skillId];
          return (
            <RewardLine
              key={`xp:${skillId}`}
              label={`${skillDef?.name ?? skillId} 经验`}
              right={`+${amount}`}
              tagColor="text-blue-300"
            />
          );
        })}
    </div>
  );
}

// ---------- 内部子组件 ----------

function RewardLine({
  label,
  right,
  tag,
  tagColor = "text-accent",
}: {
  label: string;
  right: string;
  tag?: string;
  tagColor?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-gray-300 truncate">{label}</span>
      <div className="flex items-center gap-1.5 shrink-0">
        {tag && (
          <span className={`text-[10px] px-1 py-0.5 rounded bg-surface-dim ${tagColor}`}>
            {tag}
          </span>
        )}
        <span className="tabular-nums text-accent">{right}</span>
      </div>
    </div>
  );
}
