import type { NodeSpec, ParamsMap, TransformType } from "../../types";
import {
  f,
  getBool,
  getFloat,
  getInt,
  getString,
  getVec3,
  vec,
} from "./util";

const AXIS_PARAM = {
  key: "axis",
  label: "Axis",
  type: "select" as const,
  default: "Y",
  options: [
    { value: "X", label: "X" },
    { value: "Y", label: "Y" },
    { value: "Z", label: "Z" },
  ],
};

// Shared noise helpers — written in a dialect-compatible subset so the same
// code works in OSL (Vectron) and GLSL (preview) after `vector → vec3` swap.
const NOISE_HASH_HELPER = {
  name: "noise_hash",
  code: `float noise_hash(vector p)
{
    vector q = vector(p[0] * 0.3183099 + 0.71, p[1] * 0.3183099 + 0.113, p[2] * 0.3183099 + 0.419);
    q = vector(q[0] - floor(q[0]), q[1] - floor(q[1]), q[2] - floor(q[2]));
    q = vector(q[0] * 17.0, q[1] * 17.0, q[2] * 17.0);
    float k = q[0] * q[1] * q[2] * (q[0] + q[1] + q[2]);
    return k - floor(k);
}`,
};

const NOISE_VALUE_HELPER = {
  name: "noise_value",
  code: `float noise_value(vector p)
{
    vector i = vector(floor(p[0]), floor(p[1]), floor(p[2]));
    vector f = vector(p[0] - i[0], p[1] - i[1], p[2] - i[2]);
    vector u = vector(f[0] * f[0] * (3.0 - 2.0 * f[0]), f[1] * f[1] * (3.0 - 2.0 * f[1]), f[2] * f[2] * (3.0 - 2.0 * f[2]));
    float n000 = noise_hash(vector(i[0], i[1], i[2]));
    float n100 = noise_hash(vector(i[0] + 1.0, i[1], i[2]));
    float n010 = noise_hash(vector(i[0], i[1] + 1.0, i[2]));
    float n110 = noise_hash(vector(i[0] + 1.0, i[1] + 1.0, i[2]));
    float n001 = noise_hash(vector(i[0], i[1], i[2] + 1.0));
    float n101 = noise_hash(vector(i[0] + 1.0, i[1], i[2] + 1.0));
    float n011 = noise_hash(vector(i[0], i[1] + 1.0, i[2] + 1.0));
    float n111 = noise_hash(vector(i[0] + 1.0, i[1] + 1.0, i[2] + 1.0));
    float nx00 = mix(n000, n100, u[0]);
    float nx10 = mix(n010, n110, u[0]);
    float nx01 = mix(n001, n101, u[0]);
    float nx11 = mix(n011, n111, u[0]);
    float nxy0 = mix(nx00, nx10, u[1]);
    float nxy1 = mix(nx01, nx11, u[1]);
    return mix(nxy0, nxy1, u[2]) * 2.0 - 1.0;
}`,
};

const NOISE_FBM_HELPER = {
  name: "noise_fbm",
  code: `float noise_fbm(vector p, int octaves)
{
    float total = 0.0;
    float amp = 1.0;
    float freq = 1.0;
    float norm = 0.0;
    for (int i = 0; i < octaves; i = i + 1) {
        total = total + noise_value(vector(p[0] * freq, p[1] * freq, p[2] * freq)) * amp;
        norm = norm + amp;
        amp = amp * 0.5;
        freq = freq * 2.0;
    }
    return total / max(norm, 0.0001);
}`,
};

const NOISE_RIDGED_HELPER = {
  name: "noise_ridged",
  code: `float noise_ridged(vector p, int octaves)
{
    float total = 0.0;
    float amp = 1.0;
    float freq = 1.0;
    float norm = 0.0;
    for (int i = 0; i < octaves; i = i + 1) {
        float n = 1.0 - abs(noise_value(vector(p[0] * freq, p[1] * freq, p[2] * freq)));
        total = total + n * n * amp;
        norm = norm + amp;
        amp = amp * 0.5;
        freq = freq * 2.0;
    }
    return total / max(norm, 0.0001) * 2.0 - 1.0;
}`,
};

export type TransformDef = {
  spec: NodeSpec;
  // If present, emits a new point variable derived from the input.
  emitPoint?: (
    outPoint: string,
    inPoint: string,
    params: ParamsMap,
  ) => string[];
  // If present, runs AFTER the child evaluates and produces a new distance.
  // Receives the point variable in scope at the child evaluation site.
  emitDistance?: (
    outDist: string,
    childDist: string,
    currentPoint: string,
    params: ParamsMap,
  ) => string[];
  helpers?: { name: string; code: string }[];
};

const ROTATE_HELPER = {
  name: "rotate_xyz",
  code: `vector rotate_xyz(vector p, vector ang)
{
    float ax = radians(ang[0]);
    float ay = radians(ang[1]);
    float az = radians(ang[2]);
    // Inverse rotation applied to the eval point (rotate space, not object).
    float cz = cos(-az); float sz = sin(-az);
    float x1 = p[0] * cz - p[1] * sz;
    float y1 = p[0] * sz + p[1] * cz;
    float z1 = p[2];
    float cy = cos(-ay); float sy = sin(-ay);
    float x2 = x1 * cy + z1 * sy;
    float y2 = y1;
    float z2 = -x1 * sy + z1 * cy;
    float cx = cos(-ax); float sx = sin(-ax);
    float x3 = x2;
    float y3 = y2 * cx - z2 * sx;
    float z3 = y2 * sx + z2 * cx;
    return vector(x3, y3, z3);
}`,
};

const POLAR_REPEAT_HELPER = {
  name: "polar_repeat",
  code: `vector polar_repeat(vector p, int n)
{
    float two_pi = 6.28318530718;
    float sector = two_pi / float(n);
    float a = atan2(p[0], p[2]);
    a = mod(a + 0.5 * sector, sector) - 0.5 * sector;
    float r = sqrt(p[0] * p[0] + p[2] * p[2]);
    return vector(r * sin(a), p[1], r * cos(a));
}`,
};

export const TRANSFORMS: Record<TransformType, TransformDef> = {
  translate: {
    spec: {
      type: "translate",
      kind: "transform",
      category: "Transforms",
      label: "Translate",
      params: [
        { key: "offset", label: "Offset", type: "vec3", default: [0, 0, 0], step: 0.1 },
      ],
    },
    emitPoint: (out, inp, params) => {
      const t = getVec3(params, "offset", [0, 0, 0]);
      return [`vector ${out} = ${inp} - ${vec(t)};`];
    },
  },

  rotateEuler: {
    spec: {
      type: "rotateEuler",
      kind: "transform",
      category: "Transforms",
      label: "Rotate (Euler XYZ)",
      params: [
        { key: "angles", label: "Angles (deg)", type: "vec3", default: [0, 0, 0], step: 1 },
      ],
    },
    emitPoint: (out, inp, params) => {
      const a = getVec3(params, "angles", [0, 0, 0]);
      return [`vector ${out} = rotate_xyz(${inp}, ${vec(a)});`];
    },
    helpers: [ROTATE_HELPER],
  },

  scaleUniform: {
    spec: {
      type: "scaleUniform",
      kind: "transform",
      category: "Transforms",
      label: "Scale",
      params: [
        {
          key: "scale",
          label: "Scale",
          type: "vec3",
          default: [1, 1, 1],
          step: 0.05,
        },
      ],
    },
    emitPoint: (out, inp, params) => {
      const s = getVec3(params, "scale", [1, 1, 1]);
      return [
        `vector ${out} = vector(${inp}[0] / ${f(s[0])}, ${inp}[1] / ${f(s[1])}, ${inp}[2] / ${f(s[2])});`,
      ];
    },
    emitDistance: (outDist, childDist, _pt, params) => {
      // For non-uniform scale, distance is only approximate. Use the smallest
      // axis scale factor — under-estimates the true distance, which is safe
      // for ray-marching (no over-stepping).
      const s = getVec3(params, "scale", [1, 1, 1]);
      const minAbs = `min(abs(${f(s[0])}), min(abs(${f(s[1])}), abs(${f(s[2])})))`;
      return [`float ${outDist} = ${childDist} * ${minAbs};`];
    },
  },

  mirror: {
    spec: {
      type: "mirror",
      kind: "transform",
      category: "Transforms",
      label: "Mirror",
      params: [
        { key: "x", label: "Mirror X", type: "bool", default: false },
        { key: "y", label: "Mirror Y", type: "bool", default: false },
        { key: "z", label: "Mirror Z", type: "bool", default: false },
      ],
    },
    emitPoint: (out, inp, params) => {
      const mx = getBool(params, "x", false);
      const my = getBool(params, "y", false);
      const mz = getBool(params, "z", false);
      const x = mx ? `abs(${inp}[0])` : `${inp}[0]`;
      const y = my ? `abs(${inp}[1])` : `${inp}[1]`;
      const z = mz ? `abs(${inp}[2])` : `${inp}[2]`;
      return [`vector ${out} = vector(${x}, ${y}, ${z});`];
    },
  },

  infiniteRepeat: {
    spec: {
      type: "infiniteRepeat",
      kind: "transform",
      category: "Repetition",
      label: "Infinite Repeat",
      params: [
        { key: "period", label: "Period", type: "vec3", default: [2, 2, 2], step: 0.1 },
      ],
    },
    emitPoint: (out, inp, params) => {
      const c = getVec3(params, "period", [2, 2, 2]);
      const cv = vec(c);
      return [
        `vector _c_${out} = ${cv};`,
        `vector ${out} = vector(`
          + `(_c_${out}[0] > 0.0) ? (mod(${inp}[0] + 0.5 * _c_${out}[0], _c_${out}[0]) - 0.5 * _c_${out}[0]) : ${inp}[0], `
          + `(_c_${out}[1] > 0.0) ? (mod(${inp}[1] + 0.5 * _c_${out}[1], _c_${out}[1]) - 0.5 * _c_${out}[1]) : ${inp}[1], `
          + `(_c_${out}[2] > 0.0) ? (mod(${inp}[2] + 0.5 * _c_${out}[2], _c_${out}[2]) - 0.5 * _c_${out}[2]) : ${inp}[2]);`,
      ];
    },
  },

  finiteRepeat: {
    spec: {
      type: "finiteRepeat",
      kind: "transform",
      category: "Repetition",
      label: "Finite Repeat",
      params: [
        { key: "period", label: "Period", type: "vec3", default: [2, 2, 2], step: 0.1 },
        { key: "count", label: "Count (each side)", type: "vec3", default: [2, 0, 2], step: 1 },
      ],
    },
    emitPoint: (out, inp, params) => {
      const c = vec(getVec3(params, "period", [2, 2, 2]));
      const l = vec(getVec3(params, "count", [2, 0, 2]));
      return [
        `vector _c_${out} = ${c};`,
        `vector _l_${out} = ${l};`,
        `vector ${out} = vector(`
          + `${inp}[0] - _c_${out}[0] * clamp(floor(${inp}[0] / _c_${out}[0] + 0.5), -_l_${out}[0], _l_${out}[0]), `
          + `${inp}[1] - _c_${out}[1] * clamp(floor(${inp}[1] / _c_${out}[1] + 0.5), -_l_${out}[1], _l_${out}[1]), `
          + `${inp}[2] - _c_${out}[2] * clamp(floor(${inp}[2] / _c_${out}[2] + 0.5), -_l_${out}[2], _l_${out}[2]));`,
      ];
    },
  },

  polarRepeat: {
    spec: {
      type: "polarRepeat",
      kind: "transform",
      category: "Repetition",
      label: "Polar Repeat",
      params: [
        { key: "count", label: "Sectors", type: "int", default: 6, min: 1, max: 64 },
      ],
    },
    emitPoint: (out, inp, params) => {
      const n = getInt(params, "count", 6);
      return [`vector ${out} = polar_repeat(${inp}, ${Math.max(1, n)});`];
    },
    helpers: [POLAR_REPEAT_HELPER],
  },

  twist: {
    spec: {
      type: "twist",
      kind: "transform",
      category: "Deformations",
      label: "Twist",
      params: [
        AXIS_PARAM,
        { key: "strength", label: "Strength (rad/unit)", type: "float", default: 1, step: 0.05 },
      ],
    },
    emitPoint: (out, inp, params) => {
      // Twist around `axis`: rotation around that axis by angle = k * coord-along-axis.
      const k = f(getFloat(params, "strength", 1));
      const axis = getString(params, "axis", "Y");
      const aVar = `_a_${out}`;
      const cVar = `_c_${out}`;
      const sVar = `_s_${out}`;
      if (axis === "X") {
        return [
          `float ${aVar} = ${k} * ${inp}[0];`,
          `float ${cVar} = cos(${aVar});`,
          `float ${sVar} = sin(${aVar});`,
          `vector ${out} = vector(${inp}[0], ${cVar} * ${inp}[1] - ${sVar} * ${inp}[2], ${sVar} * ${inp}[1] + ${cVar} * ${inp}[2]);`,
        ];
      }
      if (axis === "Z") {
        return [
          `float ${aVar} = ${k} * ${inp}[2];`,
          `float ${cVar} = cos(${aVar});`,
          `float ${sVar} = sin(${aVar});`,
          `vector ${out} = vector(${cVar} * ${inp}[0] - ${sVar} * ${inp}[1], ${sVar} * ${inp}[0] + ${cVar} * ${inp}[1], ${inp}[2]);`,
        ];
      }
      // Default: Y axis, rotate XZ plane.
      return [
        `float ${aVar} = ${k} * ${inp}[1];`,
        `float ${cVar} = cos(${aVar});`,
        `float ${sVar} = sin(${aVar});`,
        `vector ${out} = vector(${cVar} * ${inp}[0] - ${sVar} * ${inp}[2], ${inp}[1], ${sVar} * ${inp}[0] + ${cVar} * ${inp}[2]);`,
      ];
    },
  },

  bend: {
    spec: {
      type: "bend",
      kind: "transform",
      category: "Deformations",
      label: "Bend",
      params: [
        { ...AXIS_PARAM, default: "X" },
        { key: "strength", label: "Strength (rad/unit)", type: "float", default: 0.5, step: 0.05 },
      ],
    },
    emitPoint: (out, inp, params) => {
      // Bend along `axis`: coord along that axis drives in-plane rotation
      // toward the next axis cyclically (X→Y, Y→Z, Z→X).
      const k = f(getFloat(params, "strength", 0.5));
      const axis = getString(params, "axis", "X");
      const aVar = `_a_${out}`;
      const cVar = `_c_${out}`;
      const sVar = `_s_${out}`;
      if (axis === "Y") {
        // angle = k * p[1], rotate YZ plane.
        return [
          `float ${aVar} = ${k} * ${inp}[1];`,
          `float ${cVar} = cos(${aVar});`,
          `float ${sVar} = sin(${aVar});`,
          `vector ${out} = vector(${inp}[0], ${cVar} * ${inp}[1] - ${sVar} * ${inp}[2], ${sVar} * ${inp}[1] + ${cVar} * ${inp}[2]);`,
        ];
      }
      if (axis === "Z") {
        // angle = k * p[2], rotate ZX plane.
        return [
          `float ${aVar} = ${k} * ${inp}[2];`,
          `float ${cVar} = cos(${aVar});`,
          `float ${sVar} = sin(${aVar});`,
          `vector ${out} = vector(${sVar} * ${inp}[2] + ${cVar} * ${inp}[0], ${inp}[1], ${cVar} * ${inp}[2] - ${sVar} * ${inp}[0]);`,
        ];
      }
      // Default: X axis, rotate XY plane.
      return [
        `float ${aVar} = ${k} * ${inp}[0];`,
        `float ${cVar} = cos(${aVar});`,
        `float ${sVar} = sin(${aVar});`,
        `vector ${out} = vector(${cVar} * ${inp}[0] - ${sVar} * ${inp}[1], ${sVar} * ${inp}[0] + ${cVar} * ${inp}[1], ${inp}[2]);`,
      ];
    },
  },

  displace: {
    spec: {
      type: "displace",
      kind: "transform",
      category: "Deformations",
      label: "Displace (sine)",
      params: [
        { key: "amplitude", label: "Amplitude", type: "float", default: 0.05, step: 0.01 },
        { key: "frequency", label: "Frequency", type: "float", default: 8, step: 0.5 },
      ],
    },
    emitDistance: (outDist, childDist, pt, params) => {
      const a = f(getFloat(params, "amplitude", 0.05));
      const fr = f(getFloat(params, "frequency", 8));
      return [
        `float ${outDist} = ${childDist} + ${a} * sin(${fr} * ${pt}[0]) * sin(${fr} * ${pt}[1]) * sin(${fr} * ${pt}[2]);`,
      ];
    },
  },

  noiseValue: {
    spec: {
      type: "noiseValue",
      kind: "transform",
      category: "Deformations",
      label: "Displace (Value noise)",
      params: [
        { key: "amplitude", label: "Amplitude", type: "float", default: 0.1, step: 0.01 },
        { key: "frequency", label: "Frequency", type: "float", default: 4, step: 0.1 },
      ],
    },
    emitDistance: (outDist, childDist, pt, params) => {
      const a = f(getFloat(params, "amplitude", 0.1));
      const fr = f(getFloat(params, "frequency", 4));
      return [
        `float ${outDist} = ${childDist} + ${a} * noise_value(vector(${pt}[0] * ${fr}, ${pt}[1] * ${fr}, ${pt}[2] * ${fr}));`,
      ];
    },
    helpers: [NOISE_HASH_HELPER, NOISE_VALUE_HELPER],
  },

  noiseFbm: {
    spec: {
      type: "noiseFbm",
      kind: "transform",
      category: "Deformations",
      label: "Displace (FBM)",
      params: [
        { key: "amplitude", label: "Amplitude", type: "float", default: 0.15, step: 0.01 },
        { key: "frequency", label: "Frequency", type: "float", default: 2, step: 0.1 },
        { key: "octaves", label: "Octaves", type: "int", default: 4, min: 1, max: 8 },
      ],
    },
    emitDistance: (outDist, childDist, pt, params) => {
      const a = f(getFloat(params, "amplitude", 0.15));
      const fr = f(getFloat(params, "frequency", 2));
      const oct = getInt(params, "octaves", 4);
      return [
        `float ${outDist} = ${childDist} + ${a} * noise_fbm(vector(${pt}[0] * ${fr}, ${pt}[1] * ${fr}, ${pt}[2] * ${fr}), ${oct});`,
      ];
    },
    helpers: [NOISE_HASH_HELPER, NOISE_VALUE_HELPER, NOISE_FBM_HELPER],
  },

  noiseRidged: {
    spec: {
      type: "noiseRidged",
      kind: "transform",
      category: "Deformations",
      label: "Displace (Ridged)",
      params: [
        { key: "amplitude", label: "Amplitude", type: "float", default: 0.15, step: 0.01 },
        { key: "frequency", label: "Frequency", type: "float", default: 2, step: 0.1 },
        { key: "octaves", label: "Octaves", type: "int", default: 4, min: 1, max: 8 },
      ],
    },
    emitDistance: (outDist, childDist, pt, params) => {
      const a = f(getFloat(params, "amplitude", 0.15));
      const fr = f(getFloat(params, "frequency", 2));
      const oct = getInt(params, "octaves", 4);
      return [
        `float ${outDist} = ${childDist} + ${a} * noise_ridged(vector(${pt}[0] * ${fr}, ${pt}[1] * ${fr}, ${pt}[2] * ${fr}), ${oct});`,
      ];
    },
    helpers: [NOISE_HASH_HELPER, NOISE_VALUE_HELPER, NOISE_RIDGED_HELPER],
  },
};
