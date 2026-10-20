[id:01b2c3d4] [2026-10-19] [branch:main] [summary:Route parity for dream phases]
Pattern: model-route-parity
Confidence: 0.85
Goal: Make every model route that code reads visible in the route registry.
Approach:
- Grep for the route string in code, then compare it with the registry and the CLI display.
Worked:
- The parity test failed on the hidden dream route before the fix and passed after it.
Failed:
- The first assumption was that config set refused the key; it accepted it.
Correction:
- The defect was display parity, not acceptance.
Reuse when:
- A config key is read by code but missing from the operator-facing route list.
Refs: commit:def456; test:model-route-registry
