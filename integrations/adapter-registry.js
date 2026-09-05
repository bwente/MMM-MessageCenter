(function registerAdapterRegistry(root) {
  const adapters = [];

  root.MessageCenterAdapters = {
    register(adapter) {
      if (!adapter || typeof adapter.id !== "string" || typeof adapter.matches !== "function" || typeof adapter.handle !== "function") return;
      adapters.push(adapter);
      adapters.sort((left, right) => (right.priority || 0) - (left.priority || 0));
    },

    get(id) {
      return adapters.find((adapter) => adapter.id === id);
    },

    dispatch(module, notification, payload, sender) {
      for (const adapter of adapters) {
        if (!adapter.matches(module, notification, payload, sender)) continue;
        return adapter.handle(module, notification, payload, sender) === true;
      }
      return false;
    }
  };
})(globalThis);
