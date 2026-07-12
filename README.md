# Leap of Void

A one-touch endless mobile game. You orbit a planet in space — tap to release
along the tangent, graze the next planet to get captured into its orbit, chain
hops forever. Miss and you're lost in the void; aim too well and you smack the
surface.

Design doc: [`orbit-game-plan.md`](./orbit-game-plan.md)

## Development

```bash
npm install
npm start          # Expo dev server — scan the QR with Expo Go on your phone
npm run ios        # or open the iOS simulator
npm run typecheck  # TypeScript check
```

Built with Expo (React Native + TypeScript), rendered on a single
[Skia](https://shopify.github.io/react-native-skia/) canvas, simulated with a
[Reanimated](https://docs.swmansion.com/react-native-reanimated/) frame callback.
No physics engine — the whole game is circle and line geometry.
