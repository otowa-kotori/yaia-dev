export type AuthoringDef<T extends object> = Partial<T> & {
  extends?: string;
  abstract?: boolean;
};

export interface CompileInheritedCollectionOptions<T extends object> {
  bucketName: string;
  defs: Record<string, AuthoringDef<T>>;
  ensureIdField?: boolean;
}

export function compileInheritedCollection<T extends object>(
  options: CompileInheritedCollectionOptions<T>,
): Record<string, T> {
  const { bucketName, defs, ensureIdField = true } = options;
  const resolved = new Map<string, T>();
  const resolving: string[] = [];
  const compiled: Record<string, T> = {};

  const resolve = (id: string): T => {
    const cached = resolved.get(id);
    if (cached) return cached;

    const draft = defs[id];
    if (!draft) {
      throw new Error(`content authoring: bucket \"${bucketName}\" is missing definition \"${id}\"`);
    }

    if (resolving.includes(id)) {
      const cycle = [...resolving, id].join(" -> ");
      throw new Error(`content authoring: circular inheritance in \"${bucketName}\": ${cycle}`);
    }

    const explicitId = readDraftId(draft);
    if (explicitId !== undefined && explicitId !== id) {
      throw new Error(
        `content authoring: bucket \"${bucketName}\" definition key \"${id}\" does not match draft id \"${explicitId}\"`,
      );
    }

    resolving.push(id);
    const parent = draft.extends ? resolve(draft.extends) : undefined;
    const merged = mergeValues(parent, stripAuthoringMeta(draft)) as T;
    resolving.pop();

    if (ensureIdField) {
      (merged as { id?: string }).id = id;
    }

    resolved.set(id, merged);
    return merged;
  };

  for (const id of Object.keys(defs)) {
    const draft = defs[id]!;
    const value = resolve(id);
    if (!draft.abstract) {
      compiled[id] = value;
    }
  }

  return compiled;
}

function readDraftId(draft: object): string | undefined {
  const id = (draft as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

function stripAuthoringMeta<T extends object>(draft: AuthoringDef<T>): Partial<T> {
  const { extends: _extends, abstract: _abstract, ...rest } = draft;
  return rest as Partial<T>;
}


function mergeValues(parent: unknown, child: unknown): unknown {
  if (child === undefined) return cloneValue(parent);
  if (parent === undefined) return cloneValue(child);

  if (Array.isArray(child)) return child.map((entry) => cloneValue(entry));
  if (Array.isArray(parent)) return cloneValue(child);

  if (isPlainObject(parent) && isPlainObject(child)) {
    const merged: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(parent), ...Object.keys(child)]);
    for (const key of keys) {
      merged[key] = mergeValues(parent[key], child[key]);
    }
    return merged;
  }

  return cloneValue(child);
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry)) as T;
  }
  if (isPlainObject(value)) {
    const cloned: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      cloned[key] = cloneValue(entry);
    }
    return cloned as T;
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
