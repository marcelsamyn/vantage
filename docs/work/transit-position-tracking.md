# Transit tracking implementation

Source: `docs/design/2026-10-16-transit-position-tracking.md`.

Worklist, in dependency order:

1. Preserve observation identity and time; capture Rome input and regression evidence.
2. Add route-distance motion estimation, candidate replay, and retained tracks.
3. Integrate provider health, partial failures, geometry, and snapshot contracts.
4. Use shared estimates and bounded display corrections in City, Around Me, and profiles.
5. Run replay, performance, full checks, browser verification, and independent review; commit the result.

The units share observation types and tracking contracts, so implementation stays sequential under one owner. A fresh reviewer checks the integrated change.

Initial tree: only the design document from this session is untracked. No remote is configured. Work branch: `fix/transit-position-tracking`.

Baseline: dependencies were absent. Installed with `bun install --frozen-lockfile`. Tests require isolated loopback sockets beyond the sandbox. The baseline passed 1,126 tests.

## Implementation

The five worklist units are implemented. All application changes stay in `plugins/transit/`; package scripts expose the recorder and replay tool.

- The adapters preserve physical ids, display labels, service instances, stop metadata, and distinct measurement, feed-production, and receipt times. Undated STIB reports keep an unknown measurement time.
- The tracker keeps physical observations through missing rows, provider failures, and viewport changes. It uses connected route distance, stopped/moving candidates, measurement-time updates, residual rejection, and bounded replay checkpoints. Ordered new observations update incrementally; late observations replay the retained history.
- Partial-source errors and successful empty results have distinct health state. Missing optional full-trip geometry preserves usable map geometry. A profile can reacquire a vehicle after server restart using its last coordinate as a validated acquisition hint.
- City, Around Me, and the profile share snapshot ordering, a monotonic server-time estimate, and `positionAt`. Large corrections relocate with a short fade. Only tiny corrections interpolate along the route. Last-known points use the measured coordinate and show their age.
- Possible unannounced stops and departures widen the model range during gaps. A wide or expired forecast falls back to the actual measured point. Model ranges are uncalibrated and have no advertised statistical coverage.

## Verification

`bun run check` passed: TypeScript, architecture checks, and **1,139 tests, zero failures**. There are no separate lint or format scripts. `git diff --check` passed.

The deterministic cases cover duplicate and late reports, recovery independent of request batching, a late fix that changes residual acceptance, trimmed rejected-event boundaries, 301 incremental updates versus batch replay, 25-second latency compensation, a figure-eight crossing, reversed and disconnected paths, missing route geometry, unknown times, stopped vehicles, unannounced stops and departures, forecast expiry, snapshot/epoch ordering, clock changes, profile reacquisition, and display correction limits. Provider-cache tests preserve receipt metadata through stale-cache fallback. The replay scorer has a future-data leakage regression.

The isolated server uses `PORT=4798 bun run dev`. Live checks confirmed:

- `/api/transit/trips` returned a snapshot with measured Rome vehicles and source health.
- `/api/transit/vehicle` returned HTTP 200 and one current ATAC vehicle selected from that snapshot. Its measurement, feed-production, and receipt times were distinct.
- Reversed map bounds returned HTTP 400 with `invalid_bounds`.

Agent-browser verified the existing Rome City and Around Me surfaces at desktop width and 375 px. At 375 px, `innerWidth` and document `scrollWidth` were both 375. Visual inspection caught a MapLibre opacity expression with a nested zoom input; the corrected expression uses top-level interpolation. Fresh browser logs contained no transit rendering errors after that fix.

The final live phase encountered repeated host wall-clock steps, including one about two hours forward. The monotonic server clock did not advance vehicles with that step; the snapshot exposed the clock error, rejected future-dated reports, and the interface requested a restart. Restarting the isolated server established a new epoch, but another clock step interrupted that run. The physical-vehicle profile's final live visual check remains unverified under stable clocks. Its cold acquisition, source-age contract, and clock guard have deterministic API coverage. Live source failure or clock uncertainty must not be reported as a successful current-position validation.

The 1,000-vehicle benchmark from `bun run transit:replay` measured provider-update p95 **7.1 ms**, evaluation p95 **1.4 ms**, and retained heap growth **5.6 MiB** on this Mac. It exercises twenty generations; a separate deterministic test checks behavior after the 256-event cap. This is a model workload, not a throughput guarantee for every feed geometry.

Code review completed: `/private/tmp/vantage-transit-review-875f4f9e/review.json`. The review found and verified fixes for undated STIB ingestion, cold profile acquisition, clock-error ingress, recovery ordering, checkpoint boundaries, absent optional geometry, and outage-mode uncertainty. The final code review retained no material code findings. Its release verdict remains **Not ready** because accuracy acceptance is unmet. Cross-model coverage was replaced by local adversarial review after automatic approval review rejected sending the diff to Claude.

The simplification pass removed the unused display type, redundant adapter fields, nested profile-message branches, repeated per-vehicle media queries, and no-op profile-store writes. It retained the geometry-identity and acceleration-limit comments because they state constraints that are easy to break. Protected tests were not deleted or weakened; two masked guard fixtures were corrected and given positive controls.

## Rome accuracy: release acceptance remains open

The committed public fixture contains sixty receipt-time samples over about ten minutes, with 298 distinct ATAC observations. The recorder captured sixteen buses on routes 64, 105, and 409. The earlier adapter did not retain the feed header in this recording, so its `producedAt` fields remain explicitly null; the current adapter preserves that field for future recordings.

Replay exposes only observations received before each scored measurement time. It has 258 causal comparisons, with median measurement age **64 seconds**. Later operator GPS is the reference; it is not independent physical ground truth.

| Result at the same 258 instants | Previous code at `1cb4c4d` | New display |
| --- | ---: | ---: |
| Precise estimates emitted | 128 | 0 |
| Median displayed error | 95.5 m | 107.6 m |
| 95th-percentile displayed error | 411.4 m | 375.6 m |

The bounded constant-speed comparator had median error 95.5 m. Of the 211 instants with a route model range, 161 reference positions fell inside it; median range diameter was 518.5 m. Missing geometry, observations beyond the forecast horizon, and withheld estimates remain visible in the replay counts. Withheld errors are counted at the last measured point, never as zero error.

**The proposed 20% accuracy improvement and matched-availability targets are not met.** The lost availability is deliberate under the provisional 150 m display limit: the recorded feed does not support that level of current precision. Synthetic unannounced-stop and departure traces demonstrate why narrow continued-motion estimates can be false precision. The thresholds were not widened to hide this result. This implementation must not be described as delivering improved Rome median accuracy or as release-ready.

Accuracy acceptance needs a separate held-out run and an independent position reference, followed by provider-specific motion/range calibration and a fresh matched-coverage comparison. No calibrated 90% coverage is advertised. No deployment is authorized or claimed. No Git remote is configured, so publication is unavailable from this checkout.
