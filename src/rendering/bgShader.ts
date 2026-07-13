// Dithered vertical background gradient. The zone palettes are dark colors
// only a few 8-bit steps apart, so a plain LinearGradient quantizes into
// visible horizontal bands on tall screens. This shader computes the same
// gradient per pixel and adds ±0.75/255 of hash noise — far below visibility,
// but enough to break the bands into smooth grain.

import { Skia } from '@shopify/react-native-skia';

const source = Skia.RuntimeEffect.Make(`
uniform float2 uRes;
uniform float3 uTop;
uniform float3 uBottom;

half4 main(float2 xy) {
  float t = clamp(xy.y / uRes.y, 0.0, 1.0);
  float3 c = mix(uTop, uBottom, t);
  float n = fract(sin(dot(xy, float2(12.9898, 78.233))) * 43758.5453) - 0.5;
  c += n * (1.5 / 255.0);
  return half4(half3(c), 1.0);
}`);
if (!source) throw new Error('bg shader failed to compile');

export const BG_SHADER = source;

/** '#RRGGBB' → [r, g, b] in 0..1, the shader's uniform format. */
export function hexToRgb01(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}
