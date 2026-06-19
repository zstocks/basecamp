# Icons & splash images

Drop the generated image files at these exact paths/names — the `<head>` link tags
and `site.webmanifest` already reference them. Easiest source:
[realfavicongenerator.net](https://realfavicongenerator.net) for the favicons, and
[pwa-asset-generator](https://github.com/elegantapp/pwa-asset-generator) for the iOS
splash set (it can also emit the exact `<link>` tags if you want fuller coverage).

## Favicons

| Path | Size | Purpose |
|------|------|---------|
| `public/favicon.ico` (repo root of public/, **not** this folder) | 16/32/48 multi | classic `/favicon.ico` auto-request |
| `public/icons/favicon.svg` | vector | modern scalable favicon |
| `public/icons/favicon-96x96.png` | 96×96 | PNG fallback |
| `public/icons/apple-touch-icon.png` | 180×180 | iOS home-screen icon |
| `public/icons/web-app-manifest-192x192.png` | 192×192 | PWA / Android |
| `public/icons/web-app-manifest-512x512.png` | 512×512 | PWA / Android (also the Android splash icon) |

The 512×512 is also used as the maskable icon in `site.webmanifest` — for best
results on Android, keep the logo centered with ~20% padding (safe zone).

## iOS splash screens

Portrait PNGs in `public/icons/splash/`, sized to device pixels. The link tags
(in `index.html` and `login.html`) cover these common iPhones:

| File | Pixels | Example devices |
|------|--------|-----------------|
| `iphone-750x1334.png`  | 750×1334  | SE (2/3), 8, 7, 6s |
| `iphone-828x1792.png`  | 828×1792  | XR, 11 |
| `iphone-1125x2436.png` | 1125×2436 | X, XS, 11 Pro, 12/13 mini |
| `iphone-1170x2532.png` | 1170×2532 | 12, 12 Pro, 13, 13 Pro, 14 |
| `iphone-1179x2556.png` | 1179×2556 | 14 Pro, 15, 15 Pro, 16 |
| `iphone-1284x2778.png` | 1284×2778 | 12/13 Pro Max, 14 Plus |
| `iphone-1290x2796.png` | 1290×2796 | 14 Pro Max, 15 Plus/Pro Max, 16 Pro Max |

Background should match the app: `#0d1117`. If a device isn't listed, iOS just
shows a plain background splash — harmless. Add more `<link rel="apple-touch-startup-image">`
tags for other sizes if needed.

Android/Chrome and the PWA install splash come from `site.webmanifest` (name +
`background_color` + 512px icon) — no per-device images required.
