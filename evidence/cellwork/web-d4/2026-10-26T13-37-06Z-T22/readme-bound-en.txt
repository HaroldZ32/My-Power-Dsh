50:read carries). Every `data:` frame runs the SAME `tick` the interval runs, so a pushed and a polled
51:frame can never disagree. The interval stays as the **fallback**: a host without `EventSource`
113:## Nested groups: a subcell is a frame
115:The TEAM view paints a subcell as a frame instead of as one more task card. The host serves the box as a
116:node of the PARENT frame (`visual: "group"`) together with the model's `groups` list, and the drawing turns
118:`svg` edges, then the frames, then the task cards, and no `data-mpd-node` ever carries a group's id.
120:- **The frame is the box's own cell**, computed by the same layout that places a task: the rectangle the
121:  frame publishes (`data-mpd-group="<id>,<left>,<top>,<width>,<height>"`) is the cell the item occupies, so
124:  by the host, which makes it an ordinary drawn edge that terminates on the frame's border; `overlaps` and
125:  the no-curve-enters-a-box construction therefore extend to frames unchanged.
127:  render emits no frames layer at all, so a flat picture's bytes and DOM are what they were before subcells
129:- **DECLARED BOUND — the interior is COLLAPSED.** The items inside a subcell are not re-laid out within its
130:  frame; recursive, variable-column geometry (a subcell's own DAG drawn in place) is the remaining half of
131:  contract D4 and is NOT claimed by this build. A nested subcell therefore gets no frame of its own yet.
