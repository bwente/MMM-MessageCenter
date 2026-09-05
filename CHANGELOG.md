# Changelog

All notable changes to MMM-MessageCenter are documented in this file.

## Unreleased

## 0.5.0 - 2026-09-05

### Added

- Add an ordered adapter registry that keeps the standard MessageCenter API,
  Remote Control, weather, PublicTransportHub, and generic module alert
  ingestion independent and configurable.
- Capture valid `SHOW_ALERT` and `SHOW_NOTIFICATION` broadcasts from ordinary
  MagicMirror modules as passive history by default, with a conservative
  allowlist and recursion prevention.
- Accept `MESSAGE_CENTER_MESSAGE` from any ordinary MagicMirror module as the
  preferred rich integration API while retaining `MC_MESSAGE` compatibility.
- Add provider-neutral `MESSAGE_CENTER_SYNC` snapshots for safely updating an
  authoritative active set and resolving source messages no longer present.
- Add module integration documentation and an adapter-request issue template
  so enhanced integrations can be proposed and maintained in MessageCenter.

### Changed

- Move bundled integration normalization out of the main module routing path.
  Specific adapters take precedence over generic alert capture.

## 0.4.0 - 2026-09-05

### Added

- Add `showSummary` so non-interactive regions can hide the unread/total badge
  without removing the Messages heading. The existing summary remains enabled
  by default for compatibility.
- Add an optional MMM-PublicTransportHub adapter for normalized
  `PTH_SERVICE_ALERT` events. New alerts create attention and a toast, stable-ID
  updates replace content silently while preserving read state, and resolved
  alerts are removed.
- Add translated Public Transport source labels in English, German, Spanish,
  and French while preserving sender-authored alert titles and bodies.

### Changed

- Keep line mode intentionally constrained to its existing single-line title
  and optional single-line body presentation for service alerts.

### Fixed

- Update the locked `qs` transitive dependency to 6.16.0 to address its
  published request-parsing denial-of-service advisories.
- Keep expiration checks active while MagicMirror hides or suspends the module,
  restore a missing sweep when retained history arrives, and recheck expiration
  when the module resumes or Electron becomes visible again. Expiration now uses
  an immediate redraw, and every render defensively excludes stale history.
- Retain REST, MQTT, and Unix-socket messages in the server-side in-memory queue
  and periodically synchronize connected displays, preventing accepted messages
  from being lost during browser or socket reconnects. Read, dismissal, clear,
  and expiration state now converge across displays.
- Keep shared transports running when an individual browser client refreshes or
  closes instead of allowing that client to stop the server-wide listeners.

### Documentation

- Added a contributor and release-verification checklist covering focused
  changes, translations, metadata, sensitive-data review, clean-clone
  installation, screenshot privacy, tested versions, and CI requirements.
- Made `npm run check` the documented local development baseline.

## 0.3.0 - 2026-08-22

### Added

- MagicMirror-native interface translations with a complete English fallback
  plus German, Spanish, and French language files.
- Translation coverage for interface and accessibility labels, friendly source
  names, the Remote Control fallback title, and generated rain-alert text while
  preserving sender-authored message titles and bodies.
- Translation key and interpolation-variable parity tests, rendered coverage
  for line, compact, and full-page modes, and standalone operation without
  MMM-pages or companion hardware integrations.
- A single `npm run check` entry point for lint and the complete test suite.

### Changed

- Set the compatibility baseline to MagicMirror² 2.37.0 and its supported
  Node.js range: 22.21.1 or newer in the Node 22 series, or Node 24 and newer.
- Updated CI to run the same project check used for local release validation.

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
