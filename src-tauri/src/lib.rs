use std::{
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

static SAVE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn decode_utf8(bytes: Vec<u8>) -> Result<String, String> {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
    String::from_utf8(bytes.to_vec()).map_err(|_| {
        "UTF-8ではないファイルは開けません。UTF-8に変換してから再度お試しください。".to_string()
    })
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let bytes = fs::read(Path::new(&path))
        .map_err(|error| format!("ファイルを読み込めませんでした: {error}"))?;
    decode_utf8(bytes)
}

fn resolve_startup_file_path<I>(arguments: I) -> Option<PathBuf>
where
    I: IntoIterator<Item = OsString>,
{
    let path = PathBuf::from(arguments.into_iter().next()?);
    let absolute_path = if path.is_absolute() {
        path
    } else {
        std::env::current_dir().ok()?.join(path)
    };

    absolute_path.is_file().then_some(absolute_path)
}

#[tauri::command]
fn startup_file_path() -> Option<String> {
    resolve_startup_file_path(std::env::args_os().skip(1))
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    atomic_write(Path::new(&path), content.as_bytes())
        .map_err(|error| format!("ファイルを保存できませんでした: {error}"))
}

fn atomic_write(path: &Path, content: &[u8]) -> io::Result<()> {
    let (temporary_path, mut temporary_file) = create_temporary_file(path)?;
    let write_result = temporary_file
        .write_all(content)
        .and_then(|_| temporary_file.sync_all());
    drop(temporary_file);

    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary_path);
        return Err(error);
    }

    if let Err(error) = replace_file(&temporary_path, path) {
        return Err(recover_after_replace_failure(&temporary_path, path, error));
    }

    Ok(())
}

fn recover_after_replace_failure(
    temporary_path: &Path,
    destination_path: &Path,
    error: io::Error,
) -> io::Error {
    if destination_path.exists() {
        let _ = fs::remove_file(temporary_path);
        return error;
    }

    // A failed Windows replacement can move the destination out of place. The
    // synced temporary file must remain available instead of deleting both copies.
    if temporary_path.exists() {
        return io::Error::new(
            error.kind(),
            format!(
                "{error}。保存先を確認できないため、新しい内容は復旧用ファイル「{}」に保持しました",
                temporary_path.display()
            ),
        );
    }

    io::Error::new(
        error.kind(),
        format!("{error}。保存処理が完了せず、保存先を確認できません"),
    )
}

fn create_temporary_file(path: &Path) -> io::Result<(PathBuf, File)> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let file_name = path.file_name().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "保存先にファイル名がありません",
        )
    })?;

    loop {
        let sequence = SAVE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let temporary_name = format!(
            ".{}.mdpad-{}-{sequence}.tmp",
            file_name.to_string_lossy(),
            std::process::id()
        );
        let temporary_path = parent.join(temporary_name);
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)
        {
            Ok(file) => return Ok((temporary_path, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
}

#[cfg(windows)]
fn replace_file(from: &Path, to: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, ReplaceFileW, MOVEFILE_WRITE_THROUGH,
    };

    let from_wide: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to_wide: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();

    // ReplaceFileW preserves the existing file's Windows metadata; MoveFileExW
    // is required for a destination that does not exist yet.
    let succeeded = if to.exists() {
        unsafe {
            ReplaceFileW(
                to_wide.as_ptr(),
                from_wide.as_ptr(),
                std::ptr::null(),
                0,
                std::ptr::null(),
                std::ptr::null(),
            )
        }
    } else {
        unsafe { MoveFileExW(from_wide.as_ptr(), to_wide.as_ptr(), MOVEFILE_WRITE_THROUGH) }
    };
    if succeeded == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(from: &Path, to: &Path) -> io::Result<()> {
    fs::rename(from, to)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            startup_file_path,
            write_text_file
        ])
        .run(tauri::generate_context!())
        .expect("mdpad の起動に失敗しました");
}

#[cfg(test)]
mod tests {
    use std::{ffi::OsString, fs, io, time::SystemTime};

    use super::{
        decode_utf8, read_text_file, recover_after_replace_failure, resolve_startup_file_path,
        write_text_file,
    };

    #[test]
    fn decodes_plain_utf8() {
        let decoded = decode_utf8("# メモ".as_bytes().to_vec()).expect("valid UTF-8");
        assert_eq!(decoded, "# メモ");
    }

    #[test]
    fn strips_a_utf8_bom() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(b"hello");
        let decoded = decode_utf8(bytes).expect("valid UTF-8 with BOM");
        assert_eq!(decoded, "hello");
    }

    #[test]
    fn rejects_non_utf8_input() {
        let error = decode_utf8(vec![0xFF, 0xFE]).expect_err("invalid UTF-8");
        assert!(error.contains("UTF-8"));
    }

    #[test]
    fn writes_and_reads_a_utf8_document() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system clock after Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("mdpad-{unique}.md"));
        let path_string = path.to_string_lossy().into_owned();

        write_text_file(path_string.clone(), "# 保存テスト".to_string()).expect("write succeeds");
        write_text_file(path_string.clone(), "# 置換テスト".to_string()).expect("replace succeeds");
        let content = read_text_file(path_string).expect("read succeeds");

        assert_eq!(content, "# 置換テスト");
        fs::remove_file(path).expect("temporary file is removed");
    }

    #[test]
    fn retains_recovery_content_if_the_destination_disappears() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system clock after Unix epoch")
            .as_nanos();
        let destination = std::env::temp_dir().join(format!("mdpad-missing-{unique}.md"));
        let recovery = std::env::temp_dir().join(format!("mdpad-recovery-{unique}.tmp"));
        fs::write(&recovery, "unsaved content").expect("recovery file is created");

        let error = recover_after_replace_failure(
            &recovery,
            &destination,
            io::Error::other("replace failed"),
        );

        assert!(recovery.exists());
        assert!(error.to_string().contains(&recovery.display().to_string()));
        fs::remove_file(recovery).expect("recovery file is removed");
    }

    #[test]
    fn resolves_the_first_startup_argument_when_it_is_a_file() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system clock after Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("mdpad startup {unique}.md"));
        fs::write(&path, "startup content").expect("startup file is created");

        let resolved = resolve_startup_file_path([path.clone().into_os_string()]);

        assert_eq!(resolved.as_deref(), Some(path.as_path()));
        fs::remove_file(path).expect("startup file is removed");
    }

    #[test]
    fn ignores_a_missing_startup_file() {
        let missing = std::env::temp_dir().join("mdpad-file-that-does-not-exist.md");

        let resolved = resolve_startup_file_path([OsString::from(missing)]);

        assert_eq!(resolved, None);
    }
}
