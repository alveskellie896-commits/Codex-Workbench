# Mobile API v1

This document is the first stable contract for the future iOS native app while keeping the browser client unchanged.

## Boot Flow

1. Call `GET /api/mobile/v1/bootstrap` without a token.
2. If `auth.setupRequired` is true, show the first-run password setup flow in the browser client. The native app should ask the user to finish setup on the computer/browser first.
3. If the app has a stored refresh token, call `POST /api/auth/refresh`.
4. If the app has a trusted-device token, call `POST /api/auth/device-login`.
5. Otherwise call `POST /api/auth/login` or complete pairing through `POST /api/pairing/complete`.
6. After the app has an access token, call `GET /api/mobile/v1/bootstrap` again with `Authorization: Bearer <accessToken>` to read authenticated device state.
7. Open the WebSocket URL from `endpoints.webSocket`, replacing `{accessToken}` with the current access token.

## Bootstrap Endpoint

`GET /api/mobile/v1/bootstrap`

Alias kept for compatibility: `GET /api/mobile/bootstrap`.

The endpoint is intentionally readable before login so a native app can discover the service, version, auth requirements, and supported capabilities.

Important fields:

- `apiVersion`: currently `1`.
- `platformTarget`: currently `ios-native-and-web`.
- `service`: service name, PWA version, build id, server time, host, port, and send mode.
- `auth`: password setup state, whether the supplied bearer token is authenticated, auth method, trust level, and token TTL hints.
- `endpoints`: stable relative paths for auth, projects, threads, messages, uploads, follow-ups, status, runtime, and model APIs.
- `capabilities`: feature flags the native app can use to show or hide UI.
- `limits`: paging and upload limits.
- `runtime`: normalized runtime controls and support matrix.
- `model`: current model and available models.
- `publicLink`: current phone/computer URLs and tunnel metadata when available.

## Auth Endpoints

- `GET /api/auth/status`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/device-login`
- `POST /api/pairing/session`
- `POST /api/pairing/complete`
- `GET /api/devices`
- `PATCH /api/devices`
- `DELETE /api/devices`

The iOS app should store access/refresh tokens and trusted-device tokens in Keychain.

## Core Data Endpoints

- `GET /api/projects`
- `GET /api/threads?project={projectCwd}`
- `POST /api/threads/new`
- `GET /api/threads/{threadId}`
- `GET /api/threads/{threadId}/detail?after={messageId}&before={messageId}&limit={limit}`
- `GET /api/threads/{threadId}/messages`

The native app should use the detail endpoint for chat views because it supports latest-window loading and older-message paging.

## Send and Queue Endpoints

- `POST /api/threads/{threadId}/send`
- `POST /api/threads/{threadId}/cancel`
- `POST /api/threads/{threadId}/retry`
- `GET /api/threads/{threadId}/followups`
- `POST /api/threads/{threadId}/followups`
- `PATCH /api/threads/{threadId}/followups/{followUpId}`
- `DELETE /api/threads/{threadId}/followups/{followUpId}`

The iOS app should keep its own local send queue. A message should be visible immediately with local states such as queued, delivered to computer, processing, replied, failed, and cancelled.

## Upload Endpoint

`POST /api/uploads`

Request body:

```json
{
  "files": [
    {
      "threadId": "optional-thread-id",
      "name": "document.pdf",
      "type": "application/pdf",
      "dataBase64": "..."
    }
  ]
}
```

Limits from bootstrap:

- `limits.upload.maxFileBytes`
- `limits.upload.maxBatchBytes`
- `limits.upload.maxJsonBodyBytes`

The iOS app should show upload progress locally before sending the JSON payload and should attach returned upload paths to `POST /api/threads/{threadId}/send`.

## WebSocket

Connect to `endpoints.webSocket` after replacing `{accessToken}`.

Expected event families:

- `system.connected`
- `project.updated`
- `thread.updated`
- `thread.status`
- `message.appended`
- `run.started`
- `run.finished`
- `run.failed`
- `run.event`
- `followup.queued`
- `followup.updated`
- `followup.cancelled`
- `followup.reordered`
- `runtime.changed`
- `model.changed`

The native app must treat WebSocket as a fast path only. On foreground, reconnect, or suspected missed events, it should call the relevant HTTP endpoint to catch up.

## Non-Goals For Stage 1

- No native iOS UI yet.
- No APNs/native push yet.
- No App Store packaging yet.
- No replacement for the browser client.

