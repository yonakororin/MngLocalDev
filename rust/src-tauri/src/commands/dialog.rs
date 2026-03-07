use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn open_file_dialog(app: tauri::AppHandle) -> Option<String> {
    let file = app.dialog().file().blocking_pick_file();
    file.map(|f| f.to_string())
}

#[tauri::command]
pub async fn open_directory_dialog(app: tauri::AppHandle) -> Option<String> {
    let dir = app.dialog().file().blocking_pick_folder();
    dir.map(|d| d.to_string())
}
