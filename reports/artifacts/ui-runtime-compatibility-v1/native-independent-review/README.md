# Independent native Godot review

Captured final review: 19/19 checks passed. Both intermediate race failures are retained alongside the corrected results.

The headless timing receipt records scene readiness at 8.393 seconds, final physics result at 10.564 seconds, and total process wall time of 11.771 seconds. It does not measure native GPU/window readiness.

Only filesystem paths were redacted or parameterized. Test assertions, race ordering, physics results and timings were preserved. The archived API probe consolidates the inline snippets that were actually executed. The archive operation did not rerun tests.

To use the probes from the repository root, set `NATIVE_REVIEW_DIR` to a separate writable evidence directory and `NATIVE_REVIEW_FIXTURE_ENGINE` to an installed harmless `true` executable. Run the API probe with Node's `--experimental-strip-types` option. For the timing probe, place the archived `request.json` in that evidence directory and run the installed Godot executable with `--headless --main-pack public/godot-simulator/index.pck --script` followed by the archived `timing.gd` path.

The two `before-fix` files describe the intermediate implementation observed during review. The current probe targets the repaired implementation; it must not overwrite the historical archive.
