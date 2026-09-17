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

`npm run check` runs lint, the test suite, a production build and release-output verification. To try the build in a vault:

```bash
npm run install:vault -- /path/to/vault --enable
```

The root `main.js` and `styles.css` files are generated release artifacts. Edit the files under `src/` instead of editing those outputs by hand.

## Pull requests

- Keep the change focused and explain the user problem it solves.
- Add or update regression tests for behaviour changes.
- Include desktop and mobile notes for interaction or layout changes.
- Include before-and-after images for visible changes.
- Confirm `npm run check` passes.

If a change affects the welcome flow, screenshots or animated demo, use the scripts under `scripts/shots/` and review the generated media before submitting it.
