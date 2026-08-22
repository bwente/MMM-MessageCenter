# Contributing to MMM-MessageCenter

Thanks for helping improve MMM-MessageCenter. Keep changes focused on a
standard, independently useful MagicMirror² module. Optional transports,
page routing, and attention consumers must continue to degrade cleanly when
they are not installed or configured.

## Before each commit

- Review the complete working tree and diff. Keep unrelated work in a separate
  commit or branch.
- Run `npm run check` and `git diff --check`.
- Confirm the commit author and repository remote are the intended ones.
- Treat `translations/en.json` as the translation reference. Keep every locale
  in key and interpolation-variable parity, and leave sender-authored message
  titles and bodies untranslated.
- Check the package name, version, author, repository, Node.js requirement, and
  MIT license metadata against `LICENSE`.
- Inspect the files being committed for credentials, tokens, personal
  configuration, private endpoints, household data, local instruction files,
  and unrelated attribution or tooling boilerplate.
- Update `CHANGELOG.md` when the change affects users, compatibility, security,
  installation, or documented behavior.

## Before each push or public release

- Repeat the sensitive-data and personal-configuration review across the full
  tracked tree, not only the latest diff.
- Confirm GitHub Actions has only the permissions it needs. The project check
  workflow should remain read-only unless a documented release job requires
  otherwise.
- Clone the candidate commit into a new temporary directory and complete the
  installation procedure from `README.md`. Do not rely on an existing
  `node_modules` directory or local configuration.
- Record the versions actually used for validation, including Node.js, npm,
  MagicMirror², and optional integrations where applicable. Do not describe
  unperformed compatibility testing as verified.
- Visually review screenshots and inspect their metadata for private names,
  locations, addresses, network details, credentials, and household data.
- Confirm the proposed commit contains no local instruction files or unrelated
  development-tool artifacts.
- Wait for every required CI check to pass before merging or publishing a
  release.

## Validation scope

Use `npm run check` as the local baseline. For presentation changes, also
review standard-region line mode, compact mode, and full-page mode. For
transport or integration changes, exercise the affected webhook, MQTT, or Unix
socket path and confirm standalone operation without MMM-pages or companion
hardware modules.

Document the exact scope that was exercised in the pull request or release
notes. Manual testing on a particular display or integration is valuable, but
it should not be generalized beyond the versions and configurations actually
tested.
