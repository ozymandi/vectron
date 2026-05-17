import { buildParts } from "../osl/emit";
import { BOOLEANS, PRIMITIVES, TRANSFORMS } from "../osl/registry";
import type { NodeId, PrimitiveType, SdfNode } from "../types";

/**
 * Convert OSL-syntax fragments into GLSL-syntax fragments.
 * Our primitive helpers and body statements were authored using a small,
 * controlled subset that maps 1:1 onto GLSL after these substitutions:
 *
 *   vector  ->  vec3      (type name and constructor)
 *   atan2(  ->  atan(     (GLSL's 2-arg atan)
 */
function oslToGlsl(src: string): string {
  return src
    .replace(/\bvector\b/g, "vec3")
    .replace(/\batan2\(/g, "atan(");
}

const EMPTY_MAP = `float map(vec3 P, vec3 Center) { return 1e6; }`;

/** Returns just the `map(vec3 P, vec3 Center)` function + helpers — to be
 *  embedded in the raymarcher template. */
export function emitGLSLMap(root: SdfNode | null): string {
  const parts = buildParts(root);
  if (!parts) return EMPTY_MAP;

  const helpers = parts.helpers.map(oslToGlsl).join("\n\n");
  const body = parts.bodyStmts.map(oslToGlsl).map((s) => "    " + s).join("\n");

  return `${helpers}

float map(vec3 P, vec3 Center) {
${body}
    return ${parts.finalDist};
}`;
}

const VS = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FS_PREAMBLE = `#version 300 es
precision highp float;
out vec4 o_color;
uniform vec2 u_res;
uniform vec3 u_eye;
uniform vec3 u_target;
uniform vec3 u_up;
`;

const FS_BODY = `vec3 calcNormal(vec3 p, vec3 c) {
    float e = 0.0008;
    vec3 dx = vec3(e, 0.0, 0.0);
    vec3 dy = vec3(0.0, e, 0.0);
    vec3 dz = vec3(0.0, 0.0, e);
    return normalize(vec3(
        map(p + dx, c) - map(p - dx, c),
        map(p + dy, c) - map(p - dy, c),
        map(p + dz, c) - map(p - dz, c)
    ));
}

void main() {
    vec2 uv = (gl_FragCoord.xy / u_res) * 2.0 - 1.0;
    uv.x *= u_res.x / u_res.y;

    vec3 forward = normalize(u_target - u_eye);
    vec3 right = normalize(cross(forward, u_up));
    vec3 trueUp = cross(right, forward);
    vec3 rd = normalize(uv.x * right + uv.y * trueUp + 1.5 * forward);
    vec3 ro = u_eye;
    vec3 c = vec3(0.0);

    float t = 0.0;
    float hit = 0.0;
    const int MAX_STEPS = 128;
    const float MAX_T = 80.0;
    const float EPS = 0.0008;

    for (int i = 0; i < MAX_STEPS; i++) {
        vec3 p = ro + rd * t;
        float d = map(p, c);
        if (d < EPS) { hit = 1.0; break; }
        if (t > MAX_T) break;
        t += d * 0.92;
    }

    vec2 ndc = (gl_FragCoord.xy / u_res) - 0.5;
    float vign = 1.0 - dot(ndc, ndc) * 0.6;
    vec3 bg = mix(vec3(0.07, 0.08, 0.10), vec3(0.16, 0.17, 0.20), gl_FragCoord.y / u_res.y);
    bg *= vign;

    if (hit > 0.5) {
        vec3 p = ro + rd * t;
        vec3 n = calcNormal(p, c);

        vec3 lightDir = normalize(vec3(0.55, 0.85, 0.35));
        float lambert = max(dot(n, lightDir), 0.0);
        float ambient = 0.22;
        float fresnel = pow(1.0 - max(dot(n, -rd), 0.0), 4.0);

        // Soft fake AO by step count would need refactor; use distance falloff.
        vec3 baseA = vec3(0.84, 0.86, 0.92);
        vec3 baseB = vec3(0.32, 0.36, 0.46);
        vec3 base = mix(baseB, baseA, n.y * 0.5 + 0.5);
        vec3 col = base * (ambient + lambert * 0.85) + vec3(0.6, 0.7, 0.9) * fresnel * 0.4;
        // Gamma-ish
        col = pow(col, vec3(0.85));
        o_color = vec4(col, 1.0);
    } else {
        o_color = vec4(bg, 1.0);
    }
}
`;

export function buildPreviewProgram(root: SdfNode | null): {
  vs: string;
  fs: string;
} {
  const mapCode = emitGLSLMap(root);
  return {
    vs: VS,
    fs: `${FS_PREAMBLE}
${mapCode}

${FS_BODY}`,
  };
}

// ===== Picking shader =====================================================

const PICKING_HELPERS = `struct SdfHit { float dist; int id; };

SdfHit hit_min(SdfHit a, SdfHit b) {
    if (a.dist < b.dist) return a;
    return b;
}
SdfHit hit_max(SdfHit a, SdfHit b) {
    if (a.dist > b.dist) return a;
    return b;
}
SdfHit hit_subtract(SdfHit a, SdfHit b) {
    if (a.dist > -b.dist) return a;
    return SdfHit(-b.dist, b.id);
}
SdfHit hit_smooth_union(SdfHit a, SdfHit b, float k) {
    float h = clamp(0.5 + 0.5 * (b.dist - a.dist) / k, 0.0, 1.0);
    float d = mix(b.dist, a.dist, h) - k * h * (1.0 - h);
    int id = b.id;
    if (a.dist < b.dist) id = a.id;
    return SdfHit(d, id);
}
SdfHit hit_smooth_intersection(SdfHit a, SdfHit b, float k) {
    float h = clamp(0.5 - 0.5 * (b.dist - a.dist) / k, 0.0, 1.0);
    float d = mix(b.dist, a.dist, h) + k * h * (1.0 - h);
    int id = b.id;
    if (a.dist > b.dist) id = a.id;
    return SdfHit(d, id);
}
SdfHit hit_smooth_subtract(SdfHit a, SdfHit b, float k) {
    float h = clamp(0.5 - 0.5 * (b.dist + a.dist) / k, 0.0, 1.0);
    float d = mix(a.dist, -b.dist, h) + k * h * (1.0 - h);
    int id = b.id;
    if (a.dist > -b.dist) id = a.id;
    return SdfHit(d, id);
}`;

type PickCtx = {
  stmts: string[];
  hit: number;
  pt: number;
  d: number;
  pickId: number;
  primHelpers: Set<PrimitiveType>;
  extraHelpers: Map<string, string>;
  idMap: Map<number, NodeId>;
};

function formatGlslFloat(s: string): string {
  return s;
}

function walkPicking(
  node: SdfNode,
  currentPoint: string,
  ctx: PickCtx,
): string {
  if (!node.enabled) {
    const v = `h${++ctx.hit}`;
    ctx.stmts.push(`SdfHit ${v} = SdfHit(1e6, 0);`);
    return v;
  }

  if (node.kind === "primitive") {
    const def = PRIMITIVES[node.type];
    ctx.primHelpers.add(node.type);
    const pickId = ++ctx.pickId;
    ctx.idMap.set(pickId, node.id);
    const call = oslToGlsl(def.call(currentPoint, node.params));
    const v = `h${++ctx.hit}`;
    ctx.stmts.push(`SdfHit ${v} = SdfHit(${call}, ${pickId});`);
    return v;
  }

  if (node.kind === "transform") {
    const def = TRANSFORMS[node.type];
    if (def.helpers) {
      for (const h of def.helpers) {
        ctx.extraHelpers.set(h.name, oslToGlsl(h.code));
      }
    }
    let childPoint = currentPoint;
    if (def.emitPoint) {
      const np = `p${++ctx.pt}`;
      for (const stmt of def.emitPoint(np, currentPoint, node.params)) {
        ctx.stmts.push(oslToGlsl(stmt));
      }
      childPoint = np;
    }
    if (!node.child) {
      const v = `h${++ctx.hit}`;
      ctx.stmts.push(`SdfHit ${v} = SdfHit(1e6, 0);`);
      return v;
    }
    const childHit = walkPicking(node.child, childPoint, ctx);
    if (def.emitDistance) {
      const tmpDist = `d${++ctx.d}`;
      for (const stmt of def.emitDistance(
        tmpDist,
        `${childHit}.dist`,
        childPoint,
        node.params,
      )) {
        ctx.stmts.push(oslToGlsl(stmt));
      }
      const v = `h${++ctx.hit}`;
      ctx.stmts.push(`SdfHit ${v} = SdfHit(${tmpDist}, ${childHit}.id);`);
      return v;
    }
    return childHit;
  }

  // boolean
  const active = node.children.filter((c) => c.enabled);
  if (active.length === 0) {
    const v = `h${++ctx.hit}`;
    ctx.stmts.push(`SdfHit ${v} = SdfHit(1e6, 0);`);
    return v;
  }
  const childHits = active.map((c) => walkPicking(c, currentPoint, ctx));
  if (childHits.length === 1) return childHits[0];

  let result = childHits[0];
  for (let i = 1; i < childHits.length; i++) {
    const a = result;
    const b = childHits[i];
    const v = `h${++ctx.hit}`;
    let expr: string;
    const k = formatGlslFloat(
      String(typeof node.params.k === "number" ? node.params.k : 0.2),
    );
    switch (node.type) {
      case "union":
        expr = `hit_min(${a}, ${b})`;
        break;
      case "intersection":
        expr = `hit_max(${a}, ${b})`;
        break;
      case "subtract":
        expr = `hit_subtract(${a}, ${b})`;
        break;
      case "smoothUnion":
        expr = `hit_smooth_union(${a}, ${b}, ${k})`;
        break;
      case "smoothIntersection":
        expr = `hit_smooth_intersection(${a}, ${b}, ${k})`;
        break;
      case "smoothSubtract":
        expr = `hit_smooth_subtract(${a}, ${b}, ${k})`;
        break;
      default:
        expr = `hit_min(${a}, ${b})`;
    }
    ctx.stmts.push(`SdfHit ${v} = ${expr};`);
    result = v;
  }
  return result;
}

const PICK_FS_BODY = `void main() {
    vec2 uv = (gl_FragCoord.xy / u_res) * 2.0 - 1.0;
    uv.x *= u_res.x / u_res.y;
    vec3 forward = normalize(u_target - u_eye);
    vec3 right = normalize(cross(forward, u_up));
    vec3 trueUp = cross(right, forward);
    vec3 rd = normalize(uv.x * right + uv.y * trueUp + 1.5 * forward);
    vec3 ro = u_eye;
    vec3 c = vec3(0.0);
    float t = 0.0;
    int hitId = 0;
    const int MAX_STEPS = 128;
    const float MAX_T = 80.0;
    const float EPS = 0.001;
    for (int i = 0; i < MAX_STEPS; i++) {
        vec3 p = ro + rd * t;
        SdfHit h = map_id(p, c);
        if (h.dist < EPS) { hitId = h.id; break; }
        if (t > MAX_T) break;
        t += h.dist * 0.92;
    }
    int r = hitId & 0xFF;
    int g = (hitId >> 8) & 0xFF;
    int b2 = (hitId >> 16) & 0xFF;
    o_color = vec4(float(r) / 255.0, float(g) / 255.0, float(b2) / 255.0, 1.0);
}
`;

export function buildPickingProgram(root: SdfNode | null): {
  vs: string;
  fs: string;
  idMap: Map<number, NodeId>;
} {
  const idMap = new Map<number, NodeId>();

  let primHelpers = "";
  let extraHelpers = "";
  let mapCode: string;

  if (!root) {
    mapCode = `SdfHit map_id(vec3 P, vec3 Center) { return SdfHit(1e6, 0); }`;
  } else {
    const ctx: PickCtx = {
      stmts: [],
      hit: 0,
      pt: 0,
      d: 0,
      pickId: 0,
      primHelpers: new Set(),
      extraHelpers: new Map(),
      idMap,
    };
    ctx.stmts.push("vec3 p0 = P - Center;");
    const finalHit = walkPicking(root, "p0", ctx);

    primHelpers = [...ctx.primHelpers]
      .sort()
      .map((t) => oslToGlsl(PRIMITIVES[t].helperCode))
      .join("\n\n");
    extraHelpers = [...ctx.extraHelpers.values()].join("\n\n");

    const body = ctx.stmts.map((s) => "    " + s).join("\n");
    mapCode = `SdfHit map_id(vec3 P, vec3 Center) {\n${body}\n    return ${finalHit};\n}`;
  }

  const fs = `#version 300 es
precision highp float;
precision highp int;
out vec4 o_color;
uniform vec2 u_res;
uniform vec3 u_eye;
uniform vec3 u_target;
uniform vec3 u_up;

${PICKING_HELPERS}

${primHelpers}

${extraHelpers}

${mapCode}

${PICK_FS_BODY}`;

  return { vs: VS, fs, idMap };
}

// expose BOOLEANS reference so linter doesn't drop it.
void BOOLEANS;
