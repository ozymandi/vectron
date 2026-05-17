"use client";

import { create } from "zustand";
import type {
  BooleanType,
  NodeId,
  NodeKind,
  ParamsMap,
  ParamValue,
  PrimitiveType,
  SdfNode,
  TransformType,
} from "./types";
import {
  BOOLEANS,
  defaultParams,
  getSpec,
  PRIMITIVES,
  TRANSFORMS,
} from "./osl/registry";
import {
  computeChainOrigin,
  computeParentTransform,
  identity3,
} from "./preview/projection";

function computeChainSnapshot(root: SdfNode, nodeId: NodeId) {
  const chainOrigin = computeChainOrigin(root, nodeId) ?? [0, 0, 0];
  const pt = computeParentTransform(root, nodeId);
  return {
    chainOrigin,
    parentRotation: pt?.rotation ?? identity3(),
    parentScale: pt?.scale ?? 1,
  };
}

// --- helpers ---------------------------------------------------------------

const newId = (): NodeId =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 11);

function makePrimitive(type: PrimitiveType): SdfNode {
  return {
    id: newId(),
    kind: "primitive",
    type,
    enabled: true,
    params: defaultParams(type),
  };
}

function makeTransform(type: TransformType, child: SdfNode | null): SdfNode {
  return {
    id: newId(),
    kind: "transform",
    type,
    enabled: true,
    params: defaultParams(type),
    child,
  };
}

function makeBoolean(type: BooleanType, children: SdfNode[]): SdfNode {
  return {
    id: newId(),
    kind: "boolean",
    type,
    enabled: true,
    params: defaultParams(type),
    children,
  };
}

function cloneNode(node: SdfNode): SdfNode {
  if (node.kind === "primitive") {
    return { ...node, id: newId(), params: { ...node.params } };
  }
  if (node.kind === "transform") {
    return {
      ...node,
      id: newId(),
      params: { ...node.params },
      child: node.child ? cloneNode(node.child) : null,
    };
  }
  return {
    ...node,
    id: newId(),
    params: { ...node.params },
    children: node.children.map(cloneNode),
  };
}

function createFromLibrary(specType: string, specKind: NodeKind): SdfNode {
  if (specKind === "primitive") return makePrimitive(specType as PrimitiveType);
  if (specKind === "transform") return makeTransform(specType as TransformType, null);
  return makeBoolean(specType as BooleanType, []);
}

function collectIds(node: SdfNode, into: Set<NodeId>): void {
  into.add(node.id);
  if (node.kind === "transform" && node.child) collectIds(node.child, into);
  if (node.kind === "boolean") {
    for (const c of node.children) collectIds(c, into);
  }
}

function detachNode(
  root: SdfNode,
  id: NodeId,
): { detached: SdfNode | null; rest: SdfNode | null } {
  if (root.id === id) return { detached: root, rest: null };
  if (root.kind === "transform") {
    if (!root.child) return { detached: null, rest: root };
    const r = detachNode(root.child, id);
    if (!r.detached) return { detached: null, rest: root };
    return { detached: r.detached, rest: { ...root, child: r.rest } };
  }
  if (root.kind === "boolean") {
    for (let i = 0; i < root.children.length; i++) {
      const r = detachNode(root.children[i], id);
      if (r.detached) {
        const children = root.children.slice();
        if (r.rest === null) children.splice(i, 1);
        else children[i] = r.rest;
        return { detached: r.detached, rest: { ...root, children } };
      }
    }
  }
  return { detached: null, rest: root };
}

function attachNode(
  root: SdfNode,
  source: SdfNode,
  targetId: NodeId,
  position: "before" | "after" | "inside",
): SdfNode | null {
  if (root.id === targetId) {
    if (position === "inside") {
      if (root.kind === "boolean") {
        return { ...root, children: [...root.children, source] };
      }
      if (root.kind === "transform" && !root.child) {
        return { ...root, child: source };
      }
      return null;
    }
    return null;
  }
  if (root.kind === "transform") {
    if (!root.child) return null;
    const updated = attachNode(root.child, source, targetId, position);
    if (!updated) return null;
    return { ...root, child: updated };
  }
  if (root.kind === "boolean") {
    for (let i = 0; i < root.children.length; i++) {
      const child = root.children[i];
      if (child.id === targetId) {
        const children = root.children.slice();
        if (position === "before") {
          children.splice(i, 0, source);
          return { ...root, children };
        }
        if (position === "after") {
          children.splice(i + 1, 0, source);
          return { ...root, children };
        }
      }
      const updated = attachNode(child, source, targetId, position);
      if (updated) {
        const children = root.children.slice();
        children[i] = updated;
        return { ...root, children };
      }
    }
  }
  return null;
}

function pathFromRootTo(root: SdfNode, id: NodeId): SdfNode[] {
  const path: SdfNode[] = [];
  function dfs(node: SdfNode): boolean {
    path.push(node);
    if (node.id === id) return true;
    if (node.kind === "transform" && node.child) {
      if (dfs(node.child)) return true;
    } else if (node.kind === "boolean") {
      for (const c of node.children) {
        if (dfs(c)) return true;
      }
    }
    path.pop();
    return false;
  }
  if (!dfs(root)) return [];
  return path;
}

/** Walk from root to `id`, return the deepest ancestor (or self) of the
 *  given transform type. Returns null if not found. */
function findAncestorOfType(
  root: SdfNode | null,
  id: NodeId,
  type: TransformType,
): SdfNode | null {
  if (!root) return null;
  const path: SdfNode[] = [];
  function dfs(node: SdfNode): boolean {
    path.push(node);
    if (node.id === id) return true;
    if (node.kind === "transform" && node.child) {
      if (dfs(node.child)) return true;
    } else if (node.kind === "boolean") {
      for (const c of node.children) {
        if (dfs(c)) return true;
      }
    }
    path.pop();
    return false;
  }
  if (!dfs(root)) return null;
  for (let i = path.length - 1; i >= 0; i--) {
    const n = path[i];
    if (n.kind === "transform" && n.type === type) return n;
  }
  return null;
}

function findParentOf(root: SdfNode, id: NodeId): SdfNode | null {
  if (root.kind === "transform") {
    if (root.child?.id === id) return root;
    if (root.child) return findParentOf(root.child, id);
    return null;
  }
  if (root.kind === "boolean") {
    for (const c of root.children) {
      if (c.id === id) return root;
      const r = findParentOf(c, id);
      if (r) return r;
    }
  }
  return null;
}

type FindResult =
  | {
      node: SdfNode;
      update: (updated: SdfNode | null) => SdfNode | null;
    }
  | null;

function findById(root: SdfNode | null, id: NodeId): FindResult {
  if (!root) return null;
  if (root.id === id) {
    return { node: root, update: (u) => u };
  }
  if (root.kind === "transform" && root.child) {
    const r = findById(root.child, id);
    if (r) {
      const update = r.update;
      return {
        node: r.node,
        update: (u) => ({ ...root, child: update(u) }),
      };
    }
  }
  if (root.kind === "boolean") {
    for (let i = 0; i < root.children.length; i++) {
      const r = findById(root.children[i], id);
      if (r) {
        const innerUpdate = r.update;
        return {
          node: r.node,
          update: (u) => {
            const next = innerUpdate(u);
            const children = root.children.slice();
            if (next === null) {
              children.splice(i, 1);
            } else {
              children[i] = next;
            }
            return { ...root, children };
          },
        };
      }
    }
  }
  return null;
}

// --- state ------------------------------------------------------------------

export type DropPosition = "before" | "after" | "inside";

export type DragSource =
  | { kind: "existing"; sourceId: NodeId }
  | { kind: "library"; specType: string; specKind: NodeKind };

export type ModalMode = "grab" | "rotate" | "scale";
export type GrabAxis = "X" | "Y" | "Z";

export type ModalState = {
  mode: ModalMode;
  nodeId: NodeId; // the Translate/RotateEuler/ScaleUniform node being manipulated
  createdByModal: boolean; // if true, cancel removes the wrap
  originalRoot: SdfNode | null;
  originalSelectedId: NodeId | null;
  originalParams: ParamsMap;
  startMouseX: number;
  startMouseY: number;
  cameraEye: [number, number, number];
  cameraTarget: [number, number, number];
  cameraUp: [number, number, number];
  canvasWidth: number;
  canvasHeight: number;
  chainOrigin: [number, number, number];
  parentRotation: number[]; // Mat3 row-major
  parentScale: number;
  constraint: GrabAxis | null;
};

export type ActivateModalArgs = {
  startMouseX: number;
  startMouseY: number;
  cameraEye: [number, number, number];
  cameraTarget: [number, number, number];
  cameraUp: [number, number, number];
  canvasWidth: number;
  canvasHeight: number;
};

const MODE_TO_TRANSFORM_TYPE: Record<ModalMode, TransformType> = {
  grab: "translate",
  rotate: "rotateEuler",
  scale: "scaleUniform",
};

type StoreState = {
  root: SdfNode | null;
  selectedId: NodeId | null;
  dragSource: DragSource | null;
  modalMode: ModalMode | null; // null = no modal; non-null = armed or active
  modalState: ModalState | null; // non-null = active (mouse moved)
  collapsedIds: Record<NodeId, boolean>;

  selectNode: (id: NodeId | null) => void;
  addPrimitive: (type: PrimitiveType) => void;
  addTransform: (type: TransformType) => void;
  addBoolean: (type: BooleanType) => void;
  removeNode: (id: NodeId) => void;
  toggleEnabled: (id: NodeId) => void;
  updateParam: (id: NodeId, key: string, value: ParamValue) => void;
  changeNodeType: (id: NodeId, newType: string) => void;
  reset: () => void;

  startDragExisting: (id: NodeId) => void;
  startDragLibrary: (specType: string, specKind: NodeKind) => void;
  clearDrag: () => void;
  canDrop: (targetId: NodeId, position: DropPosition) => boolean;
  commitDrop: (targetId: NodeId, position: DropPosition) => boolean;
  // For empty-tree case: drop a library item to become the root.
  commitDropAsRoot: () => boolean;

  // Modal transform (G / R / S shortcuts)
  armModal: (mode: ModalMode) => void;
  disarmModal: () => void;
  activateModal: (args: ActivateModalArgs) => void;
  setModalConstraint: (axis: GrabAxis | null) => void;
  applyModalParams: (params: ParamsMap) => void;
  confirmModal: () => void;
  cancelModal: () => void;
  // Alt+G/R/S — reset corresponding transform on nearest ancestor.
  resetTransform: (mode: ModalMode) => boolean;
  // Shift+D — duplicate selected (deep-clone subtree, place as sibling).
  duplicateSelected: () => void;
  // Tree collapse/expand
  toggleCollapsed: (id: NodeId) => void;
  // Serialization
  loadTree: (tree: SdfNode | null) => void;
  serializeTree: () => string;
};

export const useStore = create<StoreState>((set, get) => ({
  root: null,
  selectedId: null,
  dragSource: null,
  modalMode: null,
  modalState: null,
  collapsedIds: {},

  selectNode: (id) => set({ selectedId: id }),
  reset: () =>
    set({
      root: null,
      selectedId: null,
      dragSource: null,
      modalMode: null,
      modalState: null,
      collapsedIds: {},
    }),

  addPrimitive: (type) => {
    const { root, selectedId } = get();
    const prim = makePrimitive(type);
    if (!root) {
      set({ root: prim, selectedId: prim.id });
      return;
    }
    if (!selectedId) return;
    const found = findById(root, selectedId);
    if (!found) return;
    const target = found.node;
    if (target.kind === "boolean") {
      const updated = { ...target, children: [...target.children, prim] };
      set({ root: found.update(updated), selectedId: prim.id });
    } else if (target.kind === "transform" && !target.child) {
      const updated = { ...target, child: prim };
      set({ root: found.update(updated), selectedId: prim.id });
    } else {
      set({ root: found.update(prim), selectedId: prim.id });
    }
  },

  addTransform: (type) => {
    const { root, selectedId } = get();
    if (!root) {
      const wrap = makeTransform(type, null);
      set({ root: wrap, selectedId: wrap.id });
      return;
    }
    if (!selectedId) {
      const wrap = makeTransform(type, root);
      set({ root: wrap, selectedId: wrap.id });
      return;
    }
    const found = findById(root, selectedId);
    if (!found) return;
    const wrap = makeTransform(type, found.node);
    set({ root: found.update(wrap), selectedId: wrap.id });
  },

  addBoolean: (type) => {
    const { root, selectedId } = get();
    if (!root) {
      const b = makeBoolean(type, []);
      set({ root: b, selectedId: b.id });
      return;
    }
    if (!selectedId) {
      const sphere = makePrimitive("sphere");
      const b = makeBoolean(type, [root, sphere]);
      set({ root: b, selectedId: b.id });
      return;
    }
    const found = findById(root, selectedId);
    if (!found) return;
    const sphere = makePrimitive("sphere");
    const b = makeBoolean(type, [found.node, sphere]);
    set({ root: found.update(b), selectedId: b.id });
  },

  removeNode: (id) => {
    const { root } = get();
    if (!root) return;

    // Replacement node for a removed `node`, preserving children when possible.
    // For booleans with 2+ children, parentBoolType is used to decide whether
    // to splice into the parent (return null) or wrap into a Union.
    const computeReplacement = (
      node: SdfNode,
      parent: SdfNode | null,
    ): SdfNode | null => {
      if (node.kind === "primitive") return null;
      if (node.kind === "transform") return node.child;
      // boolean
      if (node.children.length === 0) return null;
      if (node.children.length === 1) return node.children[0];
      // 2+ children: splice into same-type boolean parent, else wrap in Union.
      if (parent && parent.kind === "boolean" && parent.type === node.type) {
        // Splice signal: handled outside this function.
        return null; // caller will splice
      }
      return makeBoolean("union", node.children);
    };

    if (root.id === id) {
      const replacement = computeReplacement(root, null);
      set({ root: replacement, selectedId: replacement?.id ?? null });
      return;
    }

    const parent = findParentOf(root, id);
    const found = findById(root, id);
    if (!found || !parent) return;
    const node = found.node;

    // Special case: 2+ children boolean inside same-type boolean parent → splice.
    if (
      node.kind === "boolean" &&
      node.children.length >= 2 &&
      parent.kind === "boolean" &&
      parent.type === node.type
    ) {
      const parentFound = findById(root, parent.id);
      if (!parentFound || parentFound.node.kind !== "boolean") return;
      const childIdx = parentFound.node.children.findIndex((c) => c.id === id);
      if (childIdx < 0) return;
      const newChildren = parentFound.node.children.slice();
      newChildren.splice(childIdx, 1, ...node.children);
      set({
        root: parentFound.update({ ...parentFound.node, children: newChildren }),
        selectedId: null,
      });
      return;
    }

    const replacement = computeReplacement(node, parent);
    set({
      root: found.update(replacement),
      selectedId: replacement?.id ?? null,
    });
  },

  toggleEnabled: (id) => {
    const { root } = get();
    if (!root) return;
    const found = findById(root, id);
    if (!found) return;
    const updated = { ...found.node, enabled: !found.node.enabled };
    set({ root: found.update(updated) });
  },

  changeNodeType: (id, newType) => {
    const { root } = get();
    if (!root) return;
    const found = findById(root, id);
    if (!found) return;
    const node = found.node;
    const newSpec = getSpec(newType);
    if (!newSpec || newSpec.kind !== node.kind) return;
    if (newType === node.type) return;

    let updated: SdfNode;
    if (node.kind === "primitive") {
      updated = { ...node, type: newType as PrimitiveType, params: defaultParams(newType) };
    } else if (node.kind === "transform") {
      updated = { ...node, type: newType as TransformType, params: defaultParams(newType) };
    } else {
      updated = { ...node, type: newType as BooleanType, params: defaultParams(newType) };
    }
    set({ root: found.update(updated) });
  },

  updateParam: (id, key, value) => {
    const { root } = get();
    if (!root) return;
    const found = findById(root, id);
    if (!found) return;
    const node = found.node;
    const updated = { ...node, params: { ...node.params, [key]: value } } as SdfNode;
    set({ root: found.update(updated) });
  },

  // --- drag ---

  startDragExisting: (id) => set({ dragSource: { kind: "existing", sourceId: id } }),
  startDragLibrary: (specType, specKind) =>
    set({ dragSource: { kind: "library", specType, specKind } }),
  clearDrag: () => set({ dragSource: null }),

  canDrop: (targetId, position) => {
    const { root, dragSource } = get();
    if (!root || !dragSource) return false;
    const target = findById(root, targetId)?.node;
    if (!target) return false;

    if (dragSource.kind === "existing") {
      if (dragSource.sourceId === targetId) return false;
      const sourceNode = findById(root, dragSource.sourceId)?.node;
      if (!sourceNode) return false;
      const ids = new Set<NodeId>();
      collectIds(sourceNode, ids);
      if (ids.has(targetId)) return false;
    }

    if (position === "inside") {
      if (target.kind === "boolean") return true;
      if (target.kind === "transform" && !target.child) return true;
      return false;
    }
    if (target.id === root.id) return false;
    const parent = findParentOf(root, targetId);
    return parent?.kind === "boolean";
  },

  commitDrop: (targetId, position) => {
    const { dragSource, root } = get();
    if (!dragSource || !root || !get().canDrop(targetId, position)) {
      set({ dragSource: null });
      return false;
    }

    let source: SdfNode;
    let workingRoot: SdfNode | null = root;

    if (dragSource.kind === "existing") {
      const det = detachNode(root, dragSource.sourceId);
      if (!det.detached) {
        set({ dragSource: null });
        return false;
      }
      source = det.detached;
      workingRoot = det.rest;
    } else {
      source = createFromLibrary(dragSource.specType, dragSource.specKind);
    }

    if (!workingRoot) {
      set({ dragSource: null });
      return false;
    }
    const attached = attachNode(workingRoot, source, targetId, position);
    if (!attached) {
      set({ dragSource: null });
      return false;
    }
    set({ root: attached, selectedId: source.id, dragSource: null });
    return true;
  },

  // --- modal transform ---

  armModal: (mode) => {
    const state = get();
    if (!state.selectedId || !state.root) return;
    if (state.modalState) return; // already active
    set({ modalMode: mode, modalState: null });
  },

  disarmModal: () => {
    set({ modalMode: null, modalState: null });
  },

  activateModal: (args) => {
    const state = get();
    if (!state.modalMode || state.modalState) return;
    const mode = state.modalMode;
    const targetType = MODE_TO_TRANSFORM_TYPE[mode];
    const { root, selectedId } = state;
    if (!root || !selectedId) {
      set({ modalMode: null });
      return;
    }
    const found = findById(root, selectedId);
    if (!found) {
      set({ modalMode: null });
      return;
    }

    let workingRoot: SdfNode | null = root;
    let targetId: NodeId;
    let createdByModal: boolean;

    // For rotate/scale: insert/reuse INSIDE the deepest Translate ancestor so
    // the pivot is the chain origin (visual centre), not the world origin.
    // For grab: wrap the selected node directly (a new Translate IS the move).
    let anchorTranslate: SdfNode | null = null;
    if (mode === "rotate" || mode === "scale") {
      const path = pathFromRootTo(root, selectedId);
      for (let i = path.length - 1; i >= 0; i--) {
        const n = path[i];
        if (n.kind === "transform" && n.type === "translate") {
          anchorTranslate = n;
          break;
        }
      }
    }

    if (
      anchorTranslate &&
      anchorTranslate.kind === "transform" &&
      anchorTranslate.child &&
      anchorTranslate.child.kind === "transform" &&
      anchorTranslate.child.type === targetType
    ) {
      // Reuse existing transform of the right type already inside the anchor.
      targetId = anchorTranslate.child.id;
      createdByModal = false;
    } else if (anchorTranslate && anchorTranslate.kind === "transform") {
      // Insert new transform between the anchor Translate and its current child.
      const newWrap = makeTransform(targetType, anchorTranslate.child);
      const anchorFound = findById(root, anchorTranslate.id);
      if (!anchorFound) {
        set({ modalMode: null });
        return;
      }
      const anchorUpdated = {
        ...anchorFound.node,
        child: newWrap,
      } as SdfNode;
      workingRoot = anchorFound.update(anchorUpdated);
      targetId = newWrap.id;
      createdByModal = true;
    } else if (
      found.node.kind === "transform" &&
      found.node.type === targetType
    ) {
      targetId = found.node.id;
      createdByModal = false;
    } else {
      // No Translate ancestor (or mode === grab): wrap selected directly.
      const wrap = makeTransform(targetType, found.node);
      workingRoot = found.update(wrap);
      targetId = wrap.id;
      createdByModal = true;
    }

    if (!workingRoot) {
      set({ modalMode: null });
      return;
    }
    const tFound = findById(workingRoot, targetId);
    if (!tFound) {
      set({ modalMode: null });
      return;
    }
    const originalParams = { ...tFound.node.params };
    const { chainOrigin, parentRotation, parentScale } =
      computeChainSnapshot(workingRoot, targetId);

    set({
      root: workingRoot,
      selectedId: targetId,
      modalState: {
        mode,
        nodeId: targetId,
        createdByModal,
        originalRoot: createdByModal ? root : null,
        originalSelectedId: selectedId,
        originalParams,
        startMouseX: args.startMouseX,
        startMouseY: args.startMouseY,
        cameraEye: args.cameraEye,
        cameraTarget: args.cameraTarget,
        cameraUp: args.cameraUp,
        canvasWidth: args.canvasWidth,
        canvasHeight: args.canvasHeight,
        chainOrigin,
        parentRotation,
        parentScale,
        constraint: null,
      },
    });
  },

  setModalConstraint: (axis) => {
    const cur = get().modalState;
    if (!cur) return;
    set({ modalState: { ...cur, constraint: axis } });
  },

  applyModalParams: (params) => {
    const state = get();
    const m = state.modalState;
    if (!m || !state.root) return;
    const found = findById(state.root, m.nodeId);
    if (!found) return;
    const updated = {
      ...found.node,
      params: { ...found.node.params, ...params },
    } as SdfNode;
    set({ root: found.update(updated) });
  },

  confirmModal: () => {
    set({ modalMode: null, modalState: null });
  },

  duplicateSelected: () => {
    const state = get();
    if (!state.root || !state.selectedId) return;
    const found = findById(state.root, state.selectedId);
    if (!found) return;
    const clone = cloneNode(found.node);

    const parent = findParentOf(state.root, state.selectedId);
    if (parent && parent.kind === "boolean") {
      // Insert as next sibling in parent's children.
      const parentFound = findById(state.root, parent.id);
      if (!parentFound || parentFound.node.kind !== "boolean") return;
      const idx = parentFound.node.children.findIndex(
        (c) => c.id === state.selectedId,
      );
      if (idx < 0) return;
      const newChildren = parentFound.node.children.slice();
      newChildren.splice(idx + 1, 0, clone);
      set({
        root: parentFound.update({
          ...parentFound.node,
          children: newChildren,
        }),
        selectedId: clone.id,
      });
      return;
    }

    // Otherwise (root or inside Transform): wrap in Union(original, clone).
    const union = makeBoolean("union", [found.node, clone]);
    set({ root: found.update(union), selectedId: clone.id });
  },

  loadTree: (tree) => {
    if (!tree) {
      set({ root: null, selectedId: null, collapsedIds: {} });
      return;
    }
    // Deep-clone via cloneNode → new IDs, so we never collide with current tree.
    const fresh = cloneNode(tree);
    set({
      root: fresh,
      selectedId: fresh.id,
      collapsedIds: {},
      modalMode: null,
      modalState: null,
      dragSource: null,
    });
  },

  serializeTree: () => {
    const { root } = get();
    return JSON.stringify(root, null, 2);
  },

  toggleCollapsed: (id) => {
    const cur = get().collapsedIds;
    const next = { ...cur };
    if (next[id]) delete next[id];
    else next[id] = true;
    set({ collapsedIds: next });
  },

  resetTransform: (mode) => {
    const state = get();
    if (!state.root || !state.selectedId) return false;
    const targetType = MODE_TO_TRANSFORM_TYPE[mode];
    const ancestor = findAncestorOfType(state.root, state.selectedId, targetType);
    if (!ancestor) return false;
    const found = findById(state.root, ancestor.id);
    if (!found) return false;
    const defaults = defaultParams(targetType);
    const updated = {
      ...found.node,
      params: { ...found.node.params, ...defaults },
    } as SdfNode;
    set({ root: found.update(updated) });
    return true;
  },

  cancelModal: () => {
    const m = get().modalState;
    if (!m) {
      set({ modalMode: null });
      return;
    }
    if (m.createdByModal && m.originalRoot) {
      set({
        root: m.originalRoot,
        selectedId: m.originalSelectedId,
        modalMode: null,
        modalState: null,
      });
      return;
    }
    // Restore params only.
    const { root } = get();
    if (!root) {
      set({ modalMode: null, modalState: null });
      return;
    }
    const found = findById(root, m.nodeId);
    if (found) {
      const updated = {
        ...found.node,
        params: m.originalParams,
      } as SdfNode;
      set({
        root: found.update(updated),
        selectedId: m.originalSelectedId,
        modalMode: null,
        modalState: null,
      });
    } else {
      set({ modalMode: null, modalState: null });
    }
  },

  commitDropAsRoot: () => {
    const { dragSource, root } = get();
    if (!dragSource || root) {
      set({ dragSource: null });
      return false;
    }
    if (dragSource.kind !== "library") {
      set({ dragSource: null });
      return false;
    }
    const node = createFromLibrary(dragSource.specType, dragSource.specKind);
    set({ root: node, selectedId: node.id, dragSource: null });
    return true;
  },
}));

export function getLabel(type: string): string {
  if (type in PRIMITIVES) return PRIMITIVES[type as PrimitiveType].spec.label;
  if (type in BOOLEANS) return BOOLEANS[type as BooleanType].spec.label;
  if (type in TRANSFORMS) return TRANSFORMS[type as TransformType].spec.label;
  return type;
}
