# docker/Dockerfile — the CLIENT-side image of the Docker end-to-end install test.
#
# WHY A BARE ubuntu:24.04: the acceptance question is "can a clean Ubuntu 24.04 machine install and
# boot this bundle from a copy of the checkout". This image therefore ships NO node, NO bun, NO pnpm
# and NO dsh — every one of them is installed by docker/entrypoint.sh INSIDE the running container.
# If a runtime were baked in here, the test would prove the IMAGE instead of the install path.
#
# BUILD CONTEXT = THE REPOSITORY ROOT (`context: ..` in docker/docker-compose.yml). The repository is
# COPIED in, never bind mounted, so the container can read no host path except the single /out
# evidence mount — and what the copy contains is decided by docker/Dockerfile.dockerignore, which
# BuildKit applies to `docker/Dockerfile` builds.
#
# The measurement apparatus (entrypoint.sh, probe.mjs, lib/) is baked at /opt/mpd-e2e, NOT taken from
# the tree under test: a repository copy can supply its own plugins, never its own verdict.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
# Every path the entrypoint uses, so nothing depends on the caller's environment.
ENV MPD_E2E_SRC_DIR=/src
ENV MPD_E2E_APP=/opt/mpd
ENV MPD_E2E_WORK=/work
ENV MPD_E2E_OUT=/out
ENV MPD_E2E_LIB=/opt/mpd-e2e/lib
ENV MPD_E2E_PROBE=/opt/mpd-e2e/probe.mjs
ENV MPD_E2E_TOOLCHAIN=/opt/toolchain

# The repository under test, filtered by docker/Dockerfile.dockerignore (no .git, no node_modules, no
# evidence, no host scratch, no packed dist) — the entrypoint copies /src to /opt/mpd and asserts that
# filtering held.
COPY . /src/
COPY docker/entrypoint.sh /opt/mpd-e2e/entrypoint.sh
COPY docker/probe.mjs /opt/mpd-e2e/probe.mjs
COPY docker/lib/ /opt/mpd-e2e/lib/
RUN chmod 0755 /opt/mpd-e2e/entrypoint.sh && mkdir -p /work /out

WORKDIR /work
ENTRYPOINT ["/opt/mpd-e2e/entrypoint.sh"]
