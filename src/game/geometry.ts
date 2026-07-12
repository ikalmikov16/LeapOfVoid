// Pure geometry. No React/Skia/Reanimated imports — must stay testable and
// runnable as Reanimated worklets (hence the 'worklet' directives).

import type { Vec2 } from './types';

export function pointOnCircle(center: Vec2, radius: number, angle: number): Vec2 {
  'worklet';
  return {
    x: center.x + radius * Math.cos(angle),
    y: center.y + radius * Math.sin(angle),
  };
}

export interface SegmentApproach {
  /** Parameter along [a,b] of the closest point, clamped to [0,1]. */
  t: number;
  point: Vec2;
  distance: number;
}

/** Closest approach of segment a→b to point c. */
export function closestApproachOnSegment(a: Vec2, b: Vec2, c: Vec2): SegmentApproach {
  'worklet';
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  let t = 0;
  if (lenSq > 0) {
    t = ((c.x - a.x) * abx + (c.y - a.y) * aby) / lenSq;
    t = Math.max(0, Math.min(1, t));
  }
  const px = a.x + t * abx;
  const py = a.y + t * aby;
  const dx = c.x - px;
  const dy = c.y - py;
  return { t, point: { x: px, y: py }, distance: Math.sqrt(dx * dx + dy * dy) };
}

/**
 * Where segment a→b first enters the circle (center, radius).
 * Returns t in [0,1], 0 if it starts inside, or null if it never enters.
 */
export function segmentCircleEntry(
  a: Vec2,
  b: Vec2,
  center: Vec2,
  radius: number,
): number | null {
  'worklet';
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - center.x;
  const fy = a.y - center.y;
  const A = dx * dx + dy * dy;
  const C = fx * fx + fy * fy - radius * radius;
  if (C < 0) return 0;
  if (A === 0) return null;
  const B = 2 * (fx * dx + fy * dy);
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const t = (-B - Math.sqrt(disc)) / (2 * A);
  return t >= 0 && t <= 1 ? t : null;
}
