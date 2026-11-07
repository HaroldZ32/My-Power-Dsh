113:## Nested groups: a subcell is a frame
120:- **A box is its INTERIOR, laid out recursively.** Each frame's own items are placed by the same rules a
122:  boxes for the rank-skipping edges — and the box is then sized to that interior plus the frame's own
124:  the cards and the nested boxes it holds. Nesting repeats: a subcell inside a subcell gets its own frame,
129:  the no-two-runs-share-a-pixel promise extends to every interior unchanged.
130:- **One canvas, absolute coordinates.** The nested branch emits every card, run and frame in the canvas's
132:  absolutely instead of inside rank columns; a box's interior is re-planned at the origin its box was
135:  `nested` flag and the render emits no frames layer at all, so a flat picture's bytes and DOM are what
138:  draws it on the left); the geometry lists its witness in `nestedBackEdges` so the omission is visible
140:  unlike the flat path — and the hover halo covers the root frame's cards (an interior card keeps its own
