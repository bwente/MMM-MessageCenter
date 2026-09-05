(function registerPublicTransportHubAdapter(root) {
  root.MessageCenterAdapters.register({
    id: "public-transport-hub",
    priority: 800,
    matches(module, notification, payload, sender) {
      return notification === "PTH_SERVICE_ALERT" && module.isSender(sender, "MMM-PublicTransportHub");
    },
    handle(module, notification, payload) {
      const config = module.getInternalAdapterConfig("publicTransportHub", { enabled: true });
      if (!config.enabled || !payload || typeof payload !== "object" || Array.isArray(payload)) return false;
      if (payload.id === undefined || payload.id === null || String(payload.id).trim() === "") return false;

      const source = "magicmirror.public-transport-hub";
      const id = String(payload.id);
      if (payload.active === false) return module.resolveMessage(source, id);
      if (typeof payload.title !== "string" || !payload.title.trim()) return false;

      const existing = module.messages.find((message) => message.source === source && message.id === id);
      const types = {
        cancellation: "transit.cancellation",
        delay: "transit.delay",
        remark: "transit.remark",
        no_departures: "transit.no-departures"
      };
      return module.receiveMessage({
        id,
        type: types[payload.kind] || "transit.service-alert",
        source,
        entityId: payload.tripId || payload.stationId,
        title: payload.title,
        body: typeof payload.body === "string" ? payload.body : "",
        urgency: "attention",
        retention: "untilViewed",
        timestamp: payload.timestamp,
        unread: existing ? existing.unread : true,
        expires: payload.expires
      }, { honorState: Boolean(existing), showToast: !existing });
    }
  });
})(globalThis);
