use std::sync::Arc;

use serde::{Deserialize, Serialize};

use super::geometry::OverlaySize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RgbaFrame {
    pub size: OverlaySize,
    #[serde(with = "arc_bytes")]
    pub data: Arc<[u8]>,
}

impl RgbaFrame {
    pub fn new(size: OverlaySize, data: impl Into<Arc<[u8]>>) -> Self {
        Self {
            size,
            data: data.into(),
        }
    }

    pub fn expected_byte_len(size: OverlaySize) -> Option<usize> {
        let width = usize::try_from(size.width).ok()?;
        let height = usize::try_from(size.height).ok()?;
        width.checked_mul(height)?.checked_mul(4)
    }

    pub fn is_valid_len(&self) -> bool {
        Self::expected_byte_len(self.size).is_some_and(|expected| expected == self.data.len())
    }
}

mod arc_bytes {
    use std::sync::Arc;

    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S>(data: &Arc<[u8]>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        data.as_ref().serialize(serializer)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Arc<[u8]>, D::Error>
    where
        D: Deserializer<'de>,
    {
        Vec::<u8>::deserialize(deserializer).map(Arc::from)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expected_byte_len_allows_zero_sized_frames() {
        assert_eq!(
            RgbaFrame::expected_byte_len(OverlaySize::new(0, 0)),
            Some(0)
        );
    }

    #[test]
    fn is_valid_len_checks_exact_rgba_buffer_size() {
        let size = OverlaySize::new(2, 3);
        assert_eq!(RgbaFrame::expected_byte_len(size), Some(2 * 3 * 4));
        assert_eq!(
            RgbaFrame::expected_byte_len(OverlaySize::new(u32::MAX, u32::MAX)),
            None
        );
        assert!(RgbaFrame::new(size, vec![0; 2 * 3 * 4]).is_valid_len());
        assert!(!RgbaFrame::new(size, vec![0; 2 * 3 * 4 - 1]).is_valid_len());
        assert!(!RgbaFrame::new(OverlaySize::new(u32::MAX, u32::MAX), Vec::new()).is_valid_len());
    }

    #[test]
    fn clone_shares_rgba_storage() {
        let frame = RgbaFrame::new(OverlaySize::new(2, 2), vec![0; 2 * 2 * 4]);
        let cloned = frame.clone();

        assert!(Arc::ptr_eq(&frame.data, &cloned.data));
    }
}
