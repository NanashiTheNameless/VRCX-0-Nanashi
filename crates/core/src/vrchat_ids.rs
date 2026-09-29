pub fn is_world_id(value: &str) -> bool {
    is_prefixed_uuid(value, "wrld_")
}

pub fn is_avatar_id(value: &str) -> bool {
    is_prefixed_uuid(value, "avtr_")
}

pub fn is_user_id(value: &str) -> bool {
    is_prefixed_uuid(value, "usr_")
}

pub fn is_group_id(value: &str) -> bool {
    is_prefixed_uuid(value, "grp_")
}

fn is_prefixed_uuid(value: &str, prefix: &str) -> bool {
    let Some(uuid) = value.strip_prefix(prefix) else {
        return false;
    };
    is_uuid(uuid)
}

fn is_uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

#[cfg(test)]
mod tests {
    use super::{is_avatar_id, is_group_id, is_user_id, is_world_id};

    #[test]
    fn validates_canonical_prefixed_ids() {
        type Validator = fn(&str) -> bool;
        let cases: [(Validator, &str, bool); 15] = [
            (
                is_world_id,
                "wrld_12345678-1234-1234-1234-1234567890ab",
                true,
            ),
            (is_world_id, "", false),
            (is_world_id, "legacy-world-id", false),
            (is_world_id, "wrld_not-a-vrchat-id", false),
            (
                is_world_id,
                "usr_12345678-1234-1234-1234-1234567890ab",
                false,
            ),
            (is_user_id, "usr_12345678-1234-1234-1234-1234567890ab", true),
            (is_user_id, "", false),
            (is_user_id, "usr_not-a-vrchat-id", false),
            (
                is_user_id,
                "wrld_12345678-1234-1234-1234-1234567890ab",
                false,
            ),
            (
                is_avatar_id,
                "avtr_12345678-1234-1234-1234-1234567890ab",
                true,
            ),
            (is_avatar_id, "", false),
            (is_avatar_id, "avtr_not-a-vrchat-id", false),
            (
                is_avatar_id,
                "wrld_12345678-1234-1234-1234-1234567890ab",
                false,
            ),
            (
                is_group_id,
                "grp_12345678-1234-1234-1234-1234567890ab",
                true,
            ),
            (is_group_id, "grp_not-a-vrchat-id", false),
        ];
        for (validate, value, expected) in cases {
            assert_eq!(validate(value), expected, "{value}");
        }
    }
}
