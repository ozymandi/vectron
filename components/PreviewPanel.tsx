"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { buildPickingProgram, buildPreviewProgram } from "@/lib/glsl/emit";
import type { NodeId } from "@/lib/types";
import {
  applyMat3,
  axisAngleToMat3,
  computeChainOrigin,
  cross,
  dot,
  eulerXYZToMat3,
  FOCAL,
  matToEulerXYZDeg,
  multiplyMat3,
  normalize3,
  orbitEye,
  projectWorldToScreen,
  sub,
  transposeMat3,
  type Mat3,
  type Vec3,
} from "@/lib/preview/projection";
import type { ModalState } from "@/lib/store";
import type { ParamsMap, SdfNode } from "@/lib/types";

type GLState = {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  uRes: WebGLUniformLocation | null;
  uEye: WebGLUniformLocation | null;
  uTarget: WebGLUniformLocation | null;
  uUp: WebGLUniformLocation | null;
};

type PickState = {
  program: WebGLProgram;
  uRes: WebGLUniformLocation | null;
  uEye: WebGLUniformLocation | null;
  uTarget: WebGLUniformLocation | null;
  uUp: WebGLUniformLocation | null;
  idMap: Map<number, NodeId>;
  fbo: WebGLFramebuffer | null;
  fboTex: WebGLTexture | null;
  fboW: number;
  fboH: number;
};

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  src: string,
): WebGLShader | { error: string } {
  const sh = gl.createShader(type);
  if (!sh) return { error: "createShader failed" };
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? "unknown";
    gl.deleteShader(sh);
    return { error: log };
  }
  return sh;
}

function buildProgram(
  gl: WebGL2RenderingContext,
  vsSrc: string,
  fsSrc: string,
): WebGLProgram | { error: string } {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  if ("error" in vs) return { error: "VS: " + vs.error };
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  if ("error" in fs) {
    gl.deleteShader(vs);
    return { error: "FS: " + fs.error };
  }
  const prog = gl.createProgram();
  if (!prog) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return { error: "createProgram failed" };
  }
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, "a_pos");
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) ?? "unknown";
    gl.deleteProgram(prog);
    return { error: "LINK: " + log };
  }
  return prog;
}

// --- Modal math ------------------------------------------------------------

const GRAB_SNAP = 0.05;
const ROT_SNAP_DEG = 5;
const SCALE_SNAP = 0.05;
const SHIFT_DAMP = 0.1;

function snapTo(v: number, step: number): number {
  return Math.round(v / step) * step;
}

function computeGrabOffset(
  m: ModalState,
  cursorX: number,
  cursorY: number,
  shift: boolean,
  ctrl: boolean,
): [number, number, number] {
  const damp = shift ? SHIFT_DAMP : 1;
  const dxScreen = (cursorX - m.startMouseX) * damp;
  const dyScreen = (cursorY - m.startMouseY) * damp;

  const eye = m.cameraEye as Vec3;
  const target = m.cameraTarget as Vec3;
  const up = m.cameraUp as Vec3;
  const forward = normalize3(sub(target, eye));
  const right = normalize3(cross(forward, up));
  const trueUp = cross(right, forward);

  const dToOrigin = sub(m.chainOrigin as Vec3, eye);
  const depth = Math.max(0.1, dot(dToOrigin, forward));
  const worldPerPixel = (2 * depth) / (FOCAL * m.canvasHeight);

  let worldDelta: Vec3;

  if (m.constraint) {
    const axis: Vec3 =
      m.constraint === "X"
        ? [1, 0, 0]
        : m.constraint === "Y"
          ? [0, 1, 0]
          : [0, 0, 1];
    const origin = m.chainOrigin as Vec3;
    const tipWorld: Vec3 = [
      origin[0] + axis[0],
      origin[1] + axis[1],
      origin[2] + axis[2],
    ];
    const oProj = projectWorldToScreen(
      origin, eye, target, up, m.canvasWidth, m.canvasHeight,
    );
    const tProj = projectWorldToScreen(
      tipWorld, eye, target, up, m.canvasWidth, m.canvasHeight,
    );
    const sdx = tProj.x - oProj.x;
    const sdy = tProj.y - oProj.y;
    const lenSq = sdx * sdx + sdy * sdy;
    if (lenSq < 0.5) {
      worldDelta = [0, 0, 0];
    } else {
      const dotProd = dxScreen * sdx + dyScreen * sdy;
      const worldAlong = dotProd / lenSq;
      worldDelta = [
        axis[0] * worldAlong,
        axis[1] * worldAlong,
        axis[2] * worldAlong,
      ];
    }
  } else {
    const wdx = dxScreen * worldPerPixel;
    const wdy = -dyScreen * worldPerPixel;
    worldDelta = [
      right[0] * wdx + trueUp[0] * wdy,
      right[1] * wdx + trueUp[1] * wdy,
      right[2] * wdx + trueUp[2] * wdy,
    ];
  }

  const Rinv = transposeMat3(m.parentRotation as Mat3);
  const local = applyMat3(Rinv, worldDelta);
  const ps = m.parentScale;
  const sx = ps[0] || 1;
  const sy = ps[1] || 1;
  const sz = ps[2] || 1;
  const origOffset =
    (m.originalParams.offset as [number, number, number] | undefined) ?? [
      0, 0, 0,
    ];
  const out: [number, number, number] = [
    origOffset[0] + local[0] / sx,
    origOffset[1] + local[1] / sy,
    origOffset[2] + local[2] / sz,
  ];
  if (ctrl) {
    return [snapTo(out[0], GRAB_SNAP), snapTo(out[1], GRAB_SNAP), snapTo(out[2], GRAB_SNAP)];
  }
  return out;
}

function computeRotateAngles(
  m: ModalState,
  cursorX: number,
  cursorY: number,
  shift: boolean,
  ctrl: boolean,
): [number, number, number] {
  const eye = m.cameraEye as Vec3;
  const target = m.cameraTarget as Vec3;
  const up = m.cameraUp as Vec3;

  // Center = chain origin projected to screen.
  const proj = projectWorldToScreen(
    m.chainOrigin as Vec3,
    eye, target, up,
    m.canvasWidth, m.canvasHeight,
  );
  if (!proj.visible) {
    return (m.originalParams.angles as [number, number, number]) ?? [0, 0, 0];
  }
  const cx = proj.x, cy = proj.y;

  const vsx = m.startMouseX - cx;
  const vsy = m.startMouseY - cy;
  const vcx = cursorX - cx;
  const vcy = cursorY - cy;

  // Avoid degenerate (zero) vectors.
  if (vsx * vsx + vsy * vsy < 4 || vcx * vcx + vcy * vcy < 4) {
    return (m.originalParams.angles as [number, number, number]) ?? [0, 0, 0];
  }

  const aStart = Math.atan2(vsy, vsx);
  const aCurr = Math.atan2(vcy, vcx);
  let deltaScreen = aCurr - aStart;
  // Wrap to (-π, π].
  while (deltaScreen > Math.PI) deltaScreen -= 2 * Math.PI;
  while (deltaScreen < -Math.PI) deltaScreen += 2 * Math.PI;
  if (shift) deltaScreen *= SHIFT_DAMP;

  const forward = normalize3(sub(target, eye));

  let axis: Vec3;
  let sign: number;
  if (m.constraint === "X") {
    axis = [1, 0, 0];
    sign = forward[0];
  } else if (m.constraint === "Y") {
    axis = [0, 1, 0];
    sign = forward[1];
  } else if (m.constraint === "Z") {
    axis = [0, 0, 1];
    sign = forward[2];
  } else {
    axis = forward;
    sign = -1;
  }
  if (sign === 0) sign = 1;

  const worldAngle = deltaScreen * sign;
  const deltaR = axisAngleToMat3(axis, worldAngle);

  const origAngles =
    (m.originalParams.angles as [number, number, number]) ?? [0, 0, 0];
  const Rorig = eulerXYZToMat3(origAngles);

  const parentR = m.parentRotation as Mat3;
  const parentRT = transposeMat3(parentR);
  // newRLocal = parentRT * deltaR * parentR * Rorig
  const newRLocal = multiplyMat3(
    parentRT,
    multiplyMat3(deltaR, multiplyMat3(parentR, Rorig)),
  );
  const angles = matToEulerXYZDeg(newRLocal);
  if (ctrl) {
    return [
      snapTo(angles[0], ROT_SNAP_DEG),
      snapTo(angles[1], ROT_SNAP_DEG),
      snapTo(angles[2], ROT_SNAP_DEG),
    ];
  }
  return angles;
}

function computeScaleVector(
  m: ModalState,
  cursorX: number,
  cursorY: number,
  shift: boolean,
  ctrl: boolean,
): [number, number, number] {
  const orig = readScaleParam(m.originalParams.scale);
  const eye = m.cameraEye as Vec3;
  const target = m.cameraTarget as Vec3;
  const up = m.cameraUp as Vec3;
  const proj = projectWorldToScreen(
    m.chainOrigin as Vec3,
    eye, target, up,
    m.canvasWidth, m.canvasHeight,
  );
  if (!proj.visible) return orig;
  const cx = proj.x, cy = proj.y;
  const sdx = m.startMouseX - cx;
  const sdy = m.startMouseY - cy;
  const cdx = cursorX - cx;
  const cdy = cursorY - cy;
  const startDist = Math.sqrt(sdx * sdx + sdy * sdy);
  const currDist = Math.sqrt(cdx * cdx + cdy * cdy);
  if (startDist < 2) return orig;
  let factor = currDist / startDist;
  if (shift) factor = 1 + (factor - 1) * SHIFT_DAMP;
  const clamp = (v: number) => Math.max(0.0001, v);
  const maybeSnap = (v: number) => (ctrl ? Math.max(0.0001, snapTo(v, SCALE_SNAP)) : clamp(v));
  if (m.constraint === "X") return [maybeSnap(orig[0] * factor), orig[1], orig[2]];
  if (m.constraint === "Y") return [orig[0], maybeSnap(orig[1] * factor), orig[2]];
  if (m.constraint === "Z") return [orig[0], orig[1], maybeSnap(orig[2] * factor)];
  return [
    maybeSnap(orig[0] * factor),
    maybeSnap(orig[1] * factor),
    maybeSnap(orig[2] * factor),
  ];
}

function readScaleParam(v: unknown): [number, number, number] {
  if (Array.isArray(v) && v.length === 3) return v as [number, number, number];
  if (typeof v === "number") return [v, v, v];
  return [1, 1, 1];
}

function computeModalParams(
  m: ModalState,
  cursorX: number,
  cursorY: number,
  shift: boolean,
  ctrl: boolean,
): ParamsMap {
  if (m.mode === "grab") {
    return { offset: computeGrabOffset(m, cursorX, cursorY, shift, ctrl) };
  }
  if (m.mode === "rotate") {
    return { angles: computeRotateAngles(m, cursorX, cursorY, shift, ctrl) };
  }
  if (m.mode === "scale") {
    return { scale: computeScaleVector(m, cursorX, cursorY, shift, ctrl) };
  }
  return {};
}

// --- Component -------------------------------------------------------------

export function PreviewPanel() {
  const root = useStore((s) => s.root);
  const selectedId = useStore((s) => s.selectedId);
  const modalMode = useStore((s) => s.modalMode);
  const modalState = useStore((s) => s.modalState);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dotRef = useRef<SVGCircleElement | null>(null);
  const glStateRef = useRef<GLState | null>(null);
  const pickStateRef = useRef<PickState | null>(null);
  const cameraRef = useRef({ yaw: 0.6, pitch: 0.45, distance: 5 });
  const rafRef = useRef<number | null>(null);
  const rootRef = useRef<SdfNode | null>(root);
  rootRef.current = root;
  const selectedIdRef = useRef<string | null>(selectedId);
  selectedIdRef.current = selectedId;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let gl = glStateRef.current?.gl;
    if (!gl) {
      const ctx = canvas.getContext("webgl2", { antialias: true, alpha: false });
      if (!ctx) {
        setError("WebGL2 not supported in this browser.");
        return;
      }
      gl = ctx;
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 3, -1, -1, 3]),
        gl.STATIC_DRAW,
      );
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    }

    const { vs, fs } = buildPreviewProgram(root);
    const result = buildProgram(gl, vs, fs);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError(null);

    if (glStateRef.current?.program) {
      gl.deleteProgram(glStateRef.current.program);
    }
    glStateRef.current = {
      gl,
      program: result,
      uRes: gl.getUniformLocation(result, "u_res"),
      uEye: gl.getUniformLocation(result, "u_eye"),
      uTarget: gl.getUniformLocation(result, "u_target"),
      uUp: gl.getUniformLocation(result, "u_up"),
    };

    // Picking program (built alongside main).
    const pickSrc = buildPickingProgram(root);
    const pickProg = buildProgram(gl, pickSrc.vs, pickSrc.fs);
    if ("error" in pickProg) {
      // Picking is best-effort; log but don't surface as user-facing error.
      console.error("Picking shader build failed:", pickProg.error);
    } else {
      if (pickStateRef.current?.program) {
        gl.deleteProgram(pickStateRef.current.program);
      }
      pickStateRef.current = {
        program: pickProg,
        uRes: gl.getUniformLocation(pickProg, "u_res"),
        uEye: gl.getUniformLocation(pickProg, "u_eye"),
        uTarget: gl.getUniformLocation(pickProg, "u_target"),
        uUp: gl.getUniformLocation(pickProg, "u_up"),
        idMap: pickSrc.idMap,
        fbo: pickStateRef.current?.fbo ?? null,
        fboTex: pickStateRef.current?.fboTex ?? null,
        fboW: pickStateRef.current?.fboW ?? 0,
        fboH: pickStateRef.current?.fboH ?? 0,
      };
    }
  }, [root]);

  // Click-to-pick: render the picking shader to an offscreen FBO and read
  // the pixel at the click position to identify the primitive node id.
  const pickAt = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const glState = glStateRef.current;
    const pick = pickStateRef.current;
    if (!canvas || !glState || !pick) return null;
    const gl = glState.gl;

    const rect = canvas.getBoundingClientRect();
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(cssW * dpr));
    const h = Math.max(1, Math.floor(cssH * dpr));
    // gl_FragCoord uses bottom-left origin; convert from DOM top-left.
    const px = Math.max(0, Math.min(w - 1, Math.floor((clientX - rect.left) * dpr)));
    const py = Math.max(0, Math.min(h - 1, Math.floor((cssH - (clientY - rect.top)) * dpr)));

    // (Re)create FBO if size mismatch.
    if (!pick.fbo || pick.fboW !== w || pick.fboH !== h) {
      if (pick.fboTex) gl.deleteTexture(pick.fboTex);
      if (pick.fbo) gl.deleteFramebuffer(pick.fbo);

      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, null,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D, tex, 0,
      );
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        // eslint-disable-next-line no-console
        console.error("[pick] FBO incomplete:", status.toString(16));
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return null;
      }
      pick.fbo = fbo;
      pick.fboTex = tex;
      pick.fboW = w;
      pick.fboH = h;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, pick.fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(pick.program);

    const cam = cameraRef.current;
    const eye = orbitEye(cam.yaw, cam.pitch, cam.distance);
    if (pick.uRes) gl.uniform2f(pick.uRes, w, h);
    if (pick.uEye) gl.uniform3f(pick.uEye, eye[0], eye[1], eye[2]);
    if (pick.uTarget) gl.uniform3f(pick.uTarget, 0, 0, 0);
    if (pick.uUp) gl.uniform3f(pick.uUp, 0, 1, 0);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const px4 = new Uint8Array(4);
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const id = px4[0] | (px4[1] << 8) | (px4[2] << 16);
    if (id === 0) return null;
    return pick.idMap.get(id) ?? null;
  };
  // expose to refs so listeners (in other effects) can call it.
  const pickAtRef = useRef(pickAt);
  pickAtRef.current = pickAt;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const render = () => {
      const st = glStateRef.current;
      if (!st) {
        rafRef.current = requestAnimationFrame(render);
        return;
      }
      const { gl, program, uRes, uEye, uTarget, uUp } = st;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      const w = Math.max(1, Math.floor(cssW * dpr));
      const h = Math.max(1, Math.floor(cssH * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.useProgram(program);

      const cam = cameraRef.current;
      const eye = orbitEye(cam.yaw, cam.pitch, cam.distance);

      if (uRes) gl.uniform2f(uRes, w, h);
      if (uEye) gl.uniform3f(uEye, eye[0], eye[1], eye[2]);
      if (uTarget) gl.uniform3f(uTarget, 0, 0, 0);
      if (uUp) gl.uniform3f(uUp, 0, 1, 0);

      gl.clearColor(0.07, 0.08, 0.1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      const dot = dotRef.current;
      if (dot) {
        const r = rootRef.current;
        const sel = selectedIdRef.current;
        if (r && sel) {
          const origin = computeChainOrigin(r, sel);
          if (origin) {
            const proj = projectWorldToScreen(
              origin, eye, [0, 0, 0], [0, 1, 0], cssW, cssH,
            );
            if (proj.visible) {
              dot.setAttribute("cx", String(proj.x));
              dot.setAttribute("cy", String(proj.y));
              dot.style.display = "";
            } else {
              dot.style.display = "none";
            }
          } else {
            dot.style.display = "none";
          }
        } else {
          dot.style.display = "none";
        }
      }

      rafRef.current = requestAnimationFrame(render);
    };
    rafRef.current = requestAnimationFrame(render);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Camera orbit + click-to-pick.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let downX = 0;
    let downY = 0;
    let didMove = false;
    const CLICK_THRESHOLD = 4;

    const inModal = () =>
      useStore.getState().modalMode !== null;

    const onDown = (e: MouseEvent) => {
      if (inModal()) return;
      if (e.button !== 0) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      downX = e.clientX;
      downY = e.clientY;
      didMove = false;
    };
    const onUp = (e: MouseEvent) => {
      const wasDragging = dragging;
      dragging = false;
      if (wasDragging && !didMove && !inModal()) {
        // Click without drag → pick.
        const nodeId = pickAtRef.current(e.clientX, e.clientY);
        if (nodeId) useStore.getState().selectNode(nodeId);
        else useStore.getState().selectNode(null);
      }
    };
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      const totalDx = Math.abs(e.clientX - downX);
      const totalDy = Math.abs(e.clientY - downY);
      if (totalDx + totalDy > CLICK_THRESHOLD) didMove = true;
      if (!didMove) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      cameraRef.current.yaw -= dx * 0.005;
      cameraRef.current.pitch += dy * 0.005;

      if (e.altKey) {
        // Snap to nearest orthographic view: yaw to multiple of π/2,
        // pitch to {-π/2+ε, 0, π/2-ε}.
        const halfPi = Math.PI / 2;
        let y = cameraRef.current.yaw;
        while (y > Math.PI) y -= 2 * Math.PI;
        while (y < -Math.PI) y += 2 * Math.PI;
        cameraRef.current.yaw = Math.round(y / halfPi) * halfPi;

        const p = cameraRef.current.pitch;
        const candidates = [-halfPi + 0.02, 0, halfPi - 0.02];
        let best = candidates[0];
        let bestDist = Math.abs(p - best);
        for (let i = 1; i < candidates.length; i++) {
          const d = Math.abs(p - candidates[i]);
          if (d < bestDist) {
            bestDist = d;
            best = candidates[i];
          }
        }
        cameraRef.current.pitch = best;
      } else {
        cameraRef.current.pitch = Math.max(
          -Math.PI / 2 + 0.02,
          Math.min(Math.PI / 2 - 0.02, cameraRef.current.pitch),
        );
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (inModal()) return;
      e.preventDefault();
      const f = 1 + e.deltaY * 0.001;
      cameraRef.current.distance = Math.max(
        0.5,
        Math.min(80, cameraRef.current.distance * f),
      );
    };

    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("mousemove", onMove);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, []);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt) {
        const tag = tgt.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (tgt.isContentEditable) return;
      }

      const state = useStore.getState();
      const m = state.modalState;
      const mode = state.modalMode;
      const key = e.key.toLowerCase();

      // Modal not active and not armed: G / R / S activate modals;
      // Alt+G/R/S reset; Shift+D duplicate; Delete / Backspace removes;
      // Ctrl+Z undo, Ctrl+Shift+Z or Ctrl+Y redo.
      if (!mode) {
        // Undo / Redo work even without a selection.
        if ((e.ctrlKey || e.metaKey) && key === "z" && !e.shiftKey) {
          e.preventDefault();
          state.undo();
          return;
        }
        if (
          (e.ctrlKey || e.metaKey) &&
          (key === "y" || (e.shiftKey && key === "z"))
        ) {
          e.preventDefault();
          state.redo();
          return;
        }
        if (!state.selectedId) return;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          state.removeNode(state.selectedId);
          return;
        }
        if (e.shiftKey && key === "d") {
          e.preventDefault();
          state.duplicateSelected();
          return;
        }
        if (e.altKey && (key === "g" || key === "r" || key === "s")) {
          e.preventDefault();
          const m =
            key === "g" ? "grab" : key === "r" ? "rotate" : "scale";
          state.resetTransform(m);
          return;
        }
        if (key === "g") {
          e.preventDefault();
          state.armModal("grab");
        } else if (key === "r") {
          e.preventDefault();
          state.armModal("rotate");
        } else if (key === "s") {
          e.preventDefault();
          state.armModal("scale");
        }
        return;
      }

      // In modal (armed or active).
      if (e.key === "Escape") {
        e.preventDefault();
        state.cancelModal();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        state.confirmModal();
        return;
      }
      if (m && (key === "x" || key === "y" || key === "z")) {
        e.preventDefault();
        const axis = key.toUpperCase() as "X" | "Y" | "Z";
        state.setModalConstraint(m.constraint === axis ? null : axis);
        return;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Mouse during modal: first move activates; subsequent moves update params.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const state = useStore.getState();
      if (state.modalMode && !state.modalState) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const cam = cameraRef.current;
        const eye = orbitEye(cam.yaw, cam.pitch, cam.distance);
        state.activateModal({
          startMouseX: e.clientX,
          startMouseY: e.clientY,
          cameraEye: eye,
          cameraTarget: [0, 0, 0],
          cameraUp: [0, 1, 0],
          canvasWidth: canvas.clientWidth,
          canvasHeight: canvas.clientHeight,
        });
        return;
      }
      const m = state.modalState;
      if (m) {
        const params = computeModalParams(
          m,
          e.clientX,
          e.clientY,
          e.shiftKey,
          e.ctrlKey,
        );
        state.applyModalParams(params);
      }
    };
    const onDown = (e: PointerEvent) => {
      const state = useStore.getState();
      if (state.modalState) {
        e.preventDefault();
        if (e.button === 0) state.confirmModal();
        else if (e.button === 2) state.cancelModal();
        return;
      }
      if (state.modalMode && e.button !== 0) {
        state.disarmModal();
      }
    };
    const onContextMenu = (e: MouseEvent) => {
      if (useStore.getState().modalMode) e.preventDefault();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("contextmenu", onContextMenu);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("contextmenu", onContextMenu);
    };
  }, []);

  const resetCamera = () => {
    cameraRef.current = { yaw: 0.6, pitch: 0.45, distance: 5 };
  };

  // Detect ortho view label for status overlay. Re-evaluated every render.
  // Use a state to trigger updates as camera changes via orbit.
  const [orthoLabel, setOrthoLabel] = useState<string | null>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const cam = cameraRef.current;
      const halfPi = Math.PI / 2;
      const eps = 0.01;
      let y = cam.yaw;
      while (y > Math.PI) y -= 2 * Math.PI;
      while (y < -Math.PI) y += 2 * Math.PI;
      const p = cam.pitch;
      let label: string | null = null;
      if (Math.abs(p - (halfPi - 0.02)) < eps) label = "Top";
      else if (Math.abs(p - (-halfPi + 0.02)) < eps) label = "Bottom";
      else if (Math.abs(p) < eps) {
        if (Math.abs(y) < eps) label = "Front (+Z)";
        else if (Math.abs(y - halfPi) < eps) label = "Right (+X)";
        else if (Math.abs(y + halfPi) < eps) label = "Left (-X)";
        else if (Math.abs(Math.abs(y) - Math.PI) < eps) label = "Back (-Z)";
      }
      setOrthoLabel(label);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const modeLabel = modalMode === "grab"
    ? "Grab"
    : modalMode === "rotate"
      ? "Rotate"
      : modalMode === "scale"
        ? "Scale"
        : null;

  const statusText = modalState
    ? `${modeLabel}${modalState.constraint ? " " + modalState.constraint : ""} — Ctrl snap · Shift precision · LMB confirm · Esc cancel`
    : modalMode
      ? `${modeLabel} armed — move mouse to start, Esc to cancel`
      : null;

  return (
    <div className="relative w-full h-full bg-bg overflow-hidden">
      <canvas
        ref={canvasRef}
        className="block w-full h-full cursor-grab active:cursor-grabbing"
      />
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle
          ref={dotRef}
          r={5}
          fill="#ff8a00"
          stroke="#1e1e1e"
          strokeWidth={2}
          style={{ display: "none" }}
        />
      </svg>
      <div className="absolute top-2 left-3 flex items-center gap-2 text-[10px] uppercase tracking-wider pointer-events-none">
        <span className="text-muted-foreground">Preview</span>
        {orthoLabel && (
          <span className="text-primary border border-primary px-1.5 py-0.5 rounded-sm">
            {orthoLabel}
          </span>
        )}
      </div>
      {statusText && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-sm bg-bg/90 border border-primary text-foreground text-[11px] font-mono shadow pointer-events-none">
          {statusText}
        </div>
      )}
      <button
        type="button"
        onClick={resetCamera}
        className="absolute top-2 right-2 px-2 py-0.5 text-[10px] rounded-sm border border-border text-muted-foreground hover:text-foreground hover:border-border-strong bg-bg/70 backdrop-blur-sm transition-colors"
      >
        Reset view
      </button>
      {error && (
        <div className="absolute bottom-2 left-2 right-2 px-2 py-1 rounded-sm bg-destructive/20 border border-destructive text-destructive text-[10px] font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
          {error}
        </div>
      )}
    </div>
  );
}
