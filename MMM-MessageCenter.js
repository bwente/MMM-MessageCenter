/* global Module, Log */

Module.register("MMM-MessageCenter", {
  defaults: {
    ui: "messages",
    pages: true,
    attention: "seymour",
    messagesPage: 4,
    maxMessages: 50,
    showToasts: true,
    clearAttentionWhenViewed: true,
    webhook: {
      host: "127.0.0.1",
      port: 8787,
      token: ""
    }
  },

  getStyles() {
    return ["MMM-MessageCenter.css"];
  },

  start() {
    this.currentPage = null;
    this.maxPages = null;
    this.messages = [];
    this.unreadAttentionCount = 0;
    this.returnTimer = null;

    this.sendSocketNotification("MC_START", this.config.webhook);
    this.sendNotification("QUERY_PAGE_NUMBER");
    Log.info("[MMM-MessageCenter] Started");
  },

  stop() {
    this.clearReturnTimer();
    this.sendSocketNotification("MC_STOP");
  },

  getDom() {
    if (this.config.ui !== "messages") {
      const hidden = document.createElement("div");
      hidden.style.display = "none";
      return hidden;
    }

    const wrapper = document.createElement("section");
    wrapper.className = "messages-wrapper";
    wrapper.setAttribute("aria-label", "Message center");

    if (!this.messages.length) {
      const empty = document.createElement("p");
      empty.className = "messages-empty";
      empty.textContent = "No messages";
      wrapper.appendChild(empty);
      return wrapper;
    }

    this.messages.forEach((message) => {
      const item = document.createElement("article");
      item.className = `message-item${message.unread ? " unread" : ""}`;

      const title = document.createElement("h3");
      title.className = "message-title";
      title.textContent = message.title;
      item.appendChild(title);

      if (message.body) {
        const body = document.createElement("p");
        body.className = "message-body";
        body.textContent = message.body;
        item.appendChild(body);
      }

      const meta = document.createElement("p");
      meta.className = "message-meta";
      meta.textContent = `${message.source} · ${new Date(message.timestamp).toLocaleString()}`;
      item.appendChild(meta);
      wrapper.appendChild(item);
    });

    return wrapper;
  },

  notificationReceived(notification, payload) {
    if (notification === "MAX_PAGES_CHANGED") {
      if (Number.isInteger(payload) && payload >= 0) this.maxPages = payload;
      return;
    }

    if (notification === "NEW_PAGE" || notification === "PAGE_NUMBER_IS") {
      if (!Number.isInteger(payload) || payload < 0) return;

      this.currentPage = payload;
      if (
        payload === this.config.messagesPage &&
        this.config.clearAttentionWhenViewed &&
        this.unreadAttentionCount > 0
      ) {
        this.clearAttention();
      }
      return;
    }

    if (notification === "MC_ACK_ALL") this.clearAttention();
    if (notification === "MC_CLEAR_ALL") this.clearMessages();
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "MC_ERROR") {
      Log.error(`[MMM-MessageCenter] ${payload}`);
      return;
    }

    if (notification !== "MC_MESSAGE") return;

    const message = this.normalizeMessage(payload);
    if (!message) {
      Log.warn("[MMM-MessageCenter] Ignored invalid or expired message");
      return;
    }

    this.messages.unshift(message);
    this.messages = this.messages.slice(0, this.getMaxMessages());

    if (message.priority === "attention") {
      this.unreadAttentionCount += 1;
      if (this.config.attention === "seymour") {
        this.sendNotification("ATTENTION_ON", this.unreadAttentionCount);
      }
    }

    if (this.config.showToasts) {
      this.sendNotification("SHOW_ALERT", {
        type: "notification",
        title: message.title,
        message: message.body,
        timer: message.priority === "attention" ? 6000 : 4000
      });
    }

    if (this.config.pages) this.handlePageAction(message.actions);
    this.updateDom(200);
  },

  handlePageAction(actions) {
    if (!actions || !this.isValidPage(actions.switchChannel)) return;

    const returnPage = this.currentPage;
    this.clearReturnTimer();
    this.sendNotification("PAGE_CHANGED", actions.switchChannel);

    if (!Number.isFinite(actions.timeout) || actions.timeout <= 0 || returnPage === null) {
      return;
    }

    this.returnTimer = setTimeout(() => {
      this.returnTimer = null;
      if (this.isValidPage(returnPage)) this.sendNotification("PAGE_CHANGED", returnPage);
    }, actions.timeout);
  },

  isValidPage(page) {
    return (
      this.maxPages !== null &&
      Number.isInteger(page) &&
      page >= 0 &&
      page < this.maxPages
    );
  },

  clearReturnTimer() {
    if (!this.returnTimer) return;
    clearTimeout(this.returnTimer);
    this.returnTimer = null;
  },

  clearAttention() {
    this.unreadAttentionCount = 0;
    this.messages.forEach((message) => {
      message.unread = false;
    });
    if (this.config.attention === "seymour") this.sendNotification("ATTENTION_OFF");
    this.updateDom(200);
  },

  clearMessages() {
    this.clearReturnTimer();
    this.messages = [];
    this.clearAttention();
  },

  getMaxMessages() {
    return Number.isInteger(this.config.maxMessages) && this.config.maxMessages > 0
      ? this.config.maxMessages
      : this.defaults.maxMessages;
  },

  normalizeMessage(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

    const now = Date.now();
    const timestamp = Number.isFinite(raw.timestamp) ? raw.timestamp : now;
    const expires = Number.isFinite(raw.expires) ? raw.expires : null;
    if (expires !== null && expires <= now) return null;

    const priority = raw.priority === "attention" ? "attention" : "ephemeral";
    const actions = raw.actions && typeof raw.actions === "object" ? raw.actions : {};

    return {
      id: String(raw.id || `${now}`),
      type: String(raw.type || "generic"),
      source: String(raw.source || "unknown"),
      title: String(raw.title || "Message"),
      body: String(raw.body || ""),
      priority,
      timestamp,
      unread: priority === "attention",
      expires,
      actions
    };
  }
});
