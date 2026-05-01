import type { DungeonDef } from "../../core/content";
import { compileInheritedCollection, type AuthoringDef } from "../compiler/inheritance";

// Phase 0：无副本内容。

const authoredDungeons = {} satisfies Record<string, AuthoringDef<DungeonDef>>;

export const dungeons = compileInheritedCollection<DungeonDef>({
  bucketName: "dungeons",
  defs: authoredDungeons,
});
