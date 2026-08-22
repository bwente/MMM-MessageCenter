const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const translationsDirectory = path.join(__dirname, "..", "translations");
const files = fs.readdirSync(translationsDirectory)
  .filter((name) => name.endsWith(".json"))
  .sort();
const dictionaries = Object.fromEntries(
  files.map((name) => [path.basename(name, ".json"), require(path.join(translationsDirectory, name))])
);
const english = dictionaries.en;

function variables(value) {
  return [...value.matchAll(/\{([^{}]+)\}/g)]
    .map((match) => match[1])
    .sort();
}

test("ships the documented translation languages", () => {
  assert.deepEqual(Object.keys(dictionaries), ["de", "en", "es", "fr"]);
});

for (const [language, dictionary] of Object.entries(dictionaries)) {
  test(`${language} matches the complete English translation contract`, () => {
    assert.deepEqual(Object.keys(dictionary).sort(), Object.keys(english).sort());

    for (const [key, englishValue] of Object.entries(english)) {
      assert.equal(typeof dictionary[key], "string", `${language}.${key} must be a string`);
      assert.notEqual(dictionary[key].trim(), "", `${language}.${key} must not be empty`);
      assert.deepEqual(
        variables(dictionary[key]),
        variables(englishValue),
        `${language}.${key} must preserve interpolation variables`
      );
    }
  });
}
