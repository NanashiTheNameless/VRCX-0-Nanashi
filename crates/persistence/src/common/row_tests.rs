use serde_json::json;

use super::row::*;
use crate::Error;

#[test]
fn row_i64_reads_native_number() {
    let row = vec![json!(42)];
    assert_eq!(row_i64(&row, 0), 42);
}

#[test]
fn row_i64_reads_number_encoded_as_string() {
    let row = vec![json!("42")];
    assert_eq!(row_i64(&row, 0), 42);
}

#[test]
fn row_i64_defaults_to_zero_for_null() {
    let row = vec![json!(null)];
    assert_eq!(row_i64(&row, 0), 0);
}

#[test]
fn row_i64_defaults_to_zero_for_missing_column() {
    let row: Vec<serde_json::Value> = vec![];
    assert_eq!(row_i64(&row, 0), 0);
}

#[test]
fn row_i64_defaults_to_zero_for_unparseable_string() {
    let row = vec![json!("not-a-number")];
    assert_eq!(row_i64(&row, 0), 0);
}

#[test]
fn row_string_returns_empty_for_null() {
    let row = vec![json!(null)];
    assert_eq!(row_string(&row, 0), "");
}

#[test]
fn row_string_returns_empty_for_missing_column() {
    let row: Vec<serde_json::Value> = vec![];
    assert_eq!(row_string(&row, 0), "");
}

#[test]
fn row_string_passes_through_plain_string_without_quoting() {
    let row = vec![json!("usr_alice")];
    assert_eq!(row_string(&row, 0), "usr_alice");
}

#[test]
fn row_string_stringifies_non_string_scalars() {
    let row = vec![json!(7), json!(true)];
    assert_eq!(row_string(&row, 0), "7");
    assert_eq!(row_string(&row, 1), "true");
}

#[test]
fn strict_row_value_errors_on_missing_column() {
    let row: Vec<serde_json::Value> = vec![];
    let result = strict_row_value(&row, 2);
    assert!(matches!(result, Err(Error::Database(_))));
}

#[test]
fn strict_row_string_treats_null_as_empty_string() {
    let row = vec![json!(null)];
    assert_eq!(strict_row_string(&row, 0).unwrap(), "");
}

#[test]
fn strict_row_string_accepts_bool_and_number_as_scalars() {
    let row = vec![json!(true), json!(3.5)];
    assert_eq!(strict_row_string(&row, 0).unwrap(), "true");
    assert_eq!(strict_row_string(&row, 1).unwrap(), "3.5");
}

#[test]
fn strict_row_string_rejects_arrays_and_objects() {
    let row = vec![json!([1, 2]), json!({"a": 1})];
    assert!(strict_row_string(&row, 0).is_err());
    assert!(strict_row_string(&row, 1).is_err());
}

#[test]
fn strict_row_i64_treats_null_as_zero() {
    let row = vec![json!(null)];
    assert_eq!(strict_row_i64(&row, 0).unwrap(), 0);
}

#[test]
fn strict_row_i64_parses_numeric_string() {
    let row = vec![json!("123")];
    assert_eq!(strict_row_i64(&row, 0).unwrap(), 123);
}

#[test]
fn strict_row_i64_rejects_non_numeric_string() {
    let row = vec![json!("abc")];
    assert!(strict_row_i64(&row, 0).is_err());
}

#[test]
fn strict_row_i64_rejects_non_integer_number() {
    let row = vec![json!(1.5)];
    assert!(strict_row_i64(&row, 0).is_err());
}

#[test]
fn strict_row_i64_rejects_non_scalar_value() {
    let row = vec![json!([1])];
    assert!(strict_row_i64(&row, 0).is_err());
}
