//! Fork: play user-selected notification sounds (WAV, MP3, FLAC, OGG Vorbis)
//! from the backend, so they work in background mode without a webview.

use std::fs::File;
use std::io::{BufReader, Cursor, Read, Seek};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};

/// Simultaneous sounds; extra requests are dropped instead of piling up.
const MAX_CONCURRENT_SOUNDS: usize = 4;
static ACTIVE_SOUNDS: AtomicUsize = AtomicUsize::new(0);

/// Fork: sounds embedded in the binary (CC0 clips by HaelDB, bart and Kenney;
/// see `sounds/README.md`). A path of `bundled:<name>` selects one.
pub const BUNDLED_PREFIX: &str = "bundled:";

macro_rules! bundled_sounds {
    ($($name:literal),* $(,)?) => {
        &[$(($name, include_bytes!(concat!("../sounds/", $name, ".ogg")))),*]
    };
}

const BUNDLED_SOUNDS: &[(&str, &[u8])] = bundled_sounds![
    "error_buzz",
    "swell",
    "swell_short",
    "rise",
    "arpeggio",
    "fall",
    "descend",
    "double_knock",
    "double_knock_short",
    "flutter",
    "hum",
    "beep_sine_low",
    "beep_sine_mid",
    "beep_sine_high",
    "beep_sine_top",
    "beep_soft_low",
    "beep_soft_mid",
    "beep_soft_high",
    "beep_soft_top",
    "beep_bright_low",
    "beep_bright_mid",
    "beep_bright_high",
    "beep_bright_top",
    "beep_buzz_low",
    "beep_buzz_mid",
    "beep_buzz_high",
    "beep_buzz_top",
    "tone",
    "two_tone_1",
    "two_tone_2",
    "three_tone_1",
    "three_tone_2",
    "high_up",
    "high_down",
    "low_down",
    "low_random",
    "low_three_tone",
];

/// Names of the built-in sounds, for the settings UI.
pub fn bundled_sound_names() -> Vec<&'static str> {
    BUNDLED_SOUNDS.iter().map(|(name, _)| *name).collect()
}

fn bundled_sound(path: &Path) -> Option<Result<&'static [u8], String>> {
    let name = path.to_str()?.strip_prefix(BUNDLED_PREFIX)?;
    Some(
        BUNDLED_SOUNDS
            .iter()
            .find(|(candidate, _)| *candidate == name)
            .map(|(_, bytes)| *bytes)
            .ok_or_else(|| format!("unknown built-in sound: {name}")),
    )
}

struct ActiveGuard;

impl Drop for ActiveGuard {
    fn drop(&mut self) {
        ACTIVE_SOUNDS.fetch_sub(1, Ordering::AcqRel);
    }
}

fn open_decoder(path: &Path) -> Result<rodio::Decoder<BufReader<File>>, String> {
    let file =
        File::open(path).map_err(|error| format!("cannot open {}: {error}", path.display()))?;
    rodio::Decoder::new(BufReader::new(file)).map_err(|error| {
        format!(
            "unsupported or corrupt audio file {}: {error}",
            path.display()
        )
    })
}

/// Check that `path` is a playable audio file (used by the settings UI).
pub fn validate_sound_file(path: &Path) -> Result<(), String> {
    match bundled_sound(path) {
        Some(bytes) => decode_bundled(bytes?).map(|_| ()),
        None => open_decoder(path).map(|_| ()),
    }
}

fn decode_bundled(bytes: &'static [u8]) -> Result<rodio::Decoder<Cursor<&'static [u8]>>, String> {
    rodio::Decoder::new(Cursor::new(bytes))
        .map_err(|error| format!("corrupt built-in sound: {error}"))
}

/// Play `path` at `volume` (0.0 - 1.0) on the default output device without
/// blocking. Errors opening/decoding the file are returned immediately.
pub fn play_sound_file(path: &Path, volume: f32) -> Result<(), String> {
    if !volume.is_finite() {
        return Err("sound volume must be finite".into());
    }
    match bundled_sound(path) {
        Some(bytes) => play_decoder(decode_bundled(bytes?)?, volume),
        None => play_decoder(open_decoder(path)?, volume),
    }
}

fn play_decoder<R>(decoder: rodio::Decoder<R>, volume: f32) -> Result<(), String>
where
    R: Read + Seek + Send + Sync + 'static,
{
    if ACTIVE_SOUNDS.fetch_add(1, Ordering::AcqRel) >= MAX_CONCURRENT_SOUNDS {
        ACTIVE_SOUNDS.fetch_sub(1, Ordering::AcqRel);
        return Ok(());
    }
    // Move the guard into the closure so a failed spawn releases the slot too.
    let guard = ActiveGuard;
    let volume = volume.clamp(0.0, 1.0);
    std::thread::Builder::new()
        .name("notification-sound".into())
        .spawn(move || {
            let _guard = guard;
            let mut sink = match rodio::DeviceSinkBuilder::open_default_sink() {
                Ok(sink) => sink,
                Err(error) => {
                    tracing::warn!(%error, "no audio output device for notification sound");
                    return;
                }
            };
            sink.log_on_drop(false);
            let player = rodio::Player::connect_new(sink.mixer());
            player.set_volume(volume);
            player.append(decoder);
            player.sleep_until_end();
        })
        .map(|_| ())
        .map_err(|error| format!("failed to start sound thread: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_bundled_sound_decodes_and_unknown_names_fail() {
        for (name, _) in BUNDLED_SOUNDS {
            let path = format!("{BUNDLED_PREFIX}{name}");
            assert!(validate_sound_file(Path::new(&path)).is_ok(), "{name}");
        }
        assert!(validate_sound_file(Path::new("bundled:missing")).is_err());
    }

    #[test]
    fn rejects_missing_and_non_audio_files() {
        let dir = std::env::temp_dir().join(format!("vrcx-0-nanashi-sound-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(validate_sound_file(&dir.join("missing.wav")).is_err());
        let text = dir.join("not-audio.wav");
        std::fs::write(&text, b"hello").unwrap();
        assert!(validate_sound_file(&text).is_err());

        // Minimal valid 8-bit mono PCM WAV (one sample).
        let wav = dir.join("tiny.wav");
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&37u32.to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes()); // PCM
        bytes.extend_from_slice(&1u16.to_le_bytes()); // mono
        bytes.extend_from_slice(&8000u32.to_le_bytes());
        bytes.extend_from_slice(&8000u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&8u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&1u32.to_le_bytes());
        bytes.push(128);
        std::fs::write(&wav, bytes).unwrap();
        assert!(validate_sound_file(&wav).is_ok());

        // User files and built-in sounds share the playback entry point.
        assert!(play_sound_file(&wav, 0.0).is_ok());
        assert!(play_sound_file(&dir.join("missing.wav"), 0.0).is_err());
        assert!(play_sound_file(&text, 0.0).is_err());
        assert!(play_sound_file(Path::new("bundled:tone"), 0.0).is_ok());
        assert!(play_sound_file(Path::new("bundled:missing"), 0.0).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
