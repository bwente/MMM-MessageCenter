const NodeHelper = require("node_helper");
const express = require("express");

module.exports = NodeHelper.create({
  start() {
    console.log("[MMM-MessageCenter] Node helper started");

    this.app = express();
    this.app.use(express.json());

    this.app.post("/message", (req, res) => {
      console.log(
        "[MMM-MessageCenter] Webhook payload:",
        req.body
      );

      this.sendSocketNotification("MC_MESSAGE", req.body);

      res.json({ ok: true });
    });

    this.server = this.app.listen(8787, () => {
      console.log(
        "[MMM-MessageCenter] Webhook listening on port 8787"
      );
    });
  },

  stop() {
    if (this.server) {
      this.server.close();
    }
  }
});
