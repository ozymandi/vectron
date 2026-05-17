"use client";

import { useEffect, useState } from "react";

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 0.1,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [draft, setDraft] = useState<string>(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = (s: string) => {
    let n = parseFloat(s);
    if (!Number.isFinite(n)) n = value;
    if (typeof min === "number") n = Math.max(min, n);
    if (typeof max === "number") n = Math.min(max, n);
    onChange(n);
    setDraft(String(n));
  };

  return (
    <input
      type="number"
      step={step}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="w-full bg-input-background border border-transparent hover:border-border focus:border-primary focus:outline-none rounded-sm px-2 py-1 text-[11px] text-foreground"
    />
  );
}
