# OllamaChat (RN)

Tool-calling AI agent as a React Native app. Phone talks to Ollama running on your PC.

## Architecture

- `src/agent.ts` — agent loop. Calls Ollama `/api/chat` REST via `fetch` (no node deps). Runs tools, feeds results back, loops until final answer.
- `src/tools.ts` — tools: `calculator`, `current_time`, `write_file` / `read_file` / `list_files`.
  - All file tools read/write the phone's public **Download** folder by direct path (`/storage/emulated/0/Download`, via `@dr.pogodin/react-native-fs`).
  - Requires **All files access** (`MANAGE_EXTERNAL_STORAGE`). Grant it once: open ⚙︎ → "Grant file access" → toggle the app on. Or via adb: `adb shell appops set com.ollamachat MANAGE_EXTERNAL_STORAGE allow`.
  - `list_files` lists everything in Download; `read_file` can read any file there (not just ones this app wrote).
- `App.tsx` — navigation root (react-navigation native-stack): `Chat` + `Settings` screens, wrapped in a `SettingsProvider`.
- `src/ChatScreen.tsx` — chat UI (typewriter AI replies, keyboard-aware input). Gear → Settings screen.
- `src/SettingsScreen.tsx` — host field + model picker (fetched from `/api/tags`, shows size) + file-access grant.
- `src/settings.tsx` — shared host/model state (React context), persisted with AsyncStorage.

## The localhost gotcha (READ THIS)

Phone is NOT your PC. `localhost` on the phone = the phone itself.

1. **Ollama must listen on all interfaces**, not just localhost. On the PC, set env and restart Ollama:
   - PowerShell: `$env:OLLAMA_HOST="0.0.0.0:11434"; ollama serve`
   - Or set system env var `OLLAMA_HOST=0.0.0.0:11434` permanently.
2. **Phone and PC on the same Wi-Fi.**
3. **Use the PC's LAN IP** in the app's Host field. This PC: `http://192.168.0.27:11434` (already the default).
   - IP changes between networks — re-check with `ipconfig` if it stops connecting.
4. **Windows Firewall** may block port 11434. Allow it if the phone can't reach the PC.

Quick test from the phone's browser: open `http://192.168.0.27:11434` — should say "Ollama is running".

## Run

Device connected via USB, USB debugging on:

```bash
# build + install on device
npx react-native run-android

# (if Metro not running) in another terminal:
npm start
```

Cleartext HTTP works in debug builds (RN enables it). A release build needs a network security config to allow plain HTTP.

## Use

1. Open app → tap ⚙︎ → set Host (PC IP) and Model (e.g. `gemma4:e4b`) → Save.
2. Ask. Tool calls show as yellow `→ name(args)` / `← result` lines, final answer in a gray bubble.

### Tool calling is unreliable? It's the model.

`gemma4:e4b` is small and inconsistent at choosing tools — it often answers simple things
itself instead of calling a tool. The agent logic is correct (verified end-to-end). For
reliable tool calls, pull a stronger tool-calling model and switch in ⚙︎:

```bash
ollama pull qwen2.5        # much better at tools
```

## Add a tool

`src/tools.ts`: add an `AgentTool` (JSON-schema `definition` + async `run`), push into `tools`. Keep it RN-compatible (no `node:` modules).
