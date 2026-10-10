(function registerMyScoreboardAdapter(root) {
  const eventDefaults = {
    "game.started": {
      urgency: "passive",
      retention: "archive",
      expiresAfterMinutes: 360,
      bodyKey: "SPORTS_GAME_STARTED"
    },
    "game.halftime": {
      urgency: "attention",
      retention: "untilViewed",
      expiresAfterMinutes: 240,
      bodyKey: "SPORTS_GAME_HALFTIME"
    },
    "game.final": {
      urgency: "attention",
      retention: "untilViewed",
      expiresAfterMinutes: 720,
      bodyKey: "SPORTS_GAME_FINAL"
    }
  };

  function teamName(team) {
    if (!team || typeof team !== "object" || Array.isArray(team)) return "";
    const name = team.name || team.abbreviation;
    return typeof name === "string" ? name.trim() : "";
  }

  function score(team) {
    if (!team || typeof team !== "object" || Array.isArray(team)) return null;
    if (typeof team.score === "number" && Number.isFinite(team.score)) return team.score;
    if (typeof team.score === "string" && team.score.trim()) return team.score.trim();
    return null;
  }

  root.MessageCenterAdapters.register({
    id: "my-scoreboard",
    priority: 800,
    matches(module, notification, payload, sender) {
      return notification === "MYSCOREBOARD_GAME_EVENT" && module.isSender(sender, "MMM-MyScoreboard");
    },
    handle(module, notification, payload) {
      const config = module.getInternalAdapterConfig("myScoreboard", { enabled: true });
      if (!config.enabled || !payload || typeof payload !== "object" || Array.isArray(payload)) return false;

      const eventConfig = eventDefaults[payload.event];
      if (!eventConfig || typeof payload.gameId !== "string" || !payload.gameId.trim()) return false;

      const away = teamName(payload.away);
      const home = teamName(payload.home);
      const awayScore = score(payload.away);
      const homeScore = score(payload.home);
      if (!away || !home || awayScore === null || homeScore === null) return false;

      const source = "magicmirror.my-scoreboard";
      const id = `${payload.gameId.trim()}:${payload.event}`;
      const existing = module.messages.find((message) => message.source === source && message.id === id);
      const timestamp = Number.isFinite(Number(payload.timestamp)) && Number(payload.timestamp) > 0
        ? Number(payload.timestamp)
        : Date.now();

      return module.receiveMessage({
        id,
        type: `sports.${payload.event}`,
        source,
        entityId: payload.gameId.trim(),
        title: module.translate("SPORTS_MATCHUP", { away, home }),
        body: module.translate(eventConfig.bodyKey, { away, awayScore, home, homeScore }),
        urgency: eventConfig.urgency,
        retention: eventConfig.retention,
        timestamp,
        unread: existing ? existing.unread : eventConfig.urgency !== "passive",
        expires: timestamp + eventConfig.expiresAfterMinutes * 60 * 1000
      }, { honorState: Boolean(existing), showToast: !existing });
    }
  });
})(globalThis);
