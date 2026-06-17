// Per-user prediction UI driven by the dashboard buttons.
// A click on a match button opens a private (ephemeral) panel showing that
// user's prediction and lets them set/update it — via a modal for football
// scores, or team buttons for cricket. Resolved matches show the result and
// points earned (read-only).

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require("discord.js");
const {
  getMatch,
  getPrediction,
  upsertPrediction,
  isMatchOpenForPredictions,
  predictionState,
} = require("../db/queries");
const { toDiscordTimestamp } = require("./time");
const { refreshDashboard } = require("./dashboard");

const TYPE_EMOJI = { football: "⚽", cricket: "🏏" };

const ephemeral = (content, components = []) => ({
  content,
  components,
  flags: MessageFlags.Ephemeral,
});

/** Build the text body of a user's private match panel. */
function panelContent(match, prediction) {
  const emoji = TYPE_EMOJI[match.type] ?? "🎯";
  const state = predictionState(match);
  const open = state === "open";
  const pending = state === "pending";
  const resolved = state === "resolved";

  let status;
  if (resolved) status = `✅ **Resolved** — result: **${match.result ?? "?"}**`;
  else if (open)
    status = `🟢 **Open** · closes ${toDiscordTimestamp(match.end_time)}`;
  else if (pending)
    status = `🕜 **Upcoming** · opens ${toDiscordTimestamp(match.start_time)}`;
  else status = "🔒 **Closed** for predictions";

  const lines = [
    `**#${match.id} ${emoji} ${match.type[0].toUpperCase()}${match.type.slice(1)}**`,
    `**${match.team_a}** 🆚 **${match.team_b}**`,
    status,
  ];

  if (prediction) {
    lines.push(`\n🎯 Your prediction: **${prediction.predicted_value}**`);
    if (prediction.updated_at) {
      lines.push(
        `🕒 Last updated: ${toDiscordTimestamp(prediction.updated_at)}`,
      );
    }
    if (resolved) {
      lines.push(`🏅 Points earned: **${prediction.points_earned}**`);
    }
  } else if (open) {
    lines.push("\n🔔 You haven't predicted yet — use the controls below.");
  } else if (pending) {
    lines.push(
      `\n⏳ Predictions aren't open yet — come back ${toDiscordTimestamp(match.start_time)}.`,
    );
  } else {
    lines.push("\nℹ️ You didn't make a prediction for this match.");
  }

  return lines.join("\n");
}

/** Build the interactive controls for a user's panel (empty if not open). */
function panelComponents(match, prediction) {
  if (!isMatchOpenForPredictions(match)) return [];

  const row = new ActionRowBuilder();
  if (match.type === "football") {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`pp:fb:${match.id}`)
        .setLabel(prediction ? "✏️ Update Score" : "✏️ Enter Score")
        .setStyle(ButtonStyle.Primary),
    );
  } else {
    const current = prediction?.predicted_value?.toLowerCase();
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`pp:ck:${match.id}:a`)
        .setLabel(match.team_a.slice(0, 80))
        .setStyle(
          current === match.team_a.toLowerCase()
            ? ButtonStyle.Success
            : ButtonStyle.Secondary,
        ),
      new ButtonBuilder()
        .setCustomId(`pp:ck:${match.id}:b`)
        .setLabel(match.team_b.slice(0, 80))
        .setStyle(
          current === match.team_b.toLowerCase()
            ? ButtonStyle.Success
            : ButtonStyle.Secondary,
        ),
    );
  }
  return [row];
}

/** Dashboard match button → open the prediction window straight away. */
async function handleMatchButton(interaction, matchId) {
  const match = getMatch(matchId);
  if (!match) {
    return interaction.reply(ephemeral("❌ That match no longer exists."));
  }

  // Closed / upcoming / resolved → just show a read-only status panel.
  if (!isMatchOpenForPredictions(match)) {
    const prediction = getPrediction(matchId, interaction.user.id);
    return interaction.reply(ephemeral(panelContent(match, prediction), []));
  }

  // Open football → jump straight to the score modal (no extra message).
  if (match.type === "football") {
    const prediction = getPrediction(matchId, interaction.user.id);
    return interaction.showModal(buildFootballModal(match, prediction));
  }

  // Open cricket → show the two team-choice buttons immediately.
  const prediction = getPrediction(matchId, interaction.user.id);
  return interaction.reply(
    ephemeral(
      panelContent(match, prediction),
      panelComponents(match, prediction),
    ),
  );
}

/** Build the football score modal, pre-filled from an existing prediction. */
function buildFootballModal(match, prediction) {
  // Pre-fill from an existing "X-Y" prediction, if any.
  let prevA = "";
  let prevB = "";
  if (prediction?.predicted_value) {
    const m = /^(\d{1,3})\s*-\s*(\d{1,3})$/.exec(prediction.predicted_value);
    if (m) {
      prevA = m[1];
      prevB = m[2];
    }
  }

  // One input per team so it's obvious which score belongs to whom.
  const inputA = new TextInputBuilder()
    .setCustomId("goals_a")
    .setLabel(`${match.team_a} — goals`.slice(0, 45))
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(3)
    .setPlaceholder("e.g. 2");
  const inputB = new TextInputBuilder()
    .setCustomId("goals_b")
    .setLabel(`${match.team_b} — goals`.slice(0, 45))
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(3)
    .setPlaceholder("e.g. 1");
  if (prevA) inputA.setValue(prevA);
  if (prevB) inputB.setValue(prevB);

  return new ModalBuilder()
    .setCustomId(`pp:fbm:${match.id}`)
    .setTitle(`Predict: ${match.team_a} vs ${match.team_b}`.slice(0, 45))
    .addComponents(
      new ActionRowBuilder().addComponents(inputA),
      new ActionRowBuilder().addComponents(inputB),
    );
}

/** Football "Enter/Update Score" button → open the score modal. */
async function handleFootballScoreButton(interaction, matchId) {
  const match = getMatch(matchId);
  if (!match || match.type !== "football") {
    return interaction.reply(ephemeral("❌ That match is unavailable."));
  }
  if (!isMatchOpenForPredictions(match)) {
    return interaction.reply(
      ephemeral("🔒 Predictions are closed for this match."),
    );
  }

  const prediction = getPrediction(matchId, interaction.user.id);
  return interaction.showModal(buildFootballModal(match, prediction));
}

/** Football modal submit → validate & save the score. */
async function handleFootballModal(interaction, matchId) {
  const match = getMatch(matchId);
  if (!match || match.type !== "football") {
    return interaction.reply(ephemeral("❌ That match is unavailable."));
  }
  if (!isMatchOpenForPredictions(match)) {
    return interaction.reply(
      ephemeral("🔒 Predictions closed before your score was saved."),
    );
  }

  const rawA = interaction.fields.getTextInputValue("goals_a").trim();
  const rawB = interaction.fields.getTextInputValue("goals_b").trim();
  if (!/^\d{1,3}$/.test(rawA) || !/^\d{1,3}$/.test(rawB)) {
    return interaction.reply(
      ephemeral(
        `❌ Enter a whole number of goals for each team ` +
          `(**${match.team_a}** and **${match.team_b}**), e.g. \`2\` and \`1\`.`,
      ),
    );
  }
  const score = `${Number(rawA)}-${Number(rawB)}`;

  upsertPrediction(matchId, interaction.user.id, score);
  await interaction.reply(
    ephemeral(
      `✅ Prediction saved: **${match.team_a} ${rawA} – ${rawB} ${match.team_b}** (\`${score}\`).`,
    ),
  );
  await refreshDashboard(interaction.client, match.tournament_id);
}

/** Cricket team button → save the chosen winner and refresh the panel. */
async function handleCricketButton(interaction, matchId, side) {
  const match = getMatch(matchId);
  if (!match || match.type !== "cricket") {
    return interaction.update(ephemeral("❌ That match is unavailable."));
  }
  if (!isMatchOpenForPredictions(match)) {
    return interaction.update(
      ephemeral("🔒 Predictions are closed for this match."),
    );
  }

  const winner = side === "a" ? match.team_a : match.team_b;
  upsertPrediction(matchId, interaction.user.id, winner);

  const prediction = getPrediction(matchId, interaction.user.id);
  await interaction.update({
    content:
      `✅ Saved: **${winner}** to win.\n\n` + panelContent(match, prediction),
    components: panelComponents(match, prediction),
  });
  await refreshDashboard(interaction.client, match.tournament_id);
}

module.exports = {
  handleMatchButton,
  handleFootballScoreButton,
  handleFootballModal,
  handleCricketButton,
};
