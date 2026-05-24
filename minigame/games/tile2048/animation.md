# 2048 Race Animation

2048 animation is client-only.

Current MVP:

- spawn pop animation for visible tiles
- subtle slide-in motion on board repaint
- original 2048-inspired color scale
- high values use a compact `v-super` style

Do not write animation frame data to Firebase.

Future target:

- position-based tile movement using previous board coordinates
- merge pulse only for merged tiles
- score popup on `lastGain`
- optional reduced-motion mode
