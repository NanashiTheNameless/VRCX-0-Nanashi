# Bundled notification sounds

Every file here is dedicated to the public domain under CC0 1.0 (full legal
text in `LICENSES/CC0-1.0.txt`). They are embedded into the app binary by
`crates/host-desktop/src/sound.rs` and selected in settings as `bundled:<name>`.
WAV originals were encoded to OGG Vorbis quality 3 without metadata, with
trailing silence trimmed. The Interface Beeps are dual-mono, so they are stored
as mono and cut at 0.40 s (10 ms fade) to drop a click at the end of the
original files. Every clip, Kenney's included, was then leveled with linear
gain (no compression or limiting) to the EBU R128 reference of -23 LUFS
integrated, capped at -1 dBTP true peak, measured with ffmpeg's `loudnorm`
filter; `beep_buzz_low` reaches -23.8 LUFS before hitting the peak cap. Names
were chosen for this app and describe each clip's shape (pitch, register,
timbre).

## UI Sounds by HaelDB

https://opengameart.org/content/ui-sounds-0 (CC0)

| Name                 | Original file     |
| -------------------- | ----------------- |
| `error_buzz`         | `Wrong Error.wav` |
| `swell`              | `#0.wav`          |
| `rise`               | `#1.wav`          |
| `double_knock`       | `#2.wav`          |
| `descend`            | `#3.wav`          |
| `fall`               | `#4.wav`          |
| `swell_short`        | `#5.wav`          |
| `hum`                | `#6.wav`          |
| `double_knock_short` | `#7.wav`          |
| `flutter`            | `#8.wav`          |
| `arpeggio`           | `#9.wav`          |

## Interface Beeps by bart

https://opengameart.org/content/interface-beeps (CC0). Four timbres, each at
C3 (low), C4 (mid), C5 (high) and C6 (top).

| Name               | Original file |
| ------------------ | ------------- |
| `beep_sine_low`    | `beep-00.wav` |
| `beep_sine_mid`    | `beep-01.wav` |
| `beep_sine_high`   | `beep-02.wav` |
| `beep_sine_top`    | `beep-03.wav` |
| `beep_soft_low`    | `beep-04.wav` |
| `beep_soft_mid`    | `beep-05.wav` |
| `beep_soft_high`   | `beep-06.wav` |
| `beep_soft_top`    | `beep-07.wav` |
| `beep_bright_low`  | `beep-08.wav` |
| `beep_bright_mid`  | `beep-09.wav` |
| `beep_bright_high` | `beep-10.wav` |
| `beep_bright_top`  | `beep-11.wav` |
| `beep_buzz_low`    | `beep-12.wav` |
| `beep_buzz_mid`    | `beep-13.wav` |
| `beep_buzz_high`   | `beep-14.wav` |
| `beep_buzz_top`    | `beep-15.wav` |

## Digital Audio by Kenney

https://kenney.nl/assets/digital-audio (CC0), re-encoded only to apply the level.

| Name             | Original file      |
| ---------------- | ------------------ |
| `high_up`        | `highUp.ogg`       |
| `high_down`      | `highDown.ogg`     |
| `low_down`       | `lowDown.ogg`      |
| `low_random`     | `lowRandom.ogg`    |
| `low_three_tone` | `lowThreeTone.ogg` |
| `three_tone_1`   | `threeTone1.ogg`   |
| `three_tone_2`   | `threeTone2.ogg`   |
| `tone`           | `tone1.ogg`        |
| `two_tone_1`     | `twoTone1.ogg`     |
| `two_tone_2`     | `twoTone2.ogg`     |
