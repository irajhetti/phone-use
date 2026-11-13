# phone-use

Let an AI agent read and drive an Android phone over `adb`, by label.

One Node file. No dependencies, and nothing to install on the phone. If your agent can run a shell
command, it can use your phone: Claude Code, Codex, Cursor, Gemini CLI or a plain script.

```text
$ phone look
app: com.android.settings/.Settings
e1 text Settings
e2 btn Network & internet
e3 sw Airplane mode=off
e4 btn Hotspot & tethering

$ phone tap "Airplane mode"
tapped Airplane mode
app: com.android.settings/.Settings
...
e3 sw Airplane mode=on
```

The screen comes back as a short list of what is on it: buttons, switches with their state, fields
and text. Password fields are never shown. The agent acts on labels or `e` numbers instead of
guessing coordinates, and every action prints the screen it led to, so one step is usually one call.

## Install

You need Node 18+ and `adb` (Android platform-tools) on your PATH.

```sh
npm i -g github:irajhetti/phone-use
phone help
```

Or clone the repo and link `phone.js` onto your PATH.

## Connect a phone

1. On the phone: **Settings → About phone**, tap **Build number** seven times, then turn on
   **Developer options → USB debugging**.
2. Plug it in and tap **Allow**. Or, over Wi-Fi (Android 11+): turn on **Wireless debugging**,
   tap **Pair device with pairing code**, then run `adb pair <ip:port> <code>` and `adb connect <ip:port>`.
3. `adb devices` should list it. With several devices, set `ANDROID_SERIAL`.

**Xiaomi / Redmi / POCO:** reading the screen works straight away, but taps and typing are refused
until you also turn on **Developer options → USB debugging (Security settings)**, which needs a Mi
account. `phone` tells you when this is the problem.

## Commands

| Command | What it does |
| --- | --- |
| `phone look` | List what is on screen, numbered `e1`, `e2`, … |
| `phone tap <eN\|label\|x,y>` | Tap. A label matches exact text first, then text that contains it. If it is ambiguous, it refuses and lists the matches. |
| `phone long <eN\|label\|x,y>` | Long-press |
| `phone type <text>` | Type into the focused field (tap the field first) |
| `phone key <name>` | `back` `home` `enter` `del` `recent` `wake` `power` `tab` `up` `down`, or a keycode |
| `phone swipe <up\|down\|left\|right>` | Swipe. `up` scrolls the page down. |
| `phone open <app\|package>` | Launch an app, e.g. `phone open chrome` |
| `phone url <url>` | Open a link in the default browser or app |
| `phone shot <file.png>` | Save a screenshot |

## Tell your agent about it

Add something like this to your `CLAUDE.md`, `AGENTS.md` or system prompt:

```text
An Android phone is connected. Use the `phone` command to read and drive it: `phone look` first,
then `phone tap "<label>"` or `phone tap e4`. Every action prints the new screen.
Ask before sending messages, making purchases or changing account settings.
```

## How it works

`phone look` runs `uiautomator dump` on the device and keeps only the elements an agent can use,
labelled by their text, content description or resource id. It saves their centres in
`~/.cache/phone/last.json`, which is how `phone tap e4` finds `e4`. Actions are plain
`adb shell input` and `am start` commands.

## Limits

- `type` handles plain ASCII text only.
- Screens with little or no text, such as games, video and canvas apps, read poorly. Use
  `phone shot` and tap by `x,y`.
- It does not unlock the phone. Keep it unlocked while an agent is using it.
- There are no guard rails beyond your agent's own instructions. Use a test phone or an emulator
  for anything you would not do by hand.

For a fuller tool with an MCP server, policies and on-phone approvals, see
[android-use](https://github.com/austinintelligence/android-use).

## Test

```sh
npm test
```

## Licence

MIT
