macro_rules! open_string_enum {
    (
        $(#[$meta:meta])*
        $visibility:vis enum $name:ident {
            $($variant:ident => $value:literal),+ $(,)?
        }
    ) => {
        $(#[$meta])*
        #[derive(Clone, Debug, serde::Deserialize, PartialEq, Eq)]
        #[serde(from = "compact_str::CompactString")]
        $visibility enum $name {
            $($variant),+,
            Unknown(compact_str::CompactString),
        }

        impl $name {
            pub fn as_str(&self) -> &str {
                match self {
                    $(Self::$variant => $value),+,
                    Self::Unknown(value) => value,
                }
            }

            fn known(value: &str) -> Option<Self> {
                match value {
                    $($value => Some(Self::$variant)),+,
                    _ => None,
                }
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::Unknown(compact_str::CompactString::new(""))
            }
        }

        impl AsRef<str> for $name {
            fn as_ref(&self) -> &str {
                self.as_str()
            }
        }

        impl serde::Serialize for $name {
            fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
            where
                S: serde::Serializer,
            {
                serializer.serialize_str(self.as_str())
            }
        }

        impl From<&str> for $name {
            fn from(value: &str) -> Self {
                Self::known(value).unwrap_or_else(|| Self::Unknown(value.into()))
            }
        }

        impl From<String> for $name {
            fn from(value: String) -> Self {
                Self::known(&value).unwrap_or_else(|| Self::Unknown(value.into()))
            }
        }

        impl From<compact_str::CompactString> for $name {
            fn from(value: compact_str::CompactString) -> Self {
                Self::known(&value).unwrap_or(Self::Unknown(value))
            }
        }
    };
}

pub(crate) use open_string_enum;

#[cfg(test)]
mod tests {
    use serde_json::json;

    open_string_enum! {
        enum Sample {
            Known => "known",
        }
    }

    #[test]
    fn unknown_wire_values_round_trip_as_raw_strings() {
        let unknown: Sample = serde_json::from_value(json!("future-value")).unwrap();

        assert_eq!(unknown, Sample::Unknown("future-value".into()));
        assert_eq!(unknown.as_str(), "future-value");
        assert_eq!(
            serde_json::to_value(unknown).unwrap(),
            json!("future-value")
        );
    }
}
