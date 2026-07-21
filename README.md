# MMM-MessageCenter

MMM-MessageCenter is a centralized notification hub for
[MagicMirror²](https://magicmirror.builders/). It receives, normalizes,
prioritizes, and displays messages from Home Assistant, MagicMirror modules, and
external systems so an installation can provide one calm, consistent
notification experience.

The project is intended to make MagicMirror behave less like a collection of
dashboard widgets and more like an ambient information appliance. The current
release provides a webhook, an in-memory message queue, toast alerts, semantic
attention notifications, an optional inbox, and optional page routing through
[MMM-pages](https://github.com/edward-shen/MMM-pages).

MessageCenter does not control LEDs, speakers, GPIO, or other hardware. It
publishes message and attention intent; integrations such as MMM-Seymour decide
how that intent should be presented.

## Design principles

- One normalized entry point for household notifications.
- Hardware-independent and usable by vanilla MagicMirror installations.
- An optional UI rather than a required presentation layer.
- Semantic events instead of device-specific commands.
- Calm interactions that do not fight manual navigation.
- A stable core message schema that can gain providers and presentation adapters.

See the [living product roadmap](docs/ROADMAP.md) for the boundary between
current behavior, near-term work, and exploratory ideas.

## Installation

From the MagicMirror `modules` directory:

```sh
git clone https://github.com/bwente/MMM-MessageCenter.git
cd MMM-MessageCenter
npm install --omit=dev
```

## Configuration

```js
{
  module: "MMM-MessageCenter",
  position: "middle_center",
  classes: "message-center-page",
  config: {
    ui: "messages",
    pages: true,
    attention: "seymour",
    messagesPage: 4,
    channelRoutes: {
      weather: 1
    },
    maxMessages: 50,
    expirationSweepInterval: 60000,
    publishAttentionState: true,
    showHeader: true,
    showToasts: true,
    clearAttentionWhenViewed: true,
    internalNotifications: {
      weather: {
        enabled: true
      }
    },
    webhook: {
      host: "127.0.0.1",
      port: 8787,
      token: ""
    }
  }
}
```

Place the module class on the corresponding MMM-pages page:

```js
{
  module: "MMM-pages",
  config: {
    modules: [
      ["page-0"],
      ["page-1"],
      ["page-2"],
      ["page-3"],
      ["message-center-page"]
    ]
  }
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `ui` | string | `"messages"` | Render the inbox when set to `messages`; other values keep it hidden. |
| `pages` | boolean | `true` | Allow validated message actions to switch MMM-pages pages. |
| `attention` | string | `"seymour"` | Compatibility switch for emitting generic attention notifications; use another value to disable them. This option will become integration-neutral. |
| `messagesPage` | integer | `4` | Zero-based MMM-pages index containing the inbox. |
| `channelRoutes` | object | `{}` | Maps semantic channel names such as `weather` to MMM-pages indexes. The built-in `messages` route always uses `messagesPage`. |
| `maxMessages` | integer | `50` | Maximum messages retained in browser memory. |
| `expirationSweepInterval` | number | `60000` | Milliseconds between active expiration checks; use `0` to disable. |
| `publishAttentionState` | boolean | `true` | Publish structured `MESSAGE_CENTER_ATTENTION_CHANGED` snapshots. |
| `showHeader` | boolean | `true` | Show the inbox title, count, and touch-friendly acknowledgement control. |
| `showToasts` | boolean | `true` | Send `SHOW_ALERT` for incoming messages. |
| `clearAttentionWhenViewed` | boolean | `true` | Mark messages read when their page opens. |
| `internalNotifications.enabled` | boolean | `true` | Allow configured providers to consume MagicMirror module notifications. |
| `internalNotifications.weather.enabled` | boolean | `false` | Convert eligible default-weather forecasts into MessageCenter alerts. |
| `webhook.host` | string | `"127.0.0.1"` | Address on which the webhook listens. |
| `webhook.port` | integer | `8787` | Webhook TCP port. |
| `webhook.token` | string | `""` | Bearer token required for non-localhost listening. |

Messages are stored only in memory and reset when MagicMirror restarts.

## MagicMirror internal notifications

MessageCenter can consume MagicMirror's internal module broadcasts directly.
This keeps the notification experience useful without Home Assistant and lets
existing modules remain the authoritative data providers.

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

To receive requests from another device, bind to a LAN address such as
`"0.0.0.0"` and configure a strong token. Then include it with every request:

```sh
curl http://MIRROR_IP:8787/message \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test message"}'
```

Do not expose this webhook directly to the public internet.

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
| `actions.switchChannel` | string or integer | Semantic destination or legacy MMM-pages index. `messages` is built in. |
| `actions.timeout` | number | Optional milliseconds before returning. |

Legacy `priority: "attention"` maps to `urgency: "attention"` and
`retention: "untilViewed"`. Legacy `priority: "ephemeral"` maps to passive,
bounded inbox history to preserve the original behavior. New senders should use
the explicit fields.

Viewing the inbox clears `untilViewed` attention. Messages marked
`untilAcknowledged` continue requesting attention until the user explicitly
marks them read. Messages remain in bounded in-memory history until they expire,
are cleared, or are displaced by `maxMessages`.

A timed page action returns only while MessageCenter still owns the automatic
navigation. Turning the encoder, touching another channel, or otherwise changing
pages cancels the pending return so an alert cannot fight the user. Consecutive
timed alerts preserve the page that was visible before the first alert.

## Notifications

MMM-MessageCenter emits `ATTENTION_ON` with the unread count and
`ATTENTION_OFF` when attention is cleared. Other modules may send `MC_ACK_ALL`
to mark messages read or `MC_CLEAR_ALL` to empty the inbox.

It also emits `MESSAGE_CENTER_ATTENTION_CHANGED` with `active`, `unreadCount`,
`highestUrgency`, `highestPriority` (compatibility alias), and `sources`. The
structured event is the preferred contract for new integrations; the legacy
events remain available for compatibility.

These are ordinary MagicMirror notifications; MessageCenter does not control
WLED or depend on a particular lighting implementation. MMM-Seymour may consume
them as one attention source alongside Home Assistant, calendar, or other
modules.

Potential senders include Home Assistant, calendars, cameras, doorbells,
weather services, household appliances, custom webhooks, and other MagicMirror
modules. All senders should normalize into the same message contract rather than
creating independent alert experiences.

## Development

```sh
npm test
```

Open `dev/message-center-preview.html` in a browser to review a representative
five-message inbox inside a fixed 1024x600 stage without sending live household
events.

## License

No license has been selected yet. Until one is added, the source is not granted
for reuse or redistribution.
