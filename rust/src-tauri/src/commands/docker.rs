use tauri::State;
use crate::AppState;
use super::helpers::run_docker;
use super::settings;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[tauri::command]
pub fn docker_check() -> bool {
    run_docker(&["ps"]).is_ok()
}

#[tauri::command]
pub fn docker_list() -> Vec<serde_json::Value> {
    match run_docker(&["ps", "-a", "--format", "{{json .}}"]) {
        Ok(output) => {
            output.lines()
                .filter(|l| !l.is_empty())
                .filter_map(|l| serde_json::from_str(l).ok())
                .collect()
        }
        Err(_) => vec![],
    }
}

#[tauri::command]
pub fn docker_action(action: String, id: String) -> Result<bool, String> {
    let mut args: Vec<&str> = vec![&action];
    for part in id.split_whitespace() {
        args.push(part);
    }
    run_docker(&args)?;
    Ok(true)
}

#[tauri::command]
pub fn docker_is_installed() -> bool {
    run_docker(&["-v"]).is_ok()
}

#[tauri::command]
pub fn docker_launch() -> bool {
    let path = r"C:\Program Files\Docker\Docker\Docker Desktop.exe";
    if std::path::Path::new(path).exists() {
        let mut cmd = std::process::Command::new(path);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);
        let _ = cmd.spawn();
        true
    } else { false }
}

#[tauri::command]
pub fn docker_setup() -> bool {
    let _ = std::process::Command::new("cmd")
        .args(["/c", "start", "https://www.docker.com/products/docker-desktop/"])
        .spawn();
    true
}

#[tauri::command]
pub fn docker_sync(state: State<AppState>, assignments: serde_json::Value, skip_if_running: Option<bool>) -> Result<String, String> {
    let cfg = settings::get_full_config(&state)?;
    let base_dir = cfg["project_root"].as_str().unwrap_or("").to_string();
    if base_dir.is_empty() { return Err("project_root not set".into()); }

    let _ = std::fs::create_dir_all(&base_dir);
    let compose_file = format!("{}/docker-compose.yml", base_dir.replace('\\', "/"));
    let conf_dir = format!("{}/conf.d", base_dir.replace('\\', "/"));

    if skip_if_running.unwrap_or(false) {
        if let Ok(out) = run_docker(&["ps"]) {
            if out.contains("myapp_nginx") { return Ok("Skipped: Container already running".into()); }
        }
    }

    let mut web_port = "80".to_string();
    if let Some(p) = cfg["web_port"].as_u64() { web_port = p.to_string(); }

    let arr = assignments.as_array().cloned().unwrap_or_default();
    let mut volumes = Vec::new();
    let mut locations = String::new();
    let mut exposed_ports = std::collections::HashSet::new();
    exposed_ports.insert(web_port.clone());

    for (idx, a) in arr.iter().enumerate() {
        let mapping_id = format!("app_{}", idx);
        let mut host_path = a["doc_root"].as_str().or(a["wsl_path"].as_str()).or(a["win_path"].as_str()).unwrap_or("").to_string();
        if host_path.starts_with("/mnt/") {
            if let Some(caps) = parse_mnt_path(&host_path) {
                host_path = format!("{}:/{}", caps.0.to_uppercase(), caps.1);
            }
        }
        if !host_path.is_empty() {
            volumes.push(format!("      - \"{}:/var/www/html/{}\"", host_path, mapping_id));
        }
        let port = a["port"].as_u64().unwrap_or(0);
        let container_path = format!("/var/www/html/{}", mapping_id);
        let raw_url = a["url_path"].as_str().unwrap_or("").replace("http://","").replace("https://","");
        let mut path_part = if !raw_url.starts_with('/') {
            if let Some(p) = raw_url.find('/') { raw_url[p..].to_string() } else { "/".to_string() }
        } else { raw_url.clone() };
        if path_part == "localhost" { path_part = "/".to_string(); }
        if !path_part.starts_with('/') { path_part = format!("/{}", path_part); }

        let directive = if path_part == "/" {
            format!("root {};", container_path)
        } else {
            format!("alias {}/;", container_path)
        };

        locations.push_str(&format!(r#"
    location {} {{
        {}
        index index.php index.html;
        try_files $uri $uri/ @{}_rewrites;
        location ~ \.php$ {{
            fastcgi_pass host.docker.internal:{};
            fastcgi_index index.php;
            include fastcgi_params;
            fastcgi_param SCRIPT_FILENAME $request_filename;
            fastcgi_param PATH_INFO $fastcgi_path_info;
        }}
    }}
    location @{}_rewrites {{
        rewrite ^{}/(.*)$ {}/index.php?/$1 last;
    }}
"#, path_part, directive, mapping_id, port, mapping_id, path_part, path_part));
    }

    let _ = std::fs::create_dir_all(&conf_dir);
    let nginx_config = format!(r#"server {{
    listen {} default_server;
    server_name _;
    root /var/www/html;
    index index.php index.html;
    location = /health {{ return 200 'OK'; }}
{}
}}
"#, web_port, locations);
    std::fs::write(format!("{}/default.conf", conf_dir), &nginx_config).map_err(|e| e.to_string())?;

    let ports_section: String = exposed_ports.iter().map(|p| format!("      - \"{}:{}\"", p, p)).collect::<Vec<_>>().join("\n");
    let volumes_section = volumes.join("\n");
    let compose = format!(r#"services:
  nginx:
    image: nginx:latest
    container_name: myapp_nginx
    ports:
{}
    volumes:
      - ./conf.d:/etc/nginx/conf.d
{}
    networks:
      - app_net
    extra_hosts:
      - "host.docker.internal:host-gateway"
  mysql:
    image: mysql:8.0
    container_name: myapp_db
    environment:
      MYSQL_ROOT_PASSWORD: rootpassword
      MYSQL_DATABASE: myapp_db
    ports:
      - "3306:3306"
    volumes:
      - ./mysql_data:/var/lib/mysql
    networks:
      - app_net
  couchbase:
    image: couchbase:latest
    container_name: myapp_couchbase
    ports:
      - "8091-8096:8091-8096"
      - "11210-11211:11210-11211"
    volumes:
      - ./couchbase_data:/opt/couchbase/var
    networks:
      - app_net
networks:
  app_net:
    driver: bridge
"#, ports_section, volumes_section);

    let compose_path = std::path::Path::new(&compose_file);
    if let Some(parent) = compose_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&compose_file, &compose).map_err(|e| e.to_string())?;

    // docker-compose up -d
    let mut cmd1 = std::process::Command::new("docker-compose");
    cmd1.args(["up", "-d"]).current_dir(&base_dir);
    #[cfg(target_os = "windows")]
    cmd1.creation_flags(0x08000000);
    let result = cmd1.output();

    match result {
        Ok(o) if o.status.success() => {
            let _ = run_docker(&["exec", "myapp_nginx", "nginx", "-s", "reload"]);
            Ok(String::from_utf8_lossy(&o.stdout).to_string())
        }
        _ => {
            let mut cmd2 = std::process::Command::new("docker");
            cmd2.args(["compose", "up", "-d"]).current_dir(&base_dir);
            #[cfg(target_os = "windows")]
            cmd2.creation_flags(0x08000000);
            let result2 = cmd2.output();
            match result2 {
                Ok(o) if o.status.success() => {
                    let _ = run_docker(&["exec", "myapp_nginx", "nginx", "-s", "reload"]);
                    Ok(String::from_utf8_lossy(&o.stdout).to_string())
                }
                Ok(o) => Err(String::from_utf8_lossy(&o.stderr).to_string()),
                Err(e) => Err(e.to_string()),
            }
        }
    }
}

fn parse_mnt_path(path: &str) -> Option<(String, String)> {
    if path.starts_with("/mnt/") && path.len() > 6 {
        let drive = path.chars().nth(5)?.to_string();
        let rest = &path[6..];
        Some((drive, rest.to_string()))
    } else { None }
}
