// Pure colour helpers — no Skia imports, so zones.ts (and through it the clip
// composer in scripts/clips/compose/) can load outside React Native.

/** '#RRGGBB' → [r, g, b] in 0..1, the shader's uniform format. */
export function hexToRgb01(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}
