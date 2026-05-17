"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { emitOSL } from "@/lib/osl/emit";

export function CodePanel() {
  const root = useStore((s) => s.root);
  const [copied, setCopied] = useState(false);

  const result = useMemo(() => emitOSL(root), [root]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 h-9 shrink-0 border-b border-border bg-panel-2">
        <h2 className="text-muted-foreground uppercase tracking-wider text-[10px] font-semibold">
          OSL Output
        </h2>
        <button
          type="button"
          onClick={handleCopy}
          className="px-2 py-0.5 text-[10px] rounded-sm border border-border text-muted-foreground hover:text-foreground hover:border-border-strong transition-colors"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        className="flex-1 min-h-0 overflow-auto p-3 text-[11px] leading-relaxed whitespace-pre text-foreground"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {result.code}
      </pre>
    </div>
  );
}
