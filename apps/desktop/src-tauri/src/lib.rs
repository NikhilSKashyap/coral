//! Coral desktop shell.
//!
//! The shell deliberately holds no credential and runs no model. Its one job
//! beyond hosting the interface is to tell the app which coding agents the
//! person already has installed, so the workspace can say honestly whether a
//! coach is available before anything is spent.

use std::path::PathBuf;
use std::process::Command;

use serde::Serialize;

#[derive(Serialize)]
pub struct AgentStatus {
    id: String,
    label: String,
    available: bool,
    path: Option<String>,
    version: Option<String>,
}

/// Resolve a binary on PATH without going through a shell.
fn which(bin: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find_map(|dir| {
        let candidate = dir.join(bin);
        if candidate.is_file() {
            Some(candidate)
        } else {
            None
        }
    })
}

fn version_of(bin: &Path) -> Option<String> {
    let output = Command::new(bin).arg("--version").output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text.lines().next().unwrap_or_default().to_string())
    }
}

use std::path::Path;

fn status(id: &str, label: &str, bin: &str) -> AgentStatus {
    match which(bin) {
        Some(path) => AgentStatus {
            id: id.to_string(),
            label: label.to_string(),
            version: version_of(&path),
            path: Some(path.to_string_lossy().to_string()),
            available: true,
        },
        None => AgentStatus {
            id: id.to_string(),
            label: label.to_string(),
            available: false,
            path: None,
            version: None,
        },
    }
}

/// Which agents this machine can drive. Reads nothing but PATH.
#[tauri::command]
fn detect_agents() -> Vec<AgentStatus> {
    vec![
        status("claude-code", "Claude Code", "claude"),
        status("codex", "Codex", "codex"),
        AgentStatus {
            id: "static".into(),
            label: "Built-in ladder".into(),
            available: true,
            path: None,
            version: None,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .invoke_handler(tauri::generate_handler![detect_agents])
        .run(tauri::generate_context!())
        .expect("error while running Coral");
}
