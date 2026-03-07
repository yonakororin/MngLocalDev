use tauri::{State, Emitter};
use crate::AppState;
use super::settings;
use super::helpers::run_wsl;

#[tauri::command]
pub fn list_versions(state: State<AppState>) -> Result<Vec<String>, String> {
    let (distro, phpenv_root) = settings::get_distro_and_phpenv(&state)?;
    let output = run_wsl(&distro, &format!("ls -1v {}/versions/", phpenv_root), false)?;
    Ok(output.lines().map(|v| v.trim().to_string()).filter(|v| !v.is_empty() && v.chars().next().map_or(false, |c| c.is_ascii_digit())).collect())
}

#[tauri::command]
pub fn list_installable(state: State<AppState>) -> Result<Vec<String>, String> {
    let (distro, phpenv_root) = settings::get_distro_and_phpenv(&state)?;
    let cmd = format!("export PHPENV_ROOT='{}'; {}/bin/phpenv install --list", phpenv_root, phpenv_root);
    let output = run_wsl(&distro, &cmd, false).unwrap_or_default();
    let mut versions: Vec<String> = output.lines()
        .map(|v| v.trim().to_string())
        .filter(|v| {
            let parts: Vec<&str> = v.split('.').collect();
            parts.len() == 3 && parts.iter().all(|p| p.chars().all(|c| c.is_ascii_digit()))
        })
        .collect();
    versions.reverse();
    Ok(versions)
}

#[tauri::command]
pub fn install_version(state: State<AppState>, version: String, window: tauri::Window) -> Result<bool, String> {
    let (distro, phpenv_root) = settings::get_distro_and_phpenv(&state)?;
    let cmd = format!("export PHPENV_ROOT='{}'; source ~/.bashrc 2>/dev/null; {}/bin/phpenv install {}", phpenv_root, phpenv_root, version);

    use std::process::{Command, Stdio};
    use std::io::{BufRead, BufReader};
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;

    let mut command = Command::new("wsl");
    command.args(["-d", &distro, "--", "bash", "-c", &cmd])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);
    let mut child = command.spawn()
        .map_err(|e| format!("Failed to spawn: {}", e))?;

    let pid = child.id();
    *state.install_cancel.lock().unwrap() = Some(pid);

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let win1 = window.clone();
    let win2 = window.clone();

    if let Some(out) = stdout {
        let reader = BufReader::new(out);
        std::thread::spawn(move || {
            for line in reader.lines() {
                if let Ok(l) = line { let _ = win1.emit("install-progress", &l); }
            }
        });
    }
    if let Some(err) = stderr {
        let reader = BufReader::new(err);
        std::thread::spawn(move || {
            for line in reader.lines() {
                if let Ok(l) = line { let _ = win2.emit("install-progress", &l); }
            }
        });
    }

    let status = child.wait().map_err(|e| format!("Wait failed: {}", e))?;
    *state.install_cancel.lock().unwrap() = None;

    if status.success() {
        Ok(true)
    } else {
        let _ = run_wsl(&distro, &format!("rm -rf {}/versions/{}", phpenv_root, version), false);
        Err(format!("Install failed with code {:?}", status.code()))
    }
}

#[tauri::command]
pub fn cancel_install(state: State<AppState>) -> bool {
    let pid = state.install_cancel.lock().unwrap().take();
    if let Some(pid) = pid {
        #[cfg(target_os = "windows")]
        {
            let mut cmd = std::process::Command::new("taskkill");
            cmd.args(["/F", "/T", "/PID", &pid.to_string()]);
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
            let _ = cmd.output();
        }
        true
    } else { false }
}

#[tauri::command]
pub fn uninstall_version(state: State<AppState>, version: String) -> Result<String, String> {
    let (distro, phpenv_root) = settings::get_distro_and_phpenv(&state)?;
    run_wsl(&distro, &format!("rm -rf {}/versions/{}", phpenv_root, version), false)
}

#[tauri::command]
pub fn get_extensions(state: State<AppState>, version: String) -> Result<Vec<String>, String> {
    let (distro, phpenv_root) = settings::get_distro_and_phpenv(&state)?;
    let php_bin = format!("{}/versions/{}/bin/php", phpenv_root, version);
    let output = run_wsl(&distro, &format!("'{}' -m 2>/dev/null", php_bin), false).unwrap_or_default();
    Ok(output.lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && !l.starts_with('[') && !l.starts_with("Zend"))
        .collect())
}

#[tauri::command]
pub fn open_config(state: State<AppState>, version: String, config_type: String) -> Result<bool, String> {
    let (distro, phpenv_root) = settings::get_distro_and_phpenv(&state)?;
    let base = format!("{}/versions/{}", phpenv_root, version);
    let file = match config_type.as_str() {
        "fpm" => format!("{}/etc/php-fpm.conf", base),
        "www" => format!("{}/etc/php-fpm.d/www.conf", base),
        _ => {
            let ini = format!("{}/etc/php.ini", base);
            let check = run_wsl(&distro, &format!("[ -f '{}' ] && echo yes || echo no", ini), false).unwrap_or_default();
            if check.trim() == "yes" { ini } else { format!("{}/lib/php.ini", base) }
        }
    };
    let unc_path = format!("\\\\wsl$\\{}{}",distro, file.replace('/', "\\"));
    std::process::Command::new("cmd").args(["/c", "start", "", &unc_path]).spawn().map_err(|e| e.to_string())?;
    Ok(true)
}
