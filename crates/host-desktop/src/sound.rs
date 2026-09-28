//! Fork: play user-selected notification sounds (WAV, MP3, FLAC, OGG Vorbis)
//! from the backend, so they work in background mode without a webview.

use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};

/// Simultaneous sounds; extra requests are dropped instead of piling up.
const MAX_CONCURRENT_SOUNDS: usize = 4;
static ACTIVE_SOUNDS: AtomicUsize = AtomicUsize::new(0);

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
    open_decoder(path).map(|_| ())
}

/// Play `path` at `volume` (0.0 - 1.0) on the default output device without
/// blocking. Errors opening/decoding the file are returned immediately.
pub fn play_sound_file(path: &Path, volume: f32) -> Result<(), String> {
    if !volume.is_finite() {
        return Err("sound volume must be finite".into());
    }
    let decoder = open_decoder(path)?;
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
        let _ = std::fs::remove_dir_all(dir);
    }
}
