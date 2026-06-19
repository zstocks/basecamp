# Icons & PWA assets

Current icon set (wired up in every page's `<head>` and in `/site.webmanifest`):

| Path | Size | Purpose |
|------|------|---------|
| `public/favicon.ico` (public/ root) | 16+32 | classic `/favicon.ico` auto-request |
| `public/icons/favicon.svg` | vector | modern scalable favicon |
| `public/icons/favicon-32.png` | 32×32 | PNG favicon |
| `public/icons/favicon-16.png` | 16×16 | PNG favicon |
| `public/icons/apple-touch-icon.png` | 180×180 | iOS home-screen icon |
| `public/icons/icon-192.png` | 192×192 | PWA / Android |
| `public/icons/icon-512.png` | 512×512 | PWA / Android |
| `public/icons/icon-512-maskable.png` | 512×512 | PWA maskable (safe-zone padded) |

`favicon.ico` lives at the public/ root by convention; everything else is under
`public/icons/`. All are served publicly (before the auth gate) so they appear on
the login page too — see the allowlist in `server.js`.

## Splash screens
- **Android / PWA install** — auto-generated from `site.webmanifest` (name +
  `background_color` + 512px icon). No per-device images needed.
- **iOS** — no `apple-touch-startup-image` files are included, so a freshly-launched
  home-screen app shows a plain `background_color` splash. To add real iOS splash
  images later, generate them (e.g. `pwa-asset-generator`), drop them in
  `public/icons/splash/`, and add matching `<link rel="apple-touch-startup-image">`
  tags to `index.html` and `login.html` (the launch pages).

Brand color (manifest `theme_color`/`background_color` and the pages'
`<meta name="theme-color">`): `#1f7a46`.
