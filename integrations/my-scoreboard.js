(function registerMyScoreboardAdapter(root) {
  const eventDefaults = {
    "game.started": {
      urgency: "passive",
      retention: "archive",
      expiresConfig: "startedExpiresAfterMinutes",
      expiresAfterMinutes: 120,
      bodyKey: "SPORTS_GAME_STARTED"
    },
    "game.halftime": {
      urgency: "attention",
      retention: "untilViewed",
      expiresConfig: "halftimeExpiresAfterMinutes",
      expiresAfterMinutes: 45,
      bodyKey: "SPORTS_GAME_HALFTIME"
    },
    "game.score": {
      urgency: "attention",
      retention: "untilViewed",
      expiresConfig: "scoreExpiresAfterMinutes",
      expiresAfterMinutes: 120,
      bodyKey: "SPORTS_GAME_SCORE"
    },
    "game.final": {
      urgency: "attention",
      retention: "untilViewed",
      expiresConfig: "finalExpiresAfterMinutes",
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

  function numericScore(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value.trim())) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function scoreBody(module, event, away, awayScore, home, homeScore, fallbackKey) {
    if (!["game.halftime", "game.score", "game.final"].includes(event)) {
      return module.translate(fallbackKey, { away, awayScore, home, homeScore });
    }

    const awayNumber = numericScore(awayScore);
    const homeNumber = numericScore(homeScore);
    if (awayNumber === null || homeNumber === null) {
      return module.translate(fallbackKey, { away, awayScore, home, homeScore });
    }

    if (awayNumber === homeNumber) {
      const key = event === "game.final" ? "SPORTS_FINAL_TIED" : event === "game.halftime"
        ? "SPORTS_HALFTIME_TIED"
        : "SPORTS_SCORE_TIED";
      return module.translate(key, { away, awayScore, home, homeScore });
    }

    const awayLeads = awayNumber > homeNumber;
    const values = {
      leader: awayLeads ? away : home,
      leaderScore: awayLeads ? awayScore : homeScore,
      trailer: awayLeads ? home : away,
      trailerScore: awayLeads ? homeScore : awayScore
    };
    const key = event === "game.final" ? "SPORTS_FINAL_WINNER" : event === "game.halftime"
      ? "SPORTS_HALFTIME_LEADER"
      : "SPORTS_SCORE_LEADER";
    return module.translate(key, values);
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
      const scoreSuffix = payload.event === "game.score" ? `:${awayScore}-${homeScore}` : "";
      const id = `${payload.gameId.trim()}:${payload.event}${scoreSuffix}`;
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
        body: scoreBody(module, payload.event, away, awayScore, home, homeScore, eventConfig.bodyKey),
        urgency: eventConfig.urgency,
        retention: eventConfig.retention,
        timestamp,
        unread: existing ? existing.unread : eventConfig.urgency !== "passive",
        expires: timestamp + (
          Number.isFinite(Number(config[eventConfig.expiresConfig])) && Number(config[eventConfig.expiresConfig]) > 0
            ? Number(config[eventConfig.expiresConfig])
            : eventConfig.expiresAfterMinutes
        ) * 60 * 1000
      }, { honorState: Boolean(existing), showToast: !existing });
    }
  });
})(globalThis);
