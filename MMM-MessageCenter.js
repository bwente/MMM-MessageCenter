/* global Module, Log */

Module.register("MMM-MessageCenter", {
  defaults: {
    ui: "messages",
    pages: true,
    attention: "seymour",
    messagesPage: 0
  },

  start() {
    Log.info("[MMM-MessageCenter] Starting");

    this.currentPage = null;
    this.messages = [];
    this.unreadAttentionCount = 0;

    this.sendSocketNotification("MC_START");
  },

  getStyles() {
    return ["MMM-MessageCenter.css"];
  },

  getDom() {
    if (this.config.ui !== "messages") {
      const hidden = document.createElement("div");
      hidden.style.display = "none";
      return hidden;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "messages-wrapper";

    if (!this.messages.length) {
      const empty = document.createElement("div");
      empty.className = "messages-empty";
      empty.innerText = "No messages";
      wrapper.appendChild(empty);
      return wrapper;
    }

    this.messages.forEach((msg) => {
      const item = document.createElement("div");
      item.className = "message-item";
      if (msg.unread) item.classList.add("unread");

      const title = document.createElement("div");
      title.className = "message-title";
      title.innerText = msg.title;

      const body = document.createElement("div");
      body.className = "message-body";
      body.innerText = msg.body;

      const meta = document.createElement("div");
      meta.className = "message-meta";
      meta.innerText = new Date(msg.timestamp).toLocaleTimeString();

      item.appendChild(title);
      item.appendChild(body);
      item.appendChild(meta);

      wrapper.appendChild(item);
    });

    return wrapper;
  },

  notificationReceived(notification, payload) {
    if (notification === "NEW_PAGE") {
      this.currentPage = payload;

      if (
        payload === this.config.messagesPage &&
        this.unreadAttentionCount > 0
      ) {
        this.clearAttention();
      }
    }

    if (notification === "MC_ACK_ALL") {
      this.clearAttention();
    }
  },

  socketNotificationReceived(notification, payload) {
    if (notification !== "MC_MESSAGE") return;

    const msg = this.normalizeMessage(payload);

    Log.log("[MMM-MessageCenter] Message received:", msg.title);

    // Store message
    this.messages.unshift(msg);

    // Toast
    this.sendNotification("SHOW_ALERT", {
      type: "notification",
      title: msg.title,
      message: msg.body,
      timer: msg.priority === "attention" ? 6000 : 4000
    });

    // Page switching
    if (
      this.config.pages &&
      msg.actions &&
      msg.actions.switchChannel !== undefined
    ) {
      const targetPage = Number(msg.actions.switchChannel);
      const returnPage = this.currentPage;

      if (Number.isFinite(targetPage)) {
        this.sendNotification("PAGE_CHANGED", targetPage);

        if (msg.actions.timeout && returnPage !== null) {
          setTimeout(() => {
            this.sendNotification("PAGE_CHANGED", returnPage);
            this.clearAttention();
          }, msg.actions.timeout);
        }
      }
    }

    // Attention handling
    if (msg.priority === "attention") {
      this.unreadAttentionCount += 1;

      if (this.config.attention === "seymour") {
        this.sendNotification("ATTENTION_ON");
      }
    }

    this.updateDom(300);
  },

  clearAttention() {
    this.unreadAttentionCount = 0;

    this.messages.forEach((m) => {
      m.unread = false;
    });

    if (this.config.attention === "seymour") {
      this.sendNotification("ATTENTION_OFF");
    }

    this.updateDom(300);
  },

  normalizeMessage(raw) {
    const now = Date.now();

    return {
      id: raw.id || `${now}`,
      type: raw.type || "generic",
      source: raw.source || "unknown",
      title: raw.title || "Message",
      body: raw.body || "",
      priority: raw.priority || "ephemeral",
      timestamp: raw.timestamp || now,
      unread: raw.priority === "attention",
      actions: raw.actions || {}
    };
  }
});
