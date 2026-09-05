(function registerWeatherAdapter(root) {
  const timestamp = (value) => {
    if (Number.isFinite(value)) return value;
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  };

  const isRain = (entry, config) => {
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
    const hasRainAmount = (rain !== null && rain >= config.amountThreshold) ||
      (!snowOnly && (snow === null || snow <= 0) && amount !== null && amount >= config.amountThreshold);
    return hasRainAmount || (rainType && (probability === null || probability >= config.probabilityThreshold));
  };

  const adapter = {
    id: "weather",
    priority: 700,
    matches(module, notification) {
      return notification === "WEATHER_UPDATED";
    },
    getConfig(module) {
      const defaults = module.defaults.internalNotifications.weather;
      const configured = module.config.internalNotifications?.weather || {};
      return { ...defaults, ...configured, rain: { ...defaults.rain, ...(configured.rain || {}) } };
    },
    findRainForecast(hourlyArray, now, config) {
      const target = now + config.leadTimeMinutes * 60000;
      const tolerance = config.windowMinutes * 60000;
      return hourlyArray.map((entry) => ({ entry, timestamp: timestamp(entry?.date) }))
        .filter(({ entry, timestamp: value }) => value !== null && value > now && Math.abs(value - target) <= tolerance && isRain(entry, config))
        .sort((left, right) => Math.abs(left.timestamp - target) - Math.abs(right.timestamp - target))[0] || null;
    },
    handle(module, notification, payload, sender, now = Date.now()) {
      const weatherConfig = adapter.getConfig(module);
      if (!weatherConfig.enabled || !weatherConfig.rain.enabled) return false;
      if (!payload || !Array.isArray(payload.hourlyArray) || !payload.hourlyArray.length) return false;
      const rain = weatherConfig.rain;
      const forecast = adapter.findRainForecast(payload.hourlyArray, now, rain);
      if (!forecast) return module.resolveMessage(rain.source, rain.messageId);
      if (module.messages.some((message) => message.source === rain.source && message.id === rain.messageId)) return true;
      const forecastTime = module.formatClockTime(forecast.timestamp);
      return module.receiveMessage({
        id: rain.messageId,
        type: "weather.precipitation",
        source: rain.source,
        entityId: rain.entityId,
        title: module.translate("RAIN_APPROACHING"),
        body: payload.locationName
          ? module.translate("RAIN_EXPECTED_NEAR", { location: String(payload.locationName), time: forecastTime })
          : module.translate("RAIN_EXPECTED", { time: forecastTime }),
        urgency: rain.urgency,
        retention: rain.retention,
        timestamp: now,
        expires: forecast.timestamp + rain.expiresAfterMinutes * 60000,
        actions: { switchChannel: rain.channel, timeout: rain.timeout }
      });
    },
    timestamp,
    isRain
  };

  root.MessageCenterAdapters.register(adapter);
})(globalThis);
