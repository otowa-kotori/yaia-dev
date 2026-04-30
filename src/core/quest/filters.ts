// ObjectiveFilter matching — determines whether an event payload satisfies
// the filter constraints defined on a QuestObjectiveEvent.
//
// Pure function, no side effects.

import type { ObjectiveFilter } from "../content/types";

/**
 * Match an ObjectiveFilter against an event payload object.
 * Returns true if the payload satisfies the filter.
 */
export function matchFilter(
  filter: ObjectiveFilter,
  payload: Record<string, unknown>,
): boolean {
  // Composite: all
  if ("all" in filter) {
    return filter.all.every((f) => matchFilter(f, payload));
  }
  // Composite: any
  if ("any" in filter) {
    return filter.any.some((f) => matchFilter(f, payload));
  }

  // Leaf: { field, op, value }
  const actual = payload[filter.field];

  switch (filter.op) {
    case "eq":
      return actual === filter.value;
    case "neq":
      return actual !== filter.value;
    case "gte":
      return typeof actual === "number" && actual >= (filter.value as number);
    case "lte":
      return typeof actual === "number" && actual <= (filter.value as number);
    default: {
      const _exhaustive: never = filter.op;
      throw new Error(`matchFilter: unknown op "${_exhaustive}"`);
    }
  }
}
