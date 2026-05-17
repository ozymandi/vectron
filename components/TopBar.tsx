"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { emitOSL } from "@/lib/osl/emit";
import { PRESETS } from "@/lib/presets";
import type { SdfNode } from "@/lib/types";

const STORAGE_KEY = "vectron-formula-gen.tree";

export function TopBar() {
  const root = useStore((s) => s.root);
  const reset = useStore((s) => s.reset);
  const loadTree = useStore((s) => s.loadTree);
  const serializeTree = useStore((s) => s.serializeTree);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [presetsOpen, setPresetsOpen] = useState(false);

  // Auto-save current tree to localStorage on change.
  useEffect(() => {
    try {
      if (root) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(root));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // ignore quota / private-mode errors
    }
  }, [root]);

  // Restore last tree from localStorage on first mount (only if nothing is loaded).
  useEffect(() => {
    if (root) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SdfNode;
      loadTree(parsed);
    } catch {
      // corrupt JSON — drop silently
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close preset menu on outside click.
  useEffect(() => {
    if (!presetsOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-preset-menu]")) setPresetsOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [presetsOpen]);

  const handleNew = () => {
    if (root && !confirm("Discard the current tree?")) return;
    reset();
  };

  const handleExportOsl = () => {
    const { code } = emitOSL(root);
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    triggerDownload(blob, "vectron.osl");
  };

  const handleSaveJson = () => {
    if (!root) {
      alert("Tree is empty — nothing to save.");
      return;
    }
    const json = serializeTree();
    const blob = new Blob([json], { type: "application/json" });
    triggerDownload(blob, "vectron-tree.json");
  };

  const handleLoadJson = () => fileInputRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow loading the same file twice
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as SdfNode;
      if (!parsed || typeof parsed !== "object" || !("kind" in parsed)) {
        alert("Invalid tree file.");
        return;
      }
      if (root && !confirm("Replace the current tree?")) return;
      loadTree(parsed);
    } catch (err) {
      alert("Failed to load: " + (err as Error).message);
    }
  };

  const handlePreset = (presetKey: string) => {
    const preset = PRESETS.find((p) => p.key === presetKey);
    if (!preset) return;
    if (root && !confirm("Replace the current tree with " + preset.name + "?")) {
      setPresetsOpen(false);
      return;
    }
    loadTree(preset.tree);
    setPresetsOpen(false);
  };

  return (
    <header className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-border bg-panel-2">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-primary" />
        <h1 className="text-[13px] font-semibold tracking-wide">
          Vectron Formula Generator
        </h1>
        <span className="text-[11px] text-muted-foreground ml-2">
          Octane OSL · compiler 2026.1
        </span>
      </div>
      <nav className="flex items-center gap-1">
        <ToolbarButton label="New" onClick={handleNew} />
        <div className="relative" data-preset-menu>
          <ToolbarButton
            label={"Presets ▾"}
            onClick={() => setPresetsOpen((v) => !v)}
          />
          {presetsOpen && (
            <div className="absolute right-0 top-full mt-1 w-64 bg-card border border-border rounded-sm shadow-lg z-50 overflow-hidden">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => handlePreset(p.key)}
                  className="w-full text-left px-3 py-2 text-[11px] hover:bg-panel-2 transition-colors border-b border-border last:border-b-0"
                >
                  <div className="text-foreground">{p.name}</div>
                  <div className="text-muted-foreground text-[10px] mt-0.5">
                    {p.description}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <ToolbarButton label="Save .json" onClick={handleSaveJson} />
        <ToolbarButton label="Load .json" onClick={handleLoadJson} />
        <ToolbarButton label="Export .osl" primary onClick={handleExportOsl} />
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={onFile}
        />
      </nav>
    </header>
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function ToolbarButton({
  label,
  primary,
  onClick,
}: {
  label: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "px-3 py-1.5 text-[11px] rounded-sm border transition-colors " +
        (primary
          ? "bg-primary border-primary text-primary-foreground hover:bg-primary-hover"
          : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-border-strong")
      }
    >
      {label}
    </button>
  );
}
