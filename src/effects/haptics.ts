// JS-thread haptic feedback, invoked from UI-thread reactions via runOnJS.
// Fire-and-forget: haptic latency of one frame is imperceptible.

import * as Haptics from 'expo-haptics';
import type { CaptureKind } from '../game/types';

export function hapticRelease(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

export function hapticCapture(kind: CaptureKind): void {
  if (kind === 2) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } else if (kind === 1) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
  } else {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }
}

export function hapticDeath(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
}

export function hapticZone(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
}
