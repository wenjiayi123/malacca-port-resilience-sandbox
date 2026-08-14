# Operational closure acceptance v1

- Evidence: **PUBLIC_DATA_CALIBRATED_SIMULATION_NOT_FIELD_KPI**
- Seed/run: `240520` / `ops-1135cd3c-96224459`
- Telemetry: 61 fields; 5/5 consistency gates passed
- Forecast: mpa-train-only-exponential-smoothing-v1; train 263, validation 114; model SHA-256 `02191efc030fa7050530066b83816c4046ca4d1df6010d62d29bed71c9fbb3fe`
- Grounded handoff: xiaoyi-operational-handoff.v1; 4 trace IDs; model impersonation false
- Controllers: 5 (FCFS, port SOP, operations research, MPC, optional completed-checkpoint RL)
- Closure: 2 approvals; receipt `receipt-2b63129575f868d3`; idempotent replay true; rollback rolled_back
- Fail closed: data loss `DATA_QUALITY_GATE_BLOCKED`; simulator stop `SIMULATOR_STOPPED`
- Audit: verified; 8 records; head `164ef8940455a8cbb3937cf698741569aae69bcd51889ed87e7b21835a872593`
- Current source fingerprint: `459934642ed7dda0ab7123f625fad318e080e3b27876d12ccb008b37a9bd25f9`

This is a public-data-calibrated simulation acceptance artifact, not a field KPI or production-authority claim.
