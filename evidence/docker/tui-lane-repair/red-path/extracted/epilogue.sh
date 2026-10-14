# Summarise: every tui.* record this lane owns, so the run cannot end without a verdict.
# ONE awk pass, deliberately: `grep -c` PRINTS its count and EXITS 1 when there is no match,
# so `$(grep -c … || echo 0)` captured "0\n0" and the comparison below could never be true
# (measured 2026-09-27: all eleven assertions green and the lane still reported laneExit=false).
TUI_SUMMARY="$(awk '/"name":"tui\./ { total++; if ($0 ~ /"ok":false/) bad++ } END { printf "%d %d", total, bad }' "$STATE_FILE" 2>/dev/null || echo "0 0")"
TUI_TOTAL="${TUI_SUMMARY%% *}"
TUI_BAD="${TUI_SUMMARY##* }"
# The floor is the number of tui.* records this lane REALLY writes BEFORE this exit record (21: the 19
# names the merged-panel group closed on, plus teamFixtureBound and teamSceneOtherSessionInvisible,
# which the F1 repair added — counted from the writers, not guessed). It is pinned so a record that
# silently disappears from the writer reddens instead of shrinking the lane's coverage (measured
# 2026-09-27: all eleven assertions green and the lane still reported laneExit=false — the inverse
# failure). `tui.laneExit` itself is NOT part of it: it is written after this count on either ending.
if [ "${TUI_BAD:-0}" = "0" ] && [ "${TUI_TOTAL:-0}" -ge 21 ]; then
  record tui.laneExit true "the TUI lane ran to completion with every assertion green" "records=$TUI_TOTAL"
  exit 0
fi
record tui.laneExit false "the TUI lane finished with failing or missing assertions" "records=$TUI_TOTAL failed=$TUI_BAD"
# This exit is REQUESTED and the record above already covers it: without this line `on_exit` would read
# an ordinary red ending as the abort it was written to catch, and publish the false second record the
# trap's own comment describes.
LANE_EXIT_RECORDED=1
exit 1
