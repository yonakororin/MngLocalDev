use tauri::State;
use crate::AppState;
use super::settings;
use super::helpers::{run_wsl, win_to_wsl_path};

fn run_cron_query(distro: &str, db_path: &str, sql: &str) -> Result<Vec<serde_json::Value>, String> {
    let output = run_wsl(distro, &format!("sqlite3 -json {} \"{}\"", db_path, sql), false);
    match output {
        Ok(o) if !o.trim().is_empty() => {
            serde_json::from_str(&o).map_err(|e| e.to_string())
        }
        Ok(_) => Ok(vec![]),
        Err(e) => {
            if sql.trim().to_uppercase().starts_with("SELECT") { Ok(vec![]) } else { Err(e) }
        }
    }
}

fn run_cron_exec(distro: &str, db_path: &str, sql: &str) -> Result<(), String> {
    run_wsl(distro, &format!("sqlite3 {} \"{}\"", db_path, sql), false)?;
    Ok(())
}

fn get_cron_ctx(state: &State<AppState>) -> Result<(String, String), String> {
    let (distro, _) = settings::get_distro_and_phpenv(state)?;
    let settings = state.settings.lock().unwrap();
    let db_path = win_to_wsl_path(&settings.cron_db_path);
    Ok((distro, db_path))
}

#[tauri::command]
pub fn cron_get_data(state: State<AppState>) -> Result<serde_json::Value, String> {
    let (distro, db_path) = get_cron_ctx(&state)?;
    let jobs = run_cron_query(&distro, &db_path, "SELECT j.*, s.start_time, s.end_time, s.exit_code FROM jobs j LEFT JOIN job_status s ON j.id = s.job_id ORDER BY j.id DESC")?;
    let env_vars = run_cron_query(&distro, &db_path, "SELECT * FROM environment_variables ORDER BY name ASC")?;
    let wrappers = run_cron_query(&distro, &db_path, "SELECT * FROM wrappers ORDER BY name ASC")?;
    let settings_rows = run_cron_query(&distro, &db_path, "SELECT * FROM settings")?;
    let cron_user = settings_rows.iter().find(|s| s["name"].as_str() == Some("cron_user")).and_then(|s| s["value"].as_str()).unwrap_or("root").to_string();
    Ok(serde_json::json!({"jobs": jobs, "envVars": env_vars, "wrappers": wrappers, "cronUser": cron_user}))
}

#[tauri::command]
pub fn cron_save_job(state: State<AppState>, job: serde_json::Value) -> Result<bool, String> {
    let (distro, db_path) = get_cron_ctx(&state)?;
    let cmd = job["command"].as_str().unwrap_or("").replace('\'', "''");
    let sched = job["schedule"].as_str().unwrap_or("").replace('\'', "''");
    let desc = job["description"].as_str().unwrap_or("").replace('\'', "''");
    if let Some(id) = job["id"].as_i64() {
        run_cron_exec(&distro, &db_path, &format!("UPDATE jobs SET command='{}', schedule='{}', description='{}' WHERE id={}", cmd, sched, desc, id))?;
    } else {
        run_cron_exec(&distro, &db_path, &format!("INSERT INTO jobs (command, schedule, description) VALUES ('{}','{}','{}')", cmd, sched, desc))?;
    }
    Ok(true)
}

#[tauri::command]
pub fn cron_delete_job(state: State<AppState>, id: i64) -> Result<bool, String> {
    let (distro, db_path) = get_cron_ctx(&state)?;
    run_cron_exec(&distro, &db_path, &format!("DELETE FROM jobs WHERE id={}", id))?;
    Ok(true)
}

#[tauri::command]
pub fn cron_save_env(state: State<AppState>, env: serde_json::Value) -> Result<bool, String> {
    let (distro, db_path) = get_cron_ctx(&state)?;
    let name = env["name"].as_str().unwrap_or("").replace('\'', "''");
    let value = env["value"].as_str().unwrap_or("").replace('\'', "''");
    let desc = env["description"].as_str().unwrap_or("").replace('\'', "''");
    run_cron_exec(&distro, &db_path, &format!("INSERT INTO environment_variables (name, value, description) VALUES ('{}','{}','{}') ON CONFLICT(name) DO UPDATE SET value=excluded.value, description=excluded.description", name, value, desc))?;
    Ok(true)
}

#[tauri::command]
pub fn cron_delete_env(state: State<AppState>, id: i64) -> Result<bool, String> {
    let (distro, db_path) = get_cron_ctx(&state)?;
    run_cron_exec(&distro, &db_path, &format!("DELETE FROM environment_variables WHERE id={}", id))?;
    Ok(true)
}

#[tauri::command]
pub fn cron_save_wrapper(state: State<AppState>, wrapper: serde_json::Value) -> Result<bool, String> {
    let (distro, db_path) = get_cron_ctx(&state)?;
    let name = wrapper["name"].as_str().unwrap_or("").replace('\'', "''");
    let value = wrapper["value"].as_str().unwrap_or("").replace('\'', "''");
    let desc = wrapper["description"].as_str().unwrap_or("").replace('\'', "''");
    run_cron_exec(&distro, &db_path, &format!("INSERT INTO wrappers (name, value, description) VALUES ('{}','{}','{}') ON CONFLICT(name) DO UPDATE SET value=excluded.value, description=excluded.description", name, value, desc))?;
    Ok(true)
}

#[tauri::command]
pub fn cron_delete_wrapper(state: State<AppState>, id: i64) -> Result<bool, String> {
    let (distro, db_path) = get_cron_ctx(&state)?;
    run_cron_exec(&distro, &db_path, &format!("DELETE FROM wrappers WHERE id={}", id))?;
    Ok(true)
}

#[tauri::command]
pub fn cron_save_settings(state: State<AppState>, cron_user: String) -> Result<bool, String> {
    let (distro, db_path) = get_cron_ctx(&state)?;
    let user = cron_user.replace('\'', "''");
    run_cron_exec(&distro, &db_path, &format!("INSERT INTO settings (name, value) VALUES ('cron_user','{}') ON CONFLICT(name) DO UPDATE SET value=excluded.value", user))?;
    Ok(true)
}

#[tauri::command]
pub fn cron_apply(state: State<AppState>) -> Result<serde_json::Value, String> {
    let (distro, db_path) = get_cron_ctx(&state)?;
    let settings = state.settings.lock().unwrap();
    let cron_dir = std::path::Path::new(&settings.cron_db_path).parent().unwrap().to_string_lossy().to_string();
    let cron_dir_wsl = win_to_wsl_path(&cron_dir);

    // Generate crontab content
    let jobs = run_cron_query(&distro, &db_path, "SELECT id, schedule, command FROM jobs ORDER BY id ASC")?;
    let env_vars = run_cron_query(&distro, &db_path, "SELECT name, value FROM environment_variables ORDER BY name ASC")?;
    let wrappers = run_cron_query(&distro, &db_path, "SELECT name, value FROM wrappers")?;
    let settings_rows = run_cron_query(&distro, &db_path, "SELECT value FROM settings WHERE name = 'cron_user'")?;
    let cron_user = settings_rows.first().and_then(|s| s["value"].as_str()).unwrap_or("root");

    let mut lines = vec!["# Generated by mnglocaldev".to_string(), "SHELL=/bin/bash".to_string(), "PATH=/sbin:/bin:/usr/sbin:/usr/bin".to_string()];
    for env in &env_vars {
        lines.push(format!("{}=\"{}\"", env["name"].as_str().unwrap_or(""), env["value"].as_str().unwrap_or("")));
    }
    let runner_script = format!("{}/cron_runner.sh", cron_dir_wsl);
    for job in &jobs {
        let mut cmd = job["command"].as_str().unwrap_or("").to_string();
        for wrap in &wrappers {
            let target = format!("${{{}}}", wrap["name"].as_str().unwrap_or(""));
            cmd = cmd.replace(&target, wrap["value"].as_str().unwrap_or(""));
        }
        let sched = job["schedule"].as_str().unwrap_or("");
        let id = job["id"].as_i64().unwrap_or(0);
        if cmd.trim().starts_with('#') {
            lines.push(format!("{} {} {}", sched, cron_user, cmd));
        } else {
            let escaped = cmd.replace('\'', "'\\''");
            lines.push(format!("{} {} /bin/bash {} {} '{}'", sched, cron_user, runner_script, id, escaped));
        }
    }
    let content = lines.join("\n") + "\n";
    let crontab_path = format!("{}/crontab.txt", cron_dir);
    std::fs::write(&crontab_path, content.replace("\r\n", "\n")).map_err(|e| e.to_string())?;

    let deploy_script = format!("{}/deploy_cron.sh", cron_dir_wsl);
    let output = run_wsl(&distro, &format!("bash {}", deploy_script), true)?;
    Ok(serde_json::json!({"success": true, "output": output}))
}
