/* global Module, Log */

Module.register("MMM-MessageCenter", {
  defaults: {
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
    const wrapper = document.createElement("section");
    wrapper.className = "message-center";
    wrapper.setAttribute("aria-label", "Message center");

    const heading = document.createElement("h2");
    heading.className = "message-center__heading";
    heading.textContent = "Messages";
    wrapper.appendChild(heading);

    if (!this.messages.length) {
      const empty = document.createElement("p");
      empty.className = "message-center__empty";
      empty.textContent = "No messages";
      wrapper.appendChild(empty);
      return wrapper;
    }

    const list = document.createElement("ol");
    list.className = "message-center__list";

    this.messages.forEach((message) => {
      const item = document.createElement("li");
      item.className = `message-center__item${message.unread ? " is-unread" : ""}`;

      const title = document.createElement("h3");
      title.className = "message-center__title";
      title.textContent = message.title;
      item.appendChild(title);

      if (message.body) {
        const body = document.createElement("p");
        body.className = "message-center__body";
        body.textContent = message.body;
        item.appendChild(body);
      }

      const meta = document.createElement("p");
      meta.className = "message-center__meta";
      meta.textContent = `${message.source} · ${new Date(message.timestamp).toLocaleString()}`;
      item.appendChild(meta);
      list.appendChild(item);
    });

    wrapper.appendChild(list);
    return wrapper;
  },

  notificationReceived(notification, payload) {
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
      this.sendNotification("ATTENTION_ON", this.unreadAttentionCount);
    }

    if (this.config.showToasts) {
      this.sendNotification("SHOW_ALERT", {
        type: "notification",
        title: message.title,
        message: message.body,
        timer: message.priority === "attention" ? 6000 : 4000
      });
    }

    this.handlePageAction(message.actions);
    this.updateDom(200);
  },

  handlePageAction(actions) {
    if (!actions || !Number.isInteger(actions.switchChannel) || actions.switchChannel < 0) {
      return;
    }

    const returnPage = this.currentPage;
    this.sendNotification("PAGE_CHANGED", actions.switchChannel);

    if (!Number.isFinite(actions.timeout) || actions.timeout <= 0 || returnPage === null) {
      return;
    }

    this.clearReturnTimer();
    this.returnTimer = setTimeout(() => {
      this.returnTimer = null;
      this.sendNotification("PAGE_CHANGED", returnPage);
    }, actions.timeout);
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
    this.sendNotification("ATTENTION_OFF");
    this.updateDom(200);
  },

  clearMessages() {
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
