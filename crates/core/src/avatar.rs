use crate::open_string_enum::open_string_enum;

open_string_enum! {
    pub enum PerformanceRating {
        Excellent => "Excellent",
        Good => "Good",
        Medium => "Medium",
        None => "None",
        Poor => "Poor",
        VeryPoor => "VeryPoor",
    }
}

const FILE_NAME_SYMBOLS: [(char, char); 27] = [
    ('＠', '@'),
    ('＃', '#'),
    ('＄', '$'),
    ('％', '%'),
    ('＆', '&'),
    ('＝', '='),
    ('＋', '+'),
    ('⁄', '/'),
    ('＼', '\\'),
    (';', ';'),
    ('˸', ':'),
    ('‚', ','),
    ('？', '?'),
    ('ǃ', '!'),
    ('＂', '"'),
    ('≺', '<'),
    ('≻', '>'),
    ('․', '.'),
    ('＾', '^'),
    ('｛', '{'),
    ('｝', '}'),
    ('［', '['),
    ('］', ']'),
    ('（', '('),
    ('）', ')'),
    ('｜', '|'),
    ('∗', '*'),
];

fn restore_file_name_symbols(text: &str) -> String {
    text.chars()
        .map(|ch| {
            FILE_NAME_SYMBOLS
                .iter()
                .find(|(from, _)| *from == ch)
                .map_or(ch, |(_, to)| *to)
        })
        .collect()
}

pub fn avatar_name_from_file_name(file_name: &str) -> Option<String> {
    let lower = file_name.to_ascii_lowercase();
    let start = lower.find("avatar - ")? + "avatar - ".len();
    let end = lower.rfind(" - image -")?;
    if end < start {
        return None;
    }
    let name = file_name[start..end].trim();
    (!name.is_empty()).then(|| restore_file_name_symbols(name))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{avatar_name_from_file_name, PerformanceRating};

    #[test]
    fn avatar_name_from_file_name_extracts_name() {
        let raw = "Avatar - Name - Image - 2022․3․22f1_1_standalonewindows_Release";

        assert_eq!(avatar_name_from_file_name(raw).as_deref(), Some("Name"));
        assert_eq!(avatar_name_from_file_name("just a name"), None);
    }

    #[test]
    fn avatar_name_from_file_name_restores_symbols_vrchat_replaced() {
        let raw = "Avatar - Neko ［v2․1］ ＠home - Image - 2022․3․22f1_1_standalonewindows_Release";

        assert_eq!(
            avatar_name_from_file_name(raw).as_deref(),
            Some("Neko [v2.1] @home")
        );
    }

    #[test]
    fn performance_rating_maps_known_values() {
        for (value, expected) in [
            ("Excellent", PerformanceRating::Excellent),
            ("Good", PerformanceRating::Good),
            ("Medium", PerformanceRating::Medium),
            ("None", PerformanceRating::None),
            ("Poor", PerformanceRating::Poor),
            ("VeryPoor", PerformanceRating::VeryPoor),
        ] {
            let rating: PerformanceRating = serde_json::from_value(json!(value)).unwrap();

            assert_eq!(rating, expected, "{value}");
            assert_eq!(serde_json::to_value(rating).unwrap(), json!(value));
        }
    }
}
