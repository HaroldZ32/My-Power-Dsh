for f in "$1"/*.mjs; do echo "[test:qa] $f"; bun "$f" --self-test || { echo "[test:qa] FAILED: $f"; exit 1; }; done; echo "[test:qa] all self-tests passed"
