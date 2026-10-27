# syntax=docker/dockerfile:1.7
# =============================================================================
# Disposable build-identity PROBE — not a product image, never deployed.
#
# The claim under test is one sentence: the bytes that let an image name its own
# commit survive `.dockerignore` and reach the build. That claim lives entirely
# inside the build context, so it can only be proved by a real `docker build`
# whose context is this repository root. `scripts/build-identity.mjs` is the
# production resolver, run here under the four conditions that decide whether the
# identity is a measurement or a hand-me-down.
#
# It is deliberately NOT `--target api-build` of the real Dockerfile: that tier
# costs a full `pnpm install` + esbuild inside the image and is what
# `--tier real` asks Docker for. This file is the cheap tier, and it answers the
# same question because the context and the resolver are the real ones.
#
# Every arm writes to /out so the caller can `docker cp` the evidence out and
# assert on it in Node. Nothing here prints a verdict: a verdict is only allowed
# to exist where both the expected commit and the host's own git state are known.
# =============================================================================

FROM node:22-bookworm-slim
WORKDIR /repo

# The real `.dockerignore` of the context this build was started from applies
# here, exactly as it does to the api image.
COPY . .

# What actually arrived. Recorded, not assumed: `.git/objects` must be absent (a
# build needs to name its commit, not replay its history), and whether HEAD is
# symbolic or detached decides which of the arms below can mean anything.
RUN mkdir -p /out \
 && { \
      printf 'context-files\t%s\n' "$(find .git -maxdepth 1 2>/dev/null | sort | tr '\n' ' ')"; \
      printf 'head-first-line\t%s\n' "$(head -n 1 .git/HEAD 2>/dev/null | tr -d '\r\n')"; \
      printf 'refs-loose-count\t%s\n' "$(find .git/refs -type f 2>/dev/null | wc -l | tr -d ' ')"; \
      printf 'packed-refs-present\t%s\n' "$([ -f .git/packed-refs ] && echo yes || echo no)"; \
      printf 'objects-present\t%s\n' "$([ -d .git/objects ] && echo YES || echo no)"; \
    } > /out/context.tsv

# Arm A — the case that broke the clinic: a stamp handed in that is NOT this
# checkout. GIT_COMMIT arrives from `.env`, and only deploy-synology.sh refreshes
# `.env`, so this is precisely what a Container Manager rebuild does.
ARG STALE_COMMIT
RUN node scripts/build-identity.mjs \
      --git-dir .git --version-file version.json \
      --declared-commit "${STALE_COMMIT}" --out /out/a.json

# Arm B — the control that stops arm A being an always-true assertion. When the
# stamp agrees with the metadata, `staleStampDetected` must be false. A resolver
# that reported "stale" for every build would pass arm A and be useless.
ARG REAL_COMMIT
RUN node scripts/build-identity.mjs \
      --git-dir .git --version-file version.json \
      --declared-commit "${REAL_COMMIT}" --out /out/b.json

# Arm C — take the refs away and the answer must fall back to the declared stamp.
# This is the arm that proves the refs, not the ARG, carry the identity. Which
# file the resolver used depends on how the checkout stores its refs, so both
# representations go, and the caller only credits this arm when the context
# manifest says there was something to take.
RUN if [ -e .git/refs ]; then mv .git/refs .git/refs.probe-hidden; fi; \
    if [ -e .git/packed-refs ]; then mv .git/packed-refs .git/packed-refs.probe-hidden; fi; \
    node scripts/build-identity.mjs \
      --git-dir .git --version-file version.json \
      --declared-commit "${STALE_COMMIT}" --out /out/c.json; \
    status=$?; \
    if [ -e .git/refs.probe-hidden ]; then mv .git/refs.probe-hidden .git/refs; fi; \
    if [ -e .git/packed-refs.probe-hidden ]; then mv .git/packed-refs.probe-hidden .git/packed-refs; fi; \
    exit $status

# Arm D — take HEAD away: no ref, no detached SHA, nothing to resolve.
RUN if [ -e .git/HEAD ]; then mv .git/HEAD .git/HEAD.probe-hidden; fi; \
    node scripts/build-identity.mjs \
      --git-dir .git --version-file version.json \
      --declared-commit "${STALE_COMMIT}" --out /out/d.json; \
    status=$?; \
    if [ -e .git/HEAD.probe-hidden ]; then mv .git/HEAD.probe-hidden .git/HEAD; fi; \
    exit $status
