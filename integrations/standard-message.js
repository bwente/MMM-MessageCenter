(function registerStandardMessageAdapter(root) {
  const notificationNames = new Set(["MC_MESSAGE", "MESSAGE_CENTER_MESSAGE"]);

  root.MessageCenterAdapters.register({
    id: "standard-message",
    priority: 1000,
    matches(module, notification, payload, sender) {
      if (!notificationNames.has(notification) || module.isMessageCenterSender(sender)) return false;
      return notification !== "MC_MESSAGE" || !module.isSender(sender, "MMM-Remote-Control");
    },
    handle(module, notification, payload, sender) {
      const config = module.getInternalAdapterConfig("standard", { enabled: true });
      if (!config.enabled || !payload || typeof payload !== "object" || Array.isArray(payload)) return false;
      const senderName = module.getSenderName(sender);
      return module.receiveMessage({
        ...payload,
        source: payload.source || `magicmirror.${module.slugifySource(senderName || "module")}`
      });
    }
  });
})(globalThis);
