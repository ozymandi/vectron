import type { SdfNode } from "./types";

// Helper to build preset trees with stable IDs (replaced on load).
function P(spec: Omit<SdfNode, "id"> | SdfNode): SdfNode {
  return spec as SdfNode;
}

const sphereOnly = P({
  id: "_root",
  kind: "primitive",
  type: "sphere",
  enabled: true,
  params: { radius: 1 },
});

const smoothBlend = P({
  id: "_root",
  kind: "boolean",
  type: "smoothUnion",
  enabled: true,
  params: { k: 0.3 },
  children: [
    P({
      id: "_a",
      kind: "transform",
      type: "translate",
      enabled: true,
      params: { offset: [-0.6, 0, 0] },
      child: P({
        id: "_a_child",
        kind: "primitive",
        type: "sphere",
        enabled: true,
        params: { radius: 0.7 },
      }),
    }),
    P({
      id: "_b",
      kind: "transform",
      type: "translate",
      enabled: true,
      params: { offset: [0.6, 0, 0] },
      child: P({
        id: "_b_child",
        kind: "primitive",
        type: "box",
        enabled: true,
        params: { size: [0.6, 0.6, 0.6] },
      }),
    }),
  ],
});

const fractalBlend = P({
  id: "_root",
  kind: "boolean",
  type: "smoothUnion",
  enabled: true,
  params: { k: 0.25 },
  children: [
    P({
      id: "_mb",
      kind: "primitive",
      type: "mandelbulb",
      enabled: true,
      params: { iterations: 14, power: 8, bailout: 4 },
    }),
    P({
      id: "_sp",
      kind: "transform",
      type: "translate",
      enabled: true,
      params: { offset: [0, -1.4, 0] },
      child: P({
        id: "_sp_child",
        kind: "primitive",
        type: "sphere",
        enabled: true,
        params: { radius: 0.8 },
      }),
    }),
  ],
});

const noiseSphere = P({
  id: "_root",
  kind: "transform",
  type: "noiseFbm",
  enabled: true,
  params: { amplitude: 0.18, frequency: 2, octaves: 4 },
  child: P({
    id: "_inner",
    kind: "primitive",
    type: "sphere",
    enabled: true,
    params: { radius: 1.1 },
  }),
});

const mengerCarve = P({
  id: "_root",
  kind: "boolean",
  type: "subtract",
  enabled: true,
  params: {},
  children: [
    P({
      id: "_box",
      kind: "primitive",
      type: "roundBox",
      enabled: true,
      params: { size: [1, 1, 1], radius: 0.05 },
    }),
    P({
      id: "_menger",
      kind: "transform",
      type: "scaleUniform",
      enabled: true,
      params: { scale: 0.6 },
      child: P({
        id: "_menger_child",
        kind: "primitive",
        type: "mengerSponge",
        enabled: true,
        params: { iterations: 4, scale: 3 },
      }),
    }),
  ],
});

export type Preset = {
  key: string;
  name: string;
  description: string;
  tree: SdfNode;
};

export const PRESETS: Preset[] = [
  {
    key: "sphere",
    name: "Sphere",
    description: "Minimal starting point.",
    tree: sphereOnly,
  },
  {
    key: "smooth-blend",
    name: "Smooth Blend",
    description: "Smooth union of a sphere and a box.",
    tree: smoothBlend,
  },
  {
    key: "fractal-blend",
    name: "Mandelbulb + Sphere",
    description: "Smooth-union of a Mandelbulb with a sphere underneath.",
    tree: fractalBlend,
  },
  {
    key: "noise-sphere",
    name: "FBM Sphere",
    description: "Sphere with FBM noise displacement.",
    tree: noiseSphere,
  },
  {
    key: "menger-carve",
    name: "Box minus Menger",
    description: "Round box with Menger sponge subtracted.",
    tree: mengerCarve,
  },
];
