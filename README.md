# MMM-MessageCenter

MMM-MessageCenter is a centralized notification hub for
[MagicMirror²](https://magicmirror.builders/). It receives, normalizes,
prioritizes, and displays messages from Home Assistant, MagicMirror modules, and
external systems so an installation can provide one calm, consistent
notification experience.

The project is intended to make MagicMirror behave less like a collection of
dashboard widgets and more like an ambient information appliance. The current
release provides a webhook, a synchronized in-memory message queue, toast alerts, semantic
attention notifications, an optional inbox, and optional page routing through
[MMM-pages](https://github.com/edward-shen/MMM-pages).

MessageCenter does not control LEDs, speakers, GPIO, or other hardware. It
publishes message and attention intent so any MagicMirror module or external
integration can decide how that intent should be presented.

![Home Assistant appliance and doorbell notifications in the MessageCenter inbox](docs/images/screenshot-home-assistant-notifications.png)

## Project status

MMM-MessageCenter is released and ready for everyday use. Its core MagicMirror
notification support requires no external service, account, API key, or special
hardware. Home Assistant, MQTT, camera snapshots, and other integrations are
optional and are configured separately by the user.

### Compatibility and validation

MMM-MessageCenter requires MagicMirror² 2.37.0 or newer and follows its Node.js
baseline: Node.js 22.21.1 or newer in the Node 22 series, or Node 24 and newer.
Release checks cover a standard MagicMirror configuration with line, compact,
and full-page presentation; optional transports; and no MMM-pages or hardware
integration.

The built-in interface is translated in English, German, Spanish, and French
and follows MagicMirror's global `language`, `locale`, and `timeFormat`
preferences. Incoming message titles and bodies are user content and are never
translated. See [Translations](#translations) for contribution guidance.

## Design principles

- One normalized entry point for household notifications.
- Hardware-independent and usable by vanilla MagicMirror installations.
- An optional UI rather than a required presentation layer.
- Semantic events instead of device-specific commands.
- Calm interactions that do not fight manual navigation.
- A stable core message schema that can gain providers and presentation adapters.

## Installation

Install from the MagicMirror directory:

```sh
cd ~/MagicMirror/modules
git clone https://github.com/bwente/MMM-MessageCenter.git
cd MMM-MessageCenter
npm ci --omit=dev
```

## Update

Update an existing installation from the module directory:

```sh
cd ~/MagicMirror/modules/MMM-MessageCenter
git pull
npm ci --omit=dev
```

## Configuration

### Standard MagicMirror region

Line mode is the calmest fit for an ordinary MagicMirror region. It shows the
newest three messages as transparent single rows with a priority edge, title,
and time. It does not require MMM-pages or any hardware integration:

```js
{
  module: "MMM-MessageCenter",
  position: "top_right",
  config: {
    displayMode: "line",
    maxVisibleMessages: 3,
    lineShowBody: false,
    showControls: false,
    showSummary: false,
    pages: false
  }
},
```

Set `lineShowBody: true` to add one truncated body line below each title. Line
mode intentionally omits images, source labels, and controls. The complete
bounded queue remains available internally, and other modules can still use
`MC_ACK_ALL`, `MC_CLEAR_READ`, and `MC_CLEAR_ALL`.

The recommended non-interactive configuration hides the unread/total summary
because the visible rows and urgency edges already communicate the useful
state. Keep `showSummary: true` when the count is useful, such as when retained
history may exceed `maxVisibleMessages`.

Use `displayMode: "compact"` when the region should show small cards with body
text, source labels, and image thumbnails. The same `maxVisibleMessages` option
sets the visible count in compact mode. Its history buttons remain hidden unless
`compactShowControls: true` is configured.

### Full-page inbox

```js
{
  module: "MMM-MessageCenter",
  position: "middle_center",
  classes: "message-center-page",
  config: {
    ui: "messages",
    displayMode: "page",
    maxVisibleMessages: null,
    showControls: true,
    pages: true,
    legacyAttentionEvents: true,
    messagesPage: 4,
    channelRoutes: {
      weather: 1
    },
    maxMessages: 50,
    expirationSweepInterval: 60000,
    syncInterval: 15000,
    publishAttentionState: true,
    showHeader: true,
    showSummary: true,
    showToasts: true,
    clearAttentionWhenViewed: true,
    internalNotifications: {
      remoteControl: {
        enabled: true
      },
      publicTransportHub: {
        enabled: true
      },
      weather: {
        enabled: true
      }
    },
    webhook: {
      host: "127.0.0.1",
      port: 8787,
      token: ""
    },
    transports: {
      mqtt: {
        enabled: false,
        url: "mqtt://127.0.0.1:1883",
        topic: "messagecenter/messages",
        username: "",
        password: ""
      },
      unixSocket: {
        enabled: false,
        path: "/tmp/mmm-messagecenter.sock",
        mode: 0o600
      }
    },
    images: {
      enabled: false,
      maxBytes: 1024 * 1024,
      maxCachedImages: 12,
      maxTotalBytes: 12 * 1024 * 1024,
      timeout: 5000,
      allowPrivateHosts: false,
      allowHttp: false
    }
  }
},
```

When using MMM-pages, add `"message-center-page"` to the desired page in that
module's `modules` configuration. See the
[MMM-pages configuration guide](https://github.com/edward-shen/MMM-pages#configuration)
for its complete page layout syntax.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `ui` | string | `"messages"` | Render the inbox when set to `messages`; other values keep it hidden. |
| `displayMode` | string | `"page"` | Use `page` for the full inbox, `compact` for small cards, or `line` for a minimal standard MagicMirror region. |
| `maxVisibleMessages` | integer or `null` | `null` | Render only the newest configured number without deleting retained history. Region modes show three messages when this is `null`. |
| `showControls` | boolean | `true` | Show history and per-message buttons where the display mode allows them. Set to `false` for non-touch displays. |
| `compactShowControls` | boolean | `false` | Show condensed history buttons in compact mode. |
| `lineShowBody` | boolean | `false` | Add one truncated body line beneath each line-mode title. |
| `pages` | boolean | `true` | Allow validated message actions to switch MMM-pages pages. |
| `legacyAttentionEvents` | boolean | `true` | Emit compatibility `ATTENTION_ON` and `ATTENTION_OFF` notifications. Structured attention state remains the preferred contract. |
| `messagesPage` | integer | `4` | Zero-based MMM-pages index containing the inbox. |
| `channelRoutes` | object | `{}` | Maps semantic channel names such as `weather` to MMM-pages indexes. The built-in `messages` route always uses `messagesPage`. |
| `maxMessages` | integer | `50` | Hard limit for all retained messages. Oldest history is displaced when the queue reaches this size. |
| `expirationSweepInterval` | number | `60000` | Milliseconds between active expiration checks; use `0` to disable. |
| `syncInterval` | number | `15000` | Milliseconds between display synchronization requests. This recovers messages after a browser or socket reconnect; use `0` to disable periodic synchronization. |
| `publishAttentionState` | boolean | `true` | Publish structured `MESSAGE_CENTER_ATTENTION_CHANGED` snapshots. |
| `showHeader` | boolean | `true` | Show the header containing the inbox title and any enabled summary or history controls. |
| `showSummary` | boolean | `true` | Show the unread/total summary beside the title. Set to `false` for a quieter non-interactive region. |
| `showToasts` | boolean | `true` | Send `SHOW_ALERT` for incoming messages. |
| `clearAttentionWhenViewed` | boolean | `true` | Mark messages read when their page opens. |
| `internalNotifications.enabled` | boolean | `true` | Allow configured providers to consume MagicMirror module notifications. |
| `internalNotifications.remoteControl.enabled` | boolean | `true` | Capture the calm default allowlist of user-facing MMM-Remote-Control notifications. |
| `internalNotifications.remoteControl.mappings` | object | See below | Explicit allowlist and normalization policy for notifications emitted by MMM-Remote-Control. |
| `internalNotifications.publicTransportHub.enabled` | boolean | `true` | Accept normalized `PTH_SERVICE_ALERT` broadcasts from MMM-PublicTransportHub. The sending feature remains disabled by default in that module. |
| `internalNotifications.weather.enabled` | boolean | `false` | Convert eligible default-weather forecasts into MessageCenter alerts. |
| `webhook.host` | string | `"127.0.0.1"` | Address on which the webhook listens. The secure default accepts only software running on the mirror. |
| `webhook.port` | integer | `8787` | Webhook TCP port. |
| `webhook.token` | string | `""` | Optional bearer token. When configured, every webhook request must provide it. |
| `transports.mqtt.enabled` | boolean | `false` | Subscribe to MQTT messages using the existing MessageCenter schema. |
| `transports.mqtt.url` | string | `"mqtt://127.0.0.1:1883"` | MQTT broker URL. Keep credentials in the separate username and password settings. |
| `transports.mqtt.topic` | string | `"messagecenter/messages"` | Exact MQTT topic to subscribe to. Use `topics` with an array for several exact topics. |
| `transports.mqtt.username` | string | `""` | Optional MQTT username stored only in private MagicMirror configuration. |
| `transports.mqtt.password` | string | `""` | Optional MQTT password stored only in private MagicMirror configuration. |
| `transports.unixSocket.enabled` | boolean | `false` | Accept newline-delimited JSON from local processes through a Unix-domain socket. |
| `transports.unixSocket.path` | string | `"/tmp/mmm-messagecenter.sock"` | Absolute local socket path. |
| `transports.unixSocket.mode` | integer | `0o600` | Filesystem permissions applied to the socket. |
| `images.enabled` | boolean | `false` | Fetch and preserve one remote image when a message enters through REST, MQTT, or the Unix socket. |
| `images.maxBytes` | integer | `1048576` | Maximum downloaded snapshot size; accepted range is 1 KiB through 5 MiB. |
| `images.maxCachedImages` | integer | `12` | Maximum newest snapshots retained. Older messages remain but release their image data. |
| `images.maxTotalBytes` | integer | `12582912` | Maximum decoded bytes retained across all snapshots. The count and byte limits both apply. |
| `images.timeout` | integer | `5000` | Image download timeout in milliseconds. |
| `images.allowPrivateHosts` | boolean | `false` | Permit image hosts resolving to private or local addresses. Enable only for trusted camera networks. |
| `images.allowHttp` | boolean | `false` | Permit unencrypted HTTP image URLs. HTTPS remains required by default. |

Messages are stored only in memory and reset when MagicMirror restarts.
`compactMaxMessages` and `lineMaxMessages` remain supported for compatibility
with earlier configurations, but new installations should use the universal
`maxVisibleMessages` option.
Inbox timestamps and newly generated weather-alert times follow MagicMirror's
global `timeFormat` (`12` or `24`) and `locale`/`language` preferences. Changing
those preferences reformats rendered metadata; it does not rewrite historical
message body text that was generated earlier.

The inbox is background-agnostic. Line mode is transparent by default; themes
that need extra contrast can set `--message-center-line-background`. Themes
that need an opaque full-page header while scrolling can set
`--message-center-header-background`:

```css
.MMM-MessageCenter {
  --message-center-line-background: rgba(0, 0, 0, 0.35);
  --message-center-header-background: #000;
}
```

### Non-touch presentation

Buttons can be omitted while retaining automatic viewed-state behavior and the
notification API used by other modules. `maxVisibleMessages` limits only the
rendered newest entries; `maxMessages` remains the hard queue limit.

```js
{
  module: "MMM-MessageCenter",
  position: "middle_center",
  config: {
    displayMode: "page",
    showControls: false,
    maxVisibleMessages: 6,
    clearAttentionWhenViewed: true
  }
},
```

## MagicMirror internal notifications

MessageCenter can consume MagicMirror's internal module broadcasts directly.
This keeps the notification experience useful without Home Assistant and lets
existing modules remain the authoritative data providers.

### MMM-Remote-Control

MMM-Remote-Control rebroadcasts remote `SHOW_ALERT` requests and can intentionally
forward any MagicMirror notification through its `NOTIFICATION` action.
MessageCenter uses an explicit allowlist rather than treating Remote Control's
operational traffic as household messages.

The defaults are:

```js
internalNotifications: {
  remoteControl: {
    enabled: true,
    mappings: {
      MC_MESSAGE: { mode: "message" },
      SHOW_ALERT: {
        mode: "alert",
        type: "remote.alert",
        source: "magicmirror.remote-control",
        urgency: "passive",
        retention: "archive"
      }
    }
  }
}
```

`SHOW_ALERT` is retained as passive history but does not create another toast,
because MagicMirror's alert module already receives the original alert.
An intentionally forwarded `MC_MESSAGE` payload enters the normal MessageCenter
schema and may request retention, attention, and routing:

```json
{
  "action": "NOTIFICATION",
  "notification": "MC_MESSAGE",
  "payload": {
    "id": "entry-reminder",
    "source": "remote-control",
    "type": "household.reminder",
    "title": "Front door",
    "body": "Please check the front door.",
    "urgency": "attention",
    "retention": "untilViewed"
  }
}
```

`REMOTE_ACTION`, `REGISTER_API`, presence, brightness, temperature, refresh,
module visibility, page navigation, and MessageCenter's own emitted events are
not captured. Replace `mappings` with a deliberately chosen mapping object to
change the allowlist; use `{}` to capture nothing while leaving the provider
available.

### MMM-PublicTransportHub

[MMM-PublicTransportHub](https://github.com/KristjanESPERANTO/MMM-PublicTransportHub)
can emit provider-neutral `PTH_SERVICE_ALERT` notifications for meaningful
delays, cancellations, service remarks, and an optional no-departures state.
Enable `outgoingNotifications` in that module; MessageCenter's receiving adapter
is enabled by default and can be disabled independently:

```js
internalNotifications: {
  publicTransportHub: {
    enabled: true
  }
}
```

MessageCenter treats the first active event as an attention message and toast.
Later updates with the same stable ID replace its content silently and preserve
its read state. A matching event with `active: false` removes the message and
clears its attention contribution. Sender-provided titles and bodies remain
unchanged, so transit alerts should use concise, self-contained titles that are
useful in line mode. Compact and full-page modes can show the longer body.

The adapter consumes only normalized events and does not interpret provider
responses, delays, routes, or service remarks itself. Both modules continue to
operate independently when the other is absent.

### Rain approaching

The first internal provider listens for `WEATHER_UPDATED` from MagicMirror's
default `weather` module. Enable it with:

```js
internalNotifications: {
  weather: {
    enabled: true,
    rain: {
      leadTimeMinutes: 60,
      windowMinutes: 45,
      probabilityThreshold: 50,
      amountThreshold: 0.1,
      channel: "weather",
      timeout: 10000
    }
  }
}
```

At least one default `weather` module instance must use `type: "hourly"`. That
instance broadcasts the provider-neutral `hourlyArray` used by the rule. Other
current or daily weather instances can coexist; their broadcasts do not contain
hourly data and will not incorrectly clear an active alert.

The default rule looks approximately one hour ahead, allowing a 45-minute
tolerance for provider forecast intervals. It alerts for a rain weather type
meeting the probability threshold or a forecast rain/precipitation amount
meeting the amount threshold. Snow-only forecasts are ignored.

Only one `rain-next-hour` event remains active at a time. Repeated weather
refreshes do not repeat its toast or attention signal. A later hourly update
without qualifying rain resolves the message and its attention state. As a
safety net, the message expires 90 minutes after the matched forecast time.

![Rain approaching weather alert in the MessageCenter inbox](docs/images/weather-alert.png)

| Rain option | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Enable the rain rule when the weather provider is enabled. |
| `leadTimeMinutes` | `60` | Forecast lead time to examine. |
| `windowMinutes` | `45` | Allowed distance on either side of the target time. |
| `probabilityThreshold` | `50` | Minimum rain probability percentage when using weather type. |
| `amountThreshold` | `0.1` | Minimum numeric rain or precipitation amount. |
| `urgency` | `"attention"` | Message urgency. |
| `retention` | `"untilViewed"` | Message retention and acknowledgement policy. |
| `channel` | `"weather"` | Semantic destination resolved through `channelRoutes`. |
| `timeout` | `10000` | Milliseconds before returning to the prior channel. |
| `expiresAfterMinutes` | `90` | Safety expiration measured from the forecast time. |

Home Assistant may still send the same semantic message through the webhook.
It is an optional provider rather than a runtime requirement.

## Sending messages

The webhook accepts a JSON object at `POST /message`:

```sh
curl http://127.0.0.1:8787/message \
  -H "Content-Type: application/json" \
  -d '{
    "source": "home-assistant",
    "entityId": "garage-door",
    "title": "Garage door open",
    "body": "The garage door has been open for 10 minutes.",
    "urgency": "attention",
    "retention": "untilViewed",
    "actions": { "switchChannel": "messages", "timeout": 10000 }
  }'
```

Home Assistant messages share the same inbox and attention model, whether they
contain a simple household update or a cached camera snapshot.

The default configuration accepts requests only from software running on the
mirror. To receive webhooks from Home Assistant or another LAN system, opt in
to network access and preferably configure a strong token:

```js
webhook: {
  host: "0.0.0.0",
  port: 8787,
  token: "GENERATE_A_STRONG_RANDOM_TOKEN"
}
```

Do not expose the webhook port directly to the public internet.

For permanent or less-trusted network installations, configure a strong token
and include it with every request:

```sh
curl http://MIRROR_IP:8787/message \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test message"}'
```

When a non-localhost webhook has no token, MessageCenter logs a startup warning.
Existing installations that intentionally accept LAN requests should keep an
explicit non-localhost `webhook.host` during upgrades.

### MQTT

MQTT is optional and disabled by default. Enable it when the installation
already has a broker; REST remains the easiest transport for new users. MQTT
payloads use exactly the same message schema as the webhook. The adapter
reconnects automatically, subscribes at QoS 0, accepts up to 32 KiB, and does
not log credentials.

Home Assistant can publish a message without changing its semantic fields:

```yaml
action: mqtt.publish
data:
  topic: messagecenter/messages
  payload: |-
    {
      "id": "storage-warning",
      "type": "system.storage",
      "source": "home-assistant",
      "title": "Storage running low",
      "body": "The mirror has less than 10% free space.",
      "urgency": "attention",
      "retention": "untilAcknowledged"
    }
```

Use stable source/ID pairs for conditions that may be reported repeatedly;
MessageCenter's normal update and deduplication behavior applies regardless of
transport. MQTT wildcard subscriptions are not currently supported.

### Unix socket

The Unix-domain socket is intended for trusted monitoring scripts running on
the mirror. It does not open a network port. Each newline-delimited JSON object
is normalized through the same path as REST and MQTT. The default `0o600` mode
allows only the MagicMirror process owner to connect; widen it deliberately
only when another local service account must publish.

For example, with `socat` installed:

```sh
printf '%s\n' '{"id":"system-network","type":"system.network","source":"system-monitor","title":"Network unavailable","body":"Connectivity has been unavailable for five minutes.","urgency":"attention","retention":"untilAcknowledged"}' \
  | socat - UNIX-CONNECT:/tmp/mmm-messagecenter.sock
```

For a novice-friendly starting point, [`examples/system-monitor.sh`](examples/system-monitor.sh)
checks free storage, sends only when the warning state changes, and clears the
active warning after recovery. It can be copied directly to the mirror and run
from cron or a systemd timer. The script requires `socat` and defaults to a 10%
free-space threshold; its path, threshold, socket, and state file can all be
overridden with environment variables.

MessageCenter supplies the transport, schema, and presentation. Disk, network,
temperature, and service checks should remain separate monitoring scripts or
services so the module stays hardware-independent.

### Image snapshots

When `images.enabled` is true, messages arriving through REST, MQTT, or the Unix
socket may include one image URL:

```json
{
  "id": "front-door-2026-08-02T12:00:00Z",
  "type": "security.doorbell",
  "source": "home-assistant",
  "title": "Someone is at the door",
  "body": "Doorbell motion was detected.",
  "urgency": "attention",
  "retention": "untilAcknowledged",
  "image": {
    "url": "https://images.example.net/events/doorbell.png",
    "alt": "Doorbell camera snapshot"
  }
}
```

MessageCenter downloads the snapshot during ingestion and embeds the captured
bytes in the in-memory message. The image therefore does not change if the URL
later points to a newer camera frame. Full-page cards show a larger contained
image; compact cards show a 96-by-64-pixel recognition thumbnail. Text remains
the authoritative alert and is still delivered if the image cannot be cached.

Only JPEG, PNG, and WebP content is accepted. MessageCenter validates both the
response content type and file signature, follows at most three validated
redirects, and does not pass the original URL to the browser. HTTPS and public
hosts are required by default. Private hosts and HTTP each require a separate,
explicit opt-in. Images remain in memory and disappear with message history or
when MagicMirror restarts. By default, the newest 12 images are retained within
a 12 MiB decoded-byte budget. Reaching either limit releases image data from
the oldest affected messages without deleting their text or history state.

## Message schema

The refined contract separates urgency from retention. Existing senders using
`priority: "attention"` or `priority: "ephemeral"` remain supported.

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Optional sender-provided identifier. |
| `source` | string | Origin such as `home-assistant`. |
| `entityId` | string | Optional stable subject such as `dishwasher` or `front-door`. |
| `type` | string | Semantic event type such as `appliance.complete`. |
| `title` | string | Message heading. |
| `body` | string | Message details. |
| `urgency` | string | `passive`, `attention`, or `critical`. Controls awareness and toast duration. |
| `retention` | string | `ephemeral`, `untilViewed`, `untilAcknowledged`, or `archive`. Explicit `ephemeral` messages do not enter inbox history. |
| `priority` | string | Legacy compatibility field: `ephemeral` or `attention`. |
| `timestamp` | number | Epoch timestamp in milliseconds. |
| `expires` | number | Optional expiration time in milliseconds. |
| `image.url` | string | Optional snapshot URL for enabled external image ingestion. HTTPS is required by default. |
| `image.alt` | string | Short accessible description of the snapshot. |
| `actions.switchChannel` | string or integer | Semantic destination or legacy MMM-pages index. `messages` is built in. |
| `actions.timeout` | number | Optional milliseconds before returning. |

Legacy `priority: "attention"` maps to `urgency: "attention"` and
`retention: "untilViewed"`. Legacy `priority: "ephemeral"` maps to passive,
bounded inbox history to preserve the original behavior. New senders should use
the explicit fields.

After the inbox first renders, it clears `untilViewed` attention and transitions
from the unread styling to the read urgency edge. Messages marked
`untilAcknowledged` continue requesting attention until the user explicitly
marks them read.

Messages received through REST, MQTT, or the Unix socket are held by the
MagicMirror server and synchronized across connected displays. A display that
reconnects requests the current queue, so a brief browser or socket interruption
does not silently lose an accepted message. Read, dismissal, clearing, and
expiration state are synchronized as well. The queue remains in memory only and
starts empty when the MagicMirror server restarts.

Messages remain in bounded in-memory history until they expire, are cleared, or
are displaced by `maxMessages`.

The header distinguishes unread attention from retained history. **Mark all
read** acknowledges unread messages; **Clear read** removes only acknowledged
history and preserves anything still unread. Each full-page message also has
**Mark read** and **Dismiss** controls. Compact mode keeps per-message controls
hidden unless `compactShowControls: true` is configured. Known internal sources
are shown with friendly labels, such as **Weather** instead of
`magicmirror.weather`.

A timed page action returns only while MessageCenter still owns the automatic
navigation. Turning the encoder, touching another channel, or otherwise changing
pages cancels the pending return so an alert cannot fight the user. Consecutive
timed alerts preserve the page that was visible before the first alert.

## Translations

MessageCenter currently includes English (`en`), German (`de`), Spanish (`es`),
and French (`fr`). MagicMirror selects the interface language from its global
`language` setting and formats timestamps using global `locale` and `timeFormat`
preferences.

Translation files cover MessageCenter-owned interface labels, accessibility
text, friendly source names, the Remote Control fallback title, and generated
rain-alert text. Titles and bodies supplied by a webhook, MQTT, Unix socket,
Home Assistant, Remote Control, or another MagicMirror module remain exactly as
the sender provided them.

To add a language, copy `translations/en.json`, translate every value without
changing its key, preserve interpolation variables such as `{title}`, `{time}`,
and `{location}`, and register the file in `getTranslations()`. `npm run check`
validates that every language has the same keys and variables as English.

## Notifications

MMM-MessageCenter emits `ATTENTION_ON` with the unread count and
`ATTENTION_OFF` when attention is cleared. Other modules may send `MC_ACK_ALL`
to mark messages read, `MC_CLEAR_READ` to remove acknowledged history while
preserving unread messages, or `MC_CLEAR_ALL` to empty the inbox. To act on one
message, send `MC_ACK_MESSAGE` or `MC_DISMISS_MESSAGE` with
`{ source: "message-source", id: "message-id" }`. Both fields are required so
identical IDs from different providers remain independent.

It also emits `MESSAGE_CENTER_ATTENTION_CHANGED` with `active`, `unreadCount`,
`highestUrgency`, `highestPriority` (compatibility alias), and `sources`. The
structured event is the preferred contract for new integrations; the legacy
events remain available for compatibility.

These are ordinary MagicMirror notifications. Any MagicMirror module may
consume them as an attention source, and external integrations can translate
the semantic state into lighting, sound, desktop notifications, or other
presentation without coupling that behavior to MessageCenter.

Potential senders include Home Assistant, calendars, cameras, doorbells,
weather services, household appliances, custom webhooks, and other MagicMirror
modules. All senders should normalize into the same message contract rather than
creating independent alert experiences.

## Development

```sh
npm run check
```

Open `dev/message-center-preview.html` in a browser to review a representative
five-message inbox inside a fixed 1024x600 stage without sending live household
events.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the complete change and release
verification checklist.

## License

MMM-MessageCenter is available under the [MIT License](LICENSE).
