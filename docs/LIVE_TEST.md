# Live test checklist

Use this checklist after deploying a reviewed repository build to a mirror.
Do not place tokens, addresses, or private household payloads in this document.

## MMM-Remote-Control

- Send one `SHOW_ALERT` with a harmless test title and body.
- Confirm the alert appears once, not twice.
- Open Messages and confirm it appears once as read, passive history with the
  source label **Remote Control**.
- Forward an `MC_MESSAGE` with a stable test `id`, `urgency: "attention"`, and
  `retention: "untilViewed"`.
- Confirm it produces one toast, one unread history entry, and semantic attention.
- Forward the identical payload again and confirm it does not repeat the toast or
  create another history entry.
- Open Messages and confirm `untilViewed` attention clears.
- Forward an `untilAcknowledged` test and confirm opening Messages does not clear it;
  use **Mark all read** to acknowledge it.

## Noise and navigation

- Change brightness and confirm no message is created.
- Show or hide a module and confirm no message is created.
- Change pages and confirm no message is created.
- Trigger presence or refresh only if safe, and confirm no message is created.
- Send a message with a timed page action and confirm it returns to the original page.
- Repeat, then navigate manually before timeout and confirm automatic return is canceled.

## Recovery

- Review MagicMirror logs for MessageCenter errors.
- If normal mirror behavior regresses, restore the timestamped module backup and
  restart MagicMirror before investigating further.
