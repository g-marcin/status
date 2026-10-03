# status

Minimal status checker for [mgrzmil.dev](https://mgrzmil.dev) services, running as a Cloudflare Worker on the free tier.

- Cron every 5 min checks: site, app, dog-api, image CDN, end-to-end (api -> image).
- Results stored in a single KV key: last 24h of samples + 90 daily aggregates (ring buffers).
- `GET /api/status` returns the raw state JSON.

```bash
bun install
bun run dev      # then: curl localhost:8787/__scheduled && curl localhost:8787/api/status
bun test
bun run deploy
```
