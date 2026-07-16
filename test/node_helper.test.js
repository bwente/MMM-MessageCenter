const assert = require("node:assert/strict");
const ModuleLoader = require("node:module");
const test = require("node:test");

const originalLoad = ModuleLoader._load;
ModuleLoader._load = function load(request, parent, isMain) {
  if (request === "node_helper") {
    return {
      create(definition) {
        return definition;
      }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const helperDefinition = require("../node_helper.js");
ModuleLoader._load = originalLoad;

function helper() {
  const socketNotifications = [];
  return {
    ...helperDefinition,
    server: null,
    socketNotifications,
    sendSocketNotification(name, payload) {
      socketNotifications.push({ name, payload });
    }
  };
}

test("accepts the configured bearer token", () => {
  const module = helper();
  const request = {
    get(name) {
      assert.equal(name, "authorization");
      return "Bearer secret";
    }
  };

  assert.equal(module.isAuthorized(request, "secret"), true);
  assert.equal(module.isAuthorized(request, "different"), false);
});

test("rejects invalid webhook ports", () => {
  const module = helper();

  module.startWebhook({ port: 70000 });

  assert.equal(module.server, null);
  assert.match(module.socketNotifications[0].payload, /Invalid webhook port/);
});

test("requires a token for non-localhost binding", () => {
  const module = helper();

  module.startWebhook({ host: "0.0.0.0", port: 8787, token: "" });

  assert.equal(module.server, null);
  assert.match(module.socketNotifications[0].payload, /token is required/);
});

test("invalid startup configuration falls back safely", () => {
  const module = helper();
  const originalListen = require("express").application.listen;
  let listened;

  require("express").application.listen = function listen(port, host, callback) {
    listened = { port, host };
    if (callback) callback();
    return { on() {}, close() {} };
  };

  try {
    module.startWebhook(null);
  } finally {
    require("express").application.listen = originalListen;
  }

  assert.deepEqual(listened, { port: 8787, host: "127.0.0.1" });
});
