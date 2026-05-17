"use client";

export type SelectGroup = {
  label: string;
  options: { value: string; label: string }[];
};

export function Select({
  value,
  onChange,
  groups,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  groups?: SelectGroup[];
  options?: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none bg-input-background border border-transparent hover:border-border focus:border-primary focus:outline-none rounded-sm pl-2 pr-7 py-1 text-[11px] text-foreground cursor-pointer"
      >
        {groups
          ? groups.map((g) => (
              <optgroup key={g.label} label={g.label} className="bg-card">
                {g.options.map((o) => (
                  <option key={o.value} value={o.value} className="bg-card">
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))
          : options?.map((o) => (
              <option key={o.value} value={o.value} className="bg-card">
                {o.label}
              </option>
            ))}
      </select>
      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-[9px] pointer-events-none">
        ▾
      </span>
    </div>
  );
}
