const assert = require("node:assert/strict");
const test = require("node:test");
const schemaFile = require("../MMM-MessageCenter.schema.json");

let definition;
global.Module = {
  register(name, moduleDefinition) {
    assert.equal(name, "MMM-MessageCenter");
    definition = moduleDefinition;
  }
};
global.Log = { info() {}, warn() {}, error() {} };
require("../MMM-MessageCenter.js");

const moduleSchema = schemaFile.schema["MMM-MessageCenter"];
const configSchema = moduleSchema.properties.config;

function assertDefaultCoverage(defaults, schema, path = "config") {
  for (const [key, value] of Object.entries(defaults)) {
    const property = schema.properties?.[key];
    assert.ok(property, `Missing schema property ${path}.${key}`);
    if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length) {
      if (property.additionalProperties) continue;
      assertDefaultCoverage(value, property, `${path}.${key}`);
    }
  }
}

test("MMM-Config schema covers every MessageCenter default", () => {
  assertDefaultCoverage(definition.defaults, configSchema);
});

test("MMM-Config schema provides safe choices and numeric limits", () => {
  assert.deepEqual(configSchema.properties.displayMode.enum, ["page", "compact", "line"]);
  assert.equal(configSchema.properties.webhook.properties.port.maximum, 65535);
  assert.equal(configSchema.properties.images.properties.maxBytes.maximum, 5 * 1024 * 1024);
  assert.deepEqual(
    configSchema.properties.internalNotifications.properties.weather.properties.rain.properties.urgency.enum,
    ["passive", "attention", "critical"]
  );
});

test("MMM-Config form masks configured credentials", () => {
  const fields = [];
  const visit = (items) => {
    for (const item of items || []) {
      if (item.key) fields.push(item);
      visit(item.items);
    }
  };
  visit(schemaFile.form);
  for (const key of [
    "MMM-MessageCenter.config.webhook.token",
    "MMM-MessageCenter.config.transports.mqtt.password"
  ]) {
    assert.equal(fields.find((field) => field.key === key)?.type, "password");
  }
});

test("MMM-Config form exposes each configurable property", () => {
  const keys = new Set();
  const visit = (items) => {
    for (const item of items || []) {
      if (item.key?.startsWith("MMM-MessageCenter.config.")) keys.add(item.key.slice(25));
      visit(item.items);
    }
  };
  visit(schemaFile.form);

  const collect = (schema, prefix = "") => {
    for (const [key, property] of Object.entries(schema.properties || {})) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (property.properties) collect(property, path);
      else assert.ok(keys.has(path), `Missing form field for config.${path}`);
    }
  };
  collect(configSchema);
});
