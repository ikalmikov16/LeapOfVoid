// Zone flavor: background palettes + names, cycled every ZONE_SIZE planets.
// Names are placeholders — rename freely, nothing else references them.

export interface ZonePalette {
  name: string;
  bgTop: string;
  bgBottom: string;
}

export const ZONES: readonly ZonePalette[] = [
  { name: 'THE VOID', bgTop: '#0B0B22', bgBottom: '#050510' },
  { name: 'EMBER FIELD', bgTop: '#1E0E12', bgBottom: '#0A0507' },
  { name: 'VIOLET DEEP', bgTop: '#170B2A', bgBottom: '#090412' },
  { name: 'FROSTBITE', bgTop: '#08182A', bgBottom: '#030A12' },
  { name: 'GOLDEN WASTES', bgTop: '#20170A', bgBottom: '#0C0904' },
  { name: 'CRIMSON DRIFT', bgTop: '#230A12', bgBottom: '#0E0407' },
];

export function zonePalette(zoneIndex: number): ZonePalette {
  'worklet';
  return ZONES[zoneIndex % ZONES.length];
}
