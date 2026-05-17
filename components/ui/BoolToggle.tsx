"use client";

export function BoolToggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={
        "px-2 py-1 text-[11px] rounded-sm border transition-colors " +
        (value
          ? "bg-primary border-primary text-primary-foreground"
          : "bg-input-background border-border text-muted-foreground hover:text-foreground hover:border-border-strong")
      }
    >
      {label}
    </button>
  );
}
