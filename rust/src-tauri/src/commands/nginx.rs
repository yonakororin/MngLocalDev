use tauri::State;
use crate::AppState;
use super::settings;
use super::helpers::run_docker;
use std::fs;

#[tauri::command]
pub fn nginx_reload(state: State<AppState>) -> Result<bool, String> {
    // Try myapp_nginx directly
    if let Ok(out) = run_docker(&["ps", "-q", "-f", "name=myapp_nginx"]) {
        if !out.trim().is_empty() {
            run_docker(&["exec", "myapp_nginx", "nginx", "-s", "reload"])?;
            return Ok(true);
        }
    }
    // Fallback via compose
    let cfg = settings::get_full_config(&state)?;
    let compose_file = cfg["compose_file"].as_str().unwrap_or("");
    let project_root = cfg["project_root"].as_str().unwrap_or("");
    if compose_file.is_empty() { return Err("No compose file configured".into()); }

    let mut cmd = std::process::Command::new("docker");
    cmd.args(["compose", "-f", compose_file, "ps", "--format", "{{.Name}}"])
        .current_dir(project_root);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let output = cmd.output()
        .map_err(|e| e.to_string())?;

    let names = String::from_utf8_lossy(&output.stdout);
    let nginx = names.lines().find(|l| l.contains("nginx")).ok_or("Nginx container not found")?;
    run_docker(&["exec", nginx.trim(), "nginx", "-s", "reload"])?;
    Ok(true)
}

/// Get the conf.d directory path from project config
fn get_conf_dir(state: &State<AppState>) -> Result<String, String> {
    let cfg = settings::get_full_config(state)?;
    let base_dir = cfg["project_root"].as_str().unwrap_or("").to_string();
    if base_dir.is_empty() {
        return Err("project_root not set in config".into());
    }
    Ok(format!("{}/conf.d", base_dir.replace('\\', "/")))
}

#[tauri::command]
pub fn nginx_list_configs(state: State<AppState>) -> Result<Vec<String>, String> {
    let conf_dir = get_conf_dir(&state)?;
    let path = std::path::Path::new(&conf_dir);
    if !path.exists() {
        return Ok(vec![]);
    }
    let mut files: Vec<String> = fs::read_dir(path)
        .map_err(|e| format!("Failed to read conf.d: {}", e))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".conf") {
                Some(name)
            } else {
                None
            }
        })
        .collect();
    files.sort();
    Ok(files)
}

#[tauri::command]
pub fn nginx_read_config(state: State<AppState>, filename: String) -> Result<String, String> {
    let conf_dir = get_conf_dir(&state)?;
    // Prevent directory traversal
    if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
        return Err("Invalid filename".into());
    }
    let file_path = format!("{}/{}", conf_dir, filename);
    fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read {}: {}", filename, e))
}

#[tauri::command]
pub fn nginx_save_config(state: State<AppState>, filename: String, content: String) -> Result<bool, String> {
    let conf_dir = get_conf_dir(&state)?;
    // Prevent directory traversal
    if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
        return Err("Invalid filename".into());
    }
    let file_path = format!("{}/{}", conf_dir, filename);
    // Ensure conf.d directory exists
    let _ = fs::create_dir_all(&conf_dir);
    fs::write(&file_path, &content)
        .map_err(|e| format!("Failed to write {}: {}", filename, e))?;

    // Reload nginx after save
    let _ = nginx_reload(state);
    Ok(true)
}
