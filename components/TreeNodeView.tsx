"use client";

import { getLabel, useStore, type DropPosition } from "@/lib/store";
import type { SdfNode } from "@/lib/types";

const KIND_DOT: Record<SdfNode["kind"], string> = {
  primitive: "bg-success",
  boolean: "bg-primary",
  transform: "bg-[#e0b144]",
};

export function TreeNodeView({
  node,
  depth = 0,
  onStartDrag,
  dragSourceId,
  dragTargetId,
  dragPosition,
  dragValid,
}: {
  node: SdfNode;
  depth?: number;
  onStartDrag: (id: string, e: React.PointerEvent) => void;
  dragSourceId: string | null;
  dragTargetId: string | null;
  dragPosition: DropPosition | null;
  dragValid: boolean;
}) {
  const selectedId = useStore((s) => s.selectedId);
  const selectNode = useStore((s) => s.selectNode);
  const removeNode = useStore((s) => s.removeNode);
  const toggleEnabled = useStore((s) => s.toggleEnabled);
  const collapsed = useStore((s) => !!s.collapsedIds[node.id]);
  const toggleCollapsed = useStore((s) => s.toggleCollapsed);

  const isSelected = selectedId === node.id;
  const isSource = dragSourceId === node.id;
  const isTarget = dragTargetId === node.id;
  const showBefore = isTarget && dragPosition === "before" && dragValid;
  const showAfter = isTarget && dragPosition === "after" && dragValid;
  const showInside = isTarget && dragPosition === "inside" && dragValid;
  const showInvalid = isTarget && !dragValid;

  const hasChildren =
    (node.kind === "boolean" && node.children.length > 0) ||
    (node.kind === "transform" && node.child !== null);

  return (
    <div className="relative">
      {showBefore && (
        <div
          className="absolute left-0 right-0 h-[2px] bg-primary z-10"
          style={{ marginLeft: depth * 14, top: -1 }}
        />
      )}
      <div
        data-tree-node-id={node.id}
        className={
          "flex items-center gap-1 py-1 px-1.5 rounded-sm text-[11px] transition-colors " +
          (isSelected
            ? "bg-primary/20 border border-primary"
            : "border border-transparent hover:bg-panel-2") +
          (isSource ? " opacity-40" : "") +
          (showInside ? " !bg-primary/30 !border-primary" : "") +
          (showInvalid ? " !border-destructive" : "") +
          " cursor-grab active:cursor-grabbing"
        }
        style={{ marginLeft: depth * 14 }}
        onPointerDown={(e) => {
          const tgt = e.target as HTMLElement;
          if (tgt.closest("[data-row-action]")) return;
          onStartDrag(node.id, e);
        }}
        onClick={(e) => {
          e.stopPropagation();
          selectNode(node.id);
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            data-row-action
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapsed(node.id);
            }}
            className="text-muted-foreground hover:text-foreground text-[9px] w-3 leading-none shrink-0"
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? "▶" : "▼"}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span
          className={
            "w-1.5 h-1.5 rounded-full shrink-0 " +
            (node.enabled ? KIND_DOT[node.kind] : "bg-border-strong")
          }
        />
        <span
          className={
            "flex-1 truncate " +
            (node.enabled ? "text-foreground" : "text-muted-foreground line-through")
          }
        >
          {getLabel(node.type)}
        </span>
        <button
          type="button"
          data-row-action
          onClick={(e) => {
            e.stopPropagation();
            toggleEnabled(node.id);
          }}
          className="text-muted-foreground hover:text-foreground text-[10px] px-1"
          title={node.enabled ? "Disable" : "Enable"}
        >
          {node.enabled ? "●" : "○"}
        </button>
        <button
          type="button"
          data-row-action
          onClick={(e) => {
            e.stopPropagation();
            removeNode(node.id);
          }}
          className="text-muted-foreground hover:text-destructive text-[12px] px-1 leading-none"
          title="Delete"
        >
          ×
        </button>
      </div>
      {showAfter && (
        <div
          className="absolute left-0 right-0 h-[2px] bg-primary z-10"
          style={{ marginLeft: depth * 14, bottom: -1 }}
        />
      )}

      {!collapsed && node.kind === "transform" && node.child && (
        <TreeNodeView
          node={node.child}
          depth={depth + 1}
          onStartDrag={onStartDrag}
          dragSourceId={dragSourceId}
          dragTargetId={dragTargetId}
          dragPosition={dragPosition}
          dragValid={dragValid}
        />
      )}
      {!collapsed &&
        node.kind === "boolean" &&
        node.children.map((c) => (
          <TreeNodeView
            key={c.id}
            node={c}
            depth={depth + 1}
            onStartDrag={onStartDrag}
            dragSourceId={dragSourceId}
            dragTargetId={dragTargetId}
            dragPosition={dragPosition}
            dragValid={dragValid}
          />
        ))}
    </div>
  );
}
