const NodeHelper = require("node_helper");
const express = require("express");
const dns = require("node:dns");
const fs = require("node:fs");
const net = require("node:net");
const mqtt = require("mqtt");

const MAX_PAYLOAD_BYTES = 32 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

module.exports = NodeHelper.create({
  start() {
    this.server = null;
    this.mqttClient = null;
    this.unixServer = null;
    this.imageConfig = this.getImageConfig();
    this.messageQueue = [];
    this.messageSequence = 0;
    this.maxMessages = 50;
    this.queueSweepInterval = 60000;
    this.queueTimer = null;
    this.queueImageLimits = this.getQueueImageLimits();
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "MC_START") {
      this.startTransports(payload);
    }
    if (notification === "MC_SYNC_REQUEST") this.sendQueueSnapshot();
    if (notification === "MC_QUEUE_COMMAND") this.applyQueueCommand(payload);
  },

  startTransports(rawConfig = {}) {
    const config = rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)
      ? rawConfig
      : {};
    const hasTransportBundle = Object.prototype.hasOwnProperty.call(config, "webhook");
    this.imageConfig = this.getImageConfig(hasTransportBundle ? config.images : {});
    this.queueImageLimits = this.getQueueImageLimits(hasTransportBundle ? config.images : {});
    this.maxMessages = Number.isInteger(config.maxMessages) && config.maxMessages > 0
      ? config.maxMessages
      : 50;
    this.queueSweepInterval = Number.isFinite(Number(config.expirationSweepInterval)) &&
      Number(config.expirationSweepInterval) > 0
      ? Math.max(1000, Number(config.expirationSweepInterval))
      : 60000;
    this.startQueueTimer();
    this.startWebhook(hasTransportBundle ? config.webhook : config);

    const transports = hasTransportBundle && config.transports &&
      typeof config.transports === "object" && !Array.isArray(config.transports)
      ? config.transports
      : {};
    this.startMqtt(transports.mqtt);
    this.startUnixSocket(transports.unixSocket);
  },

  startWebhook(rawConfig = {}) {
    if (this.server) return;
    if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) rawConfig = {};

    const host = typeof rawConfig.host === "string" ? rawConfig.host : "127.0.0.1";
    const port = Number.isInteger(rawConfig.port) ? rawConfig.port : 8787;
    const token = typeof rawConfig.token === "string" ? rawConfig.token : "";

    if (port < 1 || port > 65535) {
      this.sendSocketNotification("MC_ERROR", `Invalid webhook port: ${port}`);
      return;
    }

    if (host !== "127.0.0.1" && host !== "localhost" && !token) {
      console.warn(
        "[MMM-MessageCenter] Webhook is available on the local network without authentication. " +
        "Configure webhook.token to require bearer authentication; never expose this port to the internet."
      );
    }

    const app = express();
    app.disable("x-powered-by");
    app.use(express.json({ limit: `${MAX_PAYLOAD_BYTES}b` }));

    app.post("/message", (request, response) => {
      if (token && !this.isAuthorized(request, token)) {
        return response.status(401).json({ error: "Unauthorized" });
      }

      if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
        return response.status(400).json({ error: "A JSON object payload is required" });
      }

      this.ingestPayload(request.body);
      return response.status(202).json({ status: "accepted" });
    });

    app.use((error, _request, response, next) => {
      if (!error) return next();
      return response.status(400).json({ error: "Invalid JSON payload" });
    });

    this.server = app.listen(port, host, () => {
      console.log(`[MMM-MessageCenter] Webhook listening on http://${host}:${port}/message`);
    });

    this.server.on("error", (error) => {
      this.sendSocketNotification("MC_ERROR", `Webhook server failed: ${error.message}`);
      this.server = null;
    });
  },

  isAuthorized(request, token) {
    const authorization = request.get("authorization") || "";
    return authorization === `Bearer ${token}`;
  },

  ingestPayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    const imageRequest = this.getImageRequest(payload.image);
    if (this.imageConfig.enabled && imageRequest) {
      const queuedPayload = Number.isFinite(payload.timestamp)
        ? payload
        : { ...payload, timestamp: Date.now() };
      this.cacheImage(imageRequest)
        .then((image) => this.publishPayload({ ...queuedPayload, image }))
        .catch(() => {
          this.sendSocketNotification("MC_ERROR", "Message image could not be cached");
          const fallback = { ...queuedPayload };
          delete fallback.image;
          this.publishPayload(fallback);
        });
      return true;
    }
    return this.publishPayload(payload);
  },

  publishPayload(payload) {
    const message = this.normalizeQueuedPayload(payload);
    if (!message) return false;

    if (message.retention !== "ephemeral") {
      const existingIndex = this.messageQueue.findIndex(
        (stored) => stored.source === message.source && stored.id === message.id
      );
      if (existingIndex !== -1) {
        if (this.messageQueue[existingIndex].timestamp > message.timestamp) return false;
        this.messageQueue.splice(existingIndex, 1);
      }
      this.messageQueue.unshift(message);
      this.messageQueue.sort((left, right) => right.timestamp - left.timestamp);
      this.messageQueue = this.messageQueue.slice(0, this.maxMessages);
      this.pruneQueueImages();
    }

    this.sendSocketNotification("MC_MESSAGE", message);
    return true;
  },

  normalizeQueuedPayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;

    const now = Date.now();
    const timestamp = Number.isFinite(payload.timestamp) ? payload.timestamp : now;
    const expires = Number.isFinite(payload.expires) ? payload.expires : null;
    if (expires !== null && expires <= now) return null;

    const urgencyValues = ["passive", "attention", "critical"];
    const urgency = urgencyValues.includes(payload.urgency)
      ? payload.urgency
      : payload.priority === "attention"
        ? "attention"
        : "passive";
    const retentionValues = ["ephemeral", "untilViewed", "untilAcknowledged", "archive"];
    const retention = retentionValues.includes(payload.retention)
      ? payload.retention
      : urgency === "critical"
        ? "untilAcknowledged"
        : urgency === "attention"
          ? "untilViewed"
          : "archive";
    const source = String(payload.source || "unknown");
    const hasId = payload.id !== undefined && payload.id !== null && payload.id !== "";
    const id = hasId
      ? String(payload.id)
      : `transport-${timestamp}-${this.messageSequence += 1}`;

    return {
      ...payload,
      id,
      source,
      urgency,
      retention,
      timestamp,
      expires,
      unread: typeof payload.unread === "boolean"
        ? payload.unread
        : urgency !== "passive" && retention !== "ephemeral"
    };
  },

  sendQueueSnapshot() {
    this.pruneQueue(Date.now(), false);
    this.sendSocketNotification("MC_SNAPSHOT", this.messageQueue.map((message) => ({
      ...message
    })));
  },

  startQueueTimer() {
    this.stopQueueTimer();
    this.queueTimer = setInterval(() => this.pruneQueue(), this.queueSweepInterval);
    if (typeof this.queueTimer.unref === "function") this.queueTimer.unref();
  },

  stopQueueTimer() {
    if (!this.queueTimer) return;
    clearInterval(this.queueTimer);
    this.queueTimer = null;
  },

  pruneQueue(now = Date.now(), notify = true) {
    const retained = this.messageQueue.filter(
      (message) => message.expires === null || message.expires > now
    );
    if (retained.length === this.messageQueue.length) return false;
    this.messageQueue = retained;
    if (notify) this.sendQueueSnapshot();
    return true;
  },

  applyQueueCommand(command) {
    if (!command || typeof command !== "object" || Array.isArray(command)) return false;
    let changed = false;

    if (command.action === "acknowledgeAll") {
      this.messageQueue.forEach((message) => {
        if (message.unread) {
          message.unread = false;
          changed = true;
        }
      });
    } else if (command.action === "markViewed") {
      this.messageQueue.forEach((message) => {
        if (message.retention !== "untilAcknowledged" && message.unread) {
          message.unread = false;
          changed = true;
        }
      });
    } else if (command.action === "clearRead") {
      const length = this.messageQueue.length;
      this.messageQueue = this.messageQueue.filter((message) => message.unread);
      changed = this.messageQueue.length !== length;
    } else if (command.action === "clearAll") {
      changed = this.messageQueue.length > 0;
      this.messageQueue = [];
    } else if (command.action === "acknowledge" || command.action === "dismiss") {
      if (command.source === undefined || command.id === undefined) return false;
      const source = String(command.source);
      const id = String(command.id);
      const message = this.messageQueue.find(
        (candidate) => candidate.source === source && candidate.id === id
      );
      if (!message) return false;
      if (command.action === "acknowledge") {
        if (message.unread) {
          message.unread = false;
          changed = true;
        }
      } else {
        this.messageQueue = this.messageQueue.filter((candidate) => candidate !== message);
        changed = true;
      }
    } else {
      return false;
    }

    if (!changed) return false;
    this.sendQueueSnapshot();
    return true;
  },

  getQueueImageLimits(rawConfig = {}) {
    const config = rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)
      ? rawConfig
      : {};
    return {
      maxCachedImages: Number.isInteger(config.maxCachedImages) && config.maxCachedImages >= 0
        ? config.maxCachedImages
        : 12,
      maxTotalBytes: Number.isInteger(config.maxTotalBytes) && config.maxTotalBytes >= 0
        ? config.maxTotalBytes
        : 12 * 1024 * 1024
    };
  },

  getCachedImageBytes(image) {
    if (!image || typeof image.dataUrl !== "string") return 0;
    const separator = image.dataUrl.indexOf(",");
    if (separator === -1) return 0;
    const encoded = image.dataUrl.slice(separator + 1);
    const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor(encoded.length * 3 / 4) - padding);
  },

  pruneQueueImages() {
    const { maxCachedImages, maxTotalBytes } = this.queueImageLimits;
    let retainedCount = 0;
    let retainedBytes = 0;

    this.messageQueue.forEach((message) => {
      if (!message.image || typeof message.image !== "object") return;
      const imageBytes = this.getCachedImageBytes(message.image);
      if (
        retainedCount >= maxCachedImages ||
        retainedBytes + imageBytes > maxTotalBytes
      ) {
        message.image = null;
        return;
      }
      retainedCount += 1;
      retainedBytes += imageBytes;
    });
  },

  getImageConfig(rawConfig = {}) {
    const config = rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)
      ? rawConfig
      : {};
    return {
      enabled: config.enabled === true,
      maxBytes: Number.isInteger(config.maxBytes) &&
        config.maxBytes >= 1024 && config.maxBytes <= 5 * 1024 * 1024
        ? config.maxBytes
        : 1024 * 1024,
      timeout: Number.isInteger(config.timeout) && config.timeout >= 250 && config.timeout <= 30000
        ? config.timeout
        : 5000,
      allowPrivateHosts: config.allowPrivateHosts === true,
      allowHttp: config.allowHttp === true
    };
  },

  getImageRequest(rawImage) {
    if (typeof rawImage === "string") return { url: rawImage, alt: "Message snapshot" };
    if (!rawImage || typeof rawImage !== "object" || Array.isArray(rawImage)) return null;
    if (typeof rawImage.url !== "string") return null;
    return {
      url: rawImage.url,
      alt: typeof rawImage.alt === "string" && rawImage.alt.trim()
        ? rawImage.alt.trim().slice(0, 240)
        : "Message snapshot"
    };
  },

  async cacheImage(request) {
    let url = new URL(request.url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.imageConfig.timeout);

    try {
      for (let redirects = 0; redirects <= 3; redirects += 1) {
        await this.validateImageUrl(url);
        const response = await this.fetchImage(url, { signal: controller.signal, redirect: "manual" });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location || redirects === 3) throw new Error("Invalid image redirect");
          url = new URL(location, url);
          continue;
        }
        if (!response.ok) throw new Error("Image request failed");

        const type = String(response.headers.get("content-type") || "")
          .split(";", 1)[0]
          .trim()
          .toLowerCase();
        if (!IMAGE_TYPES.has(type)) throw new Error("Unsupported image type");
        const declaredLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(declaredLength) && declaredLength > this.imageConfig.maxBytes) {
          throw new Error("Image is too large");
        }

        const buffer = await this.readImageBody(response, this.imageConfig.maxBytes);
        if (!this.matchesImageSignature(buffer, type)) throw new Error("Invalid image content");
        return {
          dataUrl: `data:${type};base64,${buffer.toString("base64")}`,
          alt: request.alt,
          capturedAt: Date.now()
        };
      }
      throw new Error("Too many image redirects");
    } finally {
      clearTimeout(timeout);
    }
  },

  async validateImageUrl(url) {
    if (url.protocol !== "https:" && !(url.protocol === "http:" && this.imageConfig.allowHttp)) {
      throw new Error("Images must use HTTPS");
    }
    if (url.username || url.password) throw new Error("Image URL credentials are not allowed");
    if (this.imageConfig.allowPrivateHosts) return;
    if (url.hostname.toLowerCase() === "localhost") throw new Error("Private image host");

    const addresses = await dns.promises.lookup(url.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => this.isPrivateAddress(address))) {
      throw new Error("Private image host");
    }
  },

  isPrivateAddress(address) {
    if (net.isIPv4(address)) {
      const [a, b] = address.split(".").map(Number);
      return a === 0 || a === 10 || a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 198 && (b === 18 || b === 19)) ||
        a >= 224;
    }
    if (net.isIPv6(address)) {
      const normalized = address.toLowerCase();
      return normalized === "::" || normalized === "::1" ||
        normalized.startsWith("fc") || normalized.startsWith("fd") ||
        /^fe[89ab]/.test(normalized) || normalized.startsWith("::ffff:") &&
          this.isPrivateAddress(normalized.slice(7));
    }
    return true;
  },

  fetchImage(url, options) {
    return fetch(url, options);
  },

  async readImageBody(response, maxBytes) {
    if (!response.body || typeof response.body.getReader !== "function") {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > maxBytes) throw new Error("Image is too large");
      return buffer;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBytes) {
        await reader.cancel();
        throw new Error("Image is too large");
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, length);
  },

  matchesImageSignature(buffer, type) {
    if (type === "image/jpeg") return buffer.length >= 3 &&
      buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (type === "image/png") return buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (type === "image/webp") return buffer.length >= 12 &&
      buffer.subarray(0, 4).toString() === "RIFF" &&
      buffer.subarray(8, 12).toString() === "WEBP";
    return false;
  },

  parsePayload(value, transport) {
    const size = Buffer.isBuffer(value) ? value.length : Buffer.byteLength(String(value));
    if (size > MAX_PAYLOAD_BYTES) {
      this.sendSocketNotification(
        "MC_ERROR",
        `${transport} payload exceeded ${MAX_PAYLOAD_BYTES} bytes`
      );
      return false;
    }

    let payload;
    try {
      payload = JSON.parse(Buffer.isBuffer(value) ? value.toString("utf8") : String(value));
    } catch {
      this.sendSocketNotification("MC_ERROR", `Invalid JSON payload from ${transport}`);
      return false;
    }

    if (!this.ingestPayload(payload)) {
      this.sendSocketNotification("MC_ERROR", `${transport} requires a JSON object payload`);
      return false;
    }
    return true;
  },

  startMqtt(rawConfig = {}) {
    if (this.mqttClient) return;
    const config = rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)
      ? rawConfig
      : {};
    if (config.enabled !== true) return;

    const url = typeof config.url === "string" && config.url.trim()
      ? config.url.trim()
      : "mqtt://127.0.0.1:1883";
    const topics = (Array.isArray(config.topics) ? config.topics : [config.topic])
      .filter((topic) => typeof topic === "string" && topic.trim())
      .map((topic) => topic.trim());
    if (!topics.length) {
      this.sendSocketNotification("MC_ERROR", "MQTT requires at least one topic");
      return;
    }

    const options = {
      clean: true,
      reconnectPeriod: 5000,
      connectTimeout: 10000
    };
    for (const key of ["username", "password", "clientId"]) {
      if (typeof config[key] === "string" && config[key]) options[key] = config[key];
    }

    let client;
    try {
      client = this.connectMqtt(url, options);
    } catch (error) {
      this.sendSocketNotification("MC_ERROR", `MQTT startup failed: ${error.message}`);
      return;
    }
    this.mqttClient = client;
    client.on("connect", () => {
      client.subscribe(topics, { qos: 0 }, (error) => {
        if (error) {
          this.sendSocketNotification("MC_ERROR", `MQTT subscription failed: ${error.message}`);
          return;
        }
        console.log(`[MMM-MessageCenter] MQTT subscribed to ${topics.join(", ")}`);
      });
    });
    client.on("message", (topic, payload) => {
      if (topics.includes(topic)) this.parsePayload(payload, `MQTT topic ${topic}`);
    });
    client.on("reconnect", () => {
      console.log("[MMM-MessageCenter] MQTT reconnecting");
    });
    client.on("error", (error) => {
      console.warn(`[MMM-MessageCenter] MQTT error: ${error.message}`);
    });
  },

  connectMqtt(url, options) {
    return mqtt.connect(url, options);
  },

  startUnixSocket(rawConfig = {}) {
    if (this.unixServer) return;
    const config = rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)
      ? rawConfig
      : {};
    if (config.enabled !== true) return;

    const socketPath = typeof config.path === "string" && config.path.trim()
      ? config.path.trim()
      : "/tmp/mmm-messagecenter.sock";
    if (!socketPath.startsWith("/")) {
      this.sendSocketNotification("MC_ERROR", "Unix socket path must be absolute");
      return;
    }
    const mode = Number.isInteger(config.mode) && config.mode >= 0 && config.mode <= 0o777
      ? config.mode
      : 0o600;

    let server;
    try {
      server = net.createServer((connection) => this.handleUnixConnection(connection));
    } catch (error) {
      this.sendSocketNotification("MC_ERROR", `Unix socket startup failed: ${error.message}`);
      return;
    }
    this.unixServer = server;
    this.unixSocketPath = socketPath;
    server.on("error", (error) => {
      this.sendSocketNotification("MC_ERROR", `Unix socket failed: ${error.message}`);
      this.unixServer = null;
    });
    try {
      server.listen(socketPath, () => {
        fs.chmod(socketPath, mode, (error) => {
          if (error) {
            this.sendSocketNotification(
              "MC_ERROR",
              `Unix socket permissions failed: ${error.message}`
            );
          }
        });
        console.log(`[MMM-MessageCenter] Unix socket listening at ${socketPath}`);
      });
    } catch (error) {
      this.unixServer = null;
      this.unixSocketPath = null;
      this.sendSocketNotification("MC_ERROR", `Unix socket startup failed: ${error.message}`);
    }
  },

  handleUnixConnection(connection) {
    let buffered = "";
    let bytes = 0;
    const respond = (accepted) => {
      if (connection.writable) {
        connection.write(`${JSON.stringify({ status: accepted ? "accepted" : "rejected" })}\n`);
      }
    };
    const consume = (line) => {
      if (!line.trim()) return;
      respond(this.parsePayload(line, "Unix socket"));
    };

    connection.setEncoding("utf8");
    connection.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_PAYLOAD_BYTES) {
        this.sendSocketNotification(
          "MC_ERROR",
          `Unix socket payload exceeded ${MAX_PAYLOAD_BYTES} bytes`
        );
        buffered = "";
        respond(false);
        connection.end();
        return;
      }
      buffered += chunk;
      const lines = buffered.split("\n");
      buffered = lines.pop();
      lines.forEach(consume);
    });
    connection.on("end", () => {
      consume(buffered);
    });
  },

  stopWebhook() {
    if (!this.server) return;
    this.server.close();
    this.server = null;
  },

  stopMqtt() {
    if (!this.mqttClient) return;
    this.mqttClient.end(true);
    this.mqttClient = null;
  },

  stopUnixSocket() {
    if (!this.unixServer) return;
    this.unixServer.close();
    this.unixServer = null;
    this.unixSocketPath = null;
  },

  stopTransports() {
    this.stopQueueTimer();
    this.stopWebhook();
    this.stopMqtt();
    this.stopUnixSocket();
  },

  stop() {
    this.stopTransports();
  }
});
