# t83 / w14 — the mpd settings section move: artifact measurements

All builds are `node scripts/build-mpd-client.mjs` (deterministic: inputs are the adopted agent-teams client, src/team-page.js, src/web-client.js, src/settings-card.js).

| Revision | bytes | sha256 |
|---|---|---|
| BEFORE — built from the HEAD sources (reproduces HEAD's committed artifact byte-for-byte) | 296735 | f98aa30541fbe4f8b9c3dedadd71a187b8dee4ea8afe4ae6666fed356ecf8035 |
| intermediate — section move, header still said 'six knobs' | 298298 | 976d2555c98d1c3beb2a0d31240d2a2256e2c21a3f187c1326eb071057f3780d |
| AFTER — final (header wording corrected), built twice, byte-identical | 298301 | 34f1976ffef5efa5464059ed11bff787916024f74e298010b775592bd13a3ce1 |

Delta BEFORE -> AFTER: +1566 bytes. HEAD's committed artifact equals the BEFORE build, so the delta is attributable to this task's source change alone (the only uncommitted client inputs are src/settings-card.js and src/web-client.js).
