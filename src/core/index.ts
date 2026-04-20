// Public facade for game-core. UI and scripts should only import from here
// (and from "@core/state" for types).
//
// Deliberately thin: grow by adding exports when a system is ready to be
// consumed externally.

export * as rng from "./rng";
export * as events from "./events";
export * as tick from "./tick";
export * as state from "./state";
export * as content from "./content";
export * as formula from "./formula";
export * as attribute from "./attribute";
export * as actor from "./actor";
export * as effect from "./effect";
export * as ability from "./ability";
export * as combat from "./combat";
export * as intent from "./intent";
export * as stage from "./stage";
export * as activity from "./activity";
export * as progression from "./progression";
export * as save from "./save";
