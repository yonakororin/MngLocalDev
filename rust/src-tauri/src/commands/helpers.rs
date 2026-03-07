use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Run a WSL command and return stdout
pub fn run_wsl(distro: &str, cmd: &str, as_root: bool) -> Result<String, String> {
    let escaped_cmd = cmd.replace('"', "\\\"");
    let mut args = vec!["-d", distro];
    if as_root {
        args.push("-u");
        args.push("root");
    }
    args.push("--");
    args.push("bash");
    args.push("-c");

    let mut command = Command::new("wsl");
    command.args(&args).arg(&escaped_cmd);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let output = command.output()
        .map_err(|e| format!("Failed to execute WSL command: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Err(format!("{}{}", stderr, if stdout.is_empty() { String::new() } else { format!("\n{}", stdout) }))
    }
}

/// Run a docker command and return stdout
pub fn run_docker(args: &[&str]) -> Result<String, String> {
    let mut command = Command::new("docker");
    command.args(args);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let output = command.output()
        .map_err(|e| format!("Failed to execute docker: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

/// Run a docker command with stdin
pub fn run_docker_with_stdin(args: &[&str], stdin_data: &str) -> Result<String, String> {
    use std::io::Write;
    use std::process::Stdio;

    let mut command = Command::new("docker");
    command.args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let mut child = command.spawn()
        .map_err(|e| format!("Failed to spawn docker: {}", e))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(stdin_data.as_bytes()).map_err(|e| format!("stdin write failed: {}", e))?;
    }

    let output = child.wait_with_output().map_err(|e| format!("wait failed: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

/// Convert Windows path to WSL path
pub fn win_to_wsl_path(win_path: &str) -> String {
    let re = regex_lite_drive(win_path);
    re.replace('\\', "/").to_string()
}

fn regex_lite_drive(path: &str) -> String {
    if path.len() >= 2 && path.as_bytes()[1] == b':' {
        let drive = (path.as_bytes()[0] as char).to_lowercase().to_string();
        format!("/mnt/{}{}", drive, &path[2..])
    } else {
        path.to_string()
    }
}
