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
    notifications,
    updateDom() {},
    sendNotification(name, payload) {
      notifications.push({ name, payload });
    },
    sendSocketNotification() {}
  };
}

test("defaults the message center to page four", () => {
  assert.equal(definition.defaults.messagesPage, 4);
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
  assert.equal(message.unread, true);
});

test("rejects invalid and expired messages", () => {
  const module = instance();

  assert.equal(module.normalizeMessage(null), null);
  assert.equal(module.normalizeMessage([]), null);
  assert.equal(module.normalizeMessage({ expires: Date.now() - 1 }), null);
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
    ["ATTENTION_ON", "SHOW_ALERT"]
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

test("clears attention when the message page is viewed", () => {
  const module = instance();
  module.messages = [{ unread: true }];
  module.unreadAttentionCount = 1;

  module.notificationReceived("NEW_PAGE", 4);

  assert.equal(module.currentPage, 4);
  assert.equal(module.unreadAttentionCount, 0);
  assert.equal(module.messages[0].unread, false);
  assert.equal(module.notifications.at(-1).name, "ATTENTION_OFF");
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

test("manual clear removes all messages and attention", () => {
  const module = instance();
  module.messages = [{ unread: true }];
  module.unreadAttentionCount = 1;

  module.notificationReceived("MC_CLEAR_ALL");

  assert.deepEqual(module.messages, []);
  assert.equal(module.unreadAttentionCount, 0);
});
