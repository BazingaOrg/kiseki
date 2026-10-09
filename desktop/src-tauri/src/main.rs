use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};

fn runtime_root(app: &tauri::App) -> PathBuf {
    if let Ok(root) = std::env::var("KISEKI_RUNTIME_ROOT") {
        if !root.is_empty() {
            return PathBuf::from(root);
        }
    }
    app.path().resource_dir().expect("安装包资源目录").join("runtime")
}

fn node_binary(runtime: &std::path::Path) -> PathBuf {
    runtime.join("bin").join(if cfg!(windows) { "node.exe" } else { "node" })
}

fn stop_child(child: &mut Child) {
    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &child.id().to_string()])
            .status();
        let deadline = std::time::Instant::now() + Duration::from_secs(8);
        while std::time::Instant::now() < deadline {
            if child.try_wait().ok().flatten().is_some() {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn show_failure(message: &str) {
    eprintln!("kiseki: {message}");
    let safe = message.replace(['"', '\n', '\r'], " ");
    #[cfg(target_os = "macos")]
    {
        let script = format!("display alert \"kiseki\" message \"{safe}\"");
        let _ = Command::new("osascript").args(["-e", &script]).status();
    }
    #[cfg(windows)]
    {
        let _ = Command::new("powershell")
            .args(["-NoProfile", "-Command", &format!("Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('{safe}','kiseki')")])
            .status();
    }
}

fn start_server(runtime: PathBuf) -> Result<(Child, String), String> {
    let node = node_binary(&runtime);
    if !node.is_file() {
        return Err(format!("找不到 {}", node.display()));
    }
    let mut child = Command::new(&node)
        .arg(runtime.join("cli").join("kiseki.mjs"))
        .arg("web")
        .current_dir(&runtime)
        .env("KISEKI_RUNTIME_ROOT", &runtime)
        .env("KISEKI_DESKTOP", "1")
        .env("KISEKI_OPEN_BROWSER", "0")
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| error.to_string())?;
    let stdout = child.stdout.take().ok_or_else(|| "界面服务没有输出".to_string())?;
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let line = line.unwrap_or_default();
            if let Some(url) = line.strip_prefix("KISEKI_READY ") {
                let _ = sender.send(url.trim().to_string());
            }
        }
    });
    match receiver.recv_timeout(Duration::from_secs(90)) {
        Ok(url) => Ok((child, url)),
        Err(_) => {
            stop_child(&mut child);
            Err("界面服务没有在 90 秒内准备好".to_string())
        }
    }
}

fn main() {
    let server: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
    let server_for_exit = Arc::clone(&server);
    tauri::Builder::default()
        .setup(move |app| {
            let runtime = runtime_root(app);
            let handle = app.handle().clone();
            let server = Arc::clone(&server);
            std::thread::spawn(move || {
                let (child, url) = match start_server(runtime) {
                    Ok(ready) => ready,
                    Err(message) => {
                        show_failure(&message);
                        handle.exit(1);
                        return;
                    }
                };
                *server.lock().expect("server") = Some(child);
                let parsed = Url::parse(&url).unwrap_or_else(|_| Url::parse("http://127.0.0.1:3000").expect("url"));
                let _ = WebviewWindowBuilder::new(&handle, "main", WebviewUrl::External(parsed))
                    .title("kiseki")
                    .inner_size(1280.0, 800.0)
                    .build();
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("kiseki 窗口没有启动")
        .run(move |_app, event| {
            if matches!(event, RunEvent::Exit) {
                if let Some(mut child) = server_for_exit.lock().expect("server").take() {
                    stop_child(&mut child);
                }
            }
        });
}
