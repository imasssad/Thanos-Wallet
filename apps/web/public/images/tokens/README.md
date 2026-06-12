# Token icon assets

Bundled icons for the LITHO ecosystem. File names match the `icon` path
in `apps/web/lib/tokens.ts`.

| File          | Token  | Notes                                          |
|---------------|--------|------------------------------------------------|
| `litho.jpg`   | LITHO  | full blue-gradient square                      |
| `jot.png`     | JOT    | full pink coin                                 |
| `lax.png`     | LAX    | full blue coin (the "X" mark)                  |
| `colle.png`   | COLLE  | dark-navy square, teal circuit glyph           |
| `furgpt.png`  | FurGPT dApp tile (FGPT token uses the dedicated fgpt.png mark) | transparent — composited on the purple circle  |
| `ignite.png`  | IGNITE | full green coin                                |
| `quantt.png`  | QUANTT | full blue coin                                 |

Tokens **without** a file here resolve their logo at runtime via
`lib/token-logos.ts` (CoinGecko CDN): BTC, SOL, ATOM, and LitBTC
(maps to the Bitcoin logo). IMAGE has no asset yet and shows the
brand-colour circle fallback.

The full client icon pack — numbered background variants + animated
GIFs — lives in `Thanos_Wallet_Pack/coin-icons-source/` (kept out of
`public/` so unused art isn't deployed).

Recommended size: 256×256. The wallet renders icons at 24–60 px;
`TokenIcon` composites them over the token's brand-colour circle.
