"use client";

import { NumberInput } from "./NumberInput";

export function Vec3Input({
  value,
  onChange,
  step = 0.1,
}: {
  value: [number, number, number];
  onChange: (v: [number, number, number]) => void;
  step?: number;
}) {
  const update = (idx: 0 | 1 | 2, n: number) => {
    const next: [number, number, number] = [value[0], value[1], value[2]];
    next[idx] = n;
    onChange(next);
  };
  return (
    <div className="grid grid-cols-3 gap-1">
      {(["X", "Y", "Z"] as const).map((axis, i) => (
        <div key={axis} className="relative">
          <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground pointer-events-none uppercase">
            {axis}
          </span>
          <div className="pl-4">
            <NumberInput
              value={value[i]}
              step={step}
              onChange={(n) => update(i as 0 | 1 | 2, n)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
