# Mobile Bridge Plugin

Forward completed OpenClaw assistant replies to an external mobile/web bridge endpoint.

## What it does

This plugin listens to the `before_message_write` hook and forwards finished assistant replies as JSON events.

Typical use cases:
- push completed replies to a local mobile gateway sidecar
- mirror replies into a mobile web shell
- trigger external notification/reporting flows

## Event shape

The plugin sends a `POST` request with a JSON body like:

```json
{
  "event": {
    "eventId": "reply_...",
    "type": "reply_finished",
    "body": "short preview",
    "text": "full reply text",
    "sessionKey": "...",
    "agentId": "...",
    "messageId": "...",
    "timestamp": "2026-03-24T04:00:00.000Z",
    "targetUrl": "/ui/"
  }
}
```

## Configuration

Configured through `openclaw.plugin.json` schema / plugin config:

- `gatewayUrl`: receiver endpoint
- `gatewayToken`: optional bearer token
- `targetUrl`: optional UI target path/url included in payload
- `eventType`: event type to emit, defaults to `reply_finished`
- `maxBodyChars`: max preview length for `event.body`
- `skipSubagents`: skip sub-agent sessions
- `skipHeartbeat`: skip `HEARTBEAT_OK`
- `debugLogPath`: optional local debug log file path

## Defaults

The plugin still supports these environment variables as fallback values:

- `OPENCLAW_MOBILE_GATEWAY_URL`
- `OPENCLAW_MOBILE_GATEWAY_TOKEN`

## Notes

- This plugin only forwards **assistant** replies.
- `NO_REPLY` is always skipped.
- If `debugLogPath` is empty, file logging is disabled.
- The receiver endpoint is expected to accept JSON over HTTP POST.

## Sharing checklist

Before sharing with others, tell them:
1. where to install the plugin folder
2. what receiver endpoint to use
3. whether a bearer token is required
4. what UI/app is expected to consume the forwarded event
