import type { NodeId, ParamsMap, SdfNode } from "../types";

// --- 3D math --------------------------------------------------------------

export type Vec3 = [number, number, number];
// row-major 3x3: [m00, m01, m02, m10, m11, m12, m20, m21, m22]
export type Mat3 = number[];

export function identity3(): Mat3 {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

export function multiplyMat3(a: Mat3, b: Mat3): Mat3 {
  const r: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}

export function applyMat3(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
export function length3(v: Vec3): number {
  return Math.sqrt(dot(v, v));
}
export function normalize3(v: Vec3): Vec3 {
  const l = length3(v);
  if (l < 1e-9) return [0, 0, 0];
  return [v[0] / l, v[1] / l, v[2] / l];
}

// Matches our rotate_xyz OSL helper:
// rotate_xyz applies INVERSE rotation = Rz(-az) * Ry(-ay) * Rx(-ax) to eval point.
// So the object's world rotation is the inverse of that, which is
// Rx(ax) * Ry(ay) * Rz(az).
export function eulerXYZToMat3(angles_deg: Vec3): Mat3 {
  const ax = (angles_deg[0] * Math.PI) / 180;
  const ay = (angles_deg[1] * Math.PI) / 180;
  const az = (angles_deg[2] * Math.PI) / 180;
  const cx = Math.cos(ax), sx = Math.sin(ax);
  const cy = Math.cos(ay), sy = Math.sin(ay);
  const cz = Math.cos(az), sz = Math.sin(az);
  const Rx: Mat3 = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const Ry: Mat3 = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rz: Mat3 = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return multiplyMat3(Rx, multiplyMat3(Ry, Rz));
}

// --- Tree chain origin ----------------------------------------------------

function findPath(
  node: SdfNode,
  targetId: NodeId,
  path: SdfNode[],
): boolean {
  path.push(node);
  if (node.id === targetId) return true;
  if (node.kind === "transform" && node.child) {
    if (findPath(node.child, targetId, path)) return true;
  } else if (node.kind === "boolean") {
    for (const c of node.children) {
      if (findPath(c, targetId, path)) return true;
    }
  }
  path.pop();
  return false;
}

function getVec3Param(params: ParamsMap, key: string, fallback: Vec3): Vec3 {
  const v = params[key];
  return Array.isArray(v) && v.length === 3 ? (v as Vec3) : fallback;
}
function getFloatParam(params: ParamsMap, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === "number" ? v : fallback;
}

/** World position of the selected node's local origin (P=0). Includes the
 *  selected node's own transform contribution (so Translate's dot sits at its
 *  destination). Returns null if target not in tree. */
export function computeChainOrigin(
  root: SdfNode,
  targetId: NodeId,
): Vec3 | null {
  const path: SdfNode[] = [];
  if (!findPath(root, targetId, path)) return null;

  let pos: Vec3 = [0, 0, 0];
  let rot: Mat3 = identity3();
  let scale = 1;

  for (const node of path) {
    if (node.kind !== "transform") continue;
    if (node.type === "translate") {
      const t = getVec3Param(node.params, "offset", [0, 0, 0]);
      const local: Vec3 = [t[0] * scale, t[1] * scale, t[2] * scale];
      const world = applyMat3(rot, local);
      pos = [pos[0] + world[0], pos[1] + world[1], pos[2] + world[2]];
    } else if (node.type === "rotateEuler") {
      const a = getVec3Param(node.params, "angles", [0, 0, 0]);
      rot = multiplyMat3(rot, eulerXYZToMat3(a));
    } else if (node.type === "scaleUniform") {
      scale *= getFloatParam(node.params, "scale", 1);
    }
    // mirror / twist / bend / displace do not contribute to chain origin.
  }
  return pos;
}

// --- Camera projection ----------------------------------------------------

export const FOCAL = 1.5; // must match shader value in lib/glsl/emit.ts

export type ProjectedPoint = {
  x: number; // CSS pixels
  y: number;
  depth: number; // forward-distance from eye (negative = behind)
  visible: boolean;
};

export function projectWorldToScreen(
  world: Vec3,
  eye: Vec3,
  target: Vec3,
  up: Vec3,
  width: number,
  height: number,
  focal: number = FOCAL,
): ProjectedPoint {
  const forward = normalize3(sub(target, eye));
  const right = normalize3(cross(forward, up));
  const trueUp = cross(right, forward);
  const d = sub(world, eye);
  const r = dot(d, right);
  const u = dot(d, trueUp);
  const f = dot(d, forward);
  if (f <= 1e-3) return { x: 0, y: 0, depth: f, visible: false };
  const k = focal * height * 0.5;
  return {
    x: width * 0.5 + (r / f) * k,
    y: height * 0.5 - (u / f) * k,
    depth: f,
    visible: true,
  };
}

/** Eye position for our orbit camera, matching PreviewPanel logic. */
export function orbitEye(yaw: number, pitch: number, distance: number): Vec3 {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  return [distance * sy * cp, distance * sp, distance * cy * cp];
}

/** Accumulated parent transform (rotation + uniform scale) up to but not
 *  including the target node. Used to convert world-space deltas into the
 *  local frame in which a Translate node's offset is expressed. */
export function computeParentTransform(
  root: SdfNode,
  targetId: NodeId,
): { rotation: Mat3; scale: number } | null {
  const path: SdfNode[] = [];
  if (!findPath(root, targetId, path)) return null;

  let rot: Mat3 = identity3();
  let scale = 1;
  // walk path EXCEPT the last node (which is the target itself).
  for (let i = 0; i < path.length - 1; i++) {
    const node = path[i];
    if (node.kind !== "transform") continue;
    if (node.type === "rotateEuler") {
      rot = multiplyMat3(rot, eulerXYZToMat3(getVec3Param(node.params, "angles", [0, 0, 0])));
    } else if (node.type === "scaleUniform") {
      scale *= getFloatParam(node.params, "scale", 1);
    }
    // translate / other transforms do not affect rotation/scale frame.
  }
  return { rotation: rot, scale };
}

export function transposeMat3(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/** Rodrigues axis-angle to 3x3 rotation matrix. Axis will be normalized. */
export function axisAngleToMat3(axis: Vec3, angleRad: number): Mat3 {
  const a = normalize3(axis);
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const t = 1 - c;
  const x = a[0], y = a[1], z = a[2];
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}

/** Decompose a 3x3 rotation matrix to Euler XYZ (degrees) matching our
 *  R = Rx(ax) * Ry(ay) * Rz(az) convention. Handles gimbal lock. */
export function matToEulerXYZDeg(m: Mat3): Vec3 {
  const m00 = m[0], m01 = m[1], m02 = m[2];
  const m11 = m[4], m12 = m[5];
  const m21 = m[7], m22 = m[8];
  const sy = Math.max(-1, Math.min(1, m02));
  const ay = Math.asin(sy);
  let ax: number, az: number;
  if (Math.abs(sy) < 0.99999) {
    ax = Math.atan2(-m12, m22);
    az = Math.atan2(-m01, m00);
  } else {
    // Gimbal lock: ay = ±π/2, choose az = 0.
    ax = Math.atan2(m21, m11);
    az = 0;
  }
  const R = 180 / Math.PI;
  return [ax * R, ay * R, az * R];
}
