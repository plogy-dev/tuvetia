import type { CSSProperties } from "react";

/** Variables CSS del motor de entrada (`--i` orden, `--y` distancia,
 *  `--d` duración, `--gap` separación) como style de React. */
export function v(
  o: Partial<Record<"i" | "y" | "d" | "gap", string | number>>,
  extra?: CSSProperties,
): CSSProperties {
  const s: Record<string, string | number> = {};
  for (const [k, val] of Object.entries(o)) s[`--${k}`] = val;
  return { ...s, ...extra } as CSSProperties;
}
