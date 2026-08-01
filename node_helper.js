const NodeHelper = require("node_helper");
const express = require("express");

module.exports = NodeHelper.create({
  start() {
    this.server = null;
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "MC_START") this.startWebhook(payload);
    if (notification === "MC_STOP") this.stopWebhook();
  },

  startWebhook(rawConfig = {}) {
    if (this.server) return;
    if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) rawConfig = {};

    const host = typeof rawConfig.host === "string" ? rawConfig.host : "0.0.0.0";
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
    app.use(express.json({ limit: "32kb" }));

    app.post("/message", (request, response) => {
      if (token && !this.isAuthorized(request, token)) {
        return response.status(401).json({ error: "Unauthorized" });
      }

      if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
        return response.status(400).json({ error: "A JSON object payload is required" });
      }

      this.sendSocketNotification("MC_MESSAGE", request.body);
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

  stopWebhook() {
    if (!this.server) return;
    this.server.close();
    this.server = null;
  },

  stop() {
    this.stopWebhook();
  }
});
