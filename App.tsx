import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { startAmbient } from './src/audio/ambient';
import { initAudio } from './src/audio/sfx';
import { GameScreen } from './src/screens/GameScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { hydrateAppStore, useAppStore } from './src/state/appStore';

export default function App() {
  const screen = useAppStore((s) => s.screen);

  useEffect(() => {
    // The drone must wait for hydration (persisted mute) and the audio mode.
    Promise.all([hydrateAppStore(), initAudio()]).then(startAmbient);
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar hidden />
      {screen === 'game' ? <GameScreen /> : <HomeScreen />}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#050510',
  },
});
