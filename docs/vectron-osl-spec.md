# Vectron OSL Dialect — Reference for Emitter

Compiled from Otoy docs + FFVectron community examples. This is the source of truth for what our generator must emit.

## Required include

```c
#include <octane-oslintrin.h>
```

Provides the `_sdf` struct and `_SDFDEF` initializer macro. The macro is a runtime placeholder — Octane substitutes real values at execution.

## `_sdf` struct

```
struct _sdf {
    int   objId;   // object id
    int   matId;   // material id (use to pick material per branch)
    float u;       // texture U
    float v;       // texture V
    float dist;    // signed distance; positive = outside
}
```

## Shader signature template

```c
#include <octane-oslintrin.h>

shader <Name>(
    <type> <param> = <default>  [[ <ui-metadata> ]],
    ...
    // optional _sdf inputs to receive other Vectron nodes:
    _sdf inputA = _SDFDEF,
    output _sdf out = _SDFDEF)
{
    // P is the evaluation point (point global)
    out.dist = <signed-distance-expression>;
    // optionally override out.matId for per-branch materials
}
```

Default values of `out.matId` / `out.objId` come from the Vectron node's Geometry material slot — leave them alone unless you want to override.

## UI metadata (parameter annotations)

```c
float radius = 1 [[ float min = 0, float slidermax = 1e4, float sliderexponent = 4 ]]
```

Common annotations: `min`, `max`, `slidermin`, `slidermax`, `sliderexponent`. Octane parses these to render the parameter UI in Blender.

## Globals

- `point P` — evaluation position in local space.
- `vector I` — ray direction (rarely needed).

## OSL syntax — critical differences from GLSL

- **No swizzles.** `p.xz` does NOT work. Access components by index: `p[0]`, `p[1]`, `p[2]`.
- **Vector construction:** `vector(x, y, z)`. For 2D-like math, use a 3-vector with z=0 and ignore z (FFVectron's `vec2(a,b)` is just `vector(a,b,0)`).
- **Types:** `float`, `int`, `vector`, `point`, `color`, `matrix`, `string`, `void`.
- **Matrix:** 4x4 `matrix`; multiply vectors via `transform(m, v)`, not `m * v`.
- **No reference passing in user functions** in older OSL versions — return values or use output params.
- Built-ins available: `length`, `distance`, `dot`, `cross`, `normalize`, `min`, `max`, `abs`, `clamp`, `mix`, `mod`, `floor`, `ceil`, `round`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan2`, `pow`, `exp`, `log`, `sqrt`, `sign`, `step`, `smoothstep`, `noise`, `cellnoise`, `hash` etc.

## Bounds

The node has a `Bounds` vector (default 10,10,10) — Octane clips everything outside this AABB. Our generator doesn't write this; user sets it on the node.

## Material per branch

To assign different materials to different sub-SDFs:
1. The Vectron node exposes ONE "Geometry material" socket. For per-branch materials, the typical Octane workflow is to use the **Composite material** node feeding the slot, and have the OSL code set `out.matId = <index>` based on which primitive wins.
2. For v1 we'll emit `out.matId = N` assignments when the user has assigned slots; documentation will tell the user to wire a Composite material with matching slot indices.

## Confirmed working pattern (from Otoy docs — minimal sphere)

```c
#include <octane-oslintrin.h>

shader VectronSphere(
    float radius = 1
        [[ float min = 0, float slidermax = 1e4, float sliderexponent = 4 ]],
    vector center = 0,
    output _sdf out = _SDFDEF)
{
    out.dist = distance(P, center) - radius;
}
```

## Emitter strategy

The generator emits a single self-contained OSL shader:

1. `#include <octane-oslintrin.h>` header.
2. A flat collection of helper functions for every SDF primitive and operator used in the tree (only the ones actually referenced — tree-shake).
3. The `shader` block: exposes any tree node marked as "parameter" as a top-level shader input; otherwise constants are baked in.
4. Body: builds the SDF expression by walking the tree. Operators compose floats (distance values). Domain ops transform the input point before passing down. Result assigned to `out.dist`. Material assignments override `out.matId`.

## Sources

- https://docs.otoy.com/osl/vectron/
- https://docs.otoy.com/blender/VectronR.html
- https://docs.otoy.com/standaloneSE/Vectron.html
- https://render.otoy.com/forum/viewtopic.php?f=27&t=75453 (Smooth union sample)
- https://github.com/thargor6/FFVectron (community SDF/fractal collection — MIT, Inigo Quilez-derived primitives)
