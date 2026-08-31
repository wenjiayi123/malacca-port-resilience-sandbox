# Operational closure acceptance v2

- Evidence: **PUBLIC_DATA_CALIBRATED_SIMULATION_NOT_FIELD_KPI**
- Seed/run: `240520` / `ops-1135cd3c-a52eac07`
- Telemetry: 61 fields; 5/5 consistency gates passed
- Forecast: mpa-train-only-exponential-smoothing-v1; train 263, validation 114; model SHA-256 `02191efc030fa7050530066b83816c4046ca4d1df6010d62d29bed71c9fbb3fe`
- Grounded handoff: xiaoyi-operational-handoff.v1; 4 trace IDs; model impersonation false
- Controllers: 5 (FCFS, port SOP, operations research, MPC, optional completed-checkpoint RL)
- Closure: 2 approvals; receipt `receipt-b16601cb0f66d10f`; idempotent replay true; rollback rolled_back
- Core RL: factorized-linear-dyna-q / curriculum-360; 5 seeds; 10 heads; active 3; paired receipt `core-receipt-86b1a9eccd808495`; idempotent replay true; rollback rolled_back
- Core RL attribution: `paired_deterministic_simulation_counterfactual_not_field_causal_estimate`; baseline `b043ebf7f654162a341cafc0aa7b05f2890b8007b6757f415fc3ee6f479eadc0`; RL output `a8987914c1a14a0e15daaef32feb87e666db5b962718992be91827b275b11896`
- Fail closed: data loss `DATA_QUALITY_GATE_BLOCKED`; simulator stop `SIMULATOR_STOPPED`
- Audit: verified; 10 records; head `31644cdda4bb614b49e0c2f74ddb4140b153fb291e4379dbff18f86bb9a595bd`
- Current source fingerprint: `4f203c886aff3771a34af7e084f71e2a04b7aa89eeabbd377bc8d2b11acedebe`

This additive v2 artifact preserves the v1 and regulatory extension bytes. It is a public-data-calibrated simulation acceptance artifact, not a field KPI or production-authority claim.
