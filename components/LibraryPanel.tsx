"use client";

import { ALL_SPECS } from "@/lib/osl/registry";
import { useStore } from "@/lib/store";
import type {
  BooleanType,
  NodeKind,
  PrimitiveType,
  TransformType,
} from "@/lib/types";

const CATEGORY_ORDER = [
  "Primitives",
  "Booleans",
  "Transforms",
  "Repetition",
  "Deformations",
] as const;

const DRAG_THRESHOLD = 5;

export function LibraryPanel() {
  const addPrimitive = useStore((s) => s.addPrimitive);
  const addBoolean = useStore((s) => s.addBoolean);
  const addTransform = useStore((s) => s.addTransform);
  const startDragLibrary = useStore((s) => s.startDragLibrary);
  const clearDrag = useStore((s) => s.clearDrag);

  const grouped = new Map<string, typeof ALL_SPECS>();
  for (const cat of CATEGORY_ORDER) grouped.set(cat, []);
  for (const spec of ALL_SPECS) {
    if (!grouped.has(spec.category)) grouped.set(spec.category, []);
    grouped.get(spec.category)!.push(spec);
  }

  const handleClickAdd = (kind: NodeKind, type: string) => {
    if (kind === "primitive") addPrimitive(type as PrimitiveType);
    else if (kind === "boolean") addBoolean(type as BooleanType);
    else if (kind === "transform") addTransform(type as TransformType);
  };

  // Pointer-down handler. Distinguishes click vs drag using a threshold.
  const onItemPointerDown = (
    kind: NodeKind,
    type: string,
    e: React.PointerEvent,
  ) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let dragStarted = false;

    const onMove = (ev: PointerEvent) => {
      if (dragStarted) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
        dragStarted = true;
        startDragLibrary(type, kind);
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!dragStarted) {
        // Plain click — preserve old behaviour.
        handleClickAdd(kind, type);
      } else {
        // TreePanel listens on pointerup too; if drop wasn't valid the drag
        // is cleared there. Defensive clear in case nothing else handled it.
        // We schedule on next tick so TreePanel's commit can run first.
        setTimeout(() => {
          const cur = useStore.getState().dragSource;
          if (cur) clearDrag();
        }, 0);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div className="p-3">
      <h2 className="text-muted-foreground uppercase tracking-wider text-[10px] font-semibold mb-3 px-1">
        Library
      </h2>
      <div className="space-y-4">
        {Array.from(grouped.entries())
          .filter(([, specs]) => specs.length > 0)
          .map(([cat, specs]) => (
            <Section key={cat} title={cat}>
              {specs.map((s) => (
                <LibButton
                  key={s.type}
                  label={s.label}
                  onPointerDown={(e) => onItemPointerDown(s.kind, s.type, e)}
                />
              ))}
            </Section>
          ))}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider mb-1.5 px-1">
        {title}
      </h3>
      <ul className="space-y-0.5">{children}</ul>
    </section>
  );
}

function LibButton({
  label,
  onPointerDown,
}: {
  label: string;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onPointerDown={onPointerDown}
        className="w-full text-left px-2 py-1 rounded-sm text-[11px] text-foreground hover:bg-panel-2 active:bg-hover transition-colors cursor-grab active:cursor-grabbing"
      >
        {label}
      </button>
    </li>
  );
}
