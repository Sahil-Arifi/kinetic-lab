# Kinetic Lab

A browser physics workshop built with React, Three.js and a dedicated Rapier WebAssembly worker.

This repository is implementing the physics foundation milestone: a 120 Hz deterministic Marble Run, real pointer constraints, keyboard-accessible scene editing, and measured physics validation. Each completed engineering phase is validated and published as it lands.

## Development

Use Node **24.19.0** and pnpm **11.19.0**. Dependencies are pinned in `package.json` and `pnpm-lock.yaml`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The application and full validation suite are currently being assembled. Completion is gated on unit/integration coverage, production build, Chromium interaction tests, accessibility checks, and Windows/Ubuntu CI. Results will be documented only after execution.

## Foundation

The main thread owns the authored scene and renders transforms. The worker exclusively owns the Rapier world. A strict versioned Zod document validates bodies and goals. Every message includes protocol version, session identity and monotonic sequence. Reset and scene replacement reconstruct a world and invalidate responses from its predecessor.

The accumulator steps at `1 / 120` seconds, caps scheduler catch-up at five steps, and records discarded simulation time. Rendering never changes the numerical timestep.

Hand tracking is not implemented yet. MediaPipe integration is planned after the physics foundation is independently verified. This milestone has no camera permissions, API calls, backend, accounts, analytics or cloud persistence.

MIT licensed. See [LICENSE](LICENSE).
