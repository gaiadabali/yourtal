# @yourtal/mail-engine

A vendored copy of the Spambank mail engine. The source of truth is
`gaiadabali/snap-app` `packages/mail-engine/src` (public); `src/` here is
byte-for-byte identical and the `mail-engine-sync` CI job fails if it drifts.

    node scripts/sync-mail-engine.mjs            # copy snap-app main into src/
    node scripts/sync-mail-engine.mjs --check    # exit 1 if src/ differs

Never edit `src/` here. Change the engine in snap-app, merge, then sync.
