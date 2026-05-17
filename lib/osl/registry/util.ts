import type { ParamsMap } from "../../types";

export function f(n: number): string {
  if (!Number.isFinite(n)) return "0.0";
  if (Number.isInteger(n)) return `${n}.0`;
  return `${parseFloat(n.toFixed(6))}`;
}

export function vec(v: [number, number, number]): string {
  return `vector(${f(v[0])}, ${f(v[1])}, ${f(v[2])})`;
}

export function getFloat(params: ParamsMap, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === "number" ? v : fallback;
}

export function getInt(params: ParamsMap, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === "number" ? Math.round(v) : fallback;
}

export function getVec3(
  params: ParamsMap,
  key: string,
  fallback: [number, number, number],
): [number, number, number] {
  const v = params[key];
  return Array.isArray(v) && v.length === 3
    ? (v as [number, number, number])
    : fallback;
}

export function getBool(
  params: ParamsMap,
  key: string,
  fallback: boolean,
): boolean {
  const v = params[key];
  return typeof v === "boolean" ? v : fallback;
}

export function getString(
  params: ParamsMap,
  key: string,
  fallback: string,
): string {
  const v = params[key];
  return typeof v === "string" ? v : fallback;
}
