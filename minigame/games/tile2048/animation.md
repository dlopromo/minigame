# 2048 Race Animation

2048 animation is client-only.

Current MVP:

- spawn pop animation only for the newly added tile
- merge pulse only for cells produced by a merge
- subtle directional motion on board repaint
- original 2048-inspired color scale
- high values use a compact `v-super` style
- reduced-motion mode disables tile animation

Do not write animation frame data to Firebase.

Future target:

- position-based tile movement using previous board coordinates
- score popup on `lastGain`
