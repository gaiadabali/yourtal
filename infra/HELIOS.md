# Helios staging layout

Started by 1.3.c with the one prerequisite the worker needs; Phase 2 (2.1.a)
fills in the deploy targets, compose layout and secrets handling as staging
goes live.

## Host prerequisites

- **ffmpeg on `PATH`.** `apps/worker` runs on the host, not in
  docker-compose (see `apps/worker/src/main.ts`'s header for why), and a
  future media-transcoding job shells out to it directly. The dev machine
  has ffmpeg 8.1.2 from winget (`infra/PORTS.md`); Helios needs an
  equivalent (`apt install ffmpeg` on Debian/Ubuntu) before the worker unit
  is enabled.
- Node major and pnpm version: kept in step with CI (`.nvmrc`, `packageManager`
  in `package.json`) — see 0.4.e and 2.1.b.
