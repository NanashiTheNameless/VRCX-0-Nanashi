# Telemetry

This fork does not collect usage data. It does send one anonymous "this install is in use"
ping, so the developer can see how many people run the fork. The two are different things:

|                        | Upstream-style telemetry (removed)                                                                      | Adoption count (this fork)                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose                | Usage stats, heartbeats, crash reports, feedback uploads, theme install counts                          | Count installs in use per day                                                                                                                            |
| What is sent           | Usage, crash and feedback data                                                                          | A SHA-256 hash of a random install ID, the app name, the UTC date and the number 1                                                                       |
| Tied to you            | Not applicable, removed                                                                                 | No. The ID is a random UUID made on your PC. It is not derived from your VRChat account, your hardware or your settings, and only its hash leaves the PC |
| Crash or error data    | Yes                                                                                                     | Never                                                                                                                                                    |
| Which features you use | Yes                                                                                                     | Never                                                                                                                                                    |
| Where it goes          | Upstream services                                                                                       | `https://telemetry.namelessnanashi.dev/census`, the developer's own [NamelessTelemetry](https://github.com/NanashiTheNameless/NamelessTelemetry) service |
| Server                 | Opaque and proprietary: the server code is not published and the data it collects is not visible to you | Open source, and everything it stores (the per-day totals) is public                                                                                     |
| Status in this fork    | Removed, with no setting to turn it back on                                                             | On by default, with an opt-out                                                                                                                           |

How the adoption count works:

- The app sends one ping on startup and one every 2 hours while it runs. The service counts
  each install once per UTC day and keeps only a per-day total. The marker it uses to avoid
  counting an install twice expires after about 10 days, and daily totals after about a year.
- The request body is
  `{"id": "<sha256 hex>", "date": "<UTC date>", "project": "VRCX-0-Nanashi", "count": 1}`
  and nothing else.
  Like every request the app makes, it carries the app's user agent (app name and version) and
  comes from your IP address, or your proxy's if you set one. The service's code stores neither.
- Unlike upstream's telemetry server, nothing about this one is hidden. Its full source is at
  [NanashiTheNameless/NamelessTelemetry](https://github.com/NanashiTheNameless/NamelessTelemetry),
  so you can read exactly what it does with a ping, and everything it stores (the per-day
  totals) is public at <https://telemetry.namelessnanashi.dev/>.
- The random install ID is a file named `.adoption-census-id` in the app's data folder. It is
  not part of History Sync, profile merge or data export.
- Development (debug) builds never send it.

Any one of these opts out:

- Turn off **Settings > Advanced > Anonymous adoption count > Count this install**.
- Set one of these environment variables to `1` (`true`, `yes` and `on` work too):
  `VRCX_0_NANASHI_TELEMETRY_OPTOUT`, `DO_NOT_TRACK` or `TELEMETRY_OPTOUT`.
- Set the environment variable `TELEMETRY=0` (`false`, `no` and `off` work too).
- Run with `CI=true` set, as CI systems do, so automated runs are never counted.
- On Windows, set the registry value `DisableTelemetry` (DWORD) to `1` under
  `HKLM\SOFTWARE\Policies\NamelessNanashi\VRCX-0-Nanashi` (whole PC, for administrators and
  group policy) or the same path under `HKCU` (your user only).
- Create a file with one of these names next to the app's executable (for an AppImage, next to
  the AppImage file). The file can be empty: `telemetry-optout`, `no-telemetry`,
  `DO_NOT_TRACK` or `VRCX_0_NANASHI_TELEMETRY_OPTOUT`. Upper and lower case do not matter,
  `-` and `_` are interchangeable, and the name may start with a dot, so `.no_telemetry` and
  `do-not-track` work too. The name must not have an extension such as `.txt`.

While an environment variable, a file or the registry value opts you out, the switch in
Settings is locked off and says why.

Opting out stops the pings and deletes the install ID. Every flag is checked before every
ping, so it takes effect without a restart. Because the count is on by default, a new install
sends its first ping on first launch, before you can reach the setting; set an environment
variable or create a file beforehand if you want no ping at all.

The RemoteSync collector (the server-side program for instance operators) never takes part in
the adoption count: it does not contain the code that sends it.

[Back to the README](README.md)
