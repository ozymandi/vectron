import type { BooleanType, NodeSpec, ParamsMap } from "../../types";
import { f, getFloat } from "./util";

/** Per-emission step: produce a new (dist, mat) pair from a left and right
 *  pair, plus any helper statements that need to be inserted. */
export type Operand = { dist: string; mat: string };
export type PairwiseResult = { stmts: string[]; dist: string; mat: string };

export type BooleanDef = {
  spec: NodeSpec;
  pairwise: (
    a: Operand,
    b: Operand,
    params: ParamsMap,
    newDist: string,
    newMat: string,
  ) => string[];
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
    pairwise: (a, b, _params, d, m) => [
      `float ${d} = min(${a.dist}, ${b.dist});`,
      `int ${m} = (${a.dist} < ${b.dist}) ? ${a.mat} : ${b.mat};`,
    ],
  },
  intersection: {
    spec: {
      type: "intersection",
      kind: "boolean",
      category: "Booleans",
      label: "Intersection",
      params: [],
    },
    pairwise: (a, b, _params, d, m) => [
      `float ${d} = max(${a.dist}, ${b.dist});`,
      `int ${m} = (${a.dist} > ${b.dist}) ? ${a.mat} : ${b.mat};`,
    ],
  },
  subtract: {
    spec: {
      type: "subtract",
      kind: "boolean",
      category: "Booleans",
      label: "Subtract",
      params: [],
    },
    pairwise: (a, b, _params, d, m) => [
      `float ${d} = max(${a.dist}, -${b.dist});`,
      `int ${m} = (${a.dist} > -${b.dist}) ? ${a.mat} : ${b.mat};`,
    ],
  },

  smoothUnion: {
    spec: {
      type: "smoothUnion",
      kind: "boolean",
      category: "Booleans",
      label: "Smooth Union",
      params: [SMOOTHNESS_PARAM],
    },
    pairwise: (a, b, params, d, m) => {
      const k = f(getFloat(params, "k", 0.2));
      return [
        `float ${d} = op_smooth_union(${a.dist}, ${b.dist}, ${k});`,
        `int ${m} = (${a.dist} < ${b.dist}) ? ${a.mat} : ${b.mat};`,
      ];
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
    pairwise: (a, b, params, d, m) => {
      const k = f(getFloat(params, "k", 0.2));
      return [
        `float ${d} = op_smooth_intersection(${a.dist}, ${b.dist}, ${k});`,
        `int ${m} = (${a.dist} > ${b.dist}) ? ${a.mat} : ${b.mat};`,
      ];
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
    pairwise: (a, b, params, d, m) => {
      const k = f(getFloat(params, "k", 0.2));
      return [
        `float ${d} = op_smooth_subtract(${a.dist}, ${b.dist}, ${k});`,
        `int ${m} = (${a.dist} > -${b.dist}) ? ${a.mat} : ${b.mat};`,
      ];
    },
    helpers: [SMOOTH_HELPERS.subtract],
  },
};
