# Operational closure acceptance v1

- Evidence: **PUBLIC_DATA_CALIBRATED_SIMULATION_NOT_FIELD_KPI**
- Seed/run: `240520` / `ops-1135cd3c-96224459`
- Telemetry: 61 fields; 5/5 consistency gates passed
- Forecast: mpa-train-only-exponential-smoothing-v1; train 263, validation 114; model SHA-256 `02191efc030fa7050530066b83816c4046ca4d1df6010d62d29bed71c9fbb3fe`
- Grounded handoff: xiaoyi-operational-handoff.v1; 4 trace IDs; model impersonation false
- Controllers: 5 (FCFS, port SOP, operations research, MPC, optional completed-checkpoint RL)
- Closure: 2 approvals; receipt `receipt-50135c1835dedb4e`; idempotent replay true; rollback rolled_back
- Fail closed: data loss `DATA_QUALITY_GATE_BLOCKED`; simulator stop `SIMULATOR_STOPPED`
- Audit: verified; 8 records; head `53582c249a325d24fbc70983fa67ed1b38b1fbc86e2e76958ecc88e3b672f58e`
- Current source fingerprint: `e392e347149ce6900edd5f3d0d3dde610b6220aa6b03217d293132f21c8b2a7e`

This is a public-data-calibrated simulation acceptance artifact, not a field KPI or production-authority claim.
