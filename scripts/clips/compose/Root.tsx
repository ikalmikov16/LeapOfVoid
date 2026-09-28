import type { FC } from 'react';
import { Composition } from 'remotion';
import { calculateEndCardMetadata, EndCardClip, type EndCardProps } from './EndCardClip';
import { COMPOSITION_ID, DEFAULT_HOLD_S } from './endCard';

const defaultProps: EndCardProps = { clip: '', holdS: DEFAULT_HOLD_S };

export const Root: FC = () => (
  <Composition
    id={COMPOSITION_ID}
    component={EndCardClip}
    width={1080}
    height={1920}
    fps={60}
    durationInFrames={1}
    defaultProps={defaultProps}
    calculateMetadata={calculateEndCardMetadata}
  />
);
