use std::io::{Cursor, Read, Write};

use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

pub const MAX_FRAME_BYTES: usize = 4 * 1024 * 1024;

#[cfg(unix)]
pub mod runtime;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum IpcError {
    #[error("truncated frame")]
    Truncated,
    #[error("frame exceeds the 4 MiB limit")]
    TooLarge,
    #[error("malformed CBOR frame")]
    Malformed,
    #[error("unsupported collector protocol version")]
    UnsupportedVersion,
    #[error("request is invalid")]
    InvalidRequest,
    #[error("tmpfs storage is required")]
    NotTmpfs,
}

#[derive(Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionMessage {
    pub v: u8,
    pub auth: String,
    pub two_factor_auth: Option<String>,
}

impl SessionMessage {
    pub fn validate(&self) -> Result<(), IpcError> {
        if self.v != 1 {
            return Err(IpcError::UnsupportedVersion);
        }
        if self.auth.is_empty() {
            return Err(IpcError::InvalidRequest);
        }
        Ok(())
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RowMessage {
    pub v: u8,
    pub row_id: u64,
    pub stream: String,
    pub row: serde_json::Value,
}

#[derive(Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ControlRequest {
    pub v: u8,
    pub id: u64,
    pub op: String,
    #[serde(default)]
    pub through_row_id: Option<u64>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ControlResponse {
    pub v: u8,
    pub id: u64,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ControlError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ControlError {
    pub code: String,
    pub message: String,
}

pub fn read_frame<R: Read>(reader: &mut R) -> Result<Option<Vec<u8>>, IpcError> {
    let mut prefix = [0_u8; 4];
    let mut first = [0_u8; 1];
    loop {
        match reader.read(&mut first) {
            Ok(0) => return Ok(None),
            Ok(1) => {
                prefix[0] = first[0];
                break;
            }
            Ok(_) => unreachable!(),
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return Err(IpcError::Truncated),
        }
    }
    reader
        .read_exact(&mut prefix[1..])
        .map_err(|_| IpcError::Truncated)?;
    let length = u32::from_be_bytes(prefix) as usize;
    if length == 0 || length > MAX_FRAME_BYTES {
        return Err(IpcError::TooLarge);
    }
    let mut frame = vec![0; length];
    reader
        .read_exact(&mut frame)
        .map_err(|_| IpcError::Truncated)?;
    Ok(Some(frame))
}

pub fn write_frame<W: Write, T: Serialize>(writer: &mut W, message: &T) -> Result<(), IpcError> {
    let mut payload = Vec::new();
    ciborium::ser::into_writer(message, &mut payload).map_err(|_| IpcError::Malformed)?;
    if payload.is_empty() || payload.len() > MAX_FRAME_BYTES {
        return Err(IpcError::TooLarge);
    }
    let length = u32::try_from(payload.len()).map_err(|_| IpcError::TooLarge)?;
    writer
        .write_all(&length.to_be_bytes())
        .and_then(|()| writer.write_all(&payload))
        .map_err(|_| IpcError::Truncated)
}

pub fn read_session<R: Read>(reader: &mut R) -> Result<SessionMessage, IpcError> {
    let mut bytes = Vec::new();
    reader
        .take((MAX_FRAME_BYTES + 5) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| IpcError::Truncated)?;
    if bytes.len() < 4 {
        bytes.zeroize();
        return Err(IpcError::Truncated);
    }
    let length = u32::from_be_bytes(bytes[..4].try_into().expect("four-byte prefix")) as usize;
    if length > MAX_FRAME_BYTES {
        bytes.zeroize();
        return Err(IpcError::TooLarge);
    }
    if length == 0 || bytes.len() != length + 4 {
        bytes.zeroize();
        return Err(IpcError::Malformed);
    }
    let mut payload = Cursor::new(&bytes[4..]);
    let decoded = ciborium::de::from_reader::<SessionMessage, _>(&mut payload)
        .map_err(|_| IpcError::Malformed)
        .and_then(|message| {
            if payload.position() as usize == length {
                Ok(message)
            } else {
                Err(IpcError::Malformed)
            }
        });
    bytes.zeroize();
    let message = decoded?;
    message.validate()?;
    Ok(message)
}

#[cfg(target_os = "linux")]
pub fn is_tmpfs(path: &std::path::Path) -> Result<bool, IpcError> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let path = CString::new(path.as_os_str().as_bytes()).map_err(|_| IpcError::NotTmpfs)?;
    let mut stat = std::mem::MaybeUninit::<libc::statfs>::uninit();
    // SAFETY: path is a valid NUL-terminated C string and stat is writable.
    let result = unsafe { libc::statfs(path.as_ptr(), stat.as_mut_ptr()) };
    if result != 0 {
        return Err(IpcError::NotTmpfs);
    }
    // SAFETY: statfs returned success and initialized the structure.
    let stat = unsafe { stat.assume_init() };
    Ok(stat.f_type as u64 == 0x0102_1994)
}

#[cfg(not(target_os = "linux"))]
pub fn is_tmpfs(_path: &std::path::Path) -> Result<bool, IpcError> {
    Err(IpcError::NotTmpfs)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn framing_is_big_endian_length_prefixed_cbor() {
        let row = RowMessage {
            v: 1,
            row_id: 1,
            stream: "feed_status".into(),
            row: serde_json::json!({"status": "Online"}),
        };
        let mut bytes = Vec::new();
        write_frame(&mut bytes, &row).unwrap();
        assert_eq!(
            u32::from_be_bytes(bytes[..4].try_into().unwrap()) as usize,
            bytes.len() - 4
        );
        let payload = read_frame(&mut Cursor::new(bytes)).unwrap().unwrap();
        let decoded: RowMessage = ciborium::de::from_reader(payload.as_slice()).unwrap();
        assert_eq!(decoded, row);
    }

    #[test]
    fn rejects_truncated_and_oversized_frames() {
        assert_eq!(
            read_frame(&mut Cursor::new([0, 0, 0])),
            Err(IpcError::Truncated)
        );
        assert_eq!(
            read_frame(&mut Cursor::new([0, 0x40, 0, 1])),
            Err(IpcError::TooLarge)
        );
    }

    #[test]
    fn session_is_one_cbor_frame_through_eof_and_requires_auth_cookie() {
        let session =
            serde_json::json!({"v": 1, "auth": "fixture", "twoFactorAuth": "fixture-2fa"});
        let mut bytes = Vec::new();
        write_frame(&mut bytes, &session).unwrap();
        let parsed = read_session(&mut Cursor::new(bytes.clone())).unwrap();
        assert_eq!(parsed.auth, "fixture");
        bytes.extend_from_slice(&[0, 0, 0, 1, 0]);
        assert!(matches!(
            read_session(&mut Cursor::new(bytes)),
            Err(IpcError::Malformed)
        ));
        let empty_auth = serde_json::json!({"v": 1, "auth": ""});
        let mut bytes = Vec::new();
        write_frame(&mut bytes, &empty_auth).unwrap();
        assert!(matches!(
            read_session(&mut Cursor::new(bytes)),
            Err(IpcError::InvalidRequest)
        ));
    }

    #[test]
    fn ordinary_workspace_filesystem_is_not_tmpfs() {
        assert!(!is_tmpfs(std::path::Path::new(env!("CARGO_MANIFEST_DIR"))).unwrap());
    }
}
