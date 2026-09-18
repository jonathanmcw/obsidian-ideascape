# Contributing to Ideascape

Thanks for helping improve Ideascape. Bug reports, focused feature proposals, documentation fixes and tested code changes are welcome.

## Before changing code

- Open an issue for a bug or feature that changes user-visible behaviour.
- Keep maps readable as ordinary Markdown notes and preserve content the map does not render.
- Keep the plugin offline: no telemetry, accounts or network requests.
- Consider both desktop and mobile interaction, even when developing on desktop.
- Discuss new runtime dependencies before adding them.

## Development

Ideascape uses Node.js 24 in continuous integration.

```bash
npm ci
npm run check
```

`npm run check` runs lint, the test suite, a production build, the rendered chrome check and release-output verification. To try the build in a vault:

```bash
npm run install:vault -- /path/to/vault --enable
```

The root `main.js` and `styles.css` files are generated release artifacts. Edit the files under `src/` instead of editing those outputs by hand.

Three passes look at the interface rather than at the source. `npm run ui` comes with `npm run check`: it renders
the chrome at six widths in two themes and measures it. `npm run review` photographs every surface inside the real
Obsidian for a person to look through. `npm run phone` drives and photographs a real iPhone over the cable, and is
the only one of the three that cannot be fooled about a phone's width, its keyboard or its chrome — several of the
mobile fixes in 0.9.5 came from measuring the device rather than reasoning about it. Each script's header says what
it needs and how it lies if you hold it wrong.

## Trusting a check

A check is not evidence until it has been watched failing. Put the bug back, run the check, see it go red, then take
the bug out again.

This is the habit that matters most here, because every instrument in this repository has lied at least once — and
each time, it lied by passing:

- The chrome was measured at 980px for weeks, because the fixture carried no `<meta name="viewport">`. Every
  "phone" measurement was taken on a screen no phone has.
- An occluded macOS window composites nothing, so a screen capture hands back the frame from before the change.
  Three separate rigs here were caught by it.
- A wrapper called a recording unfinished because it looked for the done-marker the instant the command returned,
  while the recorder was still writing. It threw away 356 good frames.
- An assertion written one-sided — `x <= 8` — accepted −162, and reported a broken layout as correct.

None of these were found by reading the code. Each was found by making the check fail on purpose. Where the reason
for a check is not plain from the check itself, say it in a comment beside it, as the scripts under `scripts/` do.

## Pull requests

- Keep the change focused and explain the user problem it solves.
- Add or update regression tests for behaviour changes, and confirm each one fails without the fix.
- Include desktop and mobile notes for interaction or layout changes.
- Include before-and-after images for visible changes.
- Confirm `npm run check` passes.

If a change affects the welcome flow, screenshots or animated demo, use the scripts under `scripts/shots/` and review the generated media before submitting it.
