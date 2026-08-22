# Changelog

All notable changes to MMM-MessageCenter are documented in this file.

## 0.2.0 - 2026-08-22

### Added

- Transparent line display mode for narrow standard MagicMirror regions, with
  priority edges, time-only metadata, a three-message default through the
  universal `maxVisibleMessages` setting, and optional single-line body text.
- Simplified region configuration documentation around `maxVisibleMessages`;
  older mode-specific limits remain supported for compatibility.
- Copy-and-paste local system-monitor example for storage, memory, load, and
  service-health alerts through the Unix socket or localhost webhook.

### Changed

- Aligned the supported Node.js range, Express, ESLint, and CI matrix with the
  current MagicMirror² toolchain.
- Reworked the README and wiki around standard MagicMirror installations,
  clearer onboarding examples, and prominent real-world screenshots.
- Removed the speculative roadmap so published documentation describes only
  implemented behavior.

## 0.1.0 - 2026-08-01

### Added

- Normalized message contract with independent urgency and retention.
- Newest-first in-memory history, expiration, deduplication, and acknowledgement.
- Individual message acknowledgement and dismissal controls and notifications.
- Webhook ingestion with optional bearer authentication.
- Optional MQTT and Unix-domain-socket transports using the same normalized schema.
- Optional ingestion-time image snapshots with full-page and compact presentation.
- MagicMirror internal notification ingestion for weather and MMM-Remote-Control.
- Toasts, semantic attention state, and optional MMM-pages channel routing.
- Integration-neutral attention-event configuration for presentation adapters.
- Inbox UI with urgency styling, read-state transitions, history controls, and
  MagicMirror locale and clock-format support.
- Compact region-friendly presentation for standard MagicMirror layouts.
- Unit tests, static UI preview, and live-test checklist.

### Security

- Webhook JSON size limits and optional bearer-token enforcement.
- Explicit allowlisting for MMM-Remote-Control ingestion to avoid operational
  traffic and recursive MessageCenter events.
- Image download limits, timeouts, signature checks, bounded redirects, and
  private-host/unencrypted-HTTP blocking by default.
- Localhost-only webhook binding by default; LAN access now requires explicit
  configuration.
- Rolling image-cache limits preserve the newest 12 snapshots within a 12 MiB
  decoded-byte budget while retaining older text history.
- Non-touch presentation can hide all buttons and limit rendered messages
  without deleting bounded queue history.
