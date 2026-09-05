# Integrating MagicMirror modules

MessageCenter uses three integration levels. Most modules do not need custom
code.

## Automatic alert capture

MessageCenter captures valid `SHOW_ALERT` and `SHOW_NOTIFICATION` payloads from
ordinary MagicMirror modules by default. Operational notifications are not
captured. A payload needs a non-empty `title`, `message`, or `body`:

```js
this.sendNotification("SHOW_ALERT", {
  title: "Train delayed",
  message: "The 8:15 service is running 12 minutes late."
});
```

These become passive, archived messages. MessageCenter does not emit another
toast for them because the original alert is already being presented.

## Standard MessageCenter API

Modules can opt into stable identity, attention, retention, expiration, and
resolution by sending `MESSAGE_CENTER_MESSAGE` with the standard schema:

```js
this.sendNotification("MESSAGE_CENTER_MESSAGE", {
  id: "garage-door-open",
  type: "security.entry",
  source: "magicmirror.garage-door",
  title: "Garage door",
  body: "The garage door is still open.",
  urgency: "attention",
  retention: "untilViewed",
  expires: Date.now() + 30 * 60 * 1000
});
```

`MC_MESSAGE` remains supported as a shorter compatibility name.

## Bundled adapters

Adapters improve existing module notifications without requiring changes to
their public payloads. They can add stable update and resolution behavior,
better defaults, source labels, or provider-specific normalization. Bundled
adapters are stored in `integrations/` and registered through
`adapter-registry.js`. More-specific adapters run before the generic fallback.

An adapter exports no Node-specific API. It registers a small object:

```js
(function registerExampleAdapter(root) {
  root.MessageCenterAdapters.register({
    id: "example",
    priority: 500,
    matches(module, notification, payload, sender) {
      return notification === "EXAMPLE_ALERT" && module.isSender(sender, "MMM-Example");
    },
    handle(module, notification, payload) {
      if (!payload?.title) return false;
      return module.receiveMessage({
        id: payload.id,
        type: "example.alert",
        source: "magicmirror.example",
        title: payload.title,
        body: payload.body || "",
        urgency: "attention",
        retention: "untilViewed"
      });
    }
  });
})(globalThis);
```

Add the file to `getScripts()`, add an independent configuration switch, and
test accepted, updated, resolved, malformed, operational, and recursive cases
as applicable. Sender-authored titles and bodies must remain untranslated.

## Requesting an adapter

If a module is not captured automatically, or its existing events could produce
a better experience through stable updates or automatic resolution, open an
issue in the MMM-MessageCenter repository. Include:

- the module name and repository link;
- the notification name and a sanitized example payload;
- which events should appear and which should be ignored;
- whether an event can update or resolve later; and
- the expected urgency, retention, and expiration behavior.

MessageCenter will review appropriate requests and maintain accepted bundled
adapters. Module authors are welcome to collaborate, but they are not expected
to learn or implement MessageCenter internals.
