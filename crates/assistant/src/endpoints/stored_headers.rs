//! Obfuscate custom header values on disk using the API-key storage format.
//! This prevents casual disclosure in config files; it is not encryption.
//! The explicit marker keeps legacy plaintext values (even those resembling
//! the obfuscation prefix) unchanged until the endpoint is next saved.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use vrcx_0_contracts::llm::LlmHeader;

use crate::config::{deobfuscate_api_key, obfuscate_api_key};

#[derive(Serialize, Deserialize)]
struct StoredHeader {
    name: String,
    value: String,
    #[serde(default)]
    obfuscated: bool,
}

pub(super) fn serialize<S: Serializer>(
    headers: &[LlmHeader],
    serializer: S,
) -> Result<S::Ok, S::Error> {
    headers
        .iter()
        .map(|header| StoredHeader {
            name: header.name.clone(),
            value: obfuscate_api_key(&header.value),
            obfuscated: true,
        })
        .collect::<Vec<_>>()
        .serialize(serializer)
}

pub(super) fn deserialize<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Vec<LlmHeader>, D::Error> {
    Ok(Vec::<StoredHeader>::deserialize(deserializer)?
        .into_iter()
        .map(|header| LlmHeader {
            name: header.name,
            value: if header.obfuscated {
                deobfuscate_api_key(&header.value)
            } else {
                header.value
            },
        })
        .collect())
}
