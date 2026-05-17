"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStore, type DropPosition, type DragSource } from "@/lib/store";
import { getLabel } from "@/lib/store";
import { TreeNodeView } from "./TreeNodeView";

type DragUI = {
  cursorX: number;
  cursorY: number;
  targetId: string | null;
  position: DropPosition | null;
  valid: boolean;
};

export function TreePanel() {
  const root = useStore((s) => s.root);
  const dragSource = useStore((s) => s.dragSource);
  const selectNode = useStore((s) => s.selectNode);
  const startDragExisting = useStore((s) => s.startDragExisting);
  const commitDrop = useStore((s) => s.commitDrop);
  const commitDropAsRoot = useStore((s) => s.commitDropAsRoot);
  const clearDrag = useStore((s) => s.clearDrag);
  const canDrop = useStore((s) => s.canDrop);

  const [dragUI, setDragUI] = useState<DragUI | null>(null);
  const dragUIRef = useRef<DragUI | null>(null);
  dragUIRef.current = dragUI;
  const dragSourceRef = useRef<DragSource | null>(null);
  dragSourceRef.current = dragSource;
  const emptyZoneRef = useRef<HTMLDivElement | null>(null);

  // Pointer-down inside the tree for an existing node — wire via callback.
  const startExistingDrag = useCallback(
    (id: string, e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const startX = e.clientX;
      const startY = e.clientY;
      let started = false;
      const THRESH = 5;
      const onMove = (ev: PointerEvent) => {
        if (started) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (dx * dx + dy * dy > THRESH * THRESH) {
          started = true;
          startDragExisting(id);
        }
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [startDragExisting],
  );

  // Global pointer listeners are only attached while a drag is in progress.
  useEffect(() => {
    if (!dragSource) {
      setDragUI(null);
      return;
    }

    const onMove = (e: PointerEvent) => {
      let targetId: string | null = null;
      let position: DropPosition | null = null;
      let valid = false;

      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const row = el?.closest("[data-tree-node-id]") as HTMLElement | null;
      if (row) {
        targetId = row.dataset.treeNodeId ?? null;
        if (targetId) {
          const rect = row.getBoundingClientRect();
          const rel = (e.clientY - rect.top) / rect.height;
          const insideOk = canDrop(targetId, "inside");
          const beforeOk = canDrop(targetId, "before");
          const afterOk = canDrop(targetId, "after");
          if (rel < 0.33 && beforeOk) {
            position = "before";
            valid = true;
          } else if (rel > 0.66 && afterOk) {
            position = "after";
            valid = true;
          } else if (insideOk) {
            position = "inside";
            valid = true;
          } else if (beforeOk) {
            position = "before";
            valid = true;
          } else if (afterOk) {
            position = "after";
            valid = true;
          } else {
            position = "inside";
            valid = false;
          }
        }
      } else if (!root && emptyZoneRef.current) {
        // Library drag onto empty tree → drop becomes new root.
        const zone = emptyZoneRef.current.getBoundingClientRect();
        if (
          e.clientX >= zone.left &&
          e.clientX <= zone.right &&
          e.clientY >= zone.top &&
          e.clientY <= zone.bottom &&
          dragSourceRef.current?.kind === "library"
        ) {
          targetId = "__root__";
          position = "inside";
          valid = true;
        }
      }

      setDragUI({
        cursorX: e.clientX,
        cursorY: e.clientY,
        targetId,
        position,
        valid,
      });
    };

    const onUp = () => {
      const cur = dragUIRef.current;
      if (cur?.valid && cur.targetId && cur.position) {
        if (cur.targetId === "__root__") {
          commitDropAsRoot();
        } else {
          commitDrop(cur.targetId, cur.position);
        }
      } else {
        clearDrag();
      }
      setDragUI(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragSource, canDrop, commitDrop, commitDropAsRoot, clearDrag, root]);

  if (!root) {
    const libDragActive =
      dragSource?.kind === "library" && dragUI?.targetId === "__root__" && dragUI.valid;
    return (
      <div
        ref={emptyZoneRef}
        className={
          "h-full flex items-center justify-center p-8 transition-colors " +
          (libDragActive ? "bg-primary/10 border-2 border-dashed border-primary" : "")
        }
      >
        <div className="text-center max-w-md pointer-events-none">
          <div className="text-muted-foreground text-[13px] mb-2">SDF Tree</div>
          <p className="text-muted-foreground text-[11px] leading-relaxed">
            {libDragActive
              ? "Drop here to set as root"
              : "Click or drag a primitive from the Library to add a root node."}
          </p>
        </div>
        {dragSource && dragUI?.cursorX != null && (
          <DragGhost
            x={dragUI.cursorX}
            y={dragUI.cursorY}
            label={dragLabel(dragSource)}
            valid={dragUI.valid}
          />
        )}
      </div>
    );
  }

  const sourceId = dragSource?.kind === "existing" ? dragSource.sourceId : null;

  return (
    <div
      className="h-full overflow-y-auto p-3 relative select-none"
      onClick={() => {
        if (!dragSource) selectNode(null);
      }}
    >
      <h2 className="text-muted-foreground uppercase tracking-wider text-[10px] font-semibold mb-3 px-1">
        SDF Tree
      </h2>
      <TreeNodeView
        node={root}
        onStartDrag={startExistingDrag}
        dragSourceId={sourceId}
        dragTargetId={dragUI?.targetId ?? null}
        dragPosition={dragUI?.position ?? null}
        dragValid={dragUI?.valid ?? false}
      />

      {dragSource && dragUI?.cursorX != null && (
        <DragGhost
          x={dragUI.cursorX}
          y={dragUI.cursorY}
          label={dragLabel(dragSource)}
          valid={dragUI.valid}
        />
      )}
    </div>
  );
}

function dragLabel(src: DragSource): string {
  if (src.kind === "existing") {
    const root = useStore.getState().root;
    return (root && findLabel(root, src.sourceId)) ?? "Node";
  }
  return getLabel(src.specType);
}

function findLabel(root: import("@/lib/types").SdfNode, id: string): string | null {
  if (root.id === id) return getLabel(root.type);
  if (root.kind === "transform" && root.child) return findLabel(root.child, id);
  if (root.kind === "boolean") {
    for (const c of root.children) {
      const r = findLabel(c, id);
      if (r) return r;
    }
  }
  return null;
}

function DragGhost({
  x,
  y,
  label,
  valid,
}: {
  x: number;
  y: number;
  label: string;
  valid: boolean;
}) {
  return (
    <div
      className="fixed pointer-events-none z-50 px-2 py-1 rounded-sm text-[11px] shadow-lg"
      style={{
        left: x + 12,
        top: y + 8,
        background: valid ? "var(--ob-blue)" : "var(--ob-danger)",
        color: "white",
      }}
    >
      {label}
    </div>
  );
}
