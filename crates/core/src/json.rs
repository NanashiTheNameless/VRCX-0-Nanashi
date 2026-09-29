use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::ops::{Deref, DerefMut};

#[derive(Clone, Debug, Default, PartialEq, Deserialize, Serialize, specta::Type)]
#[serde(transparent)]
pub struct RawJson(pub Value);

impl RawJson {
    pub fn as_value(&self) -> &Value {
        &self.0
    }

    pub fn into_value(self) -> Value {
        self.0
    }
}

impl Deref for RawJson {
    type Target = Value;

    fn deref(&self) -> &Self::Target {
        self.as_value()
    }
}

impl DerefMut for RawJson {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

impl From<Value> for RawJson {
    fn from(value: Value) -> Self {
        Self(value)
    }
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize, Serialize, specta::Type)]
#[serde(transparent)]
pub struct RawJsonObject(pub Map<String, Value>);

impl RawJsonObject {
    pub fn as_map(&self) -> &Map<String, Value> {
        &self.0
    }

    pub fn into_map(self) -> Map<String, Value> {
        self.0
    }
}

impl From<Map<String, Value>> for RawJsonObject {
    fn from(value: Map<String, Value>) -> Self {
        Self(value)
    }
}

impl Deref for RawJsonObject {
    type Target = Map<String, Value>;

    fn deref(&self) -> &Self::Target {
        self.as_map()
    }
}

impl DerefMut for RawJsonObject {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

pub fn text_of(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(text)) => text.clone(),
        None | Some(Value::Null) => String::new(),
        Some(other) => other.to_string(),
    }
}

pub fn trimmed_text_of(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(text)) => text.trim().to_string(),
        None | Some(Value::Null) => String::new(),
        Some(other) => other.to_string().trim().to_string(),
    }
}

pub fn scalar_text(value: Option<&Value>) -> String {
    scalar_text_of(value).unwrap_or_default()
}

pub fn scalar_text_of(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(text)) => Some(text.trim().to_string()),
        Some(Value::Number(number)) => Some(number.to_string()),
        Some(Value::Bool(flag)) => Some(flag.to_string()),
        _ => None,
    }
    .filter(|text| !text.is_empty())
}

pub fn scalar_text_array(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(values)) => values
            .iter()
            .filter_map(|value| scalar_text_of(Some(value)))
            .collect(),
        Some(value) => scalar_text_of(Some(value))
            .map(|text| vec![text])
            .unwrap_or_default(),
        None => Vec::new(),
    }
}

pub fn object_scalar_text(value: &Value, keys: &[&str]) -> String {
    let Some(object) = value.as_object() else {
        return String::new();
    };
    for key in keys {
        let text = scalar_text(object.get(*key));
        if !text.is_empty() {
            return text;
        }
    }
    String::new()
}

pub fn result_rows(value: &Value) -> Vec<Value> {
    if let Some(rows) = value.as_array() {
        return rows.clone();
    }
    value
        .as_object()
        .and_then(|object| object.get("results"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn i64_of(value: Option<&Value>) -> Option<i64> {
    value.and_then(|value| {
        value
            .as_i64()
            .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
    })
}

pub trait JsonExt {
    fn field(&self, key: &str) -> Option<&Value>;

    fn text_field(&self, key: &str) -> String {
        text_of(self.field(key))
    }

    fn trimmed_field(&self, key: &str) -> Option<&str> {
        self.field(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
    }

    fn trimmed_text(&self, key: &str) -> String {
        self.trimmed_field(key).unwrap_or_default().to_string()
    }

    fn trimmed_string(&self, key: &str) -> Option<String> {
        self.trimmed_field(key).map(ToOwned::to_owned)
    }

    fn scalar_field(&self, key: &str) -> Option<String> {
        scalar_text_of(self.field(key))
    }

    fn i64_field(&self, key: &str) -> Option<i64> {
        i64_of(self.field(key))
    }
}

impl JsonExt for Value {
    fn field(&self, key: &str) -> Option<&Value> {
        self.get(key)
    }
}

impl JsonExt for Map<String, Value> {
    fn field(&self, key: &str) -> Option<&Value> {
        self.get(key)
    }
}

#[cfg(test)]
mod tests {
    use super::{trimmed_text_of, JsonExt};
    use serde_json::json;

    #[test]
    fn text_field_keeps_strings_verbatim_and_renders_other_values() {
        let value = json!({
            "padded": "  spaced  ",
            "number": 5,
            "flag": true,
            "nested": {"a": 1},
            "nothing": null
        });

        assert_eq!(value.text_field("padded"), "  spaced  ");
        assert_eq!(value.text_field("number"), "5");
        assert_eq!(value.text_field("flag"), "true");
        assert_eq!(value.text_field("nested"), "{\"a\":1}");
        assert_eq!(value.text_field("nothing"), "");
        assert_eq!(value.text_field("missing"), "");
    }

    #[test]
    fn trimmed_field_accepts_strings_only() {
        let value = json!({"padded": "  spaced  ", "blank": "   ", "number": 5});

        assert_eq!(value.trimmed_field("padded"), Some("spaced"));
        assert_eq!(value.trimmed_field("blank"), None);
        assert_eq!(value.trimmed_field("number"), None);
        assert_eq!(value.trimmed_text("blank"), "");
        assert_eq!(value.trimmed_text("padded"), "spaced");
    }

    #[test]
    fn scalar_field_coerces_numbers_and_bools() {
        let value =
            json!({"text": " hi ", "number": 5, "flag": false, "blank": "  ", "nested": []});

        assert_eq!(value.scalar_field("text"), Some("hi".to_string()));
        assert_eq!(value.scalar_field("number"), Some("5".to_string()));
        assert_eq!(value.scalar_field("flag"), Some("false".to_string()));
        assert_eq!(value.scalar_field("blank"), None);
        assert_eq!(value.scalar_field("nested"), None);
    }

    #[test]
    fn i64_field_parses_numeric_strings() {
        let value = json!({"number": 42, "text": "42", "padded": " 42 ", "float": 1.5, "bad": "x"});

        assert_eq!(value.i64_field("number"), Some(42));
        assert_eq!(value.i64_field("text"), Some(42));
        assert_eq!(value.i64_field("padded"), None);
        assert_eq!(value.i64_field("float"), None);
        assert_eq!(value.i64_field("bad"), None);
        assert_eq!(value.i64_field("missing"), None);
    }

    #[test]
    fn trimmed_text_of_renders_any_value_and_trims() {
        let value = json!({"padded": "  spaced  ", "number": 5, "nothing": null});
        let object = value.as_object().unwrap();

        assert_eq!(trimmed_text_of(object.get("padded")), "spaced");
        assert_eq!(trimmed_text_of(object.get("number")), "5");
        assert_eq!(trimmed_text_of(object.get("nothing")), "");
        assert_eq!(trimmed_text_of(None), "");
    }
}
