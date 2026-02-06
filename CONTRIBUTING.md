# Contributing

## Development

This project uses:

- **Node.js** with **tsx** as the TypeScript runner
- **TypeScript** with strict type checking
- **discord.js**, **@slack/bolt**, **telegraf**, and other platform SDKs
- **Claude Code CLI** (or Claude API) for AI interactions
- **better-sqlite3** for session persistence

To modify the code:

```bash
# Install dependencies
npm install

# Run tests
npm run test:run

# Run during development (restart manually after changes)
npm start
```

**Note**: Hot reload is not recommended for this bot as it can cause process management issues and spawn multiple Claude processes.

## Security Notes

- **Private Server Recommended**: Use a private Discord/Slack server for your repositories to avoid exposing project details
- **User Restriction**: Only users in the platform-specific allowed user ID lists can interact with the bot
- **Channel Restriction**: Optionally set `DISCORD_CHANNEL_IDS` / `SLACK_CHANNEL_IDS` to limit which channels the bot responds in
- **Environment Variables**: Keep your `.env` file secure and never commit it to version control
- **Bot Tokens**: Keep all bot tokens secure - treat them like passwords

## Troubleshooting

### Bot doesn't respond

- Check that the bot has proper permissions in the channel
- Verify your allowed user IDs are correct (`ALLOWED_USER_IDS`, `SLACK_ALLOWED_USER_IDS`, etc.)
- If using channel restrictions, verify the channel ID is in the allowed list
- Check the console for error messages

### "Working directory does not exist" error

- Ensure the folder exists: `BASE_FOLDER/<project-name>`
- Check that `BASE_FOLDER` in `.env` is correct
- Verify folder names match channel names (Discord/Slack) or project names (LINE/Telegram) exactly

### Session not persisting

- Sessions are stored in SQLite and persist across restarts
- Use `/clear` if you want to intentionally reset a session
