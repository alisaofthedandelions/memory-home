# Memory Home

A small browser app for conversations through OpenRouter. The original dark blue, gold, Spectral/Cormorant typography and goldfinches remain in place.

## Projects

Open **Projects → New project**. Give the project a name and one **Project Prompt**. Its prompt, About the User, Recent Memories, Kept memory, deferred tray and keyword-triggered lorebook belong to that project. New projects start empty.

The project selector in the chat menu switches between homes. Every project can contain multiple chats, each with its own model, complete transcript and rolling summary. **Chat options → move** transfers a conversation and its summary to another project.

**Attach Project Prompt** enables or disables the saved prompt without deleting it. **History** keeps earlier prompt versions; restore a version into the editor and save to apply it. **Preview prompt** shows the saved project context for the current chat, including activated lorebook entries and its rolling summary.

## Rolling context

The archivist has its own configurable model. Automatic reviews fold older messages into a summary while preserving the latest **10 complete messages verbatim**. Streaming, failed and empty responses do not count as complete messages. Original transcripts remain stored. If a review fails, the unsummarized source messages remain available in the next request.

**Memory → This chat → Run archivist now** reviews an earlier chapter on demand. Suggestions await **Keep always**, **Lorebook**, **Later** or **Discard**. Kept suggestions and deferred items remain within the originating project.

## Storage and backups

Data is saved in this browser's local storage. **Export / Import** downloads all projects, prompt histories, lorebooks, conversations, summaries and pending suggestions as a ZIP with Markdown and an `archive.json`. The OpenRouter API key is omitted from the archive. Restore preserves the device's existing API key.

Existing installations and version 1 archives migrate into **First home**, preserving their existing text and conversations. Version 2 archives preserve separate projects.

## Development

Serve the directory with any static web server. No build step or runtime dependencies are required.

Run the core regression checks with Node 22 or newer:

```sh
npm test
```
