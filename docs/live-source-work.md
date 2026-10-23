# Live map source expansion

## Requested outcome

Add traffic incidents and flow, emergency incidents in multiple cities, Cloudflare internet outages,
streaming APRS, wider AIS coverage, nearby drone Remote ID reception, and live charger status.
Extend existing sources when a documented usable feed adds coverage or detail. Transit is excluded:
the user is changing it in parallel.

## Worklist and ownership

| Unit | Files | Completion evidence |
| --- | --- | --- |
| Wider AIS coverage | `plugins/ships/` | Schema/adapter and stream lifecycle tests; existing sources still work; map/profile render. |
| Emergency incidents | new `plugins/incidents/` | Verified sources beyond Seattle; timestamps and incident status retained; adapter tests and route/map checks. |
| Traffic incidents and flow | new `plugins/traffic/` | Broad key-based coverage plus useful key-free feeds; geometry/status tests and route/map checks. |
| Internet outages | new `plugins/outages/` | Cloudflare API adapter, geographic scope preserved, setup/error state and route/map checks. |
| Streaming amateur radio | new `plugins/aprs/` | Receive-only filtered APRS stream, packet parsing/lifecycle tests, visibility cleanup and map/profile checks. |
| Drone broadcasts | new `plugins/drones/` | Documented receiver ingestion, runtime validation, stale removal, map/profile and receiver instructions. Hardware reception requires a receiver. |
| Charger status | new `plugins/charging/` | Live operator/API records contribute to the existing `ev` thing type; identifiers/status retained; adapter tests and map checks. |
| Integration and delivery | `.env.example`, `README.md`, this file | `bun run check`, isolated server routes, desktop/mobile browser checks, fresh read-only review, scoped commit. |

The main agent owns integration and shared files. Implementation workers used isolated worktrees with exclusive plugin scopes. Their changes are now
integrated in this worktree; the main agent owns final corrections and verification. No worker changes transit, shared contracts, dependencies,
the generated registry, environment files, or Git state. Main-agent research can run during a worker unit.

## Verified starting state

- Clean worktree at `4f94bc0` on `mc/cool-live-map-data-sources`.
- No Git remote is configured. Push/PR creation requires a remote; local implementation can proceed.
- No TomTom, Cloudflare, AIS Stream, or Eco-Movement credentials are present in this checkout's environment.
- Dependencies are not installed. Use Bun and the existing lockfile.
- Follow `docs/ARCHITECTURE.md`, plugin extension points, Zod boundary validation, caching, motion policy,
  and the shared profiler. Do not access the private plugin tree.

## Validation record

- `bun run check`: type and architecture checks passed; 888 tests passed, 0 failed, 3,382 assertions across 120 files.
- `PORT=4793 bun run start`: the production bundle built and the isolated server started. The user's server on 4747 was not changed.
- Actual app routes returned records on 2026-10-11: London 120, Finland 523, Netherlands 1,331, Brussels 122, France 556 and Austin 2 road reports; Portugal 42, Victoria 15, NSW 37 and Seattle 623 emergency records. These counts describe the queried source areas at verification time; they change with the feeds.
- All traffic route responses had an empty `failed` array. Adapter tests use recordings of the official feeds; stream and receiver tests cover real loopback connections.
- Desktop (1440 px) and mobile (375 px) browser checks covered Traffic, Internet outages, Drones and City layer controls. The mobile page width stayed at 375 px. London rendered 94 road markers in its visible area. Live London road and Portugal emergency profiles opened at both sizes. The emergency update profile refreshed its source data. No JavaScript errors were recorded after the final reload; the base map emitted missing sprite/font warnings from OpenFreeMap.
- TomTom, Cloudflare and AIS Stream credentials, an APRS callsign and a drone receiver are not configured. Setup/error states were verified; authenticated reception and hardware reception remain unverified. No simulated records are shipped.
- Read-only simplification review completed; reuse and resource fixes were applied. Fresh correctness review identified poll time, date-line bounds, credential redirects, TfL closure details and ship registry fallback defects; all were corrected. Regression tests cover timing, bounds and real local charger partial-failure handling. The browser also found an incident client trailing slash that did not match the registered route; the corrected client and its real local route test pass, and Portugal markers now render.
- Shared code change: `shared/geo.ts` now normalizes MapLibre bounds and splits date-line views into geographic rectangles. APRS, incidents, ships, charging and traffic use it. No transit or kernel files changed.
- The independent review completed. Its seven original-snapshot findings were corrected and verified locally; the browser route finding was also corrected. The attempted Claude cross-model review could not run because the account had no credit; local adversarial review completed instead. No remote is configured, so push and PR creation are unavailable. Delivery is a scoped local commit.
