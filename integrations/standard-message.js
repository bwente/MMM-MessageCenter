(function registerStandardMessageAdapter(root) {
  const notificationNames = new Set(["MC_MESSAGE", "MESSAGE_CENTER_MESSAGE", "MESSAGE_CENTER_SYNC"]);
  const maxSnapshotMessages = 100;

  const isProviderMessage = (payload, expectedSource = null) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    if (payload.id === undefined || payload.id === null || String(payload.id).trim() === "") return false;
    if (expectedSource === null) {
      if (typeof payload.source !== "string" || !payload.source.trim()) return false;
    } else if (payload.source !== undefined &&
      (typeof payload.source !== "string" || payload.source.trim() !== expectedSource)) {
      return false;
    }
    return typeof payload.title === "string" && Boolean(payload.title.trim());
  };

  const syncSourceMessages = (module, source, activeIds) => {
    const active = new Set(activeIds.map(String));
    const previousAttentionState = module.getAttentionState();
    const retained = module.messages.filter(
      (message) => message.source !== source || active.has(message.id)
    );
    if (retained.length === module.messages.length) return false;
    module.messages = retained;
    module.publishAttention(previousAttentionState);
    module.updateDom(200);
    return true;
  };

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
      if (notification === "MESSAGE_CENTER_SYNC") {
        if (typeof payload.source !== "string" || !payload.source.trim() ||
          !Array.isArray(payload.messages) || payload.messages.length > maxSnapshotMessages) return false;
        const source = payload.source.trim();
        if (!payload.messages.every((message) => isProviderMessage(message, source))) return false;

        const activeIds = [];
        for (const rawMessage of payload.messages) {
          const message = { ...rawMessage, source };
          const normalized = module.normalizeMessage(message);
          if (!normalized) continue;
          activeIds.push(normalized.id);
          module.receiveMessage(message, { showToast: payload.showToasts !== false });
        }
        syncSourceMessages(module, source, activeIds);
        return true;
      }
      const senderName = module.getSenderName(sender);
      return module.receiveMessage({
        ...payload,
        source: payload.source || `magicmirror.${module.slugifySource(senderName || "module")}`
      });
    },
    isProviderMessage,
    syncSourceMessages(module, source, activeIds) {
      return syncSourceMessages(module, source, activeIds);
    }
  });
})(globalThis);
