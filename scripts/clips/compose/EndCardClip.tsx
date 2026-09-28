// The composed clip: the gameplay video, then the end card. Three layers —
// a background canvas (zone gradient + stars), the gameplay (zoomed and
// faded during the warp; its last frame held if the warp outlasts it), and
// a foreground canvas (planet, ship, title, call to action).
// Design: plans/clip-composer.md §3.4.

import { useLayoutEffect, useMemo, useRef, type FC } from 'react';
import {
  AbsoluteFill,
  Freeze,
  OffthreadVideo,
  staticFile,
  useCurrentFrame,
  type CalculateMetadataFunction,
} from 'remotion';
import { COLORS, HEAT_COLORS } from '../../../src/game/constants';
import {
  drawBackground,
  drawForeground,
  H,
  makeBackdrop,
  VP,
  W,
  warpVideo,
  type CardLook,
} from './draw';
import {
  cardSeconds,
  endCardSpec,
  LINE,
  WARP_S,
  type EndCardSpec,
  type SourceSidecar,
} from './endCard';

export type EndCardProps = {
  /** Gameplay sidecar name in the public dir, without `.json`; '' = card only (Studio). */
  clip: string;
  holdS: number;
  /** Filled in by calculateMetadata from the sidecar. */
  spec?: EndCardSpec;
  /** The gameplay mp4 in the public dir (from the sidecar), or null for card only. */
  video?: string | null;
};

const FPS = 60;
/** Card-only preview (no clip given): a second of the void, then the card. */
function previewSpec(holdS: number): EndCardSpec {
  const warpStartFrame = FPS;
  return {
    fps: FPS,
    videoFrames: 0,
    warpStartFrame,
    totalFrames: warpStartFrame + Math.round(cardSeconds(holdS) * FPS),
    holdS,
    zoneName: 'THE VOID',
    top: COLORS.bgTop,
    bottom: COLORS.bgBottom,
    accent: HEAT_COLORS[0],
    line: LINE,
  };
}

export const calculateEndCardMetadata: CalculateMetadataFunction<EndCardProps> = async ({
  props,
}) => {
  if (props.clip === '') {
    const spec = previewSpec(props.holdS);
    return { durationInFrames: spec.totalFrames, fps: FPS, props: { ...props, spec, video: null } };
  }
  const res = await fetch(staticFile(`${props.clip}.json`));
  if (!res.ok) throw new Error(`No ${props.clip}.json in the public dir (${res.status})`);
  const sidecar = (await res.json()) as SourceSidecar;
  const spec = endCardSpec(sidecar, props.holdS);
  return {
    durationInFrames: spec.totalFrames,
    fps: spec.fps,
    props: { ...props, spec, video: sidecar.video },
  };
};

const FULL = { position: 'absolute', left: 0, top: 0, width: W, height: H } as const;

function required(spec: EndCardSpec | undefined): EndCardSpec {
  if (spec === undefined) throw new Error('EndCardClip needs calculateEndCardMetadata');
  return spec;
}

export const EndCardClip: FC<EndCardProps> = (props) => {
  const spec = required(props.spec);
  const video = props.video ?? null;
  const frame = useCurrentFrame();
  const t = (frame - spec.warpStartFrame) / spec.fps;
  const look = useMemo<CardLook>(
    () => ({ top: spec.top, bottom: spec.bottom, accent: spec.accent, line: spec.line }),
    [spec.top, spec.bottom, spec.accent, spec.line],
  );
  const backdrop = useMemo(() => makeBackdrop(spec.top, spec.bottom), [spec.top, spec.bottom]);
  const showGameplay = video !== null && t < WARP_S;
  const bg = useRef<HTMLCanvasElement>(null);
  const fg = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const c = bg.current?.getContext('2d');
    if (!c) return;
    c.clearRect(0, 0, W, H);
    // Before the warp the gameplay covers everything.
    if (video === null || t >= 0) drawBackground(c, t, backdrop);
  }, [t, backdrop, video]);

  useLayoutEffect(() => {
    const c = fg.current?.getContext('2d');
    if (!c) return;
    c.clearRect(0, 0, W, H);
    drawForeground(c, t, look);
  }, [t, look]);

  const warp = warpVideo(t);
  const gameplay =
    video === null ? null : (
      <OffthreadVideo src={staticFile(video)} muted style={{ width: W, height: H }} />
    );
  return (
    <AbsoluteFill style={{ backgroundColor: spec.bottom }}>
      <canvas ref={bg} width={W} height={H} style={FULL} />
      {showGameplay && (
        <AbsoluteFill
          style={{
            transform: `scale(${warp.scale})`,
            transformOrigin: `${VP[0]}px ${VP[1]}px`,
            opacity: warp.opacity,
          }}
        >
          {frame < spec.videoFrames ? (
            gameplay
          ) : (
            <Freeze frame={spec.videoFrames - 1}>{gameplay}</Freeze>
          )}
        </AbsoluteFill>
      )}
      <canvas ref={fg} width={W} height={H} style={FULL} />
    </AbsoluteFill>
  );
};
