const { defineConfig } = require("eslint/config");

module.exports = defineConfig([
  {
    ignores: ["node_modules/**"]
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs"
    },
    rules: {
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-dupe-keys": "error",
      "no-unreachable": "error"
    }
  }
]);
