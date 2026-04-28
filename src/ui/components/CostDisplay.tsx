// CostDisplay — 通用开销展示组件。
//
// 接收 CostDef，展示货币与材料消耗。
// 每行标红表示当前不足；全部可负担时整体显示正常色。
//
// Props:
//   cost          — 要展示的开销
//   currencies    — GameState.currencies（用于判断是否可负担）
//   inventory     — 角色个人背包（用于材料数量检查，可选）

import { getContent } from "../../core/content";
import { countItem } from "../../core/inventory/ops";
import type { CostDef } from "../../core/economy/types";
import type { Inventory } from "../../core/inventory/types";
import { currencyName } from "../text";

export interface CostDisplayProps {
  cost: CostDef;
  /** 当前货币余额 */
  currencies?: Record<string, number>;
  /** 角色个人背包（用于材料充足判断） */
  inventory?: Inventory | null;
  className?: string;
}

export function CostDisplay({
  cost,
  currencies = {},
  inventory = null,
  className = "",
}: CostDisplayProps) {
  const content = getContent();
  const hasCurrencies = !!cost.currencies && Object.keys(cost.currencies).length > 0;
  const hasItems = !!cost.items && cost.items.length > 0;

  if (!hasCurrencies && !hasItems) return null;

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {hasCurrencies &&
        Object.entries(cost.currencies!).map(([currId, amount]) => {
          const balance = currencies[currId] ?? 0;
          const canAfford = balance >= amount;
          return (
            <CostLine
              key={currId}
              label={currencyName(currId)}
              value={amount}
              current={balance}
              canAfford={canAfford}
              showCurrent={true}
            />
          );
        })}
      {hasItems &&
        cost.items!.map(({ itemId, qty }) => {
          const itemDef = content.items[itemId];
          const itemName = itemDef?.name ?? itemId;
          const held = inventory ? countItem(inventory, itemId) : null;
          const canAfford = held === null ? true : held >= qty;
          return (
            <CostLine
              key={itemId}
              label={itemName}
              value={qty}
              current={held}
              canAfford={canAfford}
              showCurrent={held !== null}
            />
          );
        })}
    </div>
  );
}

// ---------- 内部子组件 ----------

function CostLine({
  label,
  value,
  current,
  canAfford,
  showCurrent,
}: {
  label: string;
  value: number;
  current: number | null;
  canAfford: boolean;
  showCurrent: boolean;
}) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className={canAfford ? "text-gray-300" : "text-red-300"}>{label}</span>
      <span className={`tabular-nums ${canAfford ? "text-accent" : "text-red-300"}`}>
        {showCurrent && current !== null ? `${current} / ${value}` : `×${value}`}
      </span>
    </div>
  );
}
