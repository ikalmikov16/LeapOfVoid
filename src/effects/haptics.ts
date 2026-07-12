// JS-thread haptic feedback, invoked from UI-thread reactions via runOnJS.
// Fire-and-forget: haptic latency of one frame is imperceptible.

import * as Haptics from 'expo-haptics';
import type { CaptureKind } from '../game/types';
import { useAppStore } from '../state/appStore';

function enabled(): boolean {
  return useAppStore.getState().hapticsEnabled;
}

export function hapticRelease(): void {
  if (!enabled()) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

export function hapticCapture(kind: CaptureKind): void {
  if (!enabled()) return;
  if (kind === 2) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } else if (kind === 1) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
  } else {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }
}

export function hapticDeath(): void {
  if (!enabled()) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
}

export function hapticZone(): void {
  if (!enabled()) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
}
