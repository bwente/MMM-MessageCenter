/* global Module, Log */

Module.register("MMM-MessageCenter", {
  defaults: {
    ui: "messages",
    pages: true,
    attention: "seymour",
    messagesPage: 4,
    maxMessages: 50,
    showHeader: true,
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
    this.autoNavigation = null;

    this.sendSocketNotification("MC_START", this.config.webhook);
    this.sendNotification("QUERY_PAGE_NUMBER");
    Log.info("[MMM-MessageCenter] Started");
  },

  stop() {
    this.cancelAutoNavigation();
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
    wrapper.setAttribute("aria-live", "polite");

    if (this.config.showHeader) {
      wrapper.appendChild(this.getHeaderDom());
    }

    if (!this.messages.length) {
      const empty = document.createElement("div");
      empty.className = "messages-empty";

      const emptyTitle = document.createElement("p");
      emptyTitle.className = "messages-empty-title";
      emptyTitle.textContent = "You’re all caught up";
      empty.appendChild(emptyTitle);

      const emptyDetail = document.createElement("p");
      emptyDetail.className = "messages-empty-detail";
      emptyDetail.textContent = "New household messages will appear here.";
      empty.appendChild(emptyDetail);

      wrapper.appendChild(empty);
      return wrapper;
    }

    this.messages.forEach((message) => {
      const item = document.createElement("article");
      item.className = `message-item message-${message.priority}${message.unread ? " unread" : ""}`;

      const heading = document.createElement("div");
      heading.className = "message-heading";

      const title = document.createElement("h3");
      title.className = "message-title";
      title.textContent = message.title;
      heading.appendChild(title);

      if (message.unread) {
        const unread = document.createElement("span");
        unread.className = "message-unread-indicator";
        unread.textContent = "New";
        heading.appendChild(unread);
      }

      item.appendChild(heading);

      if (message.body) {
        const body = document.createElement("p");
        body.className = "message-body";
        body.textContent = message.body;
        item.appendChild(body);
      }

      const meta = document.createElement("div");
      meta.className = "message-meta";

      const source = document.createElement("span");
      source.className = "message-source";
      source.textContent = message.source;
      meta.appendChild(source);

      const timestamp = document.createElement("time");
      const date = new Date(message.timestamp);
      timestamp.className = "message-time";
      timestamp.dateTime = date.toISOString();
      timestamp.textContent = date.toLocaleString();
      meta.appendChild(timestamp);

      item.appendChild(meta);
      wrapper.appendChild(item);
    });

    return wrapper;
  },

  getHeaderDom() {
    const header = document.createElement("header");
    header.className = "messages-header";

    const heading = document.createElement("div");
    heading.className = "messages-heading";

    const title = document.createElement("h2");
    title.className = "messages-title";
    title.textContent = "Messages";
    heading.appendChild(title);

    const count = document.createElement("span");
    count.className = "messages-count";
    count.textContent = String(this.messages.length);
    count.setAttribute("aria-label", `${this.messages.length} messages`);
    heading.appendChild(count);
    header.appendChild(heading);

    if (this.unreadAttentionCount > 0) {
      const acknowledge = document.createElement("button");
      acknowledge.className = "messages-acknowledge";
      acknowledge.type = "button";
      acknowledge.textContent = "Mark all read";
      acknowledge.addEventListener("click", () => this.clearAttention());
      header.appendChild(acknowledge);
    }

    return header;
  },

  notificationReceived(notification, payload) {
    if (notification === "MAX_PAGES_CHANGED") {
      if (Number.isInteger(payload) && payload >= 0) this.maxPages = payload;
      return;
    }

    if (notification === "NEW_PAGE" || notification === "PAGE_NUMBER_IS") {
      if (!Number.isInteger(payload) || payload < 0) return;

      this.currentPage = payload;
      if (this.autoNavigation && payload !== this.autoNavigation.targetPage) {
        this.cancelAutoNavigation();
      }
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

    const previousUnreadCount = this.unreadAttentionCount;
    this.messages.unshift(message);
    this.messages = this.messages.slice(0, this.getMaxMessages());
    this.unreadAttentionCount = this.messages.filter((stored) => stored.unread).length;

    if (this.config.attention === "seymour") {
      if (this.unreadAttentionCount > 0 && message.priority === "attention") {
        this.sendNotification("ATTENTION_ON", this.unreadAttentionCount);
      } else if (previousUnreadCount > 0 && this.unreadAttentionCount === 0) {
        this.sendNotification("ATTENTION_OFF");
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

    const hasTimedReturn = Number.isFinite(actions.timeout) && actions.timeout > 0;
    const returnPage = this.autoNavigation
      ? this.autoNavigation.returnPage
      : this.currentPage;

    this.clearReturnTimer();
    this.autoNavigation = hasTimedReturn
      ? { targetPage: actions.switchChannel, returnPage }
      : null;
    this.sendNotification("PAGE_CHANGED", actions.switchChannel);

    if (!hasTimedReturn || returnPage === null || returnPage === actions.switchChannel) {
      return;
    }

    this.returnTimer = setTimeout(() => {
      this.returnTimer = null;
      const navigation = this.autoNavigation;
      this.autoNavigation = null;
      if (
        navigation &&
        this.currentPage === navigation.targetPage &&
        this.isValidPage(navigation.returnPage)
      ) {
        this.sendNotification("PAGE_CHANGED", navigation.returnPage);
      }
    }, actions.timeout);
  },

  cancelAutoNavigation() {
    this.clearReturnTimer();
    this.autoNavigation = null;
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
    this.cancelAutoNavigation();
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
    const candidateTimestamp = Number.isFinite(raw.timestamp) ? raw.timestamp : now;
    const timestamp = Number.isNaN(new Date(candidateTimestamp).getTime())
      ? now
      : candidateTimestamp;
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
