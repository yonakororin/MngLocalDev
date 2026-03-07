use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::State;
use crate::AppState;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub config_path: String,
    pub assignments_path: String,
    pub cron_db_path: String,
}

fn settings_file_path() -> PathBuf {
    let data_dir = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    data_dir.join("mnglocaldev").join("app-settings.json")
}

#[tauri::command]
pub fn get_paths(state: State<AppState>) -> AppSettings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
pub fn update_paths(state: State<AppState>, new_settings: AppSettings) -> bool {
    let path = settings_file_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    match serde_json::to_string_pretty(&new_settings) {
        Ok(json) => {
            if fs::write(&path, &json).is_ok() {
                *state.settings.lock().unwrap() = new_settings;
                *state.config_cache.lock().unwrap() = None;
                true
            } else { false }
        }
        Err(_) => false,
    }
}

#[tauri::command]
pub fn get_config(state: State<AppState>) -> Result<serde_json::Value, String> {
    {
        let cache = state.config_cache.lock().unwrap();
        if let Some(ref c) = *cache {
            return Ok(c.clone());
        }
    }
    let settings = state.settings.lock().unwrap();
    if settings.config_path.is_empty() {
        return Err("Config path is not set".into());
    }
    let mut data = fs::read_to_string(&settings.config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    // Remove BOM
    if data.starts_with('\u{FEFF}') { data = data[3..].to_string(); }
    let config: serde_json::Value = serde_json::from_str(&data)
        .map_err(|e| format!("Failed to parse config: {}", e))?;
    *state.config_cache.lock().unwrap() = Some(config.clone());
    Ok(config)
}

#[tauri::command]
pub fn get_assignments(state: State<AppState>) -> Result<serde_json::Value, String> {
    let settings = state.settings.lock().unwrap();
    if settings.assignments_path.is_empty() { return Ok(serde_json::json!([])); }
    let mut data = fs::read_to_string(&settings.assignments_path).unwrap_or_else(|_| "[]".into());
    if data.starts_with('\u{FEFF}') { data = data[3..].to_string(); }
    serde_json::from_str(&data).map_err(|e| format!("Parse error: {}", e))
}

fn get_config_value(state: &State<AppState>) -> Result<serde_json::Value, String> {
    {
        let cache = state.config_cache.lock().unwrap();
        if let Some(ref c) = *cache { return Ok(c.clone()); }
    }
    let settings = state.settings.lock().unwrap();
    let mut data = fs::read_to_string(&settings.config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    if data.starts_with('\u{FEFF}') { data = data[3..].to_string(); }
    let config: serde_json::Value = serde_json::from_str(&data)
        .map_err(|e| format!("Failed to parse config: {}", e))?;
    *state.config_cache.lock().unwrap() = Some(config.clone());
    Ok(config)
}

pub fn get_distro_and_phpenv(state: &State<AppState>) -> Result<(String, String), String> {
    let cfg = get_config_value(state)?;
    let distro = cfg["wsl_distro"].as_str().unwrap_or("").to_string();
    let phpenv_root = cfg["phpenv_root"].as_str().unwrap_or("").to_string();
    if distro.is_empty() { return Err("wsl_distro not configured".into()); }
    Ok((distro, phpenv_root))
}

pub fn get_full_config(state: &State<AppState>) -> Result<serde_json::Value, String> {
    get_config_value(state)
}

#[tauri::command]
pub fn save_assignments(state: State<AppState>, assignments: serde_json::Value) -> Result<bool, String> {
    let settings = state.settings.lock().unwrap().clone();
    if settings.assignments_path.is_empty() { return Ok(false); }

    let cfg = get_config_value(&state)?;
    let distro = cfg["wsl_distro"].as_str().unwrap_or("");

    // Read old assignments for cleanup
    let old: Vec<serde_json::Value> = fs::read_to_string(&settings.assignments_path)
        .ok()
        .and_then(|d| {
            let d2 = if d.starts_with('\u{FEFF}') { d[3..].to_string() } else { d };
            serde_json::from_str(&d2).ok()
        })
        .unwrap_or_default();

    let empty_vec = vec![];
    let new_arr = assignments.as_array().unwrap_or(&empty_vec);

    // Cleanup removed assignments
    for old_a in &old {
        let old_wp = old_a["win_path"].as_str().unwrap_or("");
        let still_exists = new_arr.iter().any(|n| n["win_path"].as_str().unwrap_or("") == old_wp);
        if !still_exists && !old_wp.is_empty() {
            let wsl_path = old_a["wsl_path"].as_str()
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .unwrap_or_else(|| super::helpers::win_to_wsl_path(old_wp));
            let _ = super::helpers::run_wsl(distro, &format!("rm -f '{}'/.php-version", wsl_path), false);
        }
    }

    // Update .php-version for current assignments
    for a in new_arr {
        let wp = a["win_path"].as_str().unwrap_or("");
        let ver = a["php_version"].as_str().unwrap_or("");
        if wp.is_empty() || ver.is_empty() { continue; }
        let wsl_path = a["wsl_path"].as_str()
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| super::helpers::win_to_wsl_path(wp));
        let _ = super::helpers::run_wsl(distro, &format!("mkdir -p '{}' && echo -n '{}' > '{}'/.php-version", wsl_path, ver, wsl_path), false);
    }

    // Save JSON
    let json = serde_json::to_string_pretty(&assignments).map_err(|e| e.to_string())?;
    fs::write(&settings.assignments_path, &json).map_err(|e| e.to_string())?;

    // Generate nginx config
    let project_root = cfg["project_root"].as_str().unwrap_or("");
    if !project_root.is_empty() {
        let conf_dir = format!("{}/nginx-projects", project_root);
        let _ = fs::create_dir_all(&conf_dir);
        let mut conf_content = String::new();
        for a in new_arr {
            let url_path = a["url_path"].as_str().unwrap_or("");
            let doc_root = a["doc_root"].as_str().unwrap_or("");
            let port = a["port"].as_u64().unwrap_or(0);
            if url_path.is_empty() || doc_root.is_empty() || port == 0 { continue; }
            let win_path = a["win_path"].as_str().unwrap_or("");
            let mut path_part = if url_path.contains('/') {
                url_path[url_path.find('/').unwrap()..].to_string()
            } else if url_path != "localhost" {
                format!("/{}", url_path)
            } else {
                format!("/{}", win_path.rsplit(&['\\', '/'][..]).next().unwrap_or(""))
            };
            path_part = path_part.trim_end_matches('/').to_string();
            if !path_part.starts_with('/') { path_part = format!("/{}", path_part); }
            let label = path_part[1..].replace(|c: char| !c.is_alphanumeric(), "_");
            conf_content.push_str(&format!(r#"
    location {} {{
        alias {};
        index index.php index.html;
        try_files $uri $uri/ @{};
        location ~ \.php$ {{
            if (!-f $request_filename) {{ return 404; }}
            fastcgi_split_path_info ^(.+\.php)(/.+)$;
            fastcgi_pass host.docker.internal:{};
            fastcgi_index index.php;
            include fastcgi_params;
            fastcgi_param SCRIPT_FILENAME $request_filename;
            fastcgi_param PATH_INFO $fastcgi_path_info;
            fastcgi_read_timeout 300;
        }}
    }}
    location @{} {{
        rewrite {}/(.*)$ {}/index.php?/$1 last;
    }}
"#, path_part, doc_root, label, port, label, path_part, path_part));
        }
        let _ = fs::write(format!("{}/assignments.conf", conf_dir), &conf_content);
    }

    // Reload nginx
    let compose_file = cfg["compose_file"].as_str().unwrap_or("");
    if !compose_file.is_empty() {
        let mut cmd = std::process::Command::new("docker");
        cmd.args(["compose", "-f", compose_file, "ps", "--format", "{{.Name}}"]);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        let _ = cmd.output()
            .ok()
            .and_then(|o| {
                let names = String::from_utf8_lossy(&o.stdout).to_string();
                names.lines().find(|l| l.contains("nginx")).map(|n| {
                    let mut cmd2 = std::process::Command::new("docker");
                    cmd2.args(["exec", n.trim(), "nginx", "-s", "reload"]);
                    #[cfg(target_os = "windows")]
                    {
                        use std::os::windows::process::CommandExt;
                        cmd2.creation_flags(0x08000000);
                    }
                    let _ = cmd2.output();
                })
            });
    }

    Ok(true)
}

#[tauri::command]
pub fn init_settings(state: State<AppState>) -> Result<serde_json::Value, String> {
    let path = settings_file_path();
    if path.exists() {
        let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let s: AppSettings = serde_json::from_str(&data).map_err(|e| e.to_string())?;
        if !s.config_path.is_empty() && PathBuf::from(&s.config_path).exists() {
            *state.settings.lock().unwrap() = s;
            return Ok(serde_json::json!({"status": "loaded"}));
        }
    }
    Ok(serde_json::json!({"status": "needs_setup"}))
}
