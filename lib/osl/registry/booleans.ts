import type { BooleanType, NodeSpec, ParamsMap } from "../../types";
import { f, getFloat } from "./util";

export type BooleanDef = {
  spec: NodeSpec;
  // Reduce N distance expressions into a single combined distance expression.
  combine: (dists: string[], params: ParamsMap) => string;
  helpers?: { name: string; code: string }[];
};

const SMOOTH_HELPERS = {
  union: {
    name: "op_smooth_union",
    code: `float op_smooth_union(float d1, float d2, float k)
{
    float h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
    return mix(d2, d1, h) - k * h * (1.0 - h);
}`,
  },
  intersection: {
    name: "op_smooth_intersection",
    code: `float op_smooth_intersection(float d1, float d2, float k)
{
    float h = clamp(0.5 - 0.5 * (d2 - d1) / k, 0.0, 1.0);
    return mix(d2, d1, h) + k * h * (1.0 - h);
}`,
  },
  subtract: {
    name: "op_smooth_subtract",
    code: `float op_smooth_subtract(float d1, float d2, float k)
{
    float h = clamp(0.5 - 0.5 * (d2 + d1) / k, 0.0, 1.0);
    return mix(d1, -d2, h) + k * h * (1.0 - h);
}`,
  },
};

const SMOOTHNESS_PARAM = {
  key: "k",
  label: "Smoothness",
  type: "float" as const,
  default: 0.2,
  min: 0.0001,
  step: 0.05,
};

export const BOOLEANS: Record<BooleanType, BooleanDef> = {
  union: {
    spec: {
      type: "union",
      kind: "boolean",
      category: "Booleans",
      label: "Union",
      params: [],
    },
    combine: (dists) => dists.reduce((acc, d) => `min(${acc}, ${d})`),
  },
  intersection: {
    spec: {
      type: "intersection",
      kind: "boolean",
      category: "Booleans",
      label: "Intersection",
      params: [],
    },
    combine: (dists) => dists.reduce((acc, d) => `max(${acc}, ${d})`),
  },
  subtract: {
    spec: {
      type: "subtract",
      kind: "boolean",
      category: "Booleans",
      label: "Subtract",
      params: [],
    },
    combine: (dists) => {
      if (dists.length < 2) return dists[0] ?? "1e6";
      return dists.slice(1).reduce((acc, d) => `max(${acc}, -${d})`, dists[0]);
    },
  },

  smoothUnion: {
    spec: {
      type: "smoothUnion",
      kind: "boolean",
      category: "Booleans",
      label: "Smooth Union",
      params: [SMOOTHNESS_PARAM],
    },
    combine: (dists, params) => {
      const k = f(getFloat(params, "k", 0.2));
      return dists.reduce((acc, d) => `op_smooth_union(${acc}, ${d}, ${k})`);
    },
    helpers: [SMOOTH_HELPERS.union],
  },
  smoothIntersection: {
    spec: {
      type: "smoothIntersection",
      kind: "boolean",
      category: "Booleans",
      label: "Smooth Intersection",
      params: [SMOOTHNESS_PARAM],
    },
    combine: (dists, params) => {
      const k = f(getFloat(params, "k", 0.2));
      return dists.reduce(
        (acc, d) => `op_smooth_intersection(${acc}, ${d}, ${k})`,
      );
    },
    helpers: [SMOOTH_HELPERS.intersection],
  },
  smoothSubtract: {
    spec: {
      type: "smoothSubtract",
      kind: "boolean",
      category: "Booleans",
      label: "Smooth Subtract",
      params: [SMOOTHNESS_PARAM],
    },
    combine: (dists, params) => {
      if (dists.length < 2) return dists[0] ?? "1e6";
      const k = f(getFloat(params, "k", 0.2));
      return dists
        .slice(1)
        .reduce((acc, d) => `op_smooth_subtract(${acc}, ${d}, ${k})`, dists[0]);
    },
    helpers: [SMOOTH_HELPERS.subtract],
  },
};
