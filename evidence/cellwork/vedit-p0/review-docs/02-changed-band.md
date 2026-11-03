# Changed doc band — T6 + T12

```
 docs/cellwork.md                                 | 51 +++++++++++++++++++-----
 docs/cellwork.zh-CN.md                           | 37 ++++++++++++-----
 docs/mail.md                                     |  9 ++++-
 docs/mail.zh-CN.md                               |  8 +++-
 packages/mpd-cellwork-plugin/README.md           | 51 ++++++++++++++++++++----
 packages/mpd-cellwork-plugin/README.zh-CN.md     | 34 +++++++++++++---
 packages/mpd-dsh-adapter-plugin/README.md        |  3 ++
 packages/mpd-dsh-adapter-plugin/README.zh-CN.md  |  3 ++
 packages/mpd-team-compact-plugin/README.md       |  9 +++--
 packages/mpd-team-compact-plugin/README.zh-CN.md |  8 ++--
 packages/mpd-team-core-plugin/README.md          | 18 ++++++++-
 packages/mpd-team-core-plugin/README.zh-CN.md    | 17 ++++++--
 12 files changed, 199 insertions(+), 49 deletions(-)
```

Version carriers and root human-facing files: NOT touched.
```
(none touched)
```

Version literals inside the changed docs:
```
(none)
```

Switch links (first lines, all 12 files): every English file carries [中文](./<pair>.zh-CN.md),
every zh file carries [English](./<pair>.md); two zh files use the pre-existing
'[English](./README.md) | **中文**' / '... **简体中文**' order variants. The docs gate's
pairs=55 failed=0 violations=0 covers pair, switch-link, heading-tree, CJK and link resolution.
