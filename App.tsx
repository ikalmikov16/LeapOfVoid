import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { GameScreen } from './src/screens/GameScreen';

export default function App() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar hidden />
      <GameScreen />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#050510',
  },
});
