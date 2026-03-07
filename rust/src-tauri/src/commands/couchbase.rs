#[tauri::command]
pub fn couchbase_get_buckets(user: String, password: String) -> Vec<String> {
    let mut cmd = std::process::Command::new("docker");
    cmd.args(["exec", "myapp_couchbase", "curl", "-s", "-u", &format!("{}:{}", user, password), "http://127.0.0.1:8091/pools/default/buckets"]);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let output = cmd.output();

    match output {
        Ok(o) if o.status.success() => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(&stdout) {
                arr.iter().filter_map(|b| b["name"].as_str().map(|s| s.to_string())).collect()
            } else { vec![] }
        }
        _ => vec![],
    }
}

#[tauri::command]
pub fn couchbase_upload_document(bucket: String, user: String, password: String, file_path: String, key: Option<String>) -> serde_json::Value {
    if !std::path::Path::new(&file_path).exists() {
        return serde_json::json!({"success": false, "error": "File not found"});
    }
    let content = match std::fs::read_to_string(&file_path) {
        Ok(c) => c,
        Err(e) => return serde_json::json!({"success": false, "error": e.to_string()}),
    };
    let file_name = std::path::Path::new(&file_path).file_name().unwrap_or_default().to_string_lossy().to_string();
    let doc_key = key.filter(|k| !k.is_empty()).unwrap_or(file_name);
    let url = format!("http://127.0.0.1:8091/pools/default/buckets/{}/docs/{}", bucket, doc_key);
    let data_arg = format!("value={}", content);

    let mut cmd = std::process::Command::new("docker");
    cmd.args(["exec", "-i", "myapp_couchbase", "curl", "-X", "POST", "-u", &format!("{}:{}", user, password), &url, "--data-urlencode", &data_arg]);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let output = cmd.output();

    match output {
        Ok(o) if o.status.success() => serde_json::json!({"success": true}),
        Ok(o) => serde_json::json!({"success": false, "error": String::from_utf8_lossy(&o.stderr).to_string()}),
        Err(e) => serde_json::json!({"success": false, "error": e.to_string()}),
    }
}
