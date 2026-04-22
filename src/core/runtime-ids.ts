// Runtime instance ID allocator.
//
// Scope:
// - Running world instances only: stage / battle / dungeon session / spawned
//   actors such as enemies and resource nodes.
// - Content IDs stay where they are; this module only mints runtime copies.
//
// Design:
// - One shared persisted counter lives in GameState.runtimeIds.nextSeq.
// - Every runtime object claims the next counter value, then encodes it into a
//   short opaque suffix.
// - Callers keep only the minimum semantic prefix they actually need, such as
//   `monster.slime.<suffix>` or `battle.<suffix>`.
//
// Why the 5-char suffix:
// - It stays short and readable.
// - It does not expose low-value runtime context like location / wave / tick.
// - It is still bijective for the supported range, so we never collide before
//   the allocator space is exhausted.

import type { MonsterId, ResourceNodeId } from "./content/types";
import type { GameState, RuntimeIdState } from "./state/types";

const RUNTIME_SUFFIX_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const RUNTIME_SUFFIX_LENGTH = 5;
const RUNTIME_SUFFIX_SPACE = RUNTIME_SUFFIX_ALPHABET.length ** RUNTIME_SUFFIX_LENGTH;
// Must stay coprime with 62 so the mapping remains bijective over the suffix space.
const RUNTIME_SUFFIX_MULTIPLIER = 33_554_467;
const RUNTIME_SUFFIX_OFFSET = 15_485_863;

export function assertRuntimeIdState(
  state: Pick<GameState, "runtimeIds">,
): RuntimeIdState {
  const runtimeIds = state.runtimeIds;
  if (!runtimeIds) {
    throw new Error("runtime-ids: missing GameState.runtimeIds");
  }
  if (!Number.isSafeInteger(runtimeIds.nextSeq) || runtimeIds.nextSeq < 0) {
    throw new Error(
      `runtime-ids: invalid nextSeq ${String(runtimeIds.nextSeq)}`,
    );
  }
  if (runtimeIds.nextSeq >= RUNTIME_SUFFIX_SPACE) {
    throw new Error(
      `runtime-ids: exhausted ${RUNTIME_SUFFIX_SPACE} unique suffixes`,
    );
  }
  return runtimeIds;
}

export function mintStageId(state: GameState): string {
  return mintPrefixedRuntimeId(state, "stage");
}

export function mintBattleId(state: GameState): string {
  return mintPrefixedRuntimeId(state, "battle");
}

export function mintDungeonSessionId(state: GameState): string {
  return mintPrefixedRuntimeId(state, "dungeon.session");
}

export function mintMonsterInstanceId(
  state: GameState,
  monsterId: MonsterId | string,
): string {
  return mintPrefixedRuntimeId(state, monsterId);
}

export function mintResourceNodeInstanceId(
  state: GameState,
  nodeDefId: ResourceNodeId | string,
): string {
  return mintPrefixedRuntimeId(state, nodeDefId);
}

function mintPrefixedRuntimeId(state: GameState, prefix: string): string {
  return `${prefix}.${claimRuntimeSuffix(state)}`;
}

function claimRuntimeSuffix(state: GameState): string {
  const runtimeIds = assertRuntimeIdState(state);
  const seq = runtimeIds.nextSeq;
  runtimeIds.nextSeq += 1;
  return encodeRuntimeSuffix(seq);
}

function encodeRuntimeSuffix(seq: number): string {
  let value =
    (seq * RUNTIME_SUFFIX_MULTIPLIER + RUNTIME_SUFFIX_OFFSET) %
    RUNTIME_SUFFIX_SPACE;
  let suffix = "";
  for (let i = 0; i < RUNTIME_SUFFIX_LENGTH; i += 1) {
    suffix = RUNTIME_SUFFIX_ALPHABET[value % RUNTIME_SUFFIX_ALPHABET.length]! + suffix;
    value = Math.floor(value / RUNTIME_SUFFIX_ALPHABET.length);
  }
  return suffix;
}
