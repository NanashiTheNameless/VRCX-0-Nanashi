# AI Assistant

The AI Assistant is a chat in VRCX-0-Nanashi. It answers questions about your VRChat social
life from the history the app has recorded, and helps you use the app: it finds settings,
explains them, shows you where they are, reads these docs, and changes things for you once
you approve. It was called Social AI before.

It is **off by default**. While it is off, nothing is sent to any AI service.

## Turning it on

1. Add an AI connection: **Tools > AI Connections**, or Settings > AI > LLM Endpoints.
2. Turn on **Enable the AI Assistant** under **Settings > AI**, and choose a **default model**.
3. Open **AI Assistant** in the left navigation.

### AI connections

A connection has a name, a **base URL**, an **API type**, an API key, and its models.

- **API types**: OpenAI-compatible (Chat Completions, and Responses), Azure OpenAI, Anthropic,
  Google Gemini, Vertex AI, Ollama, Cohere and Amazon Bedrock. Most providers, LM Studio,
  llama.cpp and vLLM speak OpenAI-compatible.
- **Local or LAN models** (an `http://` or `192.168.x.x` address) work with no API key.
- **Detect models** asks the server for its models; you can also type a model name.
- **Extra headers** (one per line, `Name: value`) are sent with every request, for gateways
  that need their own authentication.
- **Use VRCX-0-Nanashi Custom Proxy** sends AI requests through the proxy set under Settings >
  System > Login & Network; otherwise the system proxy applies.
- The same connections are used by content translation.

API keys are stored on your PC. Requests go only to the connection you chose.

## Using it

- Ask in your own words. Type **@** to mention a friend or a world so the assistant knows
  exactly who or what you mean. If a name matches several people, it asks you to pick.
- Answers can include tables, charts, screenshots from your history, and chips for the people
  and worlds they mention; the **Mentioned** panel collects those. Suggested follow-up
  questions appear under an answer.
- Conversations are saved per VRChat account. Start a new chat, pin, rename or delete chats
  from the list.
- **Copy as Markdown**: hover a message and use the copy button. The clipboard button at the top
  of the chat copies the whole conversation as one Markdown document, each message under "You"
  or "AI Assistant".
- **Edit a message**: hover one of your messages and use the pencil. Sending the edit replaces
  that message and everything after it, and the assistant answers again. Editing is not
  available while it is still writing an answer.
- A disclaimer reminds you that answers come from what the app recorded locally and may be
  incomplete or wrong. The assistant only sees what the app has recorded; what others did in
  private instances you were not in is invisible to it.

### Things you can ask

- Who you play with most, who you are drifting apart from, when friends are usually online,
  the best time to catch the most friends, who is online now, how your play time is spread
  over the weeks, a recap of your week or month, which of your friends know each other.
- Your screenshots: who you take the most photos with, which worlds you photograph most.
- About a friend or a world: mention them, for example "How are @Alice and I doing lately?" or
  "Who do I usually run into at @The Black Cat?".
- About the app: "where do I turn on HMD notifications", "what does the glitchy red badge
  mean", "where is the refresh friends profile button", "make the tables compact".

## Help with the app

- **Docs**: the assistant reads every doc in the app's Docs page and answers from them, and can
  open the Docs page at the section it means (the chat closes, and a card in the corner takes
  you back).
  For example, **Refresh all friend profiles** is on **Social > Friends**, in the toolbar
  above the table beside **Load friend details**. It refreshes full profiles, with a 5-minute
  cooldown after completion or cancellation. The same action is beside **Refresh friends
  list** in the bottom-right sidebar settings popover. Both buttons ask for confirmation
  before starting. Profile requests are paced conservatively and pause when VRChat applies
  a rate limit. Refreshing the mutual graph updates mutual relationships instead.
- **Find settings**: it searches settings by what they do and tells you where they are
  (Settings > tab > card).
- **Show me**: it closes the chat, opens Settings at the setting and keeps it highlighted. A
  small guide card in the corner has a button back to the conversation.
- **Change settings**: see below.

## Approving changes

The assistant never changes anything on its own. Every change it wants to make shows a card in
the chat and waits for you:

- **Settings**: a **Permission required** card appears directly in the conversation, using
  the app's current theme. It names the setting, shows **Current value** and **Requested
  value**, explains what the change does, and shows where it is. Choose **Allow**, **Deny**,
  or **Show me the setting**. Showing the setting does not approve or apply the change.
- **Other changes**: creating or deleting a reminder, adding a favorite (local or on VRChat),
  editing a friend note, and sending to the VRChat Chatbox (a message, AFK, or Chatbox
  settings). The card shows what it will do and the details.

For other actions, choose **Approve** or **Decline**. It asks again for every change. If you decline, it accepts
that and does not ask for the same change again.

The assistant can request changes only for individually supported settings, with the same
values and save actions as Settings. These include ordinary appearance and notification
options, startup, update mode, login delay, the existing proxy toggle, Discord options,
translation and YouTube toggles, webhook enable/auth-event/format choices, game-log and Feed
recording, each Profile History recording and sync switch, History Sync interval (1, 5, 10,
15, 30 or 60 minutes), pause while playing, Settings Sync, and URL and shortener warnings.
A proxy or system-window-frame change marks a restart as needed; it does not restart the app.

The assistant can show but cannot change its own permissions, AI connections, API access,
credentials, tokens, pairing, encryption keys, server addresses, sync category choices,
collector authorization, cleanup or deletion, data migration, automatic friend-request
rejection, or automatic blocking, hiding and banning. The safety master switch stays manual
because it can reactivate saved automatic actions. Other complex controls without a
supported save action also stay manual. Read-only status displays cannot be edited.
The assistant explains the specific reason when a setting is blocked.

**Anonymous adoption count** also uses the in-chat Allow/Deny card. Device policy,
environment opt-outs and opt-out flag files still block changes; the assistant explains
which one applies. Automatic update changes are unavailable in builds with update checks
disabled. No approval can override these restrictions.
Game Log recording also requires a platform with log ingestion support and VRChat to be closed.

When you ask to change a supported setting, the assistant prefers showing the real card
over giving manual instructions or asking repeated yes/no questions in text. No change is
made until you choose **Allow**. Replies use straight quotes, apostrophes and hyphens;
streamed, saved, displayed and copied replies normalize typographic punctuation to ASCII.

To stop it from asking at all, turn on **Don't let the AI ask to make changes** in the chat
settings (the sliders icon next to the model name) for one conversation, or as the default
under Settings > AI. It can still find and show settings.

## Chat settings

The sliders icon next to the model name holds the settings for the current conversation (or
for new ones): the model, **Analysis mode**, reasoning effort, and **Don't let the AI ask to make
changes**.

**Analysis mode** controls how the assistant uses its tools:

- **Auto** (default): picks based on the connection.
- **Guided**: steers a weaker local model to the single most relevant tool for a steadier
  answer.
- **Open**: gives a stronger model every tool to dig deeper.

## Reminders

Ask the assistant to tell you when a friend comes online, goes offline, moves or joins you, or
at a time; approve the card and the reminder is saved. Reminders fire as **Assistant reminder**
notifications even with the chat closed. The **Reminders** page lists them, and you can create
them by hand there or have the AI fill the form from a sentence. See
[PAGES.md](PAGES.md#reminders) and [NOTIFICATIONS_AND_VR.md](NOTIFICATIONS_AND_VR.md).

## MCP server

Settings > AI > MCP Server lets other AI tools (Claude Desktop, Claude Code, Cherry Studio,
Codex, opencode, Cursor, VS Code, LM Studio, or any client that supports Streamable HTTP) read
your VRCX-0-Nanashi data.

The server identifies itself as `vrcx-0-nanashi`. Generated connection commands, configuration
entries and one-click installs use that name too.

- It is token-protected and listens on this PC only (port 8798 by default). **Allow LAN
  connections** lets other devices on your network connect; keep it off on untrusted networks.
- **Connect AI tools** gives one-click setup or the config to paste for each client. Client
  configs contain the token in plain text, so share them only with tools you trust. **Rotate
  token** makes old configs stop working.
- **Allow VRChat account writes** lets connected tools add favorites to your real VRChat
  account. It turns itself off every time the server starts.
