/* global Module, Log */

Module.register("MMM-MessageCenter", {
  defaults: {
    ui: "messages",
    pages: true,
    attention: "seymour",
    messagesPage: 4,
    channelRoutes: {},
    maxMessages: 50,
    expirationSweepInterval: 60000,
    publishAttentionState: true,
    showHeader: true,
    showToasts: true,
    clearAttentionWhenViewed: true,
    internalNotifications: {
      enabled: true,
      weather: {
        enabled: false,
        rain: {
          enabled: true,
          messageId: "rain-next-hour",
          source: "magicmirror.weather",
          entityId: "local-weather",
          leadTimeMinutes: 60,
          windowMinutes: 45,
          probabilityThreshold: 50,
          amountThreshold: 0.1,
          urgency: "attention",
          retention: "untilViewed",
          channel: "weather",
          timeout: 10000,
          expiresAfterMinutes: 90
        }
      }
    },
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
    this.expirationTimer = null;

    this.sendSocketNotification("MC_START", this.config.webhook);
    this.sendNotification("QUERY_PAGE_NUMBER");
    this.startExpirationTimer();
    Log.info("[MMM-MessageCenter] Started");
  },

  stop() {
    this.cancelAutoNavigation();
    this.stopExpirationTimer();
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
      source.textContent = this.getMessageSourceLabel(message.source);
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
    const counts = this.getMessageCounts();
    count.textContent = counts.unread
      ? `${counts.unread} new · ${counts.total} total`
      : `${counts.total} ${counts.total === 1 ? "message" : "messages"}`;
    count.setAttribute(
      "aria-label",
      counts.unread
        ? `${counts.unread} unread, ${counts.total} total messages`
        : `${counts.total} total messages, none unread`
    );
    if (counts.unread) count.classList.add("has-unread");
    heading.appendChild(count);
    header.appendChild(heading);

    const controls = document.createElement("div");
    controls.className = "messages-controls";

    if (counts.unread > 0) {
      const acknowledge = document.createElement("button");
      acknowledge.className = "messages-acknowledge";
      acknowledge.type = "button";
      acknowledge.textContent = "Mark all read";
      acknowledge.addEventListener("click", () => this.clearAttention());
      controls.appendChild(acknowledge);
    }

    if (counts.read > 0) {
      const clearRead = document.createElement("button");
      clearRead.className = "messages-clear-read";
      clearRead.type = "button";
      clearRead.textContent = "Clear read";
      clearRead.addEventListener("click", () => this.clearRead());
      controls.appendChild(clearRead);
    }

    if (controls.childNodes.length) header.appendChild(controls);

    return header;
  },

  getMessageCounts() {
    const unread = this.messages.filter((message) => message.unread).length;
    return {
      total: this.messages.length,
      unread,
      read: this.messages.length - unread
    };
  },

  getMessageSourceLabel(source) {
    const labels = {
      "magicmirror.weather": "Weather",
      "home-assistant": "Home Assistant",
      smartthings: "SmartThings"
    };
    return labels[source] || source;
  },

  notificationReceived(notification, payload, sender) {
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
        payload === this.resolvePageTarget("messages") &&
        this.config.clearAttentionWhenViewed &&
        this.unreadAttentionCount > 0
      ) {
        this.markViewed();
      }
      return;
    }

    if (notification === "MC_ACK_ALL") this.clearAttention();
    if (notification === "MC_CLEAR_READ") this.clearRead();
    if (notification === "MC_CLEAR_ALL") this.clearMessages();
    this.handleInternalNotification(notification, payload, sender);
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "MC_ERROR") {
      Log.error(`[MMM-MessageCenter] ${payload}`);
      return;
    }

    if (notification !== "MC_MESSAGE") return;
    this.receiveMessage(payload);
  },

  receiveMessage(payload) {
    const message = this.normalizeMessage(payload);
    if (!message) {
      Log.warn("[MMM-MessageCenter] Ignored invalid or expired message");
      return;
    }

    const previousAttentionState = this.getAttentionState();
    let inboxChanged = false;
    const duplicateIndex = message.hasExplicitId
      ? this.messages.findIndex(
          (stored) =>
            stored.hasExplicitId &&
            stored.source === message.source &&
            stored.id === message.id
        )
      : -1;
    if (duplicateIndex !== -1) {
      const duplicate = this.messages[duplicateIndex];
      if (this.isEquivalentMessage(duplicate, message)) {
        Log.info(`[MMM-MessageCenter] Ignored duplicate ${message.source}/${message.id}`);
        return;
      }
      this.messages.splice(duplicateIndex, 1);
      inboxChanged = true;
    }

    if (message.retention !== "ephemeral") {
      this.messages.unshift(message);
      this.messages = this.messages.slice(0, this.getMaxMessages());
      inboxChanged = true;
    }
    if (inboxChanged) this.publishAttention(previousAttentionState);

    if (this.config.showToasts) {
      this.sendNotification("SHOW_ALERT", {
        type: "notification",
        title: message.title,
        message: message.body,
        timer: message.urgency === "critical"
          ? 8000
          : message.urgency === "attention"
            ? 6000
            : 4000
      });
    }

    if (this.config.pages) this.handlePageAction(message.actions);
    this.updateDom(200);
  },

  handleInternalNotification(notification, payload) {
    const internalConfig = this.config.internalNotifications;
    if (!internalConfig || internalConfig.enabled === false) return false;

    if (notification === "WEATHER_UPDATED") {
      return this.handleWeatherUpdated(payload);
    }
    return false;
  },

  handleWeatherUpdated(payload, now = Date.now()) {
    const weatherConfig = this.getWeatherNotificationConfig();
    if (!weatherConfig.enabled || !weatherConfig.rain.enabled) return false;
    if (!payload || !Array.isArray(payload.hourlyArray) || !payload.hourlyArray.length) {
      return false;
    }

    const rain = weatherConfig.rain;
    const forecast = this.findRainForecast(payload.hourlyArray, now, rain);
    if (!forecast) {
      return this.resolveMessage(rain.source, rain.messageId);
    }

    const alreadyTracked = this.messages.some(
      (message) => message.source === rain.source && message.id === rain.messageId
    );
    if (alreadyTracked) return true;

    const location = payload.locationName ? ` near ${String(payload.locationName)}` : "";
    const forecastTime = new Date(forecast.timestamp).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    });
    this.receiveMessage({
      id: rain.messageId,
      type: "weather.precipitation",
      source: rain.source,
      entityId: rain.entityId,
      title: "Rain approaching",
      body: `Rain is expected${location} around ${forecastTime}.`,
      urgency: rain.urgency,
      retention: rain.retention,
      timestamp: now,
      expires: forecast.timestamp + rain.expiresAfterMinutes * 60000,
      actions: {
        switchChannel: rain.channel,
        timeout: rain.timeout
      }
    });
    return true;
  },

  getWeatherNotificationConfig() {
    const defaults = this.defaults.internalNotifications.weather;
    const configured = this.config.internalNotifications?.weather || {};
    return {
      ...defaults,
      ...configured,
      rain: {
        ...defaults.rain,
        ...(configured.rain || {})
      }
    };
  },

  findRainForecast(hourlyArray, now, config) {
    const target = now + config.leadTimeMinutes * 60000;
    const tolerance = config.windowMinutes * 60000;
    return hourlyArray
      .map((entry) => ({
        entry,
        timestamp: this.getWeatherTimestamp(entry?.date)
      }))
      .filter(
        ({ entry, timestamp }) =>
          timestamp !== null &&
          timestamp > now &&
          Math.abs(timestamp - target) <= tolerance &&
          this.isRainForecast(entry, config)
      )
      .sort((left, right) =>
        Math.abs(left.timestamp - target) - Math.abs(right.timestamp - target)
      )[0] || null;
  },

  getWeatherTimestamp(value) {
    if (Number.isFinite(value)) return value;
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  },

  isRainForecast(entry, config) {
    if (!entry || typeof entry !== "object") return false;
    const number = (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const probability = number(entry.precipitationProbability);
    const rain = number(entry.rain);
    const snow = number(entry.snow);
    const amount = number(entry.precipitationAmount);
    const weatherType = String(entry.weatherType || "").toLowerCase();
    const rainType = /(rain|shower|drizzle|thunderstorm)/.test(weatherType);
    const snowOnly = /(snow|sleet|ice)/.test(weatherType) && !rainType;
    const hasRainAmount =
      (rain !== null && rain >= config.amountThreshold) ||
      (!snowOnly &&
        (snow === null || snow <= 0) &&
        amount !== null &&
        amount >= config.amountThreshold);
    const likelyEnough = probability === null || probability >= config.probabilityThreshold;
    return hasRainAmount || (rainType && likelyEnough);
  },

  handlePageAction(actions) {
    if (!actions) return;
    const targetPage = this.resolvePageTarget(actions.switchChannel);
    if (!this.isValidPage(targetPage)) return;

    const hasTimedReturn = Number.isFinite(actions.timeout) && actions.timeout > 0;
    const returnPage = this.autoNavigation
      ? this.autoNavigation.returnPage
      : this.currentPage;

    this.clearReturnTimer();
    this.autoNavigation = hasTimedReturn
      ? { targetPage, returnPage }
      : null;
    this.sendNotification("PAGE_CHANGED", targetPage);

    if (!hasTimedReturn || returnPage === null || returnPage === targetPage) {
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

  resolvePageTarget(target) {
    if (Number.isInteger(target)) return target;
    if (typeof target !== "string" || !target.trim()) return null;

    const name = target.trim();
    if (name === "messages") return this.config.messagesPage;

    const routes = this.config.channelRoutes;
    if (!routes || typeof routes !== "object" || Array.isArray(routes)) return null;
    return Object.prototype.hasOwnProperty.call(routes, name) && Number.isInteger(routes[name])
      ? routes[name]
      : null;
  },

  clearReturnTimer() {
    if (!this.returnTimer) return;
    clearTimeout(this.returnTimer);
    this.returnTimer = null;
  },

  startExpirationTimer() {
    this.stopExpirationTimer();
    const configuredInterval = Number(this.config.expirationSweepInterval);
    if (!Number.isFinite(configuredInterval) || configuredInterval <= 0) return;

    this.expirationTimer = setInterval(
      () => this.pruneExpiredMessages(),
      Math.max(1000, configuredInterval)
    );
  },

  stopExpirationTimer() {
    if (!this.expirationTimer) return;
    clearInterval(this.expirationTimer);
    this.expirationTimer = null;
  },

  pruneExpiredMessages(now = Date.now()) {
    const previousAttentionState = this.getAttentionState();
    const retained = this.messages.filter(
      (message) => message.expires === null || message.expires > now
    );
    if (retained.length === this.messages.length) return false;

    this.messages = retained;
    this.publishAttention(previousAttentionState);
    this.updateDom(200);
    return true;
  },

  getAttentionState() {
    const unreadMessages = this.messages.filter((message) => message.unread);
    const sources = [...new Set(unreadMessages.map((message) => message.source))];
    const highestUrgency = unreadMessages.some(
      (message) => message.urgency === "critical"
    )
      ? "critical"
      : unreadMessages.length
        ? "attention"
        : "passive";

    return {
      active: unreadMessages.length > 0,
      unreadCount: unreadMessages.length,
      highestPriority: highestUrgency,
      highestUrgency,
      sources
    };
  },

  publishAttention(previousState = null) {
    const state = this.getAttentionState();
    this.unreadAttentionCount = state.unreadCount;

    const changed =
      !previousState ||
      previousState.active !== state.active ||
      previousState.unreadCount !== state.unreadCount ||
      previousState.highestPriority !== state.highestPriority ||
      previousState.sources.join("\u0000") !== state.sources.join("\u0000");
    if (!changed) return;

    if (this.config.publishAttentionState !== false) {
      this.sendNotification("MESSAGE_CENTER_ATTENTION_CHANGED", state);
    }

    if (this.config.attention === "seymour") {
      if (state.active) this.sendNotification("ATTENTION_ON", state.unreadCount);
      else if (previousState && previousState.active) this.sendNotification("ATTENTION_OFF");
    }
  },

  clearAttention() {
    const previousAttentionState = this.getAttentionState();
    this.messages.forEach((message) => {
      message.unread = false;
    });
    this.publishAttention(previousAttentionState);
    this.updateDom(200);
  },

  clearRead() {
    const retained = this.messages.filter((message) => message.unread);
    if (retained.length === this.messages.length) return false;
    this.messages = retained;
    this.updateDom(200);
    return true;
  },

  markViewed() {
    const previousAttentionState = this.getAttentionState();
    this.messages.forEach((message) => {
      if (message.retention !== "untilAcknowledged") message.unread = false;
    });
    this.publishAttention(previousAttentionState);
    this.updateDom(200);
  },

  resolveMessage(source, id) {
    const previousAttentionState = this.getAttentionState();
    const retained = this.messages.filter(
      (message) => message.source !== source || message.id !== id
    );
    if (retained.length === this.messages.length) return false;

    this.messages = retained;
    this.publishAttention(previousAttentionState);
    this.updateDom(200);
    return true;
  },

  clearMessages() {
    this.cancelAutoNavigation();
    const previousAttentionState = this.getAttentionState();
    this.messages = [];
    this.publishAttention(previousAttentionState);
    this.updateDom(200);
  },

  getMaxMessages() {
    return Number.isInteger(this.config.maxMessages) && this.config.maxMessages > 0
      ? this.config.maxMessages
      : this.defaults.maxMessages;
  },

  isEquivalentMessage(left, right) {
    return (
      left.title === right.title &&
      left.body === right.body &&
      left.type === right.type &&
      left.entityId === right.entityId &&
      left.priority === right.priority &&
      left.urgency === right.urgency &&
      left.retention === right.retention &&
      left.expires === right.expires &&
      JSON.stringify(left.actions) === JSON.stringify(right.actions)
    );
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

    const legacyPriority = raw.priority === "attention" ? "attention" : "ephemeral";
    const urgencyValues = ["passive", "attention", "critical"];
    const urgency = urgencyValues.includes(raw.urgency)
      ? raw.urgency
      : legacyPriority === "attention"
        ? "attention"
        : "passive";
    const retentionValues = ["ephemeral", "untilViewed", "untilAcknowledged", "archive"];
    const retention = retentionValues.includes(raw.retention)
      ? raw.retention
      : urgency === "critical"
        ? "untilAcknowledged"
        : urgency === "attention"
          ? "untilViewed"
          : "archive";
    const priority = urgency === "passive" ? "ephemeral" : "attention";
    const actions = raw.actions && typeof raw.actions === "object" ? raw.actions : {};

    const hasExplicitId = raw.id !== undefined && raw.id !== null && raw.id !== "";

    return {
      id: hasExplicitId ? String(raw.id) : `${now}`,
      hasExplicitId,
      type: String(raw.type || "generic"),
      source: String(raw.source || "unknown"),
      entityId: raw.entityId === undefined || raw.entityId === null || raw.entityId === ""
        ? null
        : String(raw.entityId),
      title: String(raw.title || "Message"),
      body: String(raw.body || ""),
      priority,
      urgency,
      retention,
      timestamp,
      unread: urgency !== "passive" && retention !== "ephemeral",
      expires,
      actions
    };
  }
});
