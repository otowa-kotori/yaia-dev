// Public facade for game-core. UI and scripts should only import from here
// (and from "@core/state" for types).
//
// Deliberately thin: grow by adding exports when a system is ready to be
// consumed externally.

// infra
export * as rng from "./infra/rng";
export * as events from "./infra/events";
export * as tick from "./infra/tick";
export * as state from "./infra/state";
export * as formula from "./infra/formula";
export * as gameLog from "./infra/game-log";

// content (flat)
export * as content from "./content";

// entity
export * as attribute from "./entity/attribute";
export * as actor from "./entity/actor";

// item (flat)
export * as item from "./item";
export * as inventory from "./inventory";

// behavior
export * as effect from "./behavior/effect";
export * as ability from "./behavior/ability";

// combat
export * as combat from "./combat/battle";
export * as intent from "./combat/intent";

// world
export * as stage from "./world/stage";
export * as activity from "./world/activity";

// growth
export * as progression from "./growth/leveling";
export * as upgradeManager from "./growth/upgrade-manager";

// infra (misc)
export * as runtimeIds from "./runtime-ids";

// persistence (flat)
export * as save from "./save";

// orchestration (flat)
export * as session from "./session";
