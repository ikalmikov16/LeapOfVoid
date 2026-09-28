// Remotion entry point for the clip composer (bundled by compose.ts, or opened
// with `bun run clip:studio`). Design: plans/clip-composer.md.

import { registerRoot } from 'remotion';
import { Root } from './Root';

registerRoot(Root);
