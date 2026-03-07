mod commands;

use std::sync::Mutex;
use commands::settings::AppSettings;

pub struct AppState {
    pub settings: Mutex<AppSettings>,
    pub config_cache: Mutex<Option<serde_json::Value>>,
    pub install_cancel: Mutex<Option<u32>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState {
        settings: Mutex::new(AppSettings::default()),
        config_cache: Mutex::new(None),
        install_cancel: Mutex::new(None),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_paths,
            commands::settings::update_paths,
            commands::settings::get_config,
            commands::settings::get_assignments,
            commands::settings::save_assignments,
            commands::settings::init_settings,
            commands::phpenv::list_versions,
            commands::phpenv::list_installable,
            commands::phpenv::install_version,
            commands::phpenv::cancel_install,
            commands::phpenv::uninstall_version,
            commands::phpenv::get_extensions,
            commands::phpenv::open_config,
            commands::fpm::get_status,
            commands::fpm::get_version_status,
            commands::fpm::start_fpm,
            commands::fpm::stop_fpm,
            commands::docker::docker_check,
            commands::docker::docker_list,
            commands::docker::docker_action,
            commands::docker::docker_is_installed,
            commands::docker::docker_launch,
            commands::docker::docker_setup,
            commands::docker::docker_sync,
            commands::nginx::nginx_reload,
            commands::nginx::nginx_list_configs,
            commands::nginx::nginx_read_config,
            commands::nginx::nginx_save_config,
            commands::database::db_list,
            commands::database::db_get_tables,
            commands::database::db_get_table_data,
            commands::database::db_query,
            commands::database::db_import,
            commands::database::db_import_data,
            commands::couchbase::couchbase_get_buckets,
            commands::couchbase::couchbase_upload_document,
            commands::cron::cron_get_data,
            commands::cron::cron_save_job,
            commands::cron::cron_delete_job,
            commands::cron::cron_save_env,
            commands::cron::cron_delete_env,
            commands::cron::cron_save_wrapper,
            commands::cron::cron_delete_wrapper,
            commands::cron::cron_save_settings,
            commands::cron::cron_apply,
            commands::dialog::open_file_dialog,
            commands::dialog::open_directory_dialog,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
