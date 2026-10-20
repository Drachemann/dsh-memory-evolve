[id:01a9f6ab] [2026-10-20] [branch:main] [summary:Derived index rebuild]
Pattern: derived-index-rebuild
Confidence: 0.8
Supersedes: 01a9f6a0
Goal: Rebuild a derived search index from canonical files after a schema change.
Approach:
- Hash each source entry, upsert changed rows, delete missing rows.
Worked:
- The content-hash gate made the rebuild incremental and idempotent.
Failed:
- The first pass re-embedded unchanged text because the hash covered the file, not the entry.
Correction:
- Hash the serialized entry, not the file.
Reuse when:
- A derived store is rebuilt from a canonical one and must not repeat expensive work.
Refs: gbrain:concepts/derived-index; commit:abc123
