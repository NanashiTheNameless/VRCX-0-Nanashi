fn main() {
    println!("cargo:rerun-if-changed=ui/overlay.slint");
    println!("cargo:rerun-if-changed=ui/desktop_widget.slint");
    println!("cargo:rerun-if-changed=ui/hmd_toast.slint");
    println!("cargo:rerun-if-changed=ui/wrist.slint");
    println!("cargo:rerun-if-changed=ui/avatar_placeholder.slint");
    println!("cargo:rerun-if-changed=ui/badge.slint");
    println!("cargo:rerun-if-changed=ui/fonts");
    #[cfg(feature = "slint-ui")]
    slint_build::compile("ui/overlay.slint").expect("compile Slint overlay UI");
}
