use tauri::State;
use crate::AppState;
use super::settings;
use super::helpers::run_wsl;

#[tauri::command]
pub fn get_status(state: State<AppState>, port: u16) -> Result<bool, String> {
    let (distro, _) = settings::get_distro_and_phpenv(&state)?;
    let output = run_wsl(&distro, &format!("ss -tlnp 2>/dev/null | grep ':{} '", port), false);
    Ok(output.map_or(false, |o| !o.trim().is_empty()))
}

#[tauri::command]
pub fn get_version_status(state: State<AppState>, version: String) -> Result<bool, String> {
    let (distro, phpenv_root) = settings::get_distro_and_phpenv(&state)?;
    let pid_file = format!("{}/versions/{}/var/run/php-fpm.pid", phpenv_root, version);
    let cmd = format!("if [ -f '{}' ]; then kill -0 $(cat '{}') 2>/dev/null && echo yes || echo no; else echo no; fi", pid_file, pid_file);
    let output = run_wsl(&distro, &cmd, false).unwrap_or_else(|_| "no".into());
    Ok(output.trim() == "yes")
}

#[tauri::command]
pub fn start_fpm(state: State<AppState>, version: String, port: u16) -> Result<String, String> {
    let (distro, phpenv_root) = settings::get_distro_and_phpenv(&state)?;
    let base = format!("{}/versions/{}", phpenv_root, version);
    let sbin = format!("{}/sbin/php-fpm", base);
    let fpm_conf = format!("{}/etc/php-fpm.conf", base);
    let www_conf = format!("{}/etc/php-fpm.d/www.conf", base);
    let pid_dir = format!("{}/var/run", base);
    let expected = format!("listen = 0.0.0.0:{}", port);
    let sed_cmd = format!("sed -i 's|^;*\\\\s*listen\\\\s*=.*|{}|' '{}'", expected, www_conf);
    let cmd = format!(
        "if [ -x '{}' ]; then {}; mkdir -p '{}'; {} --fpm-config '{}' -D > /dev/null 2>&1; sleep 0.5; echo ok; else exit 1; fi",
        sbin, sed_cmd, pid_dir, sbin, fpm_conf
    );
    run_wsl(&distro, &cmd, true)
}

#[tauri::command]
pub fn stop_fpm(state: State<AppState>, version: String, port: u16) -> Result<String, String> {
    let (distro, phpenv_root) = settings::get_distro_and_phpenv(&state)?;
    let base = format!("{}/versions/{}", phpenv_root, version);
    let pid_file = format!("{}/var/run/php-fpm.pid", base);
    let cmd = format!("if [ -f '{}' ]; then kill $(cat '{}') 2>/dev/null || true; fi; fuser -k {}/tcp 2>/dev/null || true", pid_file, pid_file, port);
    run_wsl(&distro, &cmd, true)
}
