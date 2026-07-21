# MMM-MessageCenter product roadmap

Status: living direction, not a release commitment

MMM-MessageCenter is the notification and attention layer for MagicMirror. Its
job is to accept messages from many systems, apply consistent lifecycle and
routing policy, and publish semantic state that any UI or hardware adapter may
present.

Seymour is the first appliance integration, not a requirement. A vanilla
MagicMirror installation should be able to use the inbox and toast behavior with
all hardware integrations disabled.

## Product boundary

MessageCenter owns:

- input validation and message normalization;
- queue ordering, retention, expiration, and acknowledgement;
- deduplication and message identity;
- toast and optional inbox presentation;
- interruption and return policy;
- semantic attention state;
- a stable interface for input providers and presentation adapters.

MessageCenter does not own:

- WLED presets or effects;
- GPIO pins, LEDs, buttons, or rotary encoders;
- speaker or audio-device control;
- camera transport and authentication;
- Home Assistant entity implementation;
- the physical form or interaction model of a particular appliance.

Those responsibilities belong to adapters such as MMM-Seymour, Home Assistant
automations, camera providers, or future sound and desktop-notification modules.

## Current message contract

The implemented message shape is:

```json
{
  "id": "dishwasher-cycle-1042",
  "type": "appliance.complete",
  "source": "home-assistant",
  "title": "Dishwasher",
  "body": "The dishes are done",
  "priority": "attention",
  "timestamp": 1784608200000,
  "unread": true,
  "expires": null,
  "actions": {
    "switchChannel": 4,
    "timeout": 10000
  }
}
```

Messages are ordered newest first. Current priority values are `ephemeral` and
`attention`, and both are presently retained in the in-memory queue. Messages
are lost when MagicMirror restarts.

## Target lifecycle model

Urgency and retention are separate concerns and should evolve independently.

### Urgency

- `passive`: useful information without an attention request;
- `attention`: requires timely awareness;
- `critical`: future highest urgency with explicit acknowledgement policy.

### Retention

- `ephemeral`: toast or transient display, not retained in the inbox;
- `untilViewed`: retained until the message page is viewed;
- `untilAcknowledged`: retained until explicit user acknowledgement;
- `archive`: retained according to configured history policy.

This separation allows a low-urgency dishwasher completion to remain until
viewed while a time-sensitive weather warning can demand attention and still
expire automatically.

The transition must preserve compatibility with existing `ephemeral` and
`attention` senders.

## Semantic attention

The current compatibility events are:

- `ATTENTION_ON`
- `ATTENTION_OFF`

The target contract also publishes a structured snapshot:

```js
MESSAGE_CENTER_ATTENTION_CHANGED
{
  active: true,
  unreadCount: 3,
  highestPriority: "attention",
  sources: ["home-assistant", "weather"]
}
```

Consumers decide whether that means a WLED animation, a GPIO indicator, a sound,
a screen effect, a desktop notification, or no additional presentation. Legacy
events remain during a compatibility period.

## Page and channel routing

The current action accepts a zero-based MMM-pages index:

```json
{
  "switchChannel": 2,
  "timeout": 10000
}
```

Automatic navigation returns only while MessageCenter still owns the temporary
page change. Manual encoder, keyboard, or touch navigation cancels the return.
Consecutive timed alerts preserve the page visible before the first alert.

Numeric indexes are fragile when users reorder pages. The target contract adds
semantic destinations while retaining numeric compatibility:

```json
{
  "switchChannel": "weather",
  "timeout": 10000
}
```

A routing adapter resolves the semantic channel to the installed page system.

## Input providers

The HTTP webhook is the first provider. Future providers may include:

- MagicMirror notifications;
- MQTT topics and Home Assistant entities;
- calendars and scheduled reminders;
- cameras and doorbells;
- weather alert feeds;
- plugin-defined local or remote sources.

All providers normalize into the same core message object. Provider-specific
credentials and transport details must not leak into the core schema.

## Presentation adapters

The built-in inbox and MagicMirror toast notification are the first presentation
surfaces. Future adapters may include:

- Seymour WLED status and attention patterns;
- audio cues and spoken alerts;
- screen-edge or full-screen critical effects;
- desktop and mobile notifications;
- synchronized displays on multiple mirrors.

Presentation adapters consume semantic state and must not become message
producers merely to control hardware.

## Delivery phases

### Phase 1 — working baseline

- HTTP webhook with bearer-token support;
- normalized message object;
- newest-first in-memory queue;
- toast notifications;
- attention lifecycle compatibility events;
- optional MMM-pages routing and timed return;
- user navigation cancels automatic return;
- built-in inbox with unread treatment and acknowledgement;
- confirmed Home Assistant delivery on Seymour.

### Phase 2 — appliance UX and lifecycle

- message icons and source identity;
- categories and filtering;
- deduplication by source and message ID;
- active expiration and message aging;
- separate urgency and retention fields;
- individual and bulk acknowledgement;
- structured attention-state event;
- semantic channel destinations;
- continued physical-device layout and interaction testing.

### Phase 3 — reliable and rich notifications

- persistent storage and restart recovery;
- camera snapshots and media attachments;
- configurable sounds and speech;
- safe notification actions;
- critical-alert and manual-acknowledgement policy;
- provider separation for webhook, MQTT, and MagicMirror inputs.

### Phase 4 — notification platform

- documented provider and presentation plugin APIs;
- notification rules and user-defined policies;
- scheduled reminders;
- cross-mirror synchronization;
- mobile or companion-client support.

## Decision rules

When evaluating roadmap work:

1. Preserve a calm appliance experience; interruption must be proportional.
2. Never let an automatic action fight explicit user navigation.
3. Keep the message contract independent of hardware and page implementations.
4. Prefer semantic state over device commands.
5. Preserve backward compatibility or document an intentional migration.
6. Validate changes on the physical Seymour display as well as in unit tests.
7. Treat this roadmap as revisable evidence of direction, not a promise that
   every exploratory feature will ship.
