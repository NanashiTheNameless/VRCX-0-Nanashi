use serde_json::{json, Value};

pub fn normalize_config_string_array(parsed: Value) -> Vec<String> {
    let mut values: Vec<String> = Vec::new();
    for value in parsed.as_array().into_iter().flatten() {
        let value = config_value_to_string(value).trim().to_string();
        if !value.is_empty() && !values.contains(&value) {
            values.push(value);
        }
    }
    values
}

pub fn config_string_array_value(values: &[String]) -> Value {
    json!(values)
}

fn config_value_to_string(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(value) => value.clone(),
        other => other.to_string(),
    }
}
