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
    maxMessages: 50,
    expirationSweepInterval: 60000,
    publishAttentionState: true,
    showHeader: true,
    showToasts: true,
    clearAttentionWhenViewed: true,
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
| `maxMessages` | integer | `50` | Maximum messages retained in browser memory. |
| `expirationSweepInterval` | number | `60000` | Milliseconds between active expiration checks; use `0` to disable. |
| `publishAttentionState` | boolean | `true` | Publish structured `MESSAGE_CENTER_ATTENTION_CHANGED` snapshots. |
| `showHeader` | boolean | `true` | Show the inbox title, count, and touch-friendly acknowledgement control. |
| `showToasts` | boolean | `true` | Send `SHOW_ALERT` for incoming messages. |
| `clearAttentionWhenViewed` | boolean | `true` | Mark messages read when their page opens. |
| `webhook.host` | string | `"127.0.0.1"` | Address on which the webhook listens. |
| `webhook.port` | integer | `8787` | Webhook TCP port. |
| `webhook.token` | string | `""` | Bearer token required for non-localhost listening. |

Messages are stored only in memory and reset when MagicMirror restarts.

## Sending messages

The webhook accepts a JSON object at `POST /message`:

```sh
curl http://127.0.0.1:8787/message \
  -H "Content-Type: application/json" \
  -d '{
    "source": "home-assistant",
    "title": "Garage door open",
    "body": "The garage door has been open for 10 minutes.",
    "priority": "attention",
    "actions": { "switchChannel": 4, "timeout": 10000 }
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

The current schema is intentionally small. Its priority names blur urgency and
retention even though the current queue stores both values. The roadmap separates
those concepts without breaking existing senders.

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Optional sender-provided identifier. |
| `source` | string | Origin such as `home-assistant`. |
| `title` | string | Message heading. |
| `body` | string | Message details. |
| `priority` | string | `ephemeral` or `attention`. |
| `timestamp` | number | Epoch timestamp in milliseconds. |
| `expires` | number | Optional expiration time in milliseconds. |
| `actions.switchChannel` | integer | Optional MMM-pages target index. |
| `actions.timeout` | number | Optional milliseconds before returning. |

A timed page action returns only while MessageCenter still owns the automatic
navigation. Turning the encoder, touching another channel, or otherwise changing
pages cancels the pending return so an alert cannot fight the user. Consecutive
timed alerts preserve the page that was visible before the first alert.

## Notifications

MMM-MessageCenter emits `ATTENTION_ON` with the unread count and
`ATTENTION_OFF` when attention is cleared. Other modules may send `MC_ACK_ALL`
to mark messages read or `MC_CLEAR_ALL` to empty the inbox.

It also emits `MESSAGE_CENTER_ATTENTION_CHANGED` with `active`, `unreadCount`,
`highestPriority`, and `sources`. The structured event is the preferred contract
for new integrations; the legacy events remain available for compatibility.

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
