# Foundation verification record

Executed on 21 September 2026 (America/Los_Angeles), Windows x64, Node **24.19.0**, pnpm **11.19.0**. Results describe this implementation and the committed fixtures, not general scientific accuracy or benchmark performance.

| Executed command                 | Result                                                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | Exit 0; committed lockfile accepted                                                                                               |
| `pnpm lint`                      | Exit 0; zero ESLint errors or warnings                                                                                            |
| `pnpm typecheck`                 | Exit 0; strict TypeScript check                                                                                                   |
| `pnpm test`                      | 98 passed in 10 files: 79 unit/component/lifecycle, 19 real-Rapier integration                                                    |
| `pnpm test:coverage`             | 98 passed; branches **97.92% (283/289)**; statements **99.43% (524/527)**; functions **100% (101/101)**; lines **100% (468/468)** |
| `pnpm build`                     | Exit 0; 430 modules transformed; production worker and app emitted                                                                |
| `pnpm test:e2e`                  | **14/14 passed**, 45.9 s, Chromium                                                                                                |
| `pnpm test:a11y`                 | **2/2 passed**, 9.8 s; zero axe violations in tested states                                                                       |
| `pnpm validate:physics`          | All five experiments pass; Marble Run **5/5**, goal tick **593** each time                                                        |
| `pnpm verify:repository`         | 74 tracked files; no matched credential patterns, credential paths or prohibited direct/resolved transitive dependencies          |

The coverage gate enforces at least 85% branches, statements, functions and lines **for each included file**. All files in `src/engine`, `src/input`, `src/editor`, `src/metrics` and `src/scenes` are included. Engine branch coverage is 96.57%; scene schema, protocol, input adapters, editor and metrics each have 100% branch coverage. Component/rendering and worker bootstrap behavior are additionally exercised through DOM tests and the actual built browser application.

## Reproducibility

A clean export of all tracked working files into a new directory had **no node_modules directory** before `pnpm install --frozen-lockfile`. With Node 24.19.0 and pnpm 11.19.0, installation added 305 packages from the package store in 4.3 s; the production build then passed with 430 transformed modules. The final lockfile SHA-256 is `10c9fd45f855bad608cf5ce2e9fb9ac6c8bad0c6f67c74ef539268f422295271`.

The dependency audit removed Drei's unused transitive MediaPipe package through a pnpm override and switched to direct imports of the two required helpers. The repository scan checks resolved lockfile packages as well as direct dependencies. The final full local suite and browser checks were repeated after this correction; no MediaPipe or OpenAI package is resolved.

Production output at validation: application JavaScript 1,235.31 kB (341.18 kB gzip), worker JavaScript including embedded Rapier WASM 2,956.71 kB, CSS 22.33 kB (5.73 kB gzip), Latin font files 59.22 kB combined. Vite reports its standard >500 kB chunk advisory. This is a recorded bundle limitation; it is not a startup or runtime performance result. Both font licenses ship under `dist/licenses`.

## Browser and visual evidence

The browser suite checks the built production application, real WebGL rendering and the dedicated physics worker. It covers load, play/pause, exact stepping, reset, keyboard selection, editable-field shortcuts, gravity, authoring operations, undo/redo, paused mouse and touch drags, running spring grabs with mouse and touch, cancellation after simulation, one-finger orbit, native touch zoom controls, and two natural goal completions separated by reset. All cases assert no uncaught exceptions or console errors.

- [1440×1000 desktop](screenshots/workbench-1440.png): full workbench, inspector and object tray reviewed.
- [768×1024 tablet](screenshots/workbench-768.png): scene, controls and collapsible inspector reviewed.
- [390×844 mobile](screenshots/workbench-390.png): primary workbench, bottom tray, visible zoom and collapsible inspector reviewed.

All three viewport checks assert no horizontal overflow. Axe checks the initial DOM and opened Inspect panel at desktop/mobile sizes, plus the opened mobile object inspector. Axe coverage concerns the DOM interface, not perception of the 3D canvas.

## Scope and limitations of verification

- Real Rapier integration and validation use no mocked physics. The four React lifecycle tests deliberately mock transport and simulate DOM visibility/error events; these verify hidden-page pause/no-auto-resume and cleanup decisions.
- This host's headless Chromium and embedded browser kept `document.visibilityState` at `visible` when switching automated tabs. A real hidden-tab transition is therefore **not claimed as browser-verified**. The visibility handler and accumulator clearing are independently unit tested.
- Mobile interactions use Chromium touch emulation, including single-finger CDP motion and native touchscreen taps. Orbit and zoom are separate cases because Chromium can suppress a native tap immediately following raw CDP gesture injection. Physical touch hardware is not claimed as tested.
- Screen-reader user sessions and Safari/Firefox are not included. These remain independent review work.
- Secret checks examine tracked paths and common credential patterns without printing matched values. No secrets were intentionally added; this targeted scan is not a universal secret-detection guarantee.
- No final performance, broad scientific-accuracy or universal cross-platform determinism claims are made.

## CI

The [commit-associated GitHub Actions runs](https://github.com/Sahil-Arifi/kinetic-lab/actions/workflows/ci.yml) independently repeat frozen installation, lint, typecheck, tests, per-file coverage, repository scanning, production build and real physics validation on Windows and Ubuntu. Ubuntu also runs all Chromium and axe cases. The final handoff verifies the workflow result for the exact remote main SHA; local passes alone do not establish CI success.

## Remaining flagship gates

This foundation remains subject to independent review of implementation, evidence and real-device usability before hand tracking starts. The subsequent scope is opt-in local MediaPipe input, calibrated poses mapped onto the existing typed grab protocol, confidence/hysteresis handling, permission/error states and complete mouse/touch/keyboard fallback. Representative-device benchmarks and final independent flagship review follow later. No MediaPipe, camera permission or OpenAI API dependency is present now.
