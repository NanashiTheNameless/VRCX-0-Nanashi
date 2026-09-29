use crate::open_string_enum::open_string_enum;

open_string_enum! {
    pub enum TwoFactorMethod {
        EmailOtp => "emailOtp",
        Otp => "otp",
        Totp => "totp",
    }
}
