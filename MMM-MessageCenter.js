/* global Module, Log, config */

Module.register("MMM-MessageCenter", {
  requiresVersion: "2.37.0",

  defaults: {
    ui: "messages",
    displayMode: "page",
    maxVisibleMessages: null,
    showControls: true,
    compactMaxMessages: 3,
    compactShowControls: false,
    lineMaxMessages: 3,
    lineShowBody: false,
    pages: true,
    legacyAttentionEvents: true,
    messagesPage: 4,
    channelRoutes: {},
    maxMessages: 50,
    expirationSweepInterval: 60000,
    syncInterval: 15000,
    publishAttentionState: true,
    showHeader: true,
    showToasts: true,
    clearAttentionWhenViewed: true,
    internalNotifications: {
      enabled: true,
      remoteControl: {
        enabled: true,
        mappings: {
          MC_MESSAGE: {
            mode: "message"
          },
          SHOW_ALERT: {
            mode: "alert",
            type: "remote.alert",
            source: "magicmirror.remote-control",
            urgency: "passive",
            retention: "archive"
          }
        }
      },
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
    },
    transports: {
      mqtt: {
        enabled: false,
        url: "mqtt://127.0.0.1:1883",
        topic: "messagecenter/messages",
        username: "",
        password: ""
      },
      unixSocket: {
        enabled: false,
        path: "/tmp/mmm-messagecenter.sock",
        mode: 0o600
      }
    },
    images: {
      enabled: false,
      maxBytes: 1024 * 1024,
      maxCachedImages: 12,
      maxTotalBytes: 12 * 1024 * 1024,
      timeout: 5000,
      allowPrivateHosts: false,
      allowHttp: false
    }
  },

  getStyles() {
    return ["MMM-MessageCenter.css"];
  },

  getTranslations() {
    return {
      de: "translations/de.json",
      en: "translations/en.json",
      es: "translations/es.json",
      fr: "translations/fr.json"
    };
  },

  start() {
    this.currentPage = null;
    this.maxPages = null;
    this.messages = [];
    this.unreadAttentionCount = 0;
    this.returnTimer = null;
    this.autoNavigation = null;
    this.expirationTimer = null;
    this.syncTimer = null;
    this.visibilityHandler = null;
    this.pendingView = null;

    this.sendSocketNotification("MC_START", {
      webhook: this.config.webhook,
      transports: this.config.transports,
      images: this.config.images,
      maxMessages: this.getMaxMessages(),
      expirationSweepInterval: this.config.expirationSweepInterval
    });
    this.startSyncTimer();
    this.sendNotification("QUERY_PAGE_NUMBER");
    this.startExpirationTimer();
    this.startVisibilityListener();
    Log.info("[MMM-MessageCenter] Started");
  },

  suspend() {
    this.ensureExpirationTimer();
  },

  resume() {
    this.refreshAfterVisibilityChange();
  },

  stop() {
    this.cancelAutoNavigation();
    this.cancelPendingView();
    this.stopExpirationTimer();
    this.stopSyncTimer();
    this.stopVisibilityListener();
  },

  getDom() {
    this.pruneExpiredMessages(Date.now(), false);

    if (this.config.ui !== "messages") {
      const hidden = document.createElement("div");
      hidden.style.display = "none";
      return hidden;
    }

    const wrapper = document.createElement("section");
    wrapper.className = `messages-wrapper messages-${this.getDisplayMode()}`;
    wrapper.setAttribute("aria-label", this.translate("MESSAGE_CENTER"));
    wrapper.setAttribute("aria-live", "polite");

    if (this.config.showHeader) {
      wrapper.appendChild(this.getHeaderDom());
    }

    if (!this.messages.length) {
      const empty = document.createElement("div");
      empty.className = "messages-empty";

      const emptyTitle = document.createElement("p");
      emptyTitle.className = "messages-empty-title";
      emptyTitle.textContent = this.translate("ALL_CAUGHT_UP");
      empty.appendChild(emptyTitle);

      if (this.getDisplayMode() === "page") {
        const emptyDetail = document.createElement("p");
        emptyDetail.className = "messages-empty-detail";
        emptyDetail.textContent = this.translate("EMPTY_DETAIL");
        empty.appendChild(emptyDetail);
      }

      wrapper.appendChild(empty);
      return wrapper;
    }

    this.getDisplayedMessages().forEach((message) => {
      const item = document.createElement("article");
      item.className =
        `message-item urgency-${message.urgency}` +
        `${message.unread ? " unread" : ""}${message.image ? " has-image" : ""}`;

      const heading = document.createElement("div");
      heading.className = "message-heading";

      const title = document.createElement("h3");
      title.className = "message-title";
      title.textContent = message.title;
      heading.appendChild(title);

      if (message.unread) {
        const unread = document.createElement("span");
        unread.className = "message-unread-indicator";
        unread.textContent = this.translate("NEW");
        heading.appendChild(unread);
      }

      item.appendChild(heading);

      if (message.body && this.shouldShowMessageBody()) {
        const body = document.createElement("p");
        body.className = "message-body";
        body.textContent = message.body;
        item.appendChild(body);
      }

      if (message.image && this.shouldShowMessageImage()) {
        const image = document.createElement("img");
        image.className = "message-image";
        image.src = message.image.dataUrl;
        image.alt = message.image.alt;
        image.loading = "eager";
        image.decoding = "async";
        item.appendChild(image);
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
      timestamp.textContent = this.formatDisplayedTimestamp(date);
      meta.appendChild(timestamp);

      if (this.shouldShowMessageControls()) {
        const controls = document.createElement("div");
        controls.className = "message-controls";

        if (message.unread) {
          const acknowledge = document.createElement("button");
          acknowledge.className = "message-acknowledge";
          acknowledge.type = "button";
          acknowledge.textContent = this.translate("MARK_READ");
          acknowledge.setAttribute("aria-label", this.translate("MARK_TITLE_READ", { title: message.title }));
          acknowledge.addEventListener("click", () => {
            this.acknowledgeMessage(message.source, message.id);
          });
          controls.appendChild(acknowledge);
        }

        const dismiss = document.createElement("button");
        dismiss.className = "message-dismiss";
        dismiss.type = "button";
        dismiss.textContent = this.translate("DISMISS");
        dismiss.setAttribute("aria-label", this.translate("DISMISS_TITLE", { title: message.title }));
        dismiss.addEventListener("click", () => {
          this.dismissMessage(message.source, message.id);
        });
        controls.appendChild(dismiss);
        meta.appendChild(controls);
      }

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
    title.textContent = this.translate("MESSAGES");
    heading.appendChild(title);

    const count = document.createElement("span");
    count.className = "messages-count";
    const counts = this.getMessageCounts();
    count.textContent = counts.unread
      ? this.translate("NEW_TOTAL", { unread: counts.unread, total: counts.total })
      : this.translate(counts.total === 1 ? "ONE_MESSAGE" : "MESSAGE_COUNT", { total: counts.total });
    count.setAttribute(
      "aria-label",
      counts.unread
        ? this.translate("UNREAD_TOTAL_ARIA", { unread: counts.unread, total: counts.total })
        : this.translate("NONE_UNREAD_ARIA", { total: counts.total })
    );
    if (counts.unread) count.classList.add("has-unread");
    heading.appendChild(count);
    header.appendChild(heading);

    const showControls = this.shouldShowMessageControls();
    const controls = document.createElement("div");
    controls.className = "messages-controls";

    if (showControls && counts.unread > 0) {
      const acknowledge = document.createElement("button");
      acknowledge.className = "messages-acknowledge";
      acknowledge.type = "button";
      acknowledge.textContent = this.translate("MARK_ALL_READ");
      acknowledge.addEventListener("click", () => this.clearAttention());
      controls.appendChild(acknowledge);
    }

    if (showControls && counts.read > 0) {
      const clearRead = document.createElement("button");
      clearRead.className = "messages-clear-read";
      clearRead.type = "button";
      clearRead.textContent = this.translate("CLEAR_READ");
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

  getDisplayMode() {
    return ["page", "compact", "line"].includes(this.config.displayMode)
      ? this.config.displayMode
      : "page";
  },

  getDisplayedMessages() {
    const configuredLimit = Number.isInteger(this.config.maxVisibleMessages) &&
      this.config.maxVisibleMessages > 0
      ? this.config.maxVisibleMessages
      : null;
    const displayMode = this.getDisplayMode();
    if (configuredLimit === null && displayMode === "page") {
      return this.messages;
    }
    const modeLimit = displayMode === "line"
      ? this.getPositiveIntegerConfig("lineMaxMessages")
      : this.getPositiveIntegerConfig("compactMaxMessages");
    const limit = configuredLimit || modeLimit;
    return this.messages.slice(0, limit);
  },

  getPositiveIntegerConfig(name) {
    return Number.isInteger(this.config[name]) && this.config[name] > 0
      ? this.config[name]
      : this.defaults[name];
  },

  shouldShowMessageControls() {
    if (this.config.showControls === false) return false;
    const displayMode = this.getDisplayMode();
    if (displayMode === "line") return false;
    return displayMode !== "compact" || this.config.compactShowControls === true;
  },

  shouldShowMessageBody() {
    return this.getDisplayMode() !== "line" || this.config.lineShowBody === true;
  },

  shouldShowMessageImage() {
    return this.getDisplayMode() !== "line";
  },

  getMessageSourceLabel(source) {
    const labels = {
      "magicmirror.weather": "SOURCE_WEATHER",
      "magicmirror.remote-control": "SOURCE_REMOTE_CONTROL",
      "home-assistant": "SOURCE_HOME_ASSISTANT",
      "home-assistant.smartthings": "SOURCE_SMARTTHINGS_HOME_ASSISTANT",
      smartthings: "SOURCE_SMARTTHINGS"
    };
    return labels[source] ? this.translate(labels[source]) : source;
  },

  getGlobalDateTimePreferences() {
    const globalConfig =
      typeof config !== "undefined" &&
      config &&
      typeof config === "object" &&
      !Array.isArray(config)
        ? config
        : {};
    const timeFormat =
      globalConfig.timeFormat === 12 || globalConfig.timeFormat === 24
        ? globalConfig.timeFormat
        : null;
    const localeCandidates = [globalConfig.locale, globalConfig.language];
    let locale;

    for (const candidate of localeCandidates) {
      if (typeof candidate !== "string" || !candidate.trim()) continue;
      try {
        new Intl.DateTimeFormat(candidate);
        locale = candidate;
        break;
      } catch {
        // Try the next configured preference, then the browser default.
      }
    }

    return { locale, timeFormat };
  },

  formatMessageTimestamp(value) {
    return this.formatDateTimeValue(value, true);
  },

  formatClockTime(value) {
    return this.formatDateTimeValue(value, false);
  },

  formatDisplayedTimestamp(value) {
    return this.getDisplayMode() !== "page"
      ? this.formatClockTime(value)
      : this.formatMessageTimestamp(value);
  },

  formatDateTimeValue(value, includeDate) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    const { locale, timeFormat } = this.getGlobalDateTimePreferences();
    const options = {
      ...(includeDate
        ? {
            year: "numeric",
            month: "numeric",
            day: "numeric"
          }
        : {}),
      hour: "numeric",
      minute: "2-digit",
      ...(includeDate ? { second: "2-digit" } : {}),
      ...(timeFormat === 12
        ? { hourCycle: "h12" }
        : timeFormat === 24
          ? { hourCycle: "h23" }
          : {})
    };

    try {
      return new Intl.DateTimeFormat(locale, options).format(date);
    } catch {
      return includeDate ? date.toLocaleString() : date.toLocaleTimeString();
    }
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
      if (payload !== this.resolvePageTarget("messages")) {
        this.cancelPendingView();
      }
      if (
        payload === this.resolvePageTarget("messages") &&
        this.config.clearAttentionWhenViewed &&
        this.unreadAttentionCount > 0
      ) {
        this.scheduleMarkViewed();
      }
      return;
    }

    if (notification === "MC_ACK_ALL") this.clearAttention();
    if (notification === "MC_ACK_MESSAGE") this.handleMessageCommand(payload, "acknowledge");
    if (notification === "MC_DISMISS_MESSAGE") this.handleMessageCommand(payload, "dismiss");
    if (notification === "MC_CLEAR_READ") this.clearRead();
    if (notification === "MC_CLEAR_ALL") this.clearMessages();
    this.handleInternalNotification(notification, payload, sender);
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "MC_ERROR") {
      Log.error(`[MMM-MessageCenter] ${payload}`);
      return;
    }

    if (notification === "MC_SNAPSHOT") {
      this.reconcileTransportSnapshot(payload);
      return;
    }

    if (notification !== "MC_MESSAGE") return;
    this.receiveMessage(payload, { transportManaged: true, honorState: true });
  },

  receiveMessage(payload, options = {}) {
    const message = this.normalizeMessage(payload, options);
    if (!message) {
      Log.warn("[MMM-MessageCenter] Ignored invalid or expired message");
      return false;
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
      if (duplicate.timestamp > message.timestamp) {
        Log.info(`[MMM-MessageCenter] Ignored stale update ${message.source}/${message.id}`);
        return false;
      }
      if (this.isEquivalentMessage(duplicate, message)) {
        Log.info(`[MMM-MessageCenter] Ignored duplicate ${message.source}/${message.id}`);
        return false;
      }
      this.messages.splice(duplicateIndex, 1);
      inboxChanged = true;
    }

    if (message.retention !== "ephemeral") {
      this.messages.unshift(message);
      this.messages.sort((left, right) => right.timestamp - left.timestamp);
      this.messages = this.messages.slice(0, this.getMaxMessages());
      this.pruneCachedImages();
      if (message.expires !== null) this.ensureExpirationTimer();
      inboxChanged = true;
    }
    if (inboxChanged) this.publishAttention(previousAttentionState);

    if (this.config.showToasts && options.showToast !== false) {
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
    return true;
  },

  handleInternalNotification(notification, payload, sender) {
    const internalConfig = this.config.internalNotifications;
    if (!internalConfig || internalConfig.enabled === false) return false;

    if (this.isRemoteControlSender(sender)) {
      return this.handleRemoteControlNotification(notification, payload);
    }

    if (notification === "WEATHER_UPDATED") {
      return this.handleWeatherUpdated(payload);
    }
    return false;
  },

  isRemoteControlSender(sender) {
    if (!sender || typeof sender !== "object") return false;
    return (
      sender.name === "MMM-Remote-Control" ||
      sender.data?.module === "MMM-Remote-Control"
    );
  },

  getRemoteControlNotificationConfig() {
    const defaults = this.defaults.internalNotifications.remoteControl;
    const configured = this.config.internalNotifications?.remoteControl || {};
    return {
      ...defaults,
      ...configured,
      mappings: configured.mappings === undefined
        ? defaults.mappings
        : configured.mappings
    };
  },

  handleRemoteControlNotification(notification, payload) {
    const config = this.getRemoteControlNotificationConfig();
    if (
      !config.enabled ||
      !config.mappings ||
      typeof config.mappings !== "object" ||
      Array.isArray(config.mappings) ||
      !Object.prototype.hasOwnProperty.call(config.mappings, notification)
    ) {
      return false;
    }

    const mapping = config.mappings[notification];
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) return false;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;

    if (mapping.mode === "message") {
      return this.receiveMessage({
        ...payload,
        source: payload.source || "magicmirror.remote-control"
      });
    }

    if (mapping.mode !== "alert") return false;
    const title = payload.title;
    const body = payload.message ?? payload.body;
    if (
      (typeof title !== "string" || !title.trim()) &&
      (typeof body !== "string" || !body.trim())
    ) {
      return false;
    }

    this.receiveMessage(
      {
        id: payload.id,
        type: mapping.type || "remote.alert",
        source: mapping.source || "magicmirror.remote-control",
        entityId: payload.entityId,
        title: typeof title === "string" && title.trim() ? title : this.translate("REMOTE_ALERT"),
        body: typeof body === "string" ? body : "",
        urgency: mapping.urgency,
        retention: mapping.retention,
        expires: payload.expires,
        actions: mapping.actions
      },
      { showToast: false }
    );
    return true;
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

    const forecastTime = this.formatClockTime(forecast.timestamp);
    this.receiveMessage({
      id: rain.messageId,
      type: "weather.precipitation",
      source: rain.source,
      entityId: rain.entityId,
      title: this.translate("RAIN_APPROACHING"),
      body: payload.locationName
        ? this.translate("RAIN_EXPECTED_NEAR", { location: String(payload.locationName), time: forecastTime })
        : this.translate("RAIN_EXPECTED", { time: forecastTime }),
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
    if (typeof this.expirationTimer.unref === "function") this.expirationTimer.unref();
  },

  ensureExpirationTimer() {
    if (!this.expirationTimer) this.startExpirationTimer();
  },

  stopExpirationTimer() {
    if (!this.expirationTimer) return;
    clearInterval(this.expirationTimer);
    this.expirationTimer = null;
  },

  startVisibilityListener() {
    this.stopVisibilityListener();
    if (typeof document === "undefined" || typeof document.addEventListener !== "function") {
      return;
    }

    this.visibilityHandler = () => {
      if (document.visibilityState === "visible") this.refreshAfterVisibilityChange();
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);
  },

  stopVisibilityListener() {
    if (!this.visibilityHandler) return;
    if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
    }
    this.visibilityHandler = null;
  },

  refreshAfterVisibilityChange() {
    const changed = this.pruneExpiredMessages();
    this.startExpirationTimer();
    this.requestQueueSync();
    if (!changed) this.updateDom(0);
  },

  startSyncTimer() {
    this.stopSyncTimer();
    this.requestQueueSync();
    const configuredInterval = Number(this.config.syncInterval);
    if (!Number.isFinite(configuredInterval) || configuredInterval <= 0) return;

    this.syncTimer = setInterval(
      () => this.requestQueueSync(),
      Math.max(1000, configuredInterval)
    );
    if (typeof this.syncTimer.unref === "function") this.syncTimer.unref();
  },

  stopSyncTimer() {
    if (!this.syncTimer) return;
    clearInterval(this.syncTimer);
    this.syncTimer = null;
  },

  requestQueueSync() {
    this.sendSocketNotification("MC_SYNC_REQUEST");
  },

  reconcileTransportSnapshot(payload) {
    if (!Array.isArray(payload)) return false;

    const previousAttentionState = this.getAttentionState();
    const localMessages = this.messages.filter((message) => !message.transportManaged);
    const transportMessages = payload
      .map((message) => this.normalizeMessage(message, {
        transportManaged: true,
        honorState: true
      }))
      .filter(Boolean);

    this.messages = [...localMessages, ...transportMessages]
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, this.getMaxMessages());
    this.pruneCachedImages();
    this.publishAttention(previousAttentionState);
    this.updateDom(0);
    return true;
  },

  pruneExpiredMessages(now = Date.now(), updateDom = true) {
    const previousAttentionState = this.getAttentionState();
    const retained = this.messages.filter(
      (message) => message.expires === null || message.expires > now
    );
    if (retained.length === this.messages.length) return false;

    this.messages = retained;
    this.publishAttention(previousAttentionState);
    if (updateDom) this.updateDom(0);
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

    if (this.shouldPublishLegacyAttentionEvents()) {
      if (state.active) this.sendNotification("ATTENTION_ON", state.unreadCount);
      else if (previousState && previousState.active) this.sendNotification("ATTENTION_OFF");
    }
  },

  shouldPublishLegacyAttentionEvents() {
    return this.config.legacyAttentionEvents !== false;
  },

  clearAttention() {
    const previousAttentionState = this.getAttentionState();
    const hasManagedMessages = this.messages.some((message) => message.transportManaged);
    this.messages.forEach((message) => {
      message.unread = false;
    });
    if (hasManagedMessages) this.sendQueueCommand({ action: "acknowledgeAll" });
    this.publishAttention(previousAttentionState);
    this.updateDom(200);
  },

  handleMessageCommand(payload, action) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    if (payload.source === undefined || payload.id === undefined) return false;
    return action === "acknowledge"
      ? this.acknowledgeMessage(String(payload.source), String(payload.id))
      : this.dismissMessage(String(payload.source), String(payload.id));
  },

  acknowledgeMessage(source, id) {
    const message = this.messages.find(
      (candidate) => candidate.source === source && candidate.id === id
    );
    if (!message || !message.unread) return false;

    const previousAttentionState = this.getAttentionState();
    message.unread = false;
    if (message.transportManaged) {
      this.sendQueueCommand({ action: "acknowledge", source, id });
    }
    this.publishAttention(previousAttentionState);
    this.updateDom(200);
    return true;
  },

  dismissMessage(source, id) {
    const message = this.messages.find(
      (candidate) => candidate.source === source && candidate.id === id
    );
    const resolved = this.resolveMessage(source, id);
    if (resolved && message && message.transportManaged) {
      this.sendQueueCommand({ action: "dismiss", source, id });
    }
    return resolved;
  },

  scheduleMarkViewed() {
    this.cancelPendingView();
    this.updateDom(0);

    const finish = () => {
      this.pendingView = null;
      if (this.currentPage === this.resolvePageTarget("messages")) {
        this.markViewed();
      }
    };

    if (
      typeof requestAnimationFrame === "function" &&
      typeof cancelAnimationFrame === "function"
    ) {
      const pending = { type: "frame", ids: [] };
      this.pendingView = pending;
      pending.ids.push(
        requestAnimationFrame(() => {
          pending.ids.push(requestAnimationFrame(finish));
        })
      );
      return;
    }

    this.pendingView = {
      type: "timer",
      id: setTimeout(finish, 0)
    };
  },

  cancelPendingView() {
    if (!this.pendingView) return;
    if (this.pendingView.type === "frame") {
      this.pendingView.ids.forEach((id) => cancelAnimationFrame(id));
    } else {
      clearTimeout(this.pendingView.id);
    }
    this.pendingView = null;
  },

  clearRead() {
    const retained = this.messages.filter((message) => message.unread);
    if (retained.length === this.messages.length) return false;
    const removedManagedMessage = this.messages.some(
      (message) => message.transportManaged && !message.unread
    );
    this.messages = retained;
    if (removedManagedMessage) this.sendQueueCommand({ action: "clearRead" });
    this.updateDom(200);
    return true;
  },

  markViewed() {
    const previousAttentionState = this.getAttentionState();
    const managedMessageViewed = this.messages.some(
      (message) => message.transportManaged && message.retention !== "untilAcknowledged"
    );
    this.messages.forEach((message) => {
      if (message.retention !== "untilAcknowledged") message.unread = false;
    });
    if (managedMessageViewed) this.sendQueueCommand({ action: "markViewed" });
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
    const hadManagedMessages = this.messages.some((message) => message.transportManaged);
    this.messages = [];
    if (hadManagedMessages) this.sendQueueCommand({ action: "clearAll" });
    this.publishAttention(previousAttentionState);
    this.updateDom(200);
  },

  getMaxMessages() {
    return Number.isInteger(this.config.maxMessages) && this.config.maxMessages > 0
      ? this.config.maxMessages
      : this.defaults.maxMessages;
  },

  sendQueueCommand(command) {
    this.sendSocketNotification("MC_QUEUE_COMMAND", command);
  },

  getImageCacheLimits() {
    const configured = this.config.images && typeof this.config.images === "object"
      ? this.config.images
      : {};
    return {
      maxCachedImages: Number.isInteger(configured.maxCachedImages) &&
        configured.maxCachedImages >= 0
        ? configured.maxCachedImages
        : this.defaults.images.maxCachedImages,
      maxTotalBytes: Number.isInteger(configured.maxTotalBytes) &&
        configured.maxTotalBytes >= 0
        ? configured.maxTotalBytes
        : this.defaults.images.maxTotalBytes
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

  pruneCachedImages() {
    const { maxCachedImages, maxTotalBytes } = this.getImageCacheLimits();
    let retainedCount = 0;
    let retainedBytes = 0;
    let removed = 0;

    this.messages.forEach((message) => {
      if (!message.image) return;
      const imageBytes = this.getCachedImageBytes(message.image);
      if (
        retainedCount >= maxCachedImages ||
        retainedBytes + imageBytes > maxTotalBytes
      ) {
        message.image = null;
        removed += 1;
        return;
      }
      retainedCount += 1;
      retainedBytes += imageBytes;
    });
    return removed;
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
      left.unread === right.unread &&
      left.expires === right.expires &&
      left.transportManaged === right.transportManaged &&
      JSON.stringify(left.image) === JSON.stringify(right.image) &&
      JSON.stringify(left.actions) === JSON.stringify(right.actions)
    );
  },

  normalizeMessage(raw, options = {}) {
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
    const image = this.normalizeImage(raw.image);

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
      unread: options.honorState && typeof raw.unread === "boolean"
        ? raw.unread
        : urgency !== "passive" && retention !== "ephemeral",
      expires,
      actions,
      image,
      transportManaged: options.transportManaged === true
    };
  },

  normalizeImage(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    if (
      typeof raw.dataUrl !== "string" ||
      !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(raw.dataUrl)
    ) {
      return null;
    }
    return {
      dataUrl: raw.dataUrl,
      alt: typeof raw.alt === "string" && raw.alt.trim()
        ? raw.alt.trim().slice(0, 240)
        : "Message snapshot",
      capturedAt: Number.isFinite(raw.capturedAt) ? raw.capturedAt : null
    };
  }
});
