# Changelog

All notable changes to MMM-MessageCenter are documented in this file.

## 0.1.0 - 2026-08-01

### Added

- Normalized message contract with independent urgency and retention.
- Newest-first in-memory history, expiration, deduplication, and acknowledgement.
- Webhook ingestion with optional bearer authentication.
- MagicMirror internal notification ingestion for weather and MMM-Remote-Control.
- Toasts, semantic attention state, and optional MMM-pages channel routing.
- Integration-neutral attention-event configuration with compatibility for the
  former Seymour-named option.
- Inbox UI with urgency styling, read-state transitions, history controls, and
  MagicMirror locale and clock-format support.
- Unit tests, product roadmap, static UI preview, and live-test checklist.

### Security

- Webhook JSON size limits and optional bearer-token enforcement.
- Explicit allowlisting for MMM-Remote-Control ingestion to avoid operational
  traffic and recursive MessageCenter events.
