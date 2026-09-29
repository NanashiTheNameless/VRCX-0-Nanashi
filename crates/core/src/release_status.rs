use crate::open_string_enum::open_string_enum;

open_string_enum! {
    pub enum ReleaseStatus {
        Public => "public",
        Private => "private",
        Hidden => "hidden",
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::ReleaseStatus;

    #[test]
    fn serde_maps_known_world_release_statuses() {
        for (value, expected) in [
            ("public", ReleaseStatus::Public),
            ("private", ReleaseStatus::Private),
            ("hidden", ReleaseStatus::Hidden),
        ] {
            let status: ReleaseStatus = serde_json::from_value(json!(value)).unwrap();

            assert_eq!(status, expected, "{value}");
            assert_eq!(serde_json::to_value(status).unwrap(), json!(value));
        }
    }
}
