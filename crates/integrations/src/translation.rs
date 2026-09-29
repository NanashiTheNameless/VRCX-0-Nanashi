use std::collections::HashMap;

use serde_json::{json, Value};
use url::Url;
pub use vrcx_0_contracts::TranslationProvider;

use crate::external_api::{translation_request_input, ExternalApiError, ExternalHttpRequestInput};

const GOOGLE_TRANSLATE_URL: &str = "https://translation.googleapis.com/language/translate/v2";
const DEEPL_FREE_TRANSLATE_URL: &str = "https://api-free.deepl.com/v2/translate";

pub fn parse_translation_provider(value: &str) -> TranslationProvider {
    match value.trim().to_ascii_lowercase().as_str() {
        "deepl" => TranslationProvider::DeepL,
        "openai" => TranslationProvider::OpenAi,
        _ => TranslationProvider::Google,
    }
}

pub fn normalize_deepl_target_language(language: &str) -> String {
    let value = {
        let trimmed = language.trim();
        if trimmed.is_empty() {
            "en"
        } else {
            trimmed
        }
    }
    .replace('_', "-")
    .to_lowercase();

    if value == "en" || value.starts_with("en-") {
        return "EN-US".into();
    }
    if value == "pt" || value.starts_with("pt-") {
        return "PT-BR".into();
    }
    if value == "zh-tw" || value == "zh-hant" {
        return "ZH-HANT".into();
    }
    if value == "zh-cn" || value == "zh-hans" || value == "zh" {
        return "ZH-HANS".into();
    }
    value.to_uppercase()
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TranslationOutcome {
    pub text: String,
    pub detected_source_language: Option<String>,
}

pub fn google_translate_request(
    key: &str,
    text: &str,
    target_language: &str,
) -> Result<ExternalHttpRequestInput, ExternalApiError> {
    let url = Url::parse_with_params(GOOGLE_TRANSLATE_URL, [("key", key)])
        .map_err(|error| ExternalApiError::Custom(error.to_string()))?;
    let body = json!({
        "q": text,
        "target": target_language,
        "format": "text"
    });
    translation_request_input(
        url.as_str(),
        "POST",
        HashMap::from([("Content-Type".to_string(), "application/json".to_string())]),
        Value::String(body.to_string()),
    )
}

pub fn deepl_translate_request(
    key: &str,
    text: &str,
    target_language: &str,
) -> Result<ExternalHttpRequestInput, ExternalApiError> {
    let body = json!({
        "text": [text],
        "target_lang": normalize_deepl_target_language(target_language)
    });
    translation_request_input(
        DEEPL_FREE_TRANSLATE_URL,
        "POST",
        HashMap::from([
            ("Content-Type".to_string(), "application/json".to_string()),
            ("Authorization".to_string(), format!("DeepL-Auth-Key {key}")),
        ]),
        Value::String(body.to_string()),
    )
}

fn parse_body(body: &str) -> Result<Value, ExternalApiError> {
    serde_json::from_str(body)
        .map_err(|error| ExternalApiError::Custom(format!("invalid translation response: {error}")))
}

fn text_field<'a>(value: &'a Value, field: &str) -> Option<&'a str> {
    value.get(field).and_then(Value::as_str)
}

pub fn parse_google_translation_response(
    body: &str,
) -> Result<TranslationOutcome, ExternalApiError> {
    let payload = parse_body(body)?;
    let translation = payload
        .get("data")
        .and_then(|data| data.get("translations"))
        .and_then(Value::as_array)
        .and_then(|translations| translations.first());

    Ok(TranslationOutcome {
        text: translation
            .and_then(|entry| text_field(entry, "translatedText"))
            .unwrap_or_default()
            .to_string(),
        detected_source_language: translation
            .and_then(|entry| text_field(entry, "detectedSourceLanguage"))
            .map(ToOwned::to_owned),
    })
}

pub fn parse_deepl_translation_response(
    body: &str,
) -> Result<TranslationOutcome, ExternalApiError> {
    let payload = parse_body(body)?;
    let translation = payload
        .get("translations")
        .and_then(Value::as_array)
        .and_then(|translations| translations.first());

    Ok(TranslationOutcome {
        text: translation
            .and_then(|entry| text_field(entry, "text"))
            .unwrap_or_default()
            .trim()
            .to_string(),
        detected_source_language: translation
            .and_then(|entry| text_field(entry, "detected_source_language"))
            .map(ToOwned::to_owned),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deepl_target_language_normalization_matches_frontend_rules() {
        assert_eq!(normalize_deepl_target_language("en"), "EN-US");
        assert_eq!(normalize_deepl_target_language("en-GB"), "EN-US");
        assert_eq!(normalize_deepl_target_language("pt"), "PT-BR");
        assert_eq!(normalize_deepl_target_language("pt-PT"), "PT-BR");
        assert_eq!(normalize_deepl_target_language("zh-CN"), "ZH-HANS");
        assert_eq!(normalize_deepl_target_language("zh_Hant"), "ZH-HANT");
        assert_eq!(normalize_deepl_target_language("zh"), "ZH-HANS");
        assert_eq!(normalize_deepl_target_language("ja"), "JA");
        assert_eq!(normalize_deepl_target_language(""), "EN-US");
    }

    #[test]
    fn google_request_encodes_key_and_sends_raw_json_body() {
        let input = google_translate_request("k ey+&", "hello", "ja").unwrap();
        let url = input.url.unwrap();
        assert!(url.starts_with("https://translation.googleapis.com/language/translate/v2?key="));
        assert!(!url.contains("k ey+&"));
        let parsed = Url::parse(&url).unwrap();
        assert_eq!(
            parsed
                .query_pairs()
                .find(|(name, _)| name == "key")
                .map(|(_, value)| value.into_owned())
                .as_deref(),
            Some("k ey+&")
        );
        let body: Value = serde_json::from_str(input.body.unwrap().as_str().unwrap()).unwrap();
        assert_eq!(
            body,
            json!({"q": "hello", "target": "ja", "format": "text"})
        );
    }

    #[test]
    fn deepl_request_sets_auth_header_and_normalized_target() {
        let input = deepl_translate_request("secret", "hello", "zh-CN").unwrap();
        assert_eq!(input.url.as_deref(), Some(DEEPL_FREE_TRANSLATE_URL));
        assert_eq!(
            input
                .headers
                .as_ref()
                .unwrap()
                .get("Authorization")
                .map(String::as_str),
            Some("DeepL-Auth-Key secret")
        );
        let body: Value = serde_json::from_str(input.body.unwrap().as_str().unwrap()).unwrap();
        assert_eq!(body, json!({"text": ["hello"], "target_lang": "ZH-HANS"}));
    }

    #[test]
    fn google_response_parser_extracts_text_and_detected_language() {
        let body = r#"{"data": {"translations": [{"translatedText": "こんにちは", "detectedSourceLanguage": "en"}]}}"#;
        let outcome = parse_google_translation_response(body).unwrap();
        assert_eq!(outcome.text, "こんにちは");
        assert_eq!(outcome.detected_source_language.as_deref(), Some("en"));

        let empty = parse_google_translation_response("{}").unwrap();
        assert_eq!(empty.text, "");
        assert_eq!(empty.detected_source_language, None);
    }

    #[test]
    fn deepl_response_parser_trims_text() {
        let body = r#"{"translations": [{"text": " hola ", "detected_source_language": "EN"}]}"#;
        let outcome = parse_deepl_translation_response(body).unwrap();
        assert_eq!(outcome.text, "hola");
        assert_eq!(outcome.detected_source_language.as_deref(), Some("EN"));
    }

    #[test]
    fn provider_parsing_defaults_to_google() {
        assert_eq!(
            parse_translation_provider("deepl"),
            TranslationProvider::DeepL
        );
        assert_eq!(
            parse_translation_provider(" OpenAI "),
            TranslationProvider::OpenAi
        );
        assert_eq!(
            parse_translation_provider("google"),
            TranslationProvider::Google
        );
        assert_eq!(parse_translation_provider(""), TranslationProvider::Google);
        assert_eq!(
            parse_translation_provider("unknown"),
            TranslationProvider::Google
        );
    }
}
