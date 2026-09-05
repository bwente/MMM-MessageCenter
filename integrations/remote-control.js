(function registerRemoteControlAdapter(root) {
  root.MessageCenterAdapters.register({
    id: "remote-control",
    priority: 900,
    matches(module, notification, payload, sender) {
      return module.isSender(sender, "MMM-Remote-Control");
    },
    handle(module, notification, payload) {
      const defaults = module.defaults.internalNotifications.remoteControl;
      const configured = module.config.internalNotifications?.remoteControl || {};
      const config = {
        ...defaults,
        ...configured,
        mappings: configured.mappings === undefined ? defaults.mappings : configured.mappings
      };
      if (!config.enabled || !config.mappings || typeof config.mappings !== "object" || Array.isArray(config.mappings)) return false;
      if (!Object.prototype.hasOwnProperty.call(config.mappings, notification)) return false;

      const mapping = config.mappings[notification];
      if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) return false;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;

      if (mapping.mode === "message") {
        return module.receiveMessage({ ...payload, source: payload.source || "magicmirror.remote-control" });
      }
      if (mapping.mode !== "alert") return false;

      const title = payload.title;
      const body = payload.message ?? payload.body;
      if ((typeof title !== "string" || !title.trim()) && (typeof body !== "string" || !body.trim())) return false;
      module.receiveMessage({
        id: payload.id,
        type: mapping.type || "remote.alert",
        source: mapping.source || "magicmirror.remote-control",
        entityId: payload.entityId,
        title: typeof title === "string" && title.trim() ? title : module.translate("REMOTE_ALERT"),
        body: typeof body === "string" ? body : "",
        urgency: mapping.urgency,
        retention: mapping.retention,
        expires: payload.expires,
        actions: mapping.actions
      }, { showToast: false });
      return true;
    }
  });
})(globalThis);
