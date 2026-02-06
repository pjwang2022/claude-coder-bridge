import { SlashCommandBuilder, REST, Routes } from "discord.js";
import type { ClaudeManager } from './manager.js';

export class CommandHandler {
  constructor(
    private claudeManager: ClaudeManager,
    private allowedUserIds: string[]
  ) {}

  getCommands() {
    return [
      new SlashCommandBuilder()
        .setName("clear")
        .setDescription("Clear the current Claude Code session"),
      new SlashCommandBuilder()
        .setName("cancel")
        .setDescription("Cancel the current running Claude Code task"),
    ];
  }

  async registerCommands(token: string, clientId: string): Promise<void> {
    const rest = new REST().setToken(token);

    try {
      await rest.put(Routes.applicationCommands(clientId), {
        body: this.getCommands(),
      });
      console.log("Successfully registered application commands.");
    } catch (error) {
      console.error(error);
    }
  }

  async handleInteraction(interaction: any): Promise<void> {
    if (!interaction.isChatInputCommand()) return;

    if (!this.allowedUserIds.includes(interaction.user.id)) {
      await interaction.reply({
        content: "You are not authorized to use this bot.",
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === "clear") {
      const channelId = interaction.channelId;
      this.claudeManager.clearSession(channelId);

      await interaction.reply(
        "Session cleared! Next message will start a new Claude Code session."
      );
    } else if (interaction.commandName === "cancel") {
      const channelId = interaction.channelId;

      if (!this.claudeManager.hasActiveProcess(channelId)) {
        await interaction.reply("No active task to cancel.");
        return;
      }

      this.claudeManager.killActiveProcess(channelId);
      await interaction.reply("Task cancelled. Session is preserved — you can continue chatting.");
    }
  }
}