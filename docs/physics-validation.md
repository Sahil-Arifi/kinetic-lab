# Physics validation

These experiments validate Kinetic Lab's implementation against defined fixtures. They are **not proof of general scientific accuracy**, a broad determinism guarantee, or a performance benchmark. Every measurement below comes from the actual Rapier WebAssembly simulation, with no mocked physics.

Run `pnpm validate:physics` to execute all five experiments, assert their tolerances, and regenerate [`artifacts/physics-validation.json`](../artifacts/physics-validation.json). The artifact contains the full fixtures, tolerances, runtime information, and measured outcomes. A failing assertion stops the command before it writes a successful artifact.

## Recorded environment

- Rapier `0.20.0`; Windows x64; Node `v24.19.0`.
- Numerical timestep: `1 / 120` seconds, independent of rendering.
- Eight solver iterations; dynamic colliders use CCD.
- Fixture SHA-256: `a44c578e8bf748df2bf21e831935e079370331f858c966d44a24f00e0545c62b`.
- Authored Marble Run SHA-256: `2f884e14c71ad4057e66c637c3a1241f80ff41c1fa027600178066c1ad8c1ea5`.

The hashes are over JSON serialization of the fixtures recorded in the artifact. They identify the tested experiment definitions; the lockfile identifies the dependency build.

## Measured results

| Experiment                                    | Observed result                                                                         | Acceptance tolerance                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Free fall, 120 ticks                          | Absolute vertical position error **0.005097122192 m**                                   | ≤ 0.05 m                                                           |
| Zero gravity, 240 ticks                       | Velocity error **1.33280037 × 10⁻⁸ m/s**                                                | ≤ 1 × 10⁻⁵ m/s                                                     |
| Zero gravity, supplemental position check     | Position error **0.001660639690 m**                                                     | ≤ 0.002 m                                                          |
| Reset, five repetitions × 30 bodies           | Largest authored-state error **2.305185902 × 10⁻⁷**; repeated-snapshot difference **0** | ≤ 1 × 10⁻⁶ authored-state error; exactly identical reset snapshots |
| Render scheduling, three patterns × 720 ticks | Largest tested state difference **0**; dropped time **0 s**                             | ≤ 1 × 10⁻⁶ state difference; equal tick count                      |
| Marble Run, five reset runs                   | **5/5 goals**, each at tick **593**; goal tick spread **0**                             | Every run completes; equal goal tick                               |

## Experiment definitions

### 1. Free fall

An isolated sphere starts at `y₀ = 20 m` with zero velocity. Gravity is `g = −9.81 m/s²`. After 120 simulation ticks, `t = 1 s`, the analytic reference is:

```text
y(t) = y₀ + v₀t + ½gt² = 15.095 m
observed y = 15.089902877807617 m
```

The 5 cm tolerance accommodates finite-step integration while remaining below the roughly 8.2 cm distance a body at its final velocity travels in one outer timestep. It is an implementation regression bound at this duration and gravity, not an accuracy promise for other scenarios.

### 2. Zero gravity momentum

An isolated sphere starts at `(0, 20, 0)` with velocity `(1.5, −0.4, 0.7) m/s`, zero gravity, and zero linear and angular damping. There are no contacts or joints. After 240 ticks (2 seconds), the Euclidean velocity difference must remain within `1e−5 m/s`.

The supplemental position check compares against `p₀ + vt`. Its 2 mm bound allows float32 position accumulation at a 20 m origin. The observed position drift is larger than the velocity error, demonstrating why those are reported separately rather than claiming exact analytical motion.

### 3. Reset reconstruction

For each of five repetitions, the default scene receives an impulse, advances 90 ticks, and creates a live grab constraint. Reset destroys the entire Rapier world and recreates all 30 authored bodies. Every body's position and quaternion are compared both with the original snapshot and with the authored position/Euler-derived quaternion. The check also confirms that no temporary handle or joint survives.

The authored comparison allows float32 conversion differences up to `1e−6`. The same-runtime reset snapshots must match exactly. Euler angles and quaternions are not compared directly; authored Euler rotations are first converted to quaternions using the same documented XYZ convention as rendering.

### 4. Fixed timestep independence

The real accumulator receives three scheduling patterns: 60 Hz, 144 Hz, and repeating intervals of `4, 12, 27, 7 ms`. All run for 6 seconds, produce exactly 720 physics steps, and apply the same impulse at tick 120 and gravity change at tick 240. Final position, orientation, and linear velocity are compared.

All intervals fit the five-step catch-up budget, so these tests expect no dropped time. Separate clock unit tests exercise the overload budget and recorded dropped simulation time. Scheduler overload deliberately sacrifices elapsed simulation time instead of changing `dt` or catching up indefinitely; equal wall time under overload is therefore not an equivalence claim.

### 5. Marble Run repeatability

The authored starter has one marble, three ramps, ten dominoes, two stage barriers, ramp rails, a support stage, five fixed support posts, a workbench, and one target cup. Three posts support the ramp centres and two support the domino stage. The marble moves only through gravity and collision response; there are no scripted trigger forces or runtime nudges.

The dominoes are slightly offset from the marble's path. The marble contacts the first domino and continues past the line while the chain falls. Each of five runs reconstructs the document, advances 1,440 ticks (12 seconds), and checks:

- Marble contact with all three ramps.
- All nine adjacent domino-to-domino contacts.
- A substantial final-domino tip (absolute quaternion Z component greater than 0.7 at some point).
- One goal event and the same completion tick across all runs.
- A final marble position within the cup footprint and below the rim.

The cup has five solid colliders (floor, three full walls, and a low entry lip) plus a real interior sensor collider. Goal dwell counts **45 consecutive simulation ticks** in which Rapier reports an overlap between the sensor and the marble collider. An interrupted overlap resets the count. The event emits once per reconstructed world. Completion at tick 593 corresponds to approximately **4.9417 seconds of simulation time**, including the 0.375 second dwell interval.

The repeated final marble position was `(7.873659133911133, 0.3099192678928375, 0.4047262668609619)` metres in all five recorded runs.

## Interaction validation

Real-Rapier integration tests additionally verify that grabbing creates a collider-free kinematic handle and one damped spring joint. The handle uses `setNextKinematicTranslation`, bounded by the configured 12 m/s speed, and the selected dynamic body is never teleported. Releasing removes both temporary resources and preserves the body's existing simulated velocity; no extra throw impulse is added. Tests cover stationary and moving targets, a rotated off-centre grab point, replacement, rejection of fixed bodies, repeated cleanup, live-grab reset, gravity wake-up, and collision begin/end events.

## Limits

- The recorded experiments use one operating system, architecture, runtime, and pinned Rapier build. Cross-browser and cross-architecture bit-for-bit determinism is not claimed.
- Contacts, stacking, friction, CCD, and spring constraints are approximate numerical models. They are suitable for this workshop, not certified engineering or scientific measurement.
- The goal uses sensor overlap occupancy, not a proof that every point of the sphere is geometrically contained in the cup. The repeatability test separately checks the settled position.
- These fixtures do not establish stability for every scene a visitor can author. Finite validated bounds constrain input, but arbitrary valid arrangements can jam, fall off the workbench, or fail a goal.
- No performance conclusion follows from these runs. The Inspect panel's instrumentation is preparation for a later benchmark milestone.
