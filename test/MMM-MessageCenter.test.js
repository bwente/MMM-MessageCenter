const assert = require("node:assert/strict");
const test = require("node:test");

let definition;
global.Module = {
  register(name, moduleDefinition) {
    assert.equal(name, "MMM-MessageCenter");
    definition = moduleDefinition;
  }
};
global.Log = { info() {}, warn() {}, error() {} };

require("../MMM-MessageCenter.js");

function instance(config = {}) {
  const notifications = [];
  return {
    ...definition,
    config: {
      ...definition.defaults,
      ...config,
      webhook: { ...definition.defaults.webhook, ...config.webhook }
    },
    currentPage: null,
    maxPages: null,
    messages: [],
    unreadAttentionCount: 0,
    returnTimer: null,
    autoNavigation: null,
    expirationTimer: null,
    pendingView: null,
    notifications,
    updateDom() {},
    sendNotification(name, payload) {
      notifications.push({ name, payload });
    },
    sendSocketNotification() {}
  };
}

function withGlobalConfig(value, callback) {
  const hadConfig = Object.prototype.hasOwnProperty.call(global, "config");
  const previous = global.config;
  global.config = value;
  try {
    return callback();
  } finally {
    if (hadConfig) global.config = previous;
    else delete global.config;
  }
}

test("defaults the message center to page four", () => {
  assert.equal(definition.defaults.messagesPage, 4);
});

test("defaults to the full page display mode", () => {
  const module = instance();
  module.messages = [{ id: "one" }, { id: "two" }, { id: "three" }, { id: "four" }];

  assert.equal(module.getDisplayMode(), "page");
  assert.equal(module.getDisplayedMessages().length, 4);
});

test("compact mode limits visible history without changing the queue", () => {
  const module = instance({ displayMode: "compact", compactMaxMessages: 2 });
  module.messages = [{ id: "one" }, { id: "two" }, { id: "three" }];

  assert.equal(module.getDisplayMode(), "compact");
  assert.deepEqual(module.getDisplayedMessages().map(({ id }) => id), ["one", "two"]);
  assert.equal(module.messages.length, 3);
});

test("compact mode falls back safely for an invalid visible-message limit", () => {
  const module = instance({ displayMode: "compact", compactMaxMessages: 0 });
  module.messages = [{ id: "one" }, { id: "two" }, { id: "three" }, { id: "four" }];

  assert.equal(module.getDisplayedMessages().length, definition.defaults.compactMaxMessages);
});

test("normalizes an attention message", () => {
  const module = instance();
  const message = module.normalizeMessage({
    id: 7,
    source: "home-assistant",
    title: "Door open",
    priority: "attention"
  });

  assert.equal(message.id, "7");
  assert.equal(message.source, "home-assistant");
  assert.equal(message.priority, "attention");
  assert.equal(message.urgency, "attention");
  assert.equal(message.retention, "untilViewed");
  assert.equal(message.unread, true);
});

test("normalizes the refined contract independently of legacy priority", () => {
  const module = instance();
  const message = module.normalizeMessage({
    entityId: "dishwasher",
    urgency: "critical",
    retention: "untilAcknowledged"
  });

  assert.equal(message.entityId, "dishwasher");
  assert.equal(message.urgency, "critical");
  assert.equal(message.retention, "untilAcknowledged");
  assert.equal(message.priority, "attention");
  assert.equal(message.unread, true);

  const criticalDefault = module.normalizeMessage({ urgency: "critical" });
  assert.equal(criticalDefault.retention, "untilAcknowledged");
});

test("rejects invalid and expired messages", () => {
  const module = instance();

  assert.equal(module.normalizeMessage(null), null);
  assert.equal(module.normalizeMessage([]), null);
  assert.equal(module.normalizeMessage({ expires: Date.now() - 1 }), null);
});

test("replaces an out-of-range timestamp with the current time", () => {
  const module = instance();
  const before = Date.now();
  const message = module.normalizeMessage({ timestamp: Number.MAX_VALUE });

  assert.ok(message.timestamp >= before);
  assert.ok(message.timestamp <= Date.now());
});

test("stores messages, raises attention, and shows a toast", () => {
  const module = instance();

  module.socketNotificationReceived("MC_MESSAGE", {
    title: "Garage door",
    priority: "attention"
  });

  assert.equal(module.messages.length, 1);
  assert.equal(module.unreadAttentionCount, 1);
  assert.deepEqual(
    module.notifications.map(({ name }) => name),
    ["MESSAGE_CENTER_ATTENTION_CHANGED", "ATTENTION_ON", "SHOW_ALERT"]
  );
});

test("caps stored messages at maxMessages", () => {
  const module = instance({ maxMessages: 2, showToasts: false });

  for (const title of ["One", "Two", "Three"]) {
    module.socketNotificationReceived("MC_MESSAGE", { title });
  }

  assert.deepEqual(
    module.messages.map(({ title }) => title),
    ["Three", "Two"]
  );
});

test("explicit ephemeral messages toast without entering inbox history", () => {
  const module = instance();

  module.socketNotificationReceived("MC_MESSAGE", {
    title: "Temperature updated",
    urgency: "passive",
    retention: "ephemeral"
  });

  assert.equal(module.messages.length, 0);
  assert.deepEqual(module.notifications.map(({ name }) => name), ["SHOW_ALERT"]);
});

test("an ephemeral update removes matching retained attention cleanly", () => {
  const module = instance({ showToasts: false });

  module.socketNotificationReceived("MC_MESSAGE", {
    id: "door",
    source: "entry",
    urgency: "attention",
    retention: "untilViewed"
  });
  module.socketNotificationReceived("MC_MESSAGE", {
    id: "door",
    source: "entry",
    urgency: "passive",
    retention: "ephemeral"
  });

  assert.equal(module.messages.length, 0);
  assert.equal(module.unreadAttentionCount, 0);
  assert.equal(module.notifications.at(-1).name, "ATTENTION_OFF");
});

test("attention count follows unread messages retained by the inbox", () => {
  const module = instance({ maxMessages: 2, showToasts: false });

  module.socketNotificationReceived("MC_MESSAGE", {
    title: "Attention",
    priority: "attention"
  });
  module.socketNotificationReceived("MC_MESSAGE", { title: "Update one" });
  module.socketNotificationReceived("MC_MESSAGE", { title: "Update two" });

  assert.equal(module.unreadAttentionCount, 0);
  assert.equal(module.notifications.at(-1).name, "ATTENTION_OFF");
});

test("replaces duplicate source and id messages with the newest copy", () => {
  const module = instance({ showToasts: false });

  module.socketNotificationReceived("MC_MESSAGE", {
    id: "cycle-42",
    source: "dishwasher",
    title: "Running"
  });
  module.socketNotificationReceived("MC_MESSAGE", {
    id: "cycle-42",
    source: "dishwasher",
    title: "Complete"
  });

  assert.equal(module.messages.length, 1);
  assert.equal(module.messages[0].title, "Complete");
});

test("reports separate total, unread, and read history counts", () => {
  const module = instance({ showToasts: false });
  module.messages = [
    { unread: true },
    { unread: false },
    { unread: false }
  ];

  assert.deepEqual(module.getMessageCounts(), { total: 3, unread: 1, read: 2 });
});

test("clear read keeps unread messages and removes read history", () => {
  const module = instance({ showToasts: false });
  module.messages = [
    { id: "new", unread: true },
    { id: "old", unread: false }
  ];

  assert.equal(module.clearRead(), true);
  assert.deepEqual(module.messages.map(({ id }) => id), ["new"]);
  assert.equal(module.clearRead(), false);
});

test("presents friendly labels for known internal sources", () => {
  const module = instance();

  assert.equal(module.getMessageSourceLabel("magicmirror.weather"), "Weather");
  assert.equal(module.getMessageSourceLabel("magicmirror.remote-control"), "Remote Control");
  assert.equal(module.getMessageSourceLabel("home-assistant"), "Home Assistant");
  assert.equal(
    module.getMessageSourceLabel("home-assistant.smartthings"),
    "SmartThings via Home Assistant"
  );
  assert.equal(module.getMessageSourceLabel("custom-source"), "custom-source");
});

test("formats timestamps using MagicMirror 12-hour preferences", () => {
  const module = instance();
  const date = new Date(2026, 6, 23, 14, 5, 6);

  withGlobalConfig({ timeFormat: 12, locale: "en-US" }, () => {
    assert.match(module.formatMessageTimestamp(date), /2:05:06\s*PM/i);
    assert.match(module.formatClockTime(date), /2:05\s*PM/i);
  });
});

test("formats timestamps using MagicMirror 24-hour preferences", () => {
  const module = instance();
  const date = new Date(2026, 6, 23, 14, 5, 6);

  withGlobalConfig({ timeFormat: 24, locale: "en-US" }, () => {
    assert.match(module.formatMessageTimestamp(date), /14:05:06/);
    assert.match(module.formatClockTime(date), /14:05/);
    assert.doesNotMatch(module.formatClockTime(date), /AM|PM/i);
  });
});

test("compact mode uses a time-only metadata timestamp", () => {
  const module = instance({ displayMode: "compact" });
  const date = new Date(2026, 6, 23, 14, 5, 6);

  withGlobalConfig({ timeFormat: 12, locale: "en-US" }, () => {
    assert.match(module.formatDisplayedTimestamp(date), /^2:05\s*PM$/i);
  });
});

test("prefers MagicMirror locale and falls back to language", () => {
  const module = instance();
  const date = new Date(2026, 6, 23, 14, 5, 6);

  withGlobalConfig({ timeFormat: 24, locale: "en-GB", language: "en-US" }, () => {
    assert.match(module.formatMessageTimestamp(date), /^23\/07\/2026/);
  });
  withGlobalConfig({ timeFormat: 24, locale: "", language: "en-US" }, () => {
    assert.match(module.formatMessageTimestamp(date), /^7\/23\/2026/);
  });
});

test("falls back safely when global date and time preferences are invalid", () => {
  const module = instance();
  const date = new Date(2026, 6, 23, 14, 5, 6);

  withGlobalConfig({ timeFormat: "twelve", locale: "not_a_locale" }, () => {
    assert.ok(module.formatMessageTimestamp(date).length > 0);
    assert.ok(module.formatClockTime(date).length > 0);
  });
  withGlobalConfig(undefined, () => {
    assert.ok(module.formatMessageTimestamp(date).length > 0);
  });
  assert.equal(module.formatMessageTimestamp("not-a-date"), "");
});

test("reformats metadata without rewriting a stored message body", () => {
  const module = instance();
  const message = {
    body: "Rain is expected around 15:00.",
    timestamp: new Date(2026, 6, 23, 14, 5, 6).getTime()
  };

  const twelveHourMetadata = withGlobalConfig(
    { timeFormat: 12, locale: "en-US" },
    () => module.formatMessageTimestamp(message.timestamp)
  );
  const twentyFourHourMetadata = withGlobalConfig(
    { timeFormat: 24, locale: "en-US" },
    () => module.formatMessageTimestamp(message.timestamp)
  );

  assert.match(twelveHourMetadata, /2:05:06\s*PM/i);
  assert.match(twentyFourHourMetadata, /14:05:06/);
  assert.equal(message.body, "Rain is expected around 15:00.");
});

test("ignores an equivalent webhook retry without repeating its toast", () => {
  const module = instance();
  const payload = {
    id: "cycle-42",
    source: "dishwasher",
    title: "Complete",
    body: "The dishes are done"
  };

  module.socketNotificationReceived("MC_MESSAGE", payload);
  module.socketNotificationReceived("MC_MESSAGE", payload);

  assert.equal(module.messages.length, 1);
  assert.equal(
    module.notifications.filter(({ name }) => name === "SHOW_ALERT").length,
    1
  );
});

test("keeps identical ids from different sources", () => {
  const module = instance({ showToasts: false });

  module.socketNotificationReceived("MC_MESSAGE", { id: "open", source: "front-door" });
  module.socketNotificationReceived("MC_MESSAGE", { id: "open", source: "garage" });

  assert.equal(module.messages.length, 2);
});

function weatherInstance(rain = {}) {
  const module = instance({
    channelRoutes: { weather: 2 },
    internalNotifications: {
      weather: {
        enabled: true,
        rain: { timeout: 0, ...rain }
      }
    }
  });
  module.maxPages = 6;
  module.currentPage = 0;
  return module;
}

test("turns a provider-neutral hourly rain forecast into a message", () => {
  const module = weatherInstance();
  const now = Date.now();

  assert.equal(
    module.handleWeatherUpdated(
      {
        locationName: "Baltimore",
        providerName: "openmeteo",
        hourlyArray: [
          {
            date: now + 60 * 60000,
            weatherType: "rain",
            precipitationProbability: 70,
            precipitationAmount: 0.8
          }
        ]
      },
      now
    ),
    true
  );

  assert.equal(module.messages.length, 1);
  assert.equal(module.messages[0].id, "rain-next-hour");
  assert.equal(module.messages[0].type, "weather.precipitation");
  assert.equal(module.messages[0].source, "magicmirror.weather");
  assert.equal(module.messages[0].entityId, "local-weather");
  assert.equal(module.messages[0].urgency, "attention");
  assert.equal(module.messages[0].retention, "untilViewed");
  assert.match(module.messages[0].body, /Baltimore/);
  assert.equal(
    module.notifications.some(
      ({ name, payload }) => name === "PAGE_CHANGED" && payload === 2
    ),
    true
  );
});

test("uses MagicMirror clock preferences in newly generated weather text", () => {
  const future = new Date();
  future.setDate(future.getDate() + 1);
  future.setHours(14, 0, 0, 0);
  const now = future.getTime();
  const hourlyArray = [
    {
      date: now + 60 * 60000,
      weatherType: "rain",
      precipitationProbability: 70
    }
  ];
  const twelveHourModule = weatherInstance();
  const twentyFourHourModule = weatherInstance();

  withGlobalConfig({ timeFormat: 12, locale: "en-US" }, () => {
    twelveHourModule.handleWeatherUpdated({ hourlyArray }, now);
  });
  withGlobalConfig({ timeFormat: 24, locale: "en-US" }, () => {
    twentyFourHourModule.handleWeatherUpdated({ hourlyArray }, now);
  });

  assert.match(twelveHourModule.messages[0].body, /around 3:00\s*PM\./i);
  assert.match(twentyFourHourModule.messages[0].body, /around 15:00\./);
  assert.doesNotMatch(twentyFourHourModule.messages[0].body, /AM|PM/i);
});

test("receives weather through the normal MagicMirror notification path", () => {
  const module = weatherInstance();
  const now = Date.now();

  module.notificationReceived("WEATHER_UPDATED", {
    hourlyArray: [
      {
        date: now + 60 * 60000,
        rain: 0.5,
        precipitationProbability: 65
      }
    ]
  });

  assert.equal(module.messages.length, 1);
  assert.equal(module.messages[0].type, "weather.precipitation");
});

test("leaves weather broadcasts disabled by default", () => {
  const module = instance();
  const now = Date.now();

  module.notificationReceived("WEATHER_UPDATED", {
    hourlyArray: [
      {
        date: now + 60 * 60000,
        weatherType: "rain",
        precipitationProbability: 90
      }
    ]
  });

  assert.equal(module.messages.length, 0);
});

test("does not repeat a rain alert while the same event remains active", () => {
  const module = weatherInstance();
  const now = Date.now();
  const payload = {
    hourlyArray: [
      {
        date: now + 60 * 60000,
        weatherType: "showers",
        precipitationProbability: 80
      }
    ]
  };

  module.handleWeatherUpdated(payload, now);
  module.handleWeatherUpdated(payload, now + 10 * 60000);

  assert.equal(module.messages.length, 1);
  assert.equal(
    module.notifications.filter(({ name }) => name === "SHOW_ALERT").length,
    1
  );
});

test("resolves the rain message when a later hourly update is dry", () => {
  const module = weatherInstance();
  const now = Date.now();

  module.handleWeatherUpdated(
    {
      hourlyArray: [
        {
          date: now + 60 * 60000,
          weatherType: "rain",
          precipitationProbability: 75
        }
      ]
    },
    now
  );
  module.handleWeatherUpdated(
    {
      hourlyArray: [
        {
          date: now + 70 * 60000,
          weatherType: "cloudy",
          precipitationProbability: 10,
          precipitationAmount: 0
        }
      ]
    },
    now + 10 * 60000
  );

  assert.equal(module.messages.length, 0);
  assert.equal(module.unreadAttentionCount, 0);
  assert.equal(module.notifications.at(-1).name, "ATTENTION_OFF");
});

test("ignores non-hourly weather broadcasts without clearing an alert", () => {
  const module = weatherInstance();
  module.messages = [
    {
      id: "rain-next-hour",
      source: "magicmirror.weather",
      urgency: "attention",
      unread: true
    }
  ];
  module.unreadAttentionCount = 1;

  assert.equal(
    module.handleWeatherUpdated({ currentWeather: {}, hourlyArray: [] }),
    false
  );
  assert.equal(module.messages.length, 1);
});

test("does not treat snow or low-probability precipitation as rain", () => {
  const module = weatherInstance();
  const now = Date.now();

  for (const forecast of [
    {
      date: now + 60 * 60000,
      weatherType: "snow",
      precipitationProbability: 90,
      precipitationAmount: 2,
      snow: 2
    },
    {
      date: now + 60 * 60000,
      weatherType: "rain",
      precipitationProbability: 20,
      precipitationAmount: 0
    }
  ]) {
    assert.equal(module.findRainForecast([forecast], now, module.getWeatherNotificationConfig().rain), null);
  }
});

test("can disable all internal MagicMirror notification providers", () => {
  const module = instance({ internalNotifications: { enabled: false } });

  assert.equal(
    module.handleInternalNotification("WEATHER_UPDATED", { hourlyArray: [{}] }),
    false
  );
  assert.equal(module.messages.length, 0);
});

test("captures a Remote Control alert without repeating its toast", () => {
  const module = instance();

  module.notificationReceived(
    "SHOW_ALERT",
    { title: "Delivery", message: "A package is at the door." },
    { name: "MMM-Remote-Control" }
  );

  assert.equal(module.messages.length, 1);
  assert.equal(module.messages[0].type, "remote.alert");
  assert.equal(module.messages[0].source, "magicmirror.remote-control");
  assert.equal(module.messages[0].title, "Delivery");
  assert.equal(module.messages[0].body, "A package is at the door.");
  assert.equal(module.notifications.some(({ name }) => name === "SHOW_ALERT"), false);
});

test("accepts an intentionally forwarded Remote Control message", () => {
  const module = instance();

  module.notificationReceived(
    "MC_MESSAGE",
    {
      id: "door-open",
      source: "entry-system",
      title: "Front door",
      body: "The front door is open.",
      urgency: "attention",
      retention: "untilViewed"
    },
    { name: "MMM-Remote-Control" }
  );

  assert.equal(module.messages.length, 1);
  assert.equal(module.messages[0].id, "door-open");
  assert.equal(module.messages[0].source, "entry-system");
  assert.equal(module.messages[0].unread, true);
  assert.equal(module.notifications.filter(({ name }) => name === "SHOW_ALERT").length, 1);
});

test("recognizes Remote Control through sender module data", () => {
  const module = instance();

  module.notificationReceived(
    "SHOW_ALERT",
    { title: "Reminder", message: "Check the mailbox." },
    { data: { module: "MMM-Remote-Control" } }
  );

  assert.equal(module.messages.length, 1);
  assert.equal(module.messages[0].source, "magicmirror.remote-control");
});

test("rejects an expired message forwarded by Remote Control", () => {
  const module = instance();

  module.notificationReceived(
    "MC_MESSAGE",
    {
      title: "Old reminder",
      expires: Date.now() - 1
    },
    { name: "MMM-Remote-Control" }
  );

  assert.equal(module.messages.length, 0);
  assert.equal(module.notifications.length, 0);
});

test("ignores Remote Control operational notifications", () => {
  const module = instance();
  const sender = { name: "MMM-Remote-Control" };

  for (const [notification, payload] of [
    ["REMOTE_ACTION", { action: "BRIGHTNESS", value: 80 }],
    ["REGISTER_API", { action: "pages" }],
    ["USER_PRESENCE", true],
    ["PAGE_CHANGED", 2],
    ["REFRESH", undefined],
    ["SHOW", { module: "clock" }]
  ]) {
    module.notificationReceived(notification, payload, sender);
  }

  assert.equal(module.messages.length, 0);
  assert.equal(module.notifications.length, 0);
});

test("ignores malformed Remote Control message payloads", () => {
  const module = instance();
  const sender = { name: "MMM-Remote-Control" };

  module.notificationReceived("MC_MESSAGE", "not-an-object", sender);
  module.notificationReceived("SHOW_ALERT", {}, sender);
  module.notificationReceived("SHOW_ALERT", [], sender);

  assert.equal(module.messages.length, 0);
  assert.equal(module.notifications.length, 0);
});

test("does not ingest MessageCenter notifications as Remote Control messages", () => {
  const module = instance();

  module.notificationReceived(
    "SHOW_ALERT",
    { title: "MessageCenter toast", message: "Do not capture this." },
    { name: "MMM-MessageCenter" }
  );
  module.notificationReceived(
    "MESSAGE_CENTER_ATTENTION_CHANGED",
    { active: true },
    { name: "MMM-Remote-Control" }
  );

  assert.equal(module.messages.length, 0);
});

test("allows Remote Control notification mappings to be disabled", () => {
  const module = instance({
    internalNotifications: {
      remoteControl: {
        enabled: false
      }
    }
  });

  module.notificationReceived(
    "SHOW_ALERT",
    { title: "Ignored", message: "Disabled provider" },
    { name: "MMM-Remote-Control" }
  );

  assert.equal(module.messages.length, 0);
});

test("prunes expired messages and publishes cleared attention state", () => {
  const module = instance({ showToasts: false });
  const now = Date.now();
  module.messages = [
    {
      id: "leak",
      source: "utility-room",
      title: "Water detected",
      priority: "attention",
      unread: true,
      expires: now - 1
    },
    {
      id: "weather",
      source: "weather",
      title: "Cloudy",
      priority: "ephemeral",
      unread: false,
      expires: now + 10000
    }
  ];
  module.unreadAttentionCount = 1;

  assert.equal(module.pruneExpiredMessages(now), true);
  assert.deepEqual(module.messages.map(({ id }) => id), ["weather"]);
  assert.equal(module.unreadAttentionCount, 0);
  assert.deepEqual(module.notifications.map(({ name }) => name), [
    "MESSAGE_CENTER_ATTENTION_CHANGED",
    "ATTENTION_OFF"
  ]);
});

test("publishes a structured attention snapshot", () => {
  const module = instance({ showToasts: false });

  module.socketNotificationReceived("MC_MESSAGE", {
    id: "rain",
    source: "weather",
    title: "Rain starting",
    priority: "attention"
  });

  assert.deepEqual(module.notifications[0], {
    name: "MESSAGE_CENTER_ATTENTION_CHANGED",
    payload: {
      active: true,
      unreadCount: 1,
      highestPriority: "attention",
      highestUrgency: "attention",
      sources: ["weather"]
    }
  });
});

test("viewing messages preserves explicit acknowledgement requirements", () => {
  const module = instance();
  module.messages = [
    { source: "weather", urgency: "critical", retention: "untilAcknowledged", unread: true },
    { source: "chores", urgency: "attention", retention: "untilViewed", unread: true }
  ];
  module.unreadAttentionCount = 2;

  module.markViewed();

  assert.equal(module.messages[0].unread, true);
  assert.equal(module.messages[1].unread, false);
  assert.equal(module.unreadAttentionCount, 1);

  module.clearAttention();
  assert.equal(module.messages[0].unread, false);
  assert.equal(module.unreadAttentionCount, 0);
});

test("clears attention after the message page first renders", async () => {
  const module = instance();
  let renders = 0;
  module.updateDom = () => {
    renders += 1;
  };
  module.messages = [
    { source: "chores", urgency: "attention", retention: "untilViewed", unread: true }
  ];
  module.unreadAttentionCount = 1;

  module.notificationReceived("NEW_PAGE", 4);

  assert.equal(module.currentPage, 4);
  assert.equal(module.unreadAttentionCount, 1);
  assert.equal(module.messages[0].unread, true);
  assert.equal(renders, 1);

  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(module.unreadAttentionCount, 0);
  assert.equal(module.messages[0].unread, false);
  assert.equal(renders, 2);
  assert.equal(module.notifications.at(-1).name, "ATTENTION_OFF");
});

test("leaving the message page cancels pending viewed state", async () => {
  const module = instance();
  module.messages = [
    { source: "chores", urgency: "attention", retention: "untilViewed", unread: true }
  ];
  module.unreadAttentionCount = 1;

  module.notificationReceived("NEW_PAGE", 4);
  module.notificationReceived("NEW_PAGE", 2);
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(module.currentPage, 2);
  assert.equal(module.messages[0].unread, true);
  assert.equal(module.unreadAttentionCount, 1);
});

test("ignores invalid page actions", () => {
  const module = instance();

  for (const switchChannel of ["4", 2.5, -1]) {
    module.handlePageAction({ switchChannel });
  }

  assert.equal(module.notifications.length, 0);
});

test("rejects pages outside the MMM-pages range", () => {
  const module = instance();
  module.notificationReceived("MAX_PAGES_CHANGED", 7);

  module.handlePageAction({ switchChannel: 7 });
  module.handlePageAction({ switchChannel: 99 });

  assert.equal(module.notifications.length, 0);
});

test("switches to a valid page", () => {
  const module = instance();
  module.maxPages = 7;

  module.handlePageAction({ switchChannel: 4 });

  assert.deepEqual(module.notifications, [{ name: "PAGE_CHANGED", payload: 4 }]);
});

test("resolves the built-in messages destination", () => {
  const module = instance({ messagesPage: 0 });
  module.maxPages = 7;

  module.handlePageAction({ switchChannel: "messages" });

  assert.deepEqual(module.notifications, [{ name: "PAGE_CHANGED", payload: 0 }]);
});

test("resolves configured semantic channel destinations", () => {
  const module = instance({ channelRoutes: { weather: 2, cameras: 5 } });
  module.maxPages = 7;

  module.handlePageAction({ switchChannel: "weather" });
  module.handlePageAction({ switchChannel: "missing" });

  assert.deepEqual(module.notifications, [{ name: "PAGE_CHANGED", payload: 2 }]);
});

test("waits for the MMM-pages page count before switching", () => {
  const module = instance();

  module.handlePageAction({ switchChannel: 4 });

  assert.equal(module.notifications.length, 0);
});

test("can disable automatic page actions", () => {
  const module = instance({ pages: false, showToasts: false });
  module.maxPages = 7;

  module.socketNotificationReceived("MC_MESSAGE", {
    title: "No page switch",
    actions: { switchChannel: 4 }
  });

  assert.equal(module.notifications.some(({ name }) => name === "PAGE_CHANGED"), false);
});

test("can disable Seymour attention notifications", () => {
  const module = instance({ attention: "none", showToasts: false });

  module.socketNotificationReceived("MC_MESSAGE", {
    title: "Stored only",
    priority: "attention"
  });

  assert.equal(module.unreadAttentionCount, 1);
  assert.equal(module.notifications.some(({ name }) => name === "ATTENTION_ON"), false);
});

test("uses an integration-neutral switch for compatibility attention events", () => {
  const module = instance({ legacyAttentionEvents: false, showToasts: false });

  module.socketNotificationReceived("MC_MESSAGE", {
    title: "Generic attention",
    urgency: "attention",
    retention: "untilViewed"
  });

  assert.deepEqual(
    module.notifications.map(({ name }) => name),
    ["MESSAGE_CENTER_ATTENTION_CHANGED"]
  );
});

test("manual clear removes all messages and attention", () => {
  const module = instance();
  module.messages = [{ unread: true }];
  module.unreadAttentionCount = 1;

  module.notificationReceived("MC_CLEAR_ALL");

  assert.deepEqual(module.messages, []);
  assert.equal(module.unreadAttentionCount, 0);
});

test("timed page action returns only while it still owns navigation", async () => {
  const module = instance();
  module.maxPages = 6;
  module.currentPage = 1;

  module.handlePageAction({ switchChannel: 4, timeout: 5 });
  module.notificationReceived("NEW_PAGE", 4);
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(module.notifications, [
    { name: "PAGE_CHANGED", payload: 4 },
    { name: "PAGE_CHANGED", payload: 1 }
  ]);
});

test("manual navigation cancels an automatic page return", async () => {
  const module = instance();
  module.maxPages = 6;
  module.currentPage = 1;

  module.handlePageAction({ switchChannel: 4, timeout: 5 });
  module.notificationReceived("NEW_PAGE", 4);
  module.notificationReceived("NEW_PAGE", 2);
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(module.notifications, [{ name: "PAGE_CHANGED", payload: 4 }]);
  assert.equal(module.autoNavigation, null);
});

test("consecutive alerts preserve the original return page", async () => {
  const module = instance();
  module.maxPages = 6;
  module.currentPage = 1;

  module.handlePageAction({ switchChannel: 4, timeout: 20 });
  module.notificationReceived("NEW_PAGE", 4);
  module.handlePageAction({ switchChannel: 3, timeout: 5 });
  module.notificationReceived("NEW_PAGE", 3);
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(module.notifications, [
    { name: "PAGE_CHANGED", payload: 4 },
    { name: "PAGE_CHANGED", payload: 3 },
    { name: "PAGE_CHANGED", payload: 1 }
  ]);
});
