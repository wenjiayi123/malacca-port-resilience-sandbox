# Godot Web Simulator Export

Generated Godot Web files are intentionally excluded from Git. A `.pck` export is
larger than GitHub's normal single-file limit, and committing only part of an
export would leave a broken simulator.

From the repository root, generate the complete local export with:

```bash
GODOT_PROJECT="/path/to/current/sailing-simulator" \
GODOT_BIN="/path/to/godot" pnpm demo:godot:web
```

The React dashboard embeds `index.html` from this directory when the complete
export exists. Without it, the dashboard keeps working and displays the export
instructions instead of presenting a non-functional demo as a live simulator.

The command exports into staging first and checks the complete HTML, JavaScript,
PCK and WebAssembly bundle before switching it into place. A failed export leaves
the previous bundle available. Successful replacement preserves that bundle under
`.runtime/godot-exports/backup-*` and writes `export-manifest.json` with the source
Git SHA, dirty state, export time, and artifact hashes and sizes. Rebuild the web
application before validating the production server, because it serves `dist`.
Godot imports run in an isolated source copy, so generating metadata cannot dirty
the selected simulator checkout. Install export templates matching the engine
version before running the command.

The isolated Web copy explicitly selects Stream playback for the four procedural
ship ambience channels, because Godot Web's default Sample playback cannot play
`AudioStreamGenerator` output. Other audio and the original simulator source are
unchanged. The manifest records this compatibility patch, its source file, and
the before/after hashes; a changed source layout stops the export for review.

The isolated Web bridge also translates the entire geographic route into a safe
corridor in the current scene's unmodified terrain. This preserves direction,
length and progress; request-specific risk obstacles are added afterwards in the
same translated frame. The deterministic search chooses the smallest feasible
translation among its candidates and fails explicitly if it cannot find one.
This is local simulation embedding, not verified geographic calibration.

Before installation, the actual exported PCK must pass the coordinate regression:
a no-risk request, the original risk request, and an injected near-destination
closure run for at least two seconds with immediate headless completion disabled.
The gate also checks geometric invariants, missing endpoint fallbacks, and clean
counters after a failed mapping. `coordinate-validation.json` preserves the real
results, and the export manifest binds the evidence, fixture, and verifier hashes.

## Local standalone validation

Run the dashboard through its local Node service (`pnpm dev`, or `pnpm start`
after building) with Godot **4.7.1** installed and the complete, coordinate-validated
export above available in `public/godot-simulator`. The native service verifies
`index.pck` against `export-manifest.json`. It discovers Godot from `GODOT_BIN`,
the standard macOS application location, or `godot4`/`godot` on `PATH`; set
`GODOT_BIN` to an absolute executable path when needed. If the service has
`PORT_API_TOKEN` configured, enter the same token in the dashboard data connection
settings. Native launch requires a local, same-origin connection.

In 沙盘推演, select a vessel, click **生成信息流**, then **独立模拟器验证**.
The current request is sent to a separate Godot window and its matching real
result returns automatically. **内嵌预览** remains available separately. Closing or
cancelling from this task targets its own native window; a completed result is
retained, while cancellation before completion does not create a result. Starting
the next validation closes the previous window managed by this service.

This runs an approximately **two-second validation window**, not a full voyage or
verified field-navigation acceptance. Missing native prerequisites produce an
explicit error and do not silently switch to the embedded Web preview.
