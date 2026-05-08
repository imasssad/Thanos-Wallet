# Browser extension targets

## Chrome and Brave

Use the same Chromium build output from WXT.

## Safari

Convert the same web extension bundle on macOS:

```bash
xcrun safari-web-extension-converter .output/chrome-mv3
```

Additional Safari wrapper assets are included in `apps/extension/safari`.
