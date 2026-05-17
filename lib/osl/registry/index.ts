import type { NodeSpec, ParamsMap } from "../../types";
import { BOOLEANS } from "./booleans";
import { PRIMITIVES } from "./primitives";
import { TRANSFORMS } from "./transforms";

export { BOOLEANS } from "./booleans";
export type { BooleanDef } from "./booleans";
export { PRIMITIVES } from "./primitives";
export type { PrimitiveDef } from "./primitives";
export { TRANSFORMS } from "./transforms";
export type { TransformDef } from "./transforms";

export const ALL_SPECS: NodeSpec[] = [
  ...Object.values(PRIMITIVES).map((d) => d.spec),
  ...Object.values(BOOLEANS).map((d) => d.spec),
  ...Object.values(TRANSFORMS).map((d) => d.spec),
];

export function getSpec(type: string): NodeSpec | undefined {
  return ALL_SPECS.find((s) => s.type === type);
}

export function defaultParams(type: string): ParamsMap {
  const spec = getSpec(type);
  if (!spec) return {};
  const out: ParamsMap = {};
  for (const p of spec.params) {
    out[p.key] = p.default as ParamsMap[string];
  }
  return out;
}
