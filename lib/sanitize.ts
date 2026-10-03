import type { ParamSpec, ParamsMap, ParamValue, SdfNode } from "./types";
import { getSpec } from "./osl/registry";

type Raw = Record<string, unknown>;

function isObject(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Migrate legacy fields: scaleUniform's `scale` was a number, kifs had
 *  a single `rotY` float instead of a vec3 `rotation`. */
function migrateParams(type: string, params: Raw): Raw {
  if (type === "scaleUniform" && typeof params.scale === "number") {
    const v = params.scale;
    return { ...params, scale: [v, v, v] };
  }
  if (
    type === "kifs" &&
    typeof params.rotY === "number" &&
    !Array.isArray(params.rotation)
  ) {
    return { ...params, rotation: [0, params.rotY, 0] };
  }
  return params;
}

function clamp(v: number, min?: number, max?: number): number {
  let n = v;
  if (typeof min === "number") n = Math.max(min, n);
  if (typeof max === "number") n = Math.min(max, n);
  return n;
}

function readParam(spec: ParamSpec, v: unknown): ParamValue {
  switch (spec.type) {
    case "float":
      return isFiniteNumber(v) ? clamp(v, spec.min, spec.max) : spec.default;
    case "int":
      return isFiniteNumber(v)
        ? clamp(Math.round(v), spec.min, spec.max)
        : spec.default;
    case "vec3":
      return Array.isArray(v) && v.length === 3 && v.every(isFiniteNumber)
        ? [v[0], v[1], v[2]]
        : spec.default;
    case "bool":
      return typeof v === "boolean" ? v : spec.default;
    case "select":
      return typeof v === "string" && spec.options.some((o) => o.value === v)
        ? v
        : spec.default;
  }
}

/** Rebuild an untrusted tree (JSON file, localStorage) into a valid SdfNode
 *  tree: nodes of unknown kind/type are dropped, params are checked against
 *  the registry spec and fall back to defaults. Returns null if the root
 *  itself is not a valid node. */
export function sanitizeTree(input: unknown): SdfNode | null {
  if (!isObject(input)) return null;
  const { kind, type } = input;
  if (typeof type !== "string") return null;
  const spec = getSpec(type);
  if (!spec || spec.kind !== kind) return null;

  const raw = migrateParams(type, isObject(input.params) ? input.params : {});
  const params: ParamsMap = {};
  for (const p of spec.params) params[p.key] = readParam(p, raw[p.key]);

  const base = {
    id: typeof input.id === "string" ? input.id : "",
    enabled: typeof input.enabled === "boolean" ? input.enabled : true,
    ...(typeof input.label === "string" ? { label: input.label } : {}),
    type,
    params,
  };

  if (spec.kind === "primitive") {
    return {
      ...base,
      kind: "primitive",
      ...(isFiniteNumber(input.matId)
        ? { matId: Math.max(0, Math.round(input.matId)) }
        : {}),
    } as SdfNode;
  }
  if (spec.kind === "transform") {
    return {
      ...base,
      kind: "transform",
      child: sanitizeTree(input.child),
    } as SdfNode;
  }
  const children = Array.isArray(input.children)
    ? input.children
        .map(sanitizeTree)
        .filter((c): c is SdfNode => c !== null)
    : [];
  return { ...base, kind: "boolean", children } as SdfNode;
}
