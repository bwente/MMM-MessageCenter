(function registerGenericAlertAdapter(root) {
  const defaultMappings = {
    SHOW_ALERT: { type: "module.alert", urgency: "passive", retention: "archive" },
    SHOW_NOTIFICATION: { type: "module.notification", urgency: "passive", retention: "archive" }
  };

  root.MessageCenterAdapters.register({
    id: "generic-alert",
    priority: 100,
    matches(module, notification, payload, sender) {
      if (module.isMessageCenterSender(sender)) return false;
      const config = module.getInternalAdapterConfig("generic", { enabled: true, mappings: defaultMappings });
      const mappings = config.mappings === undefined ? defaultMappings : config.mappings;
      return Boolean(mappings && typeof mappings === "object" && !Array.isArray(mappings) && Object.prototype.hasOwnProperty.call(mappings, notification));
    },
    handle(module, notification, payload, sender) {
      const config = module.getInternalAdapterConfig("generic", { enabled: true, mappings: defaultMappings });
      if (!config.enabled || !payload || typeof payload !== "object" || Array.isArray(payload)) return false;
      const mapping = config.mappings[notification];
      if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) return false;
      const title = payload.title;
      const body = payload.message ?? payload.body;
      if ((typeof title !== "string" || !title.trim()) && (typeof body !== "string" || !body.trim())) return false;
      const senderName = module.getSenderName(sender);
      return module.receiveMessage({
        id: payload.id,
        type: mapping.type,
        source: mapping.source || `magicmirror.${module.slugifySource(senderName || "module")}`,
        entityId: payload.entityId,
        title: typeof title === "string" && title.trim() ? title : module.translate("MODULE_ALERT"),
        body: typeof body === "string" ? body : "",
        urgency: mapping.urgency,
        retention: mapping.retention,
        timestamp: payload.timestamp,
        expires: payload.expires,
        actions: mapping.actions
      }, { showToast: false });
    }
  });
})(globalThis);
