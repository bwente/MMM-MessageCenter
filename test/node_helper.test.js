const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
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
    mqttClient: null,
    unixServer: null,
    unixSocketPath: null,
    imageConfig: helperDefinition.getImageConfig(),
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

test("allows unauthenticated LAN binding with a warning", () => {
  const module = helper();
  const originalListen = require("express").application.listen;
  const originalWarn = console.warn;
  let listened;
  let warning;

  require("express").application.listen = function listen(port, host, callback) {
    listened = { port, host };
    if (callback) callback();
    return { on() {}, close() {} };
  };
  console.warn = (message) => {
    warning = message;
  };

  try {
    module.startWebhook({ host: "0.0.0.0", port: 8787, token: "" });
  } finally {
    require("express").application.listen = originalListen;
    console.warn = originalWarn;
  }

  assert.deepEqual(listened, { port: 8787, host: "0.0.0.0" });
  assert.match(warning, /without authentication/);
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

  assert.deepEqual(listened, { port: 8787, host: "0.0.0.0" });
});

test("starts the configured transport bundle", () => {
  const module = helper();
  const started = [];
  module.startWebhook = (config) => started.push({ name: "webhook", config });
  module.startMqtt = (config) => started.push({ name: "mqtt", config });
  module.startUnixSocket = (config) => started.push({ name: "unix", config });

  module.startTransports({
    webhook: { port: 9000 },
    images: { enabled: true, maxBytes: 4096 },
    transports: {
      mqtt: { enabled: true },
      unixSocket: { enabled: true }
    }
  });

  assert.deepEqual(started, [
    { name: "webhook", config: { port: 9000 } },
    { name: "mqtt", config: { enabled: true } },
    { name: "unix", config: { enabled: true } }
  ]);
  assert.equal(module.imageConfig.enabled, true);
  assert.equal(module.imageConfig.maxBytes, 4096);
});

test("parses transport payloads through the shared message path", () => {
  const module = helper();

  assert.equal(module.parsePayload('{"title":"Disk space low"}', "test"), true);
  assert.deepEqual(module.socketNotifications[0], {
    name: "MC_MESSAGE",
    payload: { title: "Disk space low" }
  });

  assert.equal(module.parsePayload("not-json", "test"), false);
  assert.match(module.socketNotifications.at(-1).payload, /Invalid JSON/);
  assert.equal(module.parsePayload("[]", "test"), false);
  assert.match(module.socketNotifications.at(-1).payload, /JSON object/);
  assert.equal(module.parsePayload("x".repeat(33 * 1024), "test"), false);
  assert.match(module.socketNotifications.at(-1).payload, /exceeded/);
});

test("subscribes to configured MQTT topics and ingests matching messages", () => {
  const module = helper();
  const client = new EventEmitter();
  let connection;
  let subscription;
  let ended = false;
  client.subscribe = (topics, options, callback) => {
    subscription = { topics, options };
    callback();
  };
  client.end = (force) => {
    ended = force;
  };
  module.connectMqtt = (url, options) => {
    connection = { url, options };
    return client;
  };

  module.startMqtt({
    enabled: true,
    url: "mqtt://broker.local",
    topics: ["messagecenter/messages", "mirror/system"],
    username: "mirror",
    password: "private"
  });
  client.emit("connect");
  client.emit("message", "unrelated/topic", Buffer.from('{"title":"Ignored"}'));
  client.emit("message", "mirror/system", Buffer.from('{"title":"Network offline"}'));
  module.stopMqtt();

  assert.equal(connection.url, "mqtt://broker.local");
  assert.equal(connection.options.username, "mirror");
  assert.equal(connection.options.password, "private");
  assert.deepEqual(subscription, {
    topics: ["messagecenter/messages", "mirror/system"],
    options: { qos: 0 }
  });
  assert.deepEqual(
    module.socketNotifications.filter(({ name }) => name === "MC_MESSAGE"),
    [{ name: "MC_MESSAGE", payload: { title: "Network offline" } }]
  );
  assert.equal(ended, true);
  assert.equal(module.mqttClient, null);
});

test("rejects enabled MQTT without a usable topic", () => {
  const module = helper();

  module.startMqtt({ enabled: true, topic: "" });

  assert.equal(module.mqttClient, null);
  assert.match(module.socketNotifications[0].payload, /at least one topic/);
});

test("reports MQTT startup failures without exposing configuration", () => {
  const module = helper();
  module.connectMqtt = () => {
    throw new Error("invalid broker URL");
  };

  module.startMqtt({
    enabled: true,
    topic: "messagecenter/messages",
    password: "do-not-log"
  });

  assert.equal(module.mqttClient, null);
  assert.match(module.socketNotifications[0].payload, /startup failed/);
  assert.doesNotMatch(module.socketNotifications[0].payload, /do-not-log/);
});

test("accepts newline-delimited messages from a Unix connection", () => {
  const module = helper();
  const connection = new EventEmitter();
  const responses = [];
  connection.writable = true;
  connection.setEncoding = (encoding) => assert.equal(encoding, "utf8");
  connection.write = (value) => responses.push(value);
  connection.end = () => {};

  module.handleUnixConnection(connection);
  connection.emit("data", '{"title":"Storage warning"}\nnot-json\n');
  connection.emit("end");

  assert.deepEqual(
    module.socketNotifications.filter(({ name }) => name === "MC_MESSAGE"),
    [{ name: "MC_MESSAGE", payload: { title: "Storage warning" } }]
  );
  assert.deepEqual(responses, [
    '{"status":"accepted"}\n',
    '{"status":"rejected"}\n'
  ]);
});

test("requires an absolute Unix socket path", () => {
  const module = helper();

  module.startUnixSocket({ enabled: true, path: "relative.sock" });

  assert.equal(module.unixServer, null);
  assert.match(module.socketNotifications[0].payload, /must be absolute/);
});

test("uses conservative image-cache defaults", () => {
  const module = helper();

  assert.deepEqual(module.getImageConfig({ enabled: true }), {
    enabled: true,
    maxBytes: 1024 * 1024,
    timeout: 5000,
    allowPrivateHosts: false,
    allowHttp: false
  });
  assert.equal(module.isPrivateAddress("127.0.0.1"), true);
  assert.equal(module.isPrivateAddress("192.168.1.20"), true);
  assert.equal(module.isPrivateAddress("8.8.8.8"), false);
  assert.equal(module.isPrivateAddress("::1"), true);
});

test("blocks insecure and private image URLs unless explicitly allowed", async () => {
  const module = helper();

  await assert.rejects(
    module.validateImageUrl(new URL("http://images.example.test/snapshot.jpg")),
    /HTTPS/
  );
  await assert.rejects(
    module.validateImageUrl(new URL("https://127.0.0.1/snapshot.jpg")),
    /Private image host/
  );

  module.imageConfig = module.getImageConfig({
    enabled: true,
    allowPrivateHosts: true,
    allowHttp: true
  });
  await assert.doesNotReject(
    module.validateImageUrl(new URL("http://127.0.0.1/snapshot.jpg"))
  );
});

test("caches a validated image at message ingestion", async () => {
  const module = helper();
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  module.imageConfig = module.getImageConfig({ enabled: true });
  module.validateImageUrl = async (url) => {
    assert.equal(url.href, "https://images.example.test/doorbell.png");
  };
  module.fetchImage = async () => ({
    ok: true,
    status: 200,
    headers: {
      get(name) {
        if (name === "content-type") return "image/png";
        if (name === "content-length") return String(png.length);
        return null;
      }
    },
    body: null,
    async arrayBuffer() {
      return png;
    }
  });

  assert.equal(module.ingestPayload({
    title: "Doorbell",
    image: {
      url: "https://images.example.test/doorbell.png",
      alt: "Visitor at the door"
    }
  }), true);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(module.socketNotifications.length, 1);
  assert.equal(module.socketNotifications[0].name, "MC_MESSAGE");
  assert.equal(module.socketNotifications[0].payload.image.alt, "Visitor at the door");
  assert.match(module.socketNotifications[0].payload.image.dataUrl, /^data:image\/png;base64,/);
});

test("delivers message text when image caching fails", async () => {
  const module = helper();
  module.imageConfig = module.getImageConfig({ enabled: true });
  module.cacheImage = async () => {
    throw new Error("download failed");
  };

  module.ingestPayload({
    title: "Doorbell",
    image: "https://images.example.test/doorbell.png"
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(module.socketNotifications[0], {
    name: "MC_ERROR",
    payload: "Message image could not be cached"
  });
  assert.equal(module.socketNotifications[1].name, "MC_MESSAGE");
  assert.equal(module.socketNotifications[1].payload.title, "Doorbell");
  assert.equal(Number.isFinite(module.socketNotifications[1].payload.timestamp), true);
  assert.equal(Object.hasOwn(module.socketNotifications[1].payload, "image"), false);
});

test("validates image signatures independently of response headers", () => {
  const module = helper();
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  assert.equal(module.matchesImageSignature(png, "image/png"), true);
  assert.equal(module.matchesImageSignature(Buffer.from("not an image"), "image/png"), false);
  assert.equal(
    module.matchesImageSignature(Buffer.from([0xff, 0xd8, 0xff, 0x00]), "image/jpeg"),
    true
  );
});
