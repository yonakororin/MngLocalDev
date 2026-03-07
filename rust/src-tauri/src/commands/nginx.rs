use tauri::State;
use crate::AppState;
use super::settings;
use super::helpers::run_docker;

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
