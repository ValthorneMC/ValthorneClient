# valthorne-dist

Cloudflare Worker in front of the private R2 bucket `valthorne-client`.
The pack is public, so there is no account check: URLs are short-lived and requests are rate limited per IP.

| Route | Purpose |
|---|---|
| `GET /v1/manifest` | Signed manifest (`manifests/latest.json`) |
| `POST /v1/sign` | Presigned R2 URLs (15 min) for up to 200 blob hashes |

## Deploy

Run from this folder, not the repo root:

```powershell
pnpm install --ignore-workspace
pnpm dlx wrangler login
pnpm dlx wrangler secret put R2_ACCOUNT_ID
pnpm dlx wrangler secret put R2_ACCESS_KEY_ID       # read-only R2 token
pnpm dlx wrangler secret put R2_SECRET_ACCESS_KEY   # read-only R2 token
pnpm dlx wrangler deploy
```

Put the printed `https://valthorne-dist.<subdomain>.workers.dev` into `API_URL` in `src-tauri/src/dist.rs`.

## Publish a pack

From the workspace that holds `instances/valthorne` (needs `R2_ACCOUNT_ID`, `R2_PUBLISH_KEY_ID`, `R2_PUBLISH_SECRET`):

```powershell
valthorne-builder keygen            # once; put the printed public key in MANIFEST_PUBLIC_KEY
valthorne-builder publish --dry-run # hashes and signs, writes manifest.preview.json
valthorne-builder publish
```
