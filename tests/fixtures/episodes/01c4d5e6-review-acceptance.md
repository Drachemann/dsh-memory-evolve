[id:01c4d5e6] [2026-10-18] [branch:main] [summary:Review acceptance and deferral]
Pattern: review-acceptance
Confidence: 0.7
Goal: Separate review findings that must be fixed from those that can be accepted or deferred.
Approach:
- Classify each finding by whether it changes behavior, cost, or privacy.
Worked:
- The two pre-existing verify failures were proven on a pristine checkout before they were deferred.
Failed:
- The first review conflated a wrong finding with a real one.
Correction:
- Verify the premise before writing the remedy.
Reuse when:
- A review produces findings with different urgency and the plan needs a decision record.
Refs: docs/designs/LOCAL_EMBED_DREAM_RERANK.md
