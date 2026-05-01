import type { ResourceNodeDef } from "../../core/content";
import { compileInheritedCollection, type AuthoringDef } from "../compiler/inheritance";

// Phase 0：无采集内容。

const authoredResourceNodes = {} satisfies Record<string, AuthoringDef<ResourceNodeDef>>;

export const resourceNodes = compileInheritedCollection<ResourceNodeDef>({
  bucketName: "resourceNodes",
  defs: authoredResourceNodes,
});
