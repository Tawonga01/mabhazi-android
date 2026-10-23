# Capture UI decisions

## 22 October 2026 — default fare pop-up

Status: **user-directed**.

The user answered **Focused fare as the default** when asked to choose between the supplied FocusedFare and longer contextual fare variants. Use [FocusedFare.tsx](references/2026-10-22/mabhazi/FocusedFare.tsx) and its [styles](references/2026-10-22/mabhazi/FocusedFare.css) as the default visual reference for quick fare contributions, with additional fare conditions revealed when needed. The fuller editor remains part of the wider contribution flow.

This supersedes earlier pending/recommendation-only wording about the default fare variant. It does not approve every other visual choice or the separate location/bulletin concepts.

Preserve required fare context and conditional paid travel dates, explicit currency/ticket meaning, Unknown/Skip and private receipt recovery. Example USD/adult/single values must not become invented observed facts. Adapt the supplied appearance to native keyboard, Android insets, touch targets and accessibility without adding a Replit dependency.

The original design source remains unchanged. This records the design choice; it is not an installed native form, successful API integration, deployment or full WP08/WP09 acceptance.
