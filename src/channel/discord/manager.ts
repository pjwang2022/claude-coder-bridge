import * as path from "path";
import * as fs from "fs";
import { EmbedBuilder } from "discord.js";
import type { SDKMessage } from "../../types/index.js";
import { buildClaudeCommand, type DiscordContext } from "./shell.js";
import { spawnClaudeProcess, type ProcessHandle } from "../../shared/process-runner.js";
import { DatabaseManager } from "../../db/database.js";
import { getProcessTimeoutMs } from '../../utils/config.js';
import { isApiMode, createApiRunner } from '../../shared/runner-factory.js';

import { createThrottle } from '../../shared/throttle.js';
import { cleanupOldAttachments } from '../../shared/attachments.js';

export class ClaudeManager {
  private db: DatabaseManager;
  private channelMessages = new Map<string, any>();
  private channelToolCalls = new Map<string, Map<string, { message: any, toolId: string }>>();
  private channelNames = new Map<string, string>();
  private apiThrottle = createThrottle(500);
  private channelProcesses = new Map<
    string,
    {
      handle: ProcessHandle | null;
      sessionId?: string;
      discordMessage: any;
    }
  >();
  private permissionManager?: any;

  constructor(private baseFolder: string) {
    this.db = new DatabaseManager();
    this.db.cleanupOldSessions();
  }

  /**
   * Set the permission manager for API mode tool approval.
   * Only needed when CLAUDE_MODE=api.
   */
  setPermissionManager(pm: any): void {
    this.permissionManager = pm;
  }

  hasActiveProcess(channelId: string): boolean {
    return this.channelProcesses.has(channelId);
  }

  killActiveProcess(channelId: string): void {
    const activeProcess = this.channelProcesses.get(channelId);
    if (activeProcess?.handle) {
      console.log(`Killing active process for channel ${channelId}`);
      activeProcess.handle.kill();
    }
  }

  clearSession(channelId: string): void {
    this.killActiveProcess(channelId);
    const channelName = this.channelNames.get(channelId);
    if (channelName) {
      cleanupOldAttachments(path.join(this.baseFolder, channelName, '.attachments'), 0);
    }
    this.db.clearSession(channelId);
    this.channelMessages.delete(channelId);
    this.channelToolCalls.delete(channelId);
    this.channelNames.delete(channelId);
    this.channelProcesses.delete(channelId);
  }

  setDiscordMessage(channelId: string, message: any): void {
    this.channelMessages.set(channelId, message);
    this.channelToolCalls.set(channelId, new Map());
  }

  reserveChannel(
    channelId: string,
    sessionId: string | undefined,
    discordMessage: any
  ): void {
    const existingProcess = this.channelProcesses.get(channelId);
    if (existingProcess?.handle) {
      console.log(
        `Killing existing process for channel ${channelId} before starting new one`
      );
      existingProcess.handle.kill();
    }

    this.channelProcesses.set(channelId, {
      handle: null,
      sessionId,
      discordMessage,
    });
  }

  getSessionId(channelId: string): string | undefined {
    return this.db.getSession(channelId);
  }

  async runClaudeCode(
    channelId: string,
    channelName: string,
    prompt: string,
    sessionId?: string,
    discordContext?: DiscordContext
  ): Promise<void> {
    this.channelNames.set(channelId, channelName);
    const workingDir = path.join(this.baseFolder, channelName);
    console.log(`Running Claude Code in: ${workingDir}`);

    if (!fs.existsSync(workingDir)) {
      throw new Error(`Working directory does not exist: ${workingDir}`);
    }

    // Common callbacks used by both CLI and API modes
    const callbacks = {
      onInit: (parsed: any) => {
        this.handleInitMessage(channelId, parsed).catch(console.error);
        this.db.setSession(channelId, parsed.session_id, channelName);
      },

      onAssistantMessage: (parsed: any) => {
        this.handleAssistantMessage(channelId, parsed).catch(console.error);
      },

      onToolResult: (parsed: any) => {
        this.handleToolResultMessage(channelId, parsed).catch(console.error);
      },

      onResult: (parsed: any) => {
        this.handleResultMessage(channelId, parsed).catch(console.error);
        this.db.setSession(channelId, parsed.session_id, channelName);
        this.channelProcesses.delete(channelId);
      },

      onError: (error: Error) => {
        console.error(`Claude process error for channel ${channelId}:`, error.message);
        this.channelProcesses.delete(channelId);
        const channel = this.channelMessages.get(channelId)?.channel;
        if (channel) {
          const errorEmbed = new EmbedBuilder()
            .setTitle("❌ Claude Code Failed")
            .setDescription(error.message)
            .setColor(0xFF0000);
          channel.send({ embeds: [errorEmbed] }).catch(console.error);
        }
      },

      onStderr: (text: string) => {
        console.error(`Claude stderr (${channelId}):`, text);
        const channel = this.channelMessages.get(channelId)?.channel;
        if (channel) {
          const warningEmbed = new EmbedBuilder()
            .setTitle("⚠️ Warning")
            .setDescription(text)
            .setColor(0xFFA500);
          channel.send({ embeds: [warningEmbed] }).catch(console.error);
        }
      },

      onTimeout: () => {
        console.log(`Claude process timed out for channel ${channelId}`);
        this.channelProcesses.delete(channelId);
        const channel = this.channelMessages.get(channelId)?.channel;
        if (channel) {
          const timeoutEmbed = new EmbedBuilder()
            .setTitle("⏰ Timeout")
            .setDescription("Claude Code took too long to respond (5 minutes)")
            .setColor(0xFFD700);
          channel.send({ embeds: [timeoutEmbed] }).catch(console.error);
        }
      },

      onClose: (_code: number | null) => {
        this.channelProcesses.delete(channelId);
      },
    };

    let handle: ProcessHandle;

    // Check if API mode is enabled
    if (isApiMode()) {
      console.log('Running in API mode');
      handle = await createApiRunner(
        {
          workingDir,
          prompt,
          sessionId,
          timeoutMs: getProcessTimeoutMs(),
          platformContext: {
            platform: 'discord',
            channelId,
            userId: discordContext?.userId,
            permissionManager: this.permissionManager,
          },
        },
        callbacks
      );
    } else {
      // CLI mode - existing behavior unchanged
      const commandString = buildClaudeCommand(workingDir, prompt, sessionId, discordContext);
      console.log(`Running command: ${commandString}`);

      handle = spawnClaudeProcess(
        commandString,
        callbacks,
        getProcessTimeoutMs(),
        path.join(process.cwd(), 'log.txt'),
      );
    }

    // Update the channel process tracking with actual handle
    const channelProcess = this.channelProcesses.get(channelId);
    if (channelProcess) {
      channelProcess.handle = handle;
    }
  }

  private async handleInitMessage(channelId: string, parsed: any): Promise<void> {
    const channel = this.channelMessages.get(channelId)?.channel;
    if (!channel) return;

    const initEmbed = new EmbedBuilder()
      .setTitle("🚀 Claude Code Session Started")
      .setDescription(`**Working Directory:** ${parsed.cwd}\n**Model:** ${parsed.model}\n**Tools:** ${parsed.tools.length} available`)
      .setColor(0x00FF00);

    try {
      await this.apiThrottle(() => channel.send({ embeds: [initEmbed] }));
    } catch (error) {
      console.error("Error sending init message:", error);
    }
  }

  private async handleAssistantMessage(
    channelId: string,
    parsed: SDKMessage & { type: "assistant" }
  ): Promise<void> {
    const channel = this.channelMessages.get(channelId)?.channel;
    if (!channel) return;

    const content = Array.isArray(parsed.message.content)
      ? parsed.message.content.find((c: any) => c.type === "text")?.text || ""
      : parsed.message.content;

    const toolUses = Array.isArray(parsed.message.content)
      ? parsed.message.content.filter((c: any) => c.type === "tool_use")
      : [];

    const toolCalls = this.channelToolCalls.get(channelId) || new Map();
    const channelName = this.channelNames.get(channelId) || "default";

    try {
      if (content && content.trim()) {
        const assistantEmbed = new EmbedBuilder()
          .setTitle("💬 Claude")
          .setDescription(content)
          .setColor(0x7289DA);
        await this.apiThrottle(() => channel.send({ embeds: [assistantEmbed] }));
      }

      for (const tool of toolUses) {
        let toolMessage = `🔧 ${tool.name}`;

        if (tool.input && Object.keys(tool.input).length > 0) {
          const inputs = Object.entries(tool.input)
            .map(([key, value]) => {
              let val = String(value);
              if (channelName) {
                const basePath = `${this.baseFolder}${channelName}`;
                if (val === basePath) {
                  val = ".";
                } else if (val.startsWith(basePath + "/")) {
                  val = val.replace(basePath + "/", "./");
                }
              }
              return `${key}=${val}`;
            })
            .join(", ");
          toolMessage += ` (${inputs})`;
        }

        const toolEmbed = new EmbedBuilder()
          .setDescription(`⏳ ${toolMessage}`)
          .setColor(0x0099FF);

        const sentMessage = await this.apiThrottle(() => channel.send({ embeds: [toolEmbed] }));
        toolCalls.set(tool.id, { message: sentMessage, toolId: tool.id });
      }

      this.db.setSession(channelId, parsed.session_id, channelName);
      this.channelToolCalls.set(channelId, toolCalls);
    } catch (error) {
      console.error("Error sending assistant message:", error);
    }
  }

  private async handleToolResultMessage(channelId: string, parsed: any): Promise<void> {
    const toolResults = Array.isArray(parsed.message.content)
      ? parsed.message.content.filter((c: any) => c.type === "tool_result")
      : [];

    if (toolResults.length === 0) return;

    const toolCalls = this.channelToolCalls.get(channelId) || new Map();

    for (const result of toolResults) {
      const toolCall = toolCalls.get(result.tool_use_id);
      if (toolCall && toolCall.message) {
        try {
          const firstLine = result.content.split('\n')[0].trim();
          const resultText = firstLine.length > 100
            ? firstLine.substring(0, 100) + "..."
            : firstLine;

          const currentEmbed = toolCall.message.embeds[0];
          const originalDescription = currentEmbed.data.description.replace("⏳", "✅");
          const isError = result.is_error === true;

          const updatedEmbed = new EmbedBuilder();

          if (isError) {
            updatedEmbed
              .setDescription(`❌ ${originalDescription.substring(2)}\n*${resultText}*`)
              .setColor(0xFF0000);
          } else {
            updatedEmbed
              .setDescription(`${originalDescription}\n*${resultText}*`)
              .setColor(0x00FF00);
          }

          await this.apiThrottle(() => toolCall.message.edit({ embeds: [updatedEmbed] }));
        } catch (error) {
          console.error("Error updating tool result message:", error);
        }
      }
    }
  }

  private async handleResultMessage(
    channelId: string,
    parsed: SDKMessage & { type: "result" }
  ): Promise<void> {
    console.log("Result message:", parsed);
    const channelName = this.channelNames.get(channelId) || "default";
    this.db.setSession(channelId, parsed.session_id, channelName);

    const channel = this.channelMessages.get(channelId)?.channel;
    if (!channel) return;

    const resultEmbed = new EmbedBuilder();

    if (parsed.subtype === "success") {
      resultEmbed
        .setTitle("✅ Session Complete")
        .setDescription(`*Completed in ${parsed.num_turns} turns*`)
        .setColor(0x00FF00);
    } else {
      resultEmbed
        .setTitle("❌ Session Failed")
        .setDescription(`Task failed: ${parsed.subtype}`)
        .setColor(0xFF0000);
    }

    try {
      await this.apiThrottle(() => channel.send({ embeds: [resultEmbed] }));
    } catch (error) {
      console.error("Error sending result message:", error);
    }
  }

  destroy(): void {
    for (const [channelId] of this.channelProcesses) {
      this.killActiveProcess(channelId);
    }
    this.db.close();
  }
}
