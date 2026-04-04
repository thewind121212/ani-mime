use tauri::Manager;

/// Apply macOS-specific window customizations:
/// - Transparent background
/// - No shadow
/// - Visible on all workspaces
/// - WebView transparent background
pub fn setup_macos_window(app: &tauri::App) {
    let window = app.get_webview_window("main").unwrap();
    let _ = window.set_shadow(false);
    let _ = window.set_visible_on_all_workspaces(true);

    #[cfg(target_os = "macos")]
    {
        use cocoa::appkit::{NSColor, NSWindow};
        use cocoa::base::{id, nil, NO};

        if let Ok(ns_win) = window.ns_window() {
            let ns_win = ns_win as id;
            unsafe {
                ns_win.setOpaque_(NO);
                ns_win.setBackgroundColor_(NSColor::clearColor(nil));
            }
        }

        let _ = window.with_webview(|webview| {
            use cocoa::foundation::NSString;
            let wk: id = webview.inner() as id;
            unsafe {
                let no: id = msg_send![class!(NSNumber), numberWithBool: NO];
                let key = NSString::alloc(nil).init_str("drawsBackground");
                let _: () = msg_send![wk, setValue: no forKey: key];
            }
        });
    }
}
