# WhatsApp (official Cloud API)

Follow https://developers.facebook.com/docs/whatsapp/cloud-api (check current
version; code defaults `v21.0` via `WHATSAPP_API_VERSION`).

1. Create a Meta app → Add WhatsApp → note `Phone-Number-ID`.
2. Generate a permanent access token → `WHATSAPP_ACCESS_TOKEN`.
3. Set webhook URL to `https://<host>/api/channels/whatsapp?tenant=<slug>`,
   verify token = `WHATSAPP_VERIFY_TOKEN`, subscribe to `messages`.
4. Copy App Secret → `WHATSAPP_APP_SECRET` for `X-Hub-Signature-256` checks.
5. Send a message to the test number; watch logs for `message processed`.

Without credentials the UI marks the channel “not yet configured” and
outbound sends are logged, never faked. No scraping/unofficial APIs anywhere.
