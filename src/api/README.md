# Yazio API client notes

The client calls the private API of the Yazio app at `https://yzapi.yazio.com`. Nothing here is documented by Yazio. Each note below was checked against the live API on the date given. The [yazio-community API specification](https://github.com/yazio-community/yazio-api-specification) describes v22 and has more notes.

## Versions

- **v15 and v22 are the same API.** Each version is a snapshot of the API behind one generation of the app. A newer version adds endpoints and fields. Some new endpoints exist in older versions too, but not all.
- **v15 is the default.** A request that needs a newer version names it with `version`, e.g. `{ version: 'v22' }`. Use this only for an endpoint that v15 does not have, or that v15 answers with less data.
- **v23 answers 410** (2026-11-14).

## The user agent gate

- **v22 checks the client version in the `User-Agent`.** An app build that it does not support gets `403 {"error":"version_blocked"}` on every endpoint except the token exchange (2026-11-14).
- **v15 does not check it.** Its answers are the same with and without the app user agent (2026-11-14, 15 endpoints).
- **Only a request that names a version sends the user agent.** Thus the v15 calls continue to work when Yazio retires the app build in the user agent.
- **When the v22 calls start to fail with 403, the user agent is out of date.** Set a newer app build with `YAZIO_USER_AGENT`, then update `DEFAULT_USER_AGENT`. The `yazio-community` repos use the iOS string, e.g. `YAZIO/26.30.1 (com.yazio.ios.YAZIO; build:2607271240; iOS 27.0.0) Ktor`.

## Endpoints

- **Diary products need `serving: null, serving_quantity: null`** when they have no serving. Without the two fields, the entry counts in the totals, but the app does not list it on the meal page ([#56](https://github.com/fliptheweb/yazio-mcp/issues/56)).
- **`GET /user/consumed-items/latest`** returns one flat list, newest first. Each item has a `type`: `product` or `simple_product`. Without `?limit` it returns 500 items (2026-11-14).
- **`GET /user/streak` on v15 has no counts.** Each day has only `daytimes` and `origin_of_recovery`. v22 also returns `streak_count` and `freeze_count` (2026-11-14).
- **`POST /user/streak/{date}`** creates the day or replaces it. The server stores `streak_count` and `freeze_count` as sent and does not calculate them. The app continues them from the day before (2026-11-14, v22).
- **`GET /user/fasting-countdowns` answers 404 when no countdown is active.** This 404 has an HTML content type. An unknown path answers 404 with a JSON content type. The shape of an active countdown is not known yet (2026-11-14, v15 and v22).
- **`POST /user/claimables/autoclaim` on v15 needs `mealtime`**, e.g. `{ user_date, mealtime: 'dinner' }`. Without it, the answer is 400. It credits the rewards to the wallet and creates no chest to claim. The v22 spec names this field `type` (2026-11-14).
- **`POST /user/claimables`** creates one chest per type per day. A second chest of the same type gets 409 (2026-11-14).
