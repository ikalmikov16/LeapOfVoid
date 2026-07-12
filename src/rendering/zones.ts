// Zone flavor: background palettes + names, cycled every ZONE_SIZE planets.
// Names are placeholders — rename freely, nothing else references them.

export interface ZonePalette {
  name: string;
  bgTop: string;
  bgBottom: string;
}

export const ZONES: readonly ZonePalette[] = [
  { name: 'THE VOID', bgTop: '#0B0B22', bgBottom: '#050510' },
  { name: 'EMBER FIELD', bgTop: '#2A1216', bgBottom: '#120709' },
  { name: 'VIOLET DEEP', bgTop: '#1F0F38', bgBottom: '#0C0618' },
  { name: 'FROSTBITE', bgTop: '#0B2238', bgBottom: '#051019' },
  { name: 'GOLDEN WASTES', bgTop: '#2B1F0E', bgBottom: '#110C05' },
  { name: 'CRIMSON DRIFT', bgTop: '#2E0D17', bgBottom: '#130509' },
];

export function zonePalette(zoneIndex: number): ZonePalette {
  'worklet';
  return ZONES[zoneIndex % ZONES.length];
}
