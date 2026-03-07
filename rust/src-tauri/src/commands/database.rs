use super::helpers::{run_docker, run_docker_with_stdin};

fn find_db_container() -> Result<String, String> {
    let output = run_docker(&["ps", "--format", "{{.Names}}"])?;
    let containers: Vec<&str> = output.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
    containers.iter().find(|c| **c == "myapp_db")
        .or_else(|| containers.iter().find(|c| c.contains("db")))
        .map(|c| c.to_string())
        .ok_or_else(|| format!("MySQL container not found. Running: {}", containers.join(", ")))
}

#[tauri::command]
pub fn db_list() -> Result<Vec<String>, String> {
    let container = find_db_container()?;
    let output = run_docker(&["exec", &container, "mysql", "-uroot", "-prootpassword", "-N", "-e", "SHOW DATABASES;"])?;
    let excluded = ["information_schema", "mysql", "performance_schema", "sys"];
    Ok(output.lines().map(|s| s.trim().to_string()).filter(|s| !s.is_empty() && !excluded.contains(&s.as_str())).collect())
}

#[tauri::command]
pub fn db_get_tables(database: String) -> Result<Vec<serde_json::Value>, String> {
    let safe_db = database.chars().filter(|c| c.is_alphanumeric() || *c == '_').collect::<String>();
    let query = format!("SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH + INDEX_LENGTH FROM information_schema.TABLES WHERE TABLE_SCHEMA = '{}'", safe_db);
    let output = run_docker(&["exec", "myapp_db", "mysql", "-uroot", "-prootpassword", "-N", "-e", &query])?;
    Ok(output.lines().filter(|l| !l.trim().is_empty()).map(|line| {
        let parts: Vec<&str> = line.split('\t').collect();
        serde_json::json!({
            "name": parts.first().unwrap_or(&""),
            "rows": parts.get(1).unwrap_or(&"0").parse::<i64>().unwrap_or(0),
            "size": parts.get(2).unwrap_or(&"0").parse::<i64>().unwrap_or(0),
        })
    }).collect())
}

#[tauri::command]
pub fn db_get_table_data(database: String, table: String) -> Result<serde_json::Value, String> {
    let query = format!("SELECT * FROM `{}`.`{}` LIMIT 100", database, table);
    let output = run_docker(&["exec", "myapp_db", "mysql", "-uroot", "-prootpassword", "--default-character-set=utf8mb4", "-B", "-e", &query])?;
    let lines: Vec<&str> = output.lines().collect();
    if lines.is_empty() { return Ok(serde_json::json!({"columns": [], "rows": []})); }
    let columns: Vec<String> = lines[0].split('\t').map(|c| c.trim().to_string()).collect();
    let rows: Vec<serde_json::Value> = lines[1..].iter().map(|line| {
        let vals: Vec<&str> = line.split('\t').collect();
        let mut row = serde_json::Map::new();
        for (i, col) in columns.iter().enumerate() {
            row.insert(col.clone(), serde_json::Value::String(vals.get(i).unwrap_or(&"").to_string()));
        }
        serde_json::Value::Object(row)
    }).collect();
    Ok(serde_json::json!({"columns": columns, "rows": rows}))
}

#[tauri::command]
pub fn db_query(database: String, sql: String) -> Result<String, String> {
    run_docker_with_stdin(&["exec", "-i", "myapp_db", "mysql", "-uroot", "-prootpassword", "-D", &database], &sql)
}

#[tauri::command]
pub fn db_import(database: String, file_path: String) -> Result<bool, String> {
    let content = std::fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    run_docker_with_stdin(&["exec", "-i", "myapp_db", "mysql", "-uroot", "-prootpassword", &database], &content)?;
    Ok(true)
}

#[tauri::command]
pub fn db_import_data(database: String, table: String, file_path: String, import_type: String) -> Result<bool, String> {
    let content = std::fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let delimiter = if import_type == "tsv" { '\t' } else { ',' };
    let mut sql = String::from("SET NAMES utf8mb4;\n");
    let mut buffer = Vec::new();

    for line in content.lines() {
        if line.trim().is_empty() { continue; }
        let cols: Vec<String> = line.split(delimiter).map(|v| {
            let v = v.trim();
            if v == "NULL" { "NULL".to_string() }
            else {
                let v = v.trim_matches('"').trim_matches('\'');
                format!("'{}'", v.replace('\\', "\\\\").replace('\'', "''"))
            }
        }).collect();
        buffer.push(format!("({})", cols.join(",")));
        if buffer.len() >= 500 {
            sql.push_str(&format!("INSERT INTO `{}` VALUES {};\n", table, buffer.join(",")));
            buffer.clear();
        }
    }
    if !buffer.is_empty() {
        sql.push_str(&format!("INSERT INTO `{}` VALUES {};\n", table, buffer.join(",")));
    }
    run_docker_with_stdin(&["exec", "-i", "myapp_db", "mysql", "-uroot", "-prootpassword", "-D", &database, "--default-character-set=utf8mb4"], &sql)?;
    Ok(true)
}
