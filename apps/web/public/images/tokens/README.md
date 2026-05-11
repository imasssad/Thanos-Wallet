# Token icon assets

Drop the LITHO ecosystem token icons here. File names must match the `icon`
path in `apps/web/lib/tokens.ts`:

| File           | Source                                                                     |
|----------------|----------------------------------------------------------------------------|
| `litho.png`    | https://www.dropbox.com/scl/fo/k5g6wqtldaanbxx8fj4nt/ (Litho gradient sq.) |
| `litbtc.png`   | https://en.wikipedia.org/wiki/Bitcoin#/media/File:Bitcoin.svg              |
| `jot.png`      | https://www.dropbox.com/scl/fo/0jpbjvy6ptbky6ltmbutu/ (Jot-red.png)        |
| `lax.png`      | https://www.dropbox.com/scl/fo/glmmtpacaro46l6z5mhpj/ (Lax_Logo.png)       |
| `colle.png`    | https://www.dropbox.com/scl/fi/yvzczjga5yrtqnfop03b8/ (Only Logo, Black BG)|
| `furgpt.png`   | https://www.dropbox.com/scl/fo/90t7b0lw4r46fny5bus76/ (FurGPT Transparent) |

Dropbox URLs end with `dl=0` (preview) — when downloading, swap to `dl=1`
or open the share and grab the actual image. The wallet currently renders
a colored avatar fallback (per-token brand color) when the file is missing,
so it stays presentable until the icons are placed.

Recommended size: 256×256 PNG with transparent background. The wallet
displays them at 24–60 px depending on context, so PNG is fine.
