import type { NodeSpec, ParamsMap, PrimitiveType } from "../../types";
import { f, getFloat, getInt, getString, getVec3, vec } from "./util";

const BASE_SHAPE_PARAM = {
  key: "base",
  label: "Base shape",
  type: "select" as const,
  default: "sphere",
  options: [
    { value: "sphere", label: "Sphere" },
    { value: "box", label: "Box" },
    { value: "octahedron", label: "Octahedron" },
    { value: "torus", label: "Torus" },
  ],
};

const BASE_SHAPE_TO_ID: Record<string, number> = {
  sphere: 0,
  box: 1,
  octahedron: 2,
  torus: 3,
};

// Branches on base_id and returns the SDF distance for the given `z`. The
// constants below (radius 2, half-size 2, etc.) are conventional — adjust the
// fractal's overall scale param if you want a different surface thickness.
const FRACTAL_BASE_CODE = `
    float base_d;
    if (base_id == 1) {
        // Box of half-size 2
        vector qb = vector(abs(z[0]) - 2.0, abs(z[1]) - 2.0, abs(z[2]) - 2.0);
        float ob = length(vector(max(qb[0], 0.0), max(qb[1], 0.0), max(qb[2], 0.0)));
        float ib = min(max(qb[0], max(qb[1], qb[2])), 0.0);
        base_d = ob + ib;
    } else if (base_id == 2) {
        // Octahedron of size 2
        base_d = (abs(z[0]) + abs(z[1]) + abs(z[2]) - 2.0) * 0.57735027;
    } else if (base_id == 3) {
        // Torus (major=1.5, minor=0.4)
        float qtx = sqrt(z[0] * z[0] + z[2] * z[2]) - 1.5;
        base_d = sqrt(qtx * qtx + z[1] * z[1]) - 0.4;
    } else {
        // Sphere of radius 2 (default)
        base_d = length(z) - 2.0;
    }`;

export type PrimitiveDef = {
  spec: NodeSpec;
  helperName: string;
  helperCode: string;
  call: (point: string, params: ParamsMap) => string;
};

export const PRIMITIVES: Record<PrimitiveType, PrimitiveDef> = {
  sphere: {
    spec: {
      type: "sphere",
      kind: "primitive",
      category: "Primitives",
      label: "Sphere",
      params: [
        { key: "radius", label: "Radius", type: "float", default: 1, min: 0, step: 0.05 },
      ],
    },
    helperName: "sd_sphere",
    helperCode: `float sd_sphere(vector p, float r)
{
    return length(p) - r;
}`,
    call: (p, params) => `sd_sphere(${p}, ${f(getFloat(params, "radius", 1))})`,
  },

  box: {
    spec: {
      type: "box",
      kind: "primitive",
      category: "Primitives",
      label: "Box",
      params: [
        { key: "size", label: "Half-size", type: "vec3", default: [1, 1, 1], step: 0.05 },
      ],
    },
    helperName: "sd_box",
    helperCode: `float sd_box(vector p, vector b)
{
    vector d = vector(abs(p[0]) - b[0], abs(p[1]) - b[1], abs(p[2]) - b[2]);
    float outside = length(vector(max(d[0], 0.0), max(d[1], 0.0), max(d[2], 0.0)));
    float inside = min(max(d[0], max(d[1], d[2])), 0.0);
    return outside + inside;
}`,
    call: (p, params) => `sd_box(${p}, ${vec(getVec3(params, "size", [1, 1, 1]))})`,
  },

  roundBox: {
    spec: {
      type: "roundBox",
      kind: "primitive",
      category: "Primitives",
      label: "Round Box",
      params: [
        { key: "size", label: "Half-size", type: "vec3", default: [1, 1, 1], step: 0.05 },
        { key: "radius", label: "Round radius", type: "float", default: 0.2, min: 0, step: 0.05 },
      ],
    },
    helperName: "sd_round_box",
    helperCode: `float sd_round_box(vector p, vector b, float r)
{
    vector q = vector(max(abs(p[0]) - b[0], 0.0), max(abs(p[1]) - b[1], 0.0), max(abs(p[2]) - b[2], 0.0));
    return length(q) - r;
}`,
    call: (p, params) =>
      `sd_round_box(${p}, ${vec(getVec3(params, "size", [1, 1, 1]))}, ${f(
        getFloat(params, "radius", 0.2),
      )})`,
  },

  torus: {
    spec: {
      type: "torus",
      kind: "primitive",
      category: "Primitives",
      label: "Torus",
      params: [
        { key: "major", label: "Major radius", type: "float", default: 1, min: 0, step: 0.05 },
        { key: "minor", label: "Minor radius", type: "float", default: 0.25, min: 0, step: 0.05 },
      ],
    },
    helperName: "sd_torus",
    helperCode: `float sd_torus(vector p, float R, float r)
{
    float qx = sqrt(p[0] * p[0] + p[2] * p[2]) - R;
    return sqrt(qx * qx + p[1] * p[1]) - r;
}`,
    call: (p, params) =>
      `sd_torus(${p}, ${f(getFloat(params, "major", 1))}, ${f(getFloat(params, "minor", 0.25))})`,
  },

  cappedTorus: {
    spec: {
      type: "cappedTorus",
      kind: "primitive",
      category: "Primitives",
      label: "Capped Torus",
      params: [
        { key: "angle", label: "Aperture (deg)", type: "float", default: 90, min: 0, max: 180, step: 1 },
        { key: "major", label: "Major radius", type: "float", default: 1, min: 0, step: 0.05 },
        { key: "minor", label: "Minor radius", type: "float", default: 0.25, min: 0, step: 0.05 },
      ],
    },
    helperName: "sd_capped_torus",
    helperCode: `float sd_capped_torus(vector p, float aperture_deg, float ra, float rb)
{
    float a = radians(aperture_deg) * 0.5;
    float sa = sin(a);
    float ca = cos(a);
    float px = abs(p[0]);
    float k = (sa * px > ca * p[1]) ? (px * sa + p[1] * ca) : sqrt(px * px + p[1] * p[1]);
    float dot_pp = p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
    return sqrt(dot_pp + ra * ra - 2.0 * ra * k) - rb;
}`,
    call: (p, params) =>
      `sd_capped_torus(${p}, ${f(getFloat(params, "angle", 90))}, ${f(
        getFloat(params, "major", 1),
      )}, ${f(getFloat(params, "minor", 0.25))})`,
  },

  plane: {
    spec: {
      type: "plane",
      kind: "primitive",
      category: "Primitives",
      label: "Plane",
      params: [
        { key: "normal", label: "Normal", type: "vec3", default: [0, 1, 0], step: 0.05 },
        { key: "offset", label: "Offset", type: "float", default: 0, step: 0.05 },
      ],
    },
    helperName: "sd_plane",
    helperCode: `float sd_plane(vector p, vector n, float h)
{
    vector nn = normalize(n);
    return p[0] * nn[0] + p[1] * nn[1] + p[2] * nn[2] + h;
}`,
    call: (p, params) =>
      `sd_plane(${p}, ${vec(getVec3(params, "normal", [0, 1, 0]))}, ${f(
        getFloat(params, "offset", 0),
      )})`,
  },

  capsule: {
    spec: {
      type: "capsule",
      kind: "primitive",
      category: "Primitives",
      label: "Capsule",
      params: [
        { key: "a", label: "Endpoint A", type: "vec3", default: [0, -0.5, 0], step: 0.05 },
        { key: "b", label: "Endpoint B", type: "vec3", default: [0, 0.5, 0], step: 0.05 },
        { key: "radius", label: "Radius", type: "float", default: 0.25, min: 0, step: 0.05 },
      ],
    },
    helperName: "sd_capsule",
    helperCode: `float sd_capsule(vector p, vector a, vector b, float r)
{
    vector pa = p - a;
    vector ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    vector q = pa - ba * h;
    return length(q) - r;
}`,
    call: (p, params) =>
      `sd_capsule(${p}, ${vec(getVec3(params, "a", [0, -0.5, 0]))}, ${vec(
        getVec3(params, "b", [0, 0.5, 0]),
      )}, ${f(getFloat(params, "radius", 0.25))})`,
  },

  cylinder: {
    spec: {
      type: "cylinder",
      kind: "primitive",
      category: "Primitives",
      label: "Cylinder",
      params: [
        { key: "radius", label: "Radius", type: "float", default: 0.5, min: 0, step: 0.05 },
        { key: "halfHeight", label: "Half-height", type: "float", default: 1, min: 0, step: 0.05 },
      ],
    },
    helperName: "sd_cylinder",
    helperCode: `float sd_cylinder(vector p, float r, float h)
{
    float dx = sqrt(p[0] * p[0] + p[2] * p[2]) - r;
    float dy = abs(p[1]) - h;
    float outside = sqrt(max(dx, 0.0) * max(dx, 0.0) + max(dy, 0.0) * max(dy, 0.0));
    float inside = min(max(dx, dy), 0.0);
    return outside + inside;
}`,
    call: (p, params) =>
      `sd_cylinder(${p}, ${f(getFloat(params, "radius", 0.5))}, ${f(
        getFloat(params, "halfHeight", 1),
      )})`,
  },

  cone: {
    spec: {
      type: "cone",
      kind: "primitive",
      category: "Primitives",
      label: "Cone",
      params: [
        { key: "radius", label: "Base radius", type: "float", default: 0.5, min: 0, step: 0.05 },
        { key: "height", label: "Height", type: "float", default: 1, min: 0.0001, step: 0.05 },
      ],
    },
    helperName: "sd_cone",
    helperCode: `float sd_cone(vector p, float r, float h)
{
    // Capped cone with apex at (0, h, 0), base at y=0 with radius r.
    // IQ capped-cone formula with r_top = 0.
    float qx = sqrt(p[0] * p[0] + p[2] * p[2]);
    float half_h = h * 0.5;
    float py = p[1] - half_h; // center on y axis
    // Cap component
    float ca_rad = (py < 0.0) ? r : 0.0;
    float cax = qx - min(qx, ca_rad);
    float cay = abs(py) - half_h;
    float ca2 = cax * cax + cay * cay;
    // Slant component
    float k2_dot = r * r + h * h;
    float t = clamp((qx * r + h * (half_h - py)) / k2_dot, 0.0, 1.0);
    float cbx = qx - r * t;
    float cby = py - half_h + h * t;
    float cb2 = cbx * cbx + cby * cby;
    float sgn = (cbx < 0.0 && cay < 0.0) ? -1.0 : 1.0;
    return sgn * sqrt(min(ca2, cb2));
}`,
    call: (p, params) =>
      `sd_cone(${p}, ${f(getFloat(params, "radius", 0.5))}, ${f(
        getFloat(params, "height", 1),
      )})`,
  },

  hexPrism: {
    spec: {
      type: "hexPrism",
      kind: "primitive",
      category: "Primitives",
      label: "Hex Prism",
      params: [
        { key: "radius", label: "Hex radius", type: "float", default: 0.5, min: 0, step: 0.05 },
        { key: "halfHeight", label: "Half-height", type: "float", default: 0.5, min: 0, step: 0.05 },
      ],
    },
    helperName: "sd_hex_prism",
    helperCode: `float sd_hex_prism(vector p, float r, float h)
{
    float qx = abs(p[0]);
    float qy = abs(p[1]);
    float qz = abs(p[2]);
    float d1 = qz - h;
    float d2 = max(qx * 0.866025 + qy * 0.5, qy) - r;
    float outside = sqrt(max(d1, 0.0) * max(d1, 0.0) + max(d2, 0.0) * max(d2, 0.0));
    float inside = min(max(d1, d2), 0.0);
    return outside + inside;
}`,
    call: (p, params) =>
      `sd_hex_prism(${p}, ${f(getFloat(params, "radius", 0.5))}, ${f(
        getFloat(params, "halfHeight", 0.5),
      )})`,
  },

  triPrism: {
    spec: {
      type: "triPrism",
      kind: "primitive",
      category: "Primitives",
      label: "Tri Prism",
      params: [
        { key: "radius", label: "Tri radius", type: "float", default: 0.5, min: 0, step: 0.05 },
        { key: "halfHeight", label: "Half-height", type: "float", default: 0.5, min: 0, step: 0.05 },
      ],
    },
    helperName: "sd_tri_prism",
    helperCode: `float sd_tri_prism(vector p, float r, float h)
{
    float qx = abs(p[0]);
    float qz = abs(p[2]);
    float d1 = qz - h;
    float d2 = max(qx * 0.866025 + p[1] * 0.5, -p[1]) - r * 0.5;
    float outside = sqrt(max(d1, 0.0) * max(d1, 0.0) + max(d2, 0.0) * max(d2, 0.0));
    float inside = min(max(d1, d2), 0.0);
    return outside + inside;
}`,
    call: (p, params) =>
      `sd_tri_prism(${p}, ${f(getFloat(params, "radius", 0.5))}, ${f(
        getFloat(params, "halfHeight", 0.5),
      )})`,
  },

  ellipsoid: {
    spec: {
      type: "ellipsoid",
      kind: "primitive",
      category: "Primitives",
      label: "Ellipsoid",
      params: [
        { key: "radii", label: "Radii", type: "vec3", default: [1, 0.5, 0.5], step: 0.05 },
      ],
    },
    helperName: "sd_ellipsoid",
    helperCode: `float sd_ellipsoid(vector p, vector r)
{
    float k0 = length(vector(p[0] / r[0], p[1] / r[1], p[2] / r[2]));
    float k1 = length(vector(p[0] / (r[0] * r[0]), p[1] / (r[1] * r[1]), p[2] / (r[2] * r[2])));
    return k0 * (k0 - 1.0) / k1;
}`,
    call: (p, params) =>
      `sd_ellipsoid(${p}, ${vec(getVec3(params, "radii", [1, 0.5, 0.5]))})`,
  },

  octahedron: {
    spec: {
      type: "octahedron",
      kind: "primitive",
      category: "Primitives",
      label: "Octahedron",
      params: [
        { key: "size", label: "Size", type: "float", default: 1, min: 0, step: 0.05 },
      ],
    },
    helperName: "sd_octahedron",
    helperCode: `float sd_octahedron(vector p, float s)
{
    float qx = abs(p[0]);
    float qy = abs(p[1]);
    float qz = abs(p[2]);
    return (qx + qy + qz - s) * 0.57735027;
}`,
    call: (p, params) =>
      `sd_octahedron(${p}, ${f(getFloat(params, "size", 1))})`,
  },

  pyramid: {
    spec: {
      type: "pyramid",
      kind: "primitive",
      category: "Primitives",
      label: "Pyramid",
      params: [
        { key: "height", label: "Height", type: "float", default: 1, min: 0.0001, step: 0.05 },
      ],
    },
    helperName: "sd_pyramid",
    helperCode: `float sd_pyramid(vector p, float h)
{
    float m2 = h * h + 0.25;
    float px = abs(p[0]);
    float pz = abs(p[2]);
    float swap = (pz > px) ? 1.0 : 0.0;
    float ax = (swap > 0.5) ? pz : px;
    float az = (swap > 0.5) ? px : pz;
    ax = ax - 0.5;
    az = az - 0.5;
    vector q = vector(az, h * p[1] - 0.5 * ax, h * ax + 0.5 * p[1]);
    float s = max(-q[0], 0.0);
    float t = clamp((q[1] - 0.5 * az) / (m2 + 0.25), 0.0, 1.0);
    float a = m2 * (q[0] + s) * (q[0] + s) + q[1] * q[1];
    float b = m2 * (q[0] + 0.5 * t) * (q[0] + 0.5 * t) + (q[1] - m2 * t) * (q[1] - m2 * t);
    float d2 = (min(q[1], -q[0] * m2 - q[1] * 0.5) > 0.0) ? 0.0 : min(a, b);
    return sqrt((d2 + q[2] * q[2]) / m2) * sign(max(q[2], -p[1]));
}`,
    call: (p, params) =>
      `sd_pyramid(${p}, ${f(getFloat(params, "height", 1))})`,
  },

  link: {
    spec: {
      type: "link",
      kind: "primitive",
      category: "Primitives",
      label: "Link",
      params: [
        { key: "length", label: "Length", type: "float", default: 0.3, min: 0, step: 0.05 },
        { key: "major", label: "Major radius", type: "float", default: 0.4, min: 0, step: 0.05 },
        { key: "minor", label: "Minor radius", type: "float", default: 0.15, min: 0, step: 0.05 },
      ],
    },
    helperName: "sd_link",
    helperCode: `float sd_link(vector p, float le, float r1, float r2)
{
    float qy = max(abs(p[1]) - le, 0.0);
    float a = sqrt(p[0] * p[0] + qy * qy) - r1;
    return sqrt(a * a + p[2] * p[2]) - r2;
}`,
    call: (p, params) =>
      `sd_link(${p}, ${f(getFloat(params, "length", 0.3))}, ${f(
        getFloat(params, "major", 0.4),
      )}, ${f(getFloat(params, "minor", 0.15))})`,
  },

  // ---- Fractals ----

  mandelbulb: {
    spec: {
      type: "mandelbulb",
      kind: "primitive",
      category: "Fractals",
      label: "Mandelbulb",
      params: [
        { key: "iterations", label: "Iterations", type: "int", default: 12, min: 1, max: 40 },
        { key: "power", label: "Power", type: "float", default: 8, min: 1, step: 0.1 },
        { key: "bailout", label: "Bailout", type: "float", default: 4, min: 1, step: 0.5 },
      ],
    },
    helperName: "sd_mandelbulb",
    helperCode: `float sd_mandelbulb(vector pos, int iterations, float power, float bailout)
{
    vector z = pos;
    float dr = 1.0;
    float r = 0.0;
    for (int i = 0; i < iterations; i = i + 1) {
        r = length(z);
        if (r > bailout) break;
        float theta = acos(z[2] / r);
        float phi = atan2(z[1], z[0]);
        dr = pow(r, power - 1.0) * power * dr + 1.0;
        float zr = pow(r, power);
        float tp = theta * power;
        float pp = phi * power;
        z = vector(zr * sin(tp) * cos(pp), zr * sin(pp) * sin(tp), zr * cos(tp));
        z = vector(z[0] + pos[0], z[1] + pos[1], z[2] + pos[2]);
    }
    return 0.5 * log(max(r, 0.0001)) * r / max(dr, 0.0001);
}`,
    call: (p, params) =>
      `sd_mandelbulb(${p}, ${getInt(params, "iterations", 12)}, ${f(
        getFloat(params, "power", 8),
      )}, ${f(getFloat(params, "bailout", 4))})`,
  },

  mandelbox: {
    spec: {
      type: "mandelbox",
      kind: "primitive",
      category: "Fractals",
      label: "Mandelbox",
      params: [
        { key: "iterations", label: "Iterations", type: "int", default: 14, min: 1, max: 40 },
        { key: "scale", label: "Scale", type: "float", default: 2.5, step: 0.05 },
        { key: "fold", label: "Box fold limit", type: "float", default: 1, step: 0.05 },
      ],
    },
    helperName: "sd_mandelbox",
    helperCode: `float sd_mandelbox(vector pos, int iterations, float scale, float fold)
{
    vector z = pos;
    float dr = 1.0;
    for (int i = 0; i < iterations; i = i + 1) {
        z = vector(
            clamp(z[0], -fold, fold) * 2.0 - z[0],
            clamp(z[1], -fold, fold) * 2.0 - z[1],
            clamp(z[2], -fold, fold) * 2.0 - z[2]);
        float r2 = z[0] * z[0] + z[1] * z[1] + z[2] * z[2];
        if (r2 < 0.25) {
            z = vector(z[0] * 4.0, z[1] * 4.0, z[2] * 4.0);
            dr = dr * 4.0;
        } else if (r2 < 1.0) {
            float t = 1.0 / r2;
            z = vector(z[0] * t, z[1] * t, z[2] * t);
            dr = dr * t;
        }
        z = vector(z[0] * scale + pos[0], z[1] * scale + pos[1], z[2] * scale + pos[2]);
        dr = dr * abs(scale) + 1.0;
    }
    return length(z) / max(abs(dr), 0.0001);
}`,
    call: (p, params) =>
      `sd_mandelbox(${p}, ${getInt(params, "iterations", 14)}, ${f(
        getFloat(params, "scale", 2.5),
      )}, ${f(getFloat(params, "fold", 1))})`,
  },

  mengerSponge: {
    spec: {
      type: "mengerSponge",
      kind: "primitive",
      category: "Fractals",
      label: "Menger Sponge",
      params: [
        { key: "iterations", label: "Iterations", type: "int", default: 4, min: 1, max: 12 },
        { key: "scale", label: "Scale", type: "float", default: 3, step: 0.1 },
      ],
    },
    helperName: "sd_menger",
    helperCode: `float sd_menger(vector pos, int iterations, float scale)
{
    vector z = pos;
    float dr = 1.0;
    for (int i = 0; i < iterations; i = i + 1) {
        z = vector(abs(z[0]), abs(z[1]), abs(z[2]));
        if (z[0] < z[1]) z = vector(z[1], z[0], z[2]);
        if (z[1] < z[2]) z = vector(z[0], z[2], z[1]);
        if (z[0] < z[1]) z = vector(z[1], z[0], z[2]);
        z = vector(z[0] * scale, z[1] * scale, z[2] * scale);
        dr = dr * scale;
        float k = scale - 1.0;
        z = vector(z[0] - k, z[1] - k, z[2] - k);
        if (z[2] < -0.5 * k) z[2] = z[2] + k;
    }
    vector d = vector(abs(z[0]) - 1.0, abs(z[1]) - 1.0, abs(z[2]) - 1.0);
    float ext = length(vector(max(d[0], 0.0), max(d[1], 0.0), max(d[2], 0.0)));
    float ins = min(max(d[0], max(d[1], d[2])), 0.0);
    return (ext + ins) / max(dr, 0.0001);
}`,
    call: (p, params) =>
      `sd_menger(${p}, ${getInt(params, "iterations", 4)}, ${f(
        getFloat(params, "scale", 3),
      )})`,
  },

  sierpinski: {
    spec: {
      type: "sierpinski",
      kind: "primitive",
      category: "Fractals",
      label: "Sierpinski Tetrahedron",
      params: [
        { key: "iterations", label: "Iterations", type: "int", default: 8, min: 1, max: 20 },
        { key: "scale", label: "Scale", type: "float", default: 2, step: 0.05 },
        BASE_SHAPE_PARAM,
      ],
    },
    helperName: "sd_sierpinski",
    helperCode: `float sd_sierpinski(vector pos, int iterations, float scale, int base_id)
{
    vector z = pos;
    for (int i = 0; i < iterations; i = i + 1) {
        if (z[0] + z[1] < 0.0) z = vector(-z[1], -z[0], z[2]);
        if (z[0] + z[2] < 0.0) z = vector(-z[2], z[1], -z[0]);
        if (z[1] + z[2] < 0.0) z = vector(z[0], -z[2], -z[1]);
        float k = scale - 1.0;
        z = vector(z[0] * scale - k, z[1] * scale - k, z[2] * scale - k);
    }${FRACTAL_BASE_CODE}
    return base_d * pow(scale, -float(iterations));
}`,
    call: (p, params) =>
      `sd_sierpinski(${p}, ${getInt(params, "iterations", 8)}, ${f(
        getFloat(params, "scale", 2),
      )}, ${BASE_SHAPE_TO_ID[getString(params, "base", "sphere")] ?? 0})`,
  },

  juliaBulb: {
    spec: {
      type: "juliaBulb",
      kind: "primitive",
      category: "Fractals",
      label: "Julia Bulb",
      params: [
        { key: "c", label: "C constant", type: "vec3", default: [0.353, 0.318, 0.27], step: 0.01 },
        { key: "iterations", label: "Iterations", type: "int", default: 14, min: 1, max: 40 },
        { key: "power", label: "Power", type: "float", default: 8, min: 1, step: 0.1 },
        { key: "bailout", label: "Bailout", type: "float", default: 4, min: 1, step: 0.5 },
      ],
    },
    helperName: "sd_julia_bulb",
    helperCode: `float sd_julia_bulb(vector pos, vector c, int iterations, float power, float bailout)
{
    vector z = pos;
    float dr = 1.0;
    float r = 0.0;
    for (int i = 0; i < iterations; i = i + 1) {
        r = length(z);
        if (r > bailout) break;
        float theta = acos(z[2] / r);
        float phi = atan2(z[1], z[0]);
        dr = pow(r, power - 1.0) * power * dr + 1.0;
        float zr = pow(r, power);
        float tp = theta * power;
        float pp = phi * power;
        z = vector(zr * sin(tp) * cos(pp), zr * sin(pp) * sin(tp), zr * cos(tp));
        z = vector(z[0] + c[0], z[1] + c[1], z[2] + c[2]);
    }
    return 0.5 * log(max(r, 0.0001)) * r / max(dr, 0.0001);
}`,
    call: (p, params) =>
      `sd_julia_bulb(${p}, ${vec(getVec3(params, "c", [0.353, 0.318, 0.27]))}, ${getInt(
        params,
        "iterations",
        14,
      )}, ${f(getFloat(params, "power", 8))}, ${f(getFloat(params, "bailout", 4))})`,
  },

  apollonian: {
    spec: {
      type: "apollonian",
      kind: "primitive",
      category: "Fractals",
      label: "Apollonian Gasket",
      params: [
        { key: "iterations", label: "Iterations", type: "int", default: 8, min: 1, max: 20 },
        { key: "scale", label: "Scale", type: "float", default: 1.5, step: 0.05 },
      ],
    },
    helperName: "sd_apollonian",
    helperCode: `float sd_apollonian(vector pos, int iterations, float scale)
{
    vector p = pos;
    float k = 1.0;
    for (int i = 0; i < iterations; i = i + 1) {
        // Fold into [-1, 1]^3 by reflection
        p = vector(
            p[0] - 2.0 * floor(0.5 * p[0] + 0.5),
            p[1] - 2.0 * floor(0.5 * p[1] + 0.5),
            p[2] - 2.0 * floor(0.5 * p[2] + 0.5));
        float r2 = p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
        float t = scale / max(r2, 0.0001);
        p = vector(p[0] * t, p[1] * t, p[2] * t);
        k = k * t;
    }
    return 0.25 * abs(p[1]) / max(k, 0.0001);
}`,
    call: (p, params) =>
      `sd_apollonian(${p}, ${getInt(params, "iterations", 8)}, ${f(
        getFloat(params, "scale", 1.5),
      )})`,
  },

  kifs: {
    spec: {
      type: "kifs",
      kind: "primitive",
      category: "Fractals",
      label: "Kaleidoscopic IFS",
      params: [
        { key: "iterations", label: "Iterations", type: "int", default: 10, min: 1, max: 30 },
        { key: "scale", label: "Scale", type: "float", default: 2, min: 1.01, step: 0.05 },
        { key: "offset", label: "Offset", type: "vec3", default: [1, 1, 1], step: 0.05 },
        { key: "rotation", label: "Rotation per step (deg)", type: "vec3", default: [0, 0, 0], step: 1 },
        BASE_SHAPE_PARAM,
      ],
    },
    helperName: "sd_kifs",
    helperCode: `float sd_kifs(vector pos, int iterations, float scale, vector offset, vector rot_deg, int base_id)
{
    vector z = pos;
    float dr = 1.0;
    // Pre-compute Euler XYZ rotation matrix (R = Rx * Ry * Rz applied per step).
    float ax = radians(rot_deg[0]);
    float ay = radians(rot_deg[1]);
    float az = radians(rot_deg[2]);
    float cx = cos(ax); float sx = sin(ax);
    float cy = cos(ay); float sy = sin(ay);
    float cz = cos(az); float sz = sin(az);
    float m00 = cy * cz;
    float m01 = -cy * sz;
    float m02 = sy;
    float m10 = cx * sz + sx * sy * cz;
    float m11 = cx * cz - sx * sy * sz;
    float m12 = -sx * cy;
    float m20 = sx * sz - cx * sy * cz;
    float m21 = sx * cz + cx * sy * sz;
    float m22 = cx * cy;
    for (int i = 0; i < iterations; i = i + 1) {
        z = vector(abs(z[0]), abs(z[1]), abs(z[2]));
        // Sort: largest component first, reduces symmetry
        if (z[1] > z[0]) z = vector(z[1], z[0], z[2]);
        if (z[2] > z[0]) z = vector(z[2], z[1], z[0]);
        if (z[2] > z[1]) z = vector(z[0], z[2], z[1]);
        // Apply per-step rotation matrix
        float nx = m00 * z[0] + m01 * z[1] + m02 * z[2];
        float ny = m10 * z[0] + m11 * z[1] + m12 * z[2];
        float nz = m20 * z[0] + m21 * z[1] + m22 * z[2];
        z = vector(nx, ny, nz);
        // Scale and offset
        float k = scale - 1.0;
        z = vector(scale * z[0] - offset[0] * k, scale * z[1] - offset[1] * k, scale * z[2] - offset[2] * k);
        dr = dr * scale;
    }${FRACTAL_BASE_CODE}
    return base_d / max(abs(dr), 0.0001);
}`,
    call: (p, params) =>
      `sd_kifs(${p}, ${getInt(params, "iterations", 10)}, ${f(
        getFloat(params, "scale", 2),
      )}, ${vec(getVec3(params, "offset", [1, 1, 1]))}, ${vec(
        getVec3(params, "rotation", [0, 0, 0]),
      )}, ${BASE_SHAPE_TO_ID[getString(params, "base", "sphere")] ?? 0})`,
  },

  quaternionJulia: {
    spec: {
      type: "quaternionJulia",
      kind: "primitive",
      category: "Fractals",
      label: "Quaternion Julia",
      params: [
        { key: "c", label: "C (x, y, z)", type: "vec3", default: [-0.2, 0.4, -0.4], step: 0.01 },
        { key: "cw", label: "C w", type: "float", default: -0.4, step: 0.01 },
        { key: "iterations", label: "Iterations", type: "int", default: 10, min: 1, max: 30 },
        { key: "bailout", label: "Bailout", type: "float", default: 4, min: 1, step: 0.5 },
      ],
    },
    helperName: "sd_quat_julia",
    helperCode: `float sd_quat_julia(vector pos, vector c, float c_w, int iterations, float bailout)
{
    float qx = pos[0];
    float qy = pos[1];
    float qz = pos[2];
    float qw = 0.0;
    float md2 = 1.0;
    float mz2 = qx * qx + qy * qy + qz * qz + qw * qw;
    for (int i = 0; i < iterations; i = i + 1) {
        md2 = md2 * 4.0 * mz2;
        // q = q*q + c, with q*q for quaternion (treating real q with imaginary parts xy z)
        float nw = qw * qw - qx * qx - qy * qy - qz * qz;
        float nx = 2.0 * qw * qx;
        float ny = 2.0 * qw * qy;
        float nz = 2.0 * qw * qz;
        qw = nw + c_w;
        qx = nx + c[0];
        qy = ny + c[1];
        qz = nz + c[2];
        mz2 = qx * qx + qy * qy + qz * qz + qw * qw;
        if (mz2 > bailout) break;
    }
    return 0.25 * sqrt(mz2 / max(md2, 0.0001)) * log(max(mz2, 0.0001));
}`,
    call: (p, params) =>
      `sd_quat_julia(${p}, ${vec(getVec3(params, "c", [-0.2, 0.4, -0.4]))}, ${f(
        getFloat(params, "cw", -0.4),
      )}, ${getInt(params, "iterations", 10)}, ${f(getFloat(params, "bailout", 4))})`,
  },

  pseudoKleinian: {
    spec: {
      type: "pseudoKleinian",
      kind: "primitive",
      category: "Fractals",
      label: "Pseudo-Kleinian",
      params: [
        { key: "iterations", label: "Iterations", type: "int", default: 10, min: 1, max: 30 },
        { key: "kr", label: "Sphere radius²", type: "float", default: 0.6, min: 0.01, step: 0.05 },
        { key: "cs", label: "Cube size", type: "vec3", default: [1, 1, 1], step: 0.05 },
      ],
    },
    helperName: "sd_pseudo_kleinian",
    helperCode: `float sd_pseudo_kleinian(vector pos, int iterations, float kr, vector cs)
{
    vector p = pos;
    float dr = 1.0;
    for (int i = 0; i < iterations; i = i + 1) {
        // Box fold (reflection inside the cube)
        p = vector(
            2.0 * clamp(p[0], -cs[0], cs[0]) - p[0],
            2.0 * clamp(p[1], -cs[1], cs[1]) - p[1],
            2.0 * clamp(p[2], -cs[2], cs[2]) - p[2]);
        // Sphere inversion (only when inside)
        float r2 = p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
        float t = max(kr / max(r2, 0.0001), 1.0);
        p = vector(p[0] * t, p[1] * t, p[2] * t);
        dr = dr * t;
    }
    return 0.25 * abs(p[1]) / max(dr, 0.0001);
}`,
    call: (p, params) =>
      `sd_pseudo_kleinian(${p}, ${getInt(params, "iterations", 10)}, ${f(
        getFloat(params, "kr", 0.6),
      )}, ${vec(getVec3(params, "cs", [1, 1, 1]))})`,
  },
};
