# Vectron Formula Generator

Visual editor for Octane Render's **Vectron** SDF shaders. Compose primitives,
booleans, transforms and fractals as a tree → generates a ready-to-compile OSL
shader for the Vectron node in Octane (Standalone, Blender, C4D, etc.).

Includes a live WebGL2 ray-marched preview that mirrors the OSL output, plus
Blender-style modal transforms (`G` / `R` / `S`) so you can build SDFs
visually.

## Features

### Library

- **15 primitives**: Sphere, Box, Round Box, Torus, Capped Torus, Capsule,
  Cylinder, Cone, Plane, Hex/Tri Prism, Ellipsoid, Octahedron, Pyramid, Link.
- **Booleans**: Union, Intersection, Subtract — each with hard and Smooth
  (polynomial `k`) variants.
- **Transforms**: Translate, Rotate (Euler XYZ), Uniform Scale, Mirror.
- **Repetition**: Infinite Repeat, Finite Repeat, Polar Repeat.
- **Deformations**: Twist, Bend, Sine Displace, Value/FBM/Ridged noise
  displacement.
- **Fractals**: Mandelbulb, Mandelbox, Menger Sponge, Sierpinski Tetrahedron.

### Editor

- Drag-and-drop from Library or between Tree nodes (insert before / after /
  inside).
- Smart-delete that preserves child branches when the logic allows it
  (un-wrap, Union fallback).
- Type-swap dropdown inside the Inspector (Union → Smooth Union, Box →
  Sphere, etc.) preserves the tree structure.
- Collapse/expand tree branches.
- `Shift+D` duplicates the selected subtree.
- `Delete` / `Backspace` removes selected.

### Preview

- WebGL2 sphere-tracer with the same SDF as the OSL output (`vector → vec3`
  swap; one source of truth for both dialects).
- Orbit camera (drag), zoom (wheel), `Reset view`.
- `Alt` while orbiting → snap to 6 orthographic projections (Front / Back /
  Left / Right / Top / Bottom) with a label chip.
- Click on a surface → selects the corresponding primitive node (picking via
  ID-encoded offscreen framebuffer).
- Orange chain-origin dot for the selected node.

### Blender-style modal transforms

- `G` / `R` / `S` — grab / rotate / scale. Auto-wraps the selected node in
  the right transform if needed.
- `Alt + G / R / S` — reset the corresponding transform to defaults.
- `X` / `Y` / `Z` during modal — constrain to a world axis.
- `LMB` / `Enter` — confirm. `RMB` / `Esc` — cancel (reverts to start state).
- Rotate/Scale pivot is the chain origin (visual centre), not world origin.

### Output

- Live OSL panel with `Copy` and **Export `.osl`** buttons.
- Generated code includes only the helpers actually used (tree-shaken).
- Uses `#include "octane-oslintrin.h"` and the `vector Center` shader input
  expected by community Vectron examples.

## Using the output in Octane (Blender plugin)

1. Click **Export .osl** in the top bar → saves `vectron.osl` to Downloads.
2. Add the Octane Vectron node in the Blender shader graph.
3. **Important: switch the toggle from `Internal` to `External`.** Internal
   expects a Blender Text datablock; External reads the file directly from
   disk.
4. Click the folder icon → pick the exported `.osl` file.
5. Click **Compile OSL Node**.

If you see `error: No shader function defined`, you're likely in `Internal`
mode without a Blender Text datablock selected. Switch to `External`.

## Tech

- **Next.js 16** (App Router, Turbopack)
- **TypeScript** + **Tailwind 4** with the O'Bend design system tokens
- **Zustand** for tree / modal / drag state
- **WebGL2** sphere-tracing for preview
- No backend — fully static, deploys to Vercel as-is

## Development

```bash
npm install
npm run dev    # http://localhost:3000
npm run build  # production build
npm run lint
```

## Deploy on Vercel

The project is plain Next.js with no server-side dependencies, so a Vercel
deploy is a one-click flow:

1. Push to GitHub.
2. Open <https://vercel.com/new> → import the repository.
3. Vercel auto-detects Next.js — accept defaults and deploy.

No environment variables required.

## Project layout

```
app/                       Next.js App Router
components/                React UI (Tree, Preview, Inspector, Panels, ui/)
lib/
  types.ts                 Node types
  store.ts                 Zustand store (tree, modal, drag)
  osl/
    emit.ts                OSL emitter (Octane Vectron output)
    registry/              Primitive / boolean / transform specs + helpers
  glsl/
    emit.ts                GLSL emitters (preview + picking)
  preview/
    projection.ts          3D math, chain-origin walk, camera projection
docs/
  vectron-osl-spec.md      Notes from Otoy docs + FFVectron examples
```

## Credits

- SDF primitive distance functions are derived from
  [Inigo Quilez](https://iquilezles.org/articles/distfunctions/) and
  [`thargor6/FFVectron`](https://github.com/thargor6/FFVectron) (MIT).
- Vectron OSL conventions from the
  [OctaneRender OSL docs](https://docs.otoy.com/osl/vectron/) and OTOY forum
  examples.
