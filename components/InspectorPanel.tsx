"use client";

import { useMemo } from "react";
import { ALL_SPECS, getSpec } from "@/lib/osl/registry";
import { getLabel, useStore } from "@/lib/store";
import type { SdfNode } from "@/lib/types";
import { NumberInput } from "./ui/NumberInput";
import { Vec3Input } from "./ui/Vec3Input";
import { BoolToggle } from "./ui/BoolToggle";
import { Select, type SelectGroup } from "./ui/Select";

function findById(root: SdfNode | null, id: string): SdfNode | null {
  if (!root) return null;
  if (root.id === id) return root;
  if (root.kind === "transform") return root.child ? findById(root.child, id) : null;
  if (root.kind === "boolean") {
    for (const c of root.children) {
      const r = findById(c, id);
      if (r) return r;
    }
  }
  return null;
}

const CATEGORY_ORDER = [
  "Primitives",
  "Booleans",
  "Transforms",
  "Repetition",
  "Deformations",
];

function buildTypeOptionsForKind(kind: SdfNode["kind"]): SelectGroup[] {
  const sameKind = ALL_SPECS.filter((s) => s.kind === kind);
  const byCat = new Map<string, typeof sameKind>();
  for (const s of sameKind) {
    if (!byCat.has(s.category)) byCat.set(s.category, []);
    byCat.get(s.category)!.push(s);
  }
  const groups: SelectGroup[] = [];
  for (const cat of CATEGORY_ORDER) {
    const arr = byCat.get(cat);
    if (!arr || arr.length === 0) continue;
    groups.push({
      label: cat,
      options: arr.map((s) => ({ value: s.type, label: s.label })),
    });
  }
  return groups;
}

export function InspectorPanel() {
  const root = useStore((s) => s.root);
  const selectedId = useStore((s) => s.selectedId);
  const updateParam = useStore((s) => s.updateParam);
  const changeNodeType = useStore((s) => s.changeNodeType);
  const setMatId = useStore((s) => s.setMatId);

  const node = useMemo(
    () => (selectedId ? findById(root, selectedId) : null),
    [root, selectedId],
  );

  if (!node) {
    return (
      <div className="p-3">
        <h2 className="text-muted-foreground uppercase tracking-wider text-[10px] font-semibold mb-3 px-1">
          Inspector
        </h2>
        <div className="text-muted-foreground text-[11px] px-1 leading-relaxed">
          Select a node in the tree to edit its parameters here.
        </div>
      </div>
    );
  }

  const spec = getSpec(node.type);
  const hasParams = spec && spec.params.length > 0;
  const typeGroups = buildTypeOptionsForKind(node.kind);
  const showGroups = typeGroups.length > 1;

  return (
    <div className="p-3">
      <h2 className="text-muted-foreground uppercase tracking-wider text-[10px] font-semibold mb-3 px-1">
        Inspector
      </h2>

      <div className="mb-3 px-1">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 capitalize">
          {node.kind}
        </div>
        <Select
          value={node.type}
          onChange={(v) => changeNodeType(node.id, v)}
          groups={showGroups ? typeGroups : undefined}
          options={
            showGroups ? undefined : typeGroups[0]?.options ?? [
              { value: node.type, label: getLabel(node.type) },
            ]
          }
        />
      </div>

      {!hasParams && node.kind !== "primitive" && (
        <div className="text-muted-foreground text-[11px] px-1 leading-relaxed">
          No parameters for this node.
        </div>
      )}

      {node.kind === "primitive" && (
        <div className="px-1 mb-3">
          <label className="block text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">
            Material slot
          </label>
          <NumberInput
            value={node.matId ?? 0}
            min={0}
            max={15}
            step={1}
            onChange={(v) => setMatId(node.id, v)}
          />
          <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
            Selects which slot of an Octane <span className="text-foreground">Composite Material</span> applies when this primitive's surface is visible.
          </p>
        </div>
      )}

      {hasParams && spec && (
        <div className="space-y-3">
          {spec.params.map((p) => {
            const value = node.params[p.key];
            return (
              <div key={p.key} className="px-1">
                <label className="block text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">
                  {p.label}
                </label>
                {p.type === "float" && (
                  <NumberInput
                    value={(value as number) ?? p.default}
                    min={p.min}
                    max={p.max}
                    step={p.step ?? 0.1}
                    onChange={(v) => updateParam(node.id, p.key, v)}
                  />
                )}
                {p.type === "int" && (
                  <NumberInput
                    value={(value as number) ?? p.default}
                    min={p.min}
                    max={p.max}
                    step={1}
                    onChange={(v) =>
                      updateParam(node.id, p.key, Math.round(v))
                    }
                  />
                )}
                {p.type === "vec3" && (
                  <Vec3Input
                    value={
                      (value as [number, number, number]) ?? p.default
                    }
                    step={p.step ?? 0.1}
                    onChange={(v) => updateParam(node.id, p.key, v)}
                  />
                )}
                {p.type === "bool" && (
                  <BoolToggle
                    label={p.label}
                    value={(value as boolean) ?? p.default}
                    onChange={(v) => updateParam(node.id, p.key, v)}
                  />
                )}
                {p.type === "select" && (
                  <Select
                    value={(value as string) ?? p.default}
                    options={p.options}
                    onChange={(v) => updateParam(node.id, p.key, v)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
