use crate::macho::parse_macho;
use crate::plist::PlistEditor;
use crate::zip::{decompress_entry, ZipArchive, ZipWriter};
use plist::Value;
use std::collections::HashSet;
use std::fs;
use std::fs::File;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
#[cfg(not(windows))]
use zsign::{SigningCredentials, ZSign};

#[derive(Debug, Clone, Default)]
pub struct SignConfig {
    pub input_path: String,
    pub output_path: String,
    pub p12_path: String,
    pub p12_password: String,
    pub provision_path: String,
    pub bundle_id: Option<String>,
    pub app_name: Option<String>,
    pub version: Option<String>,
    pub entitlements_path: Option<String>,
    pub sha256_only: bool,
    pub compression_level: Option<u8>,
    pub dylib_paths: Vec<String>,
    pub weak_dylib_paths: Vec<String>,
}

/// Punto de entrada del motor nativo de SpeedySigner.
///
/// Esta funcion reemplaza al wrapper de zsign.exe en la CLI y ejecuta la firma
/// desde Rust, dentro del proceso de SpeedySigner.
pub fn sign_ipa(config: &SignConfig) -> Result<(), String> {
    let ipa_bytes = fs::read(&config.input_path)
        .map_err(|_| "No se pudo leer la IPA de entrada".to_string())?;
    let p12_bytes = fs::read(&config.p12_path)
        .map_err(|_| "No se pudo leer el certificado .p12".to_string())?;
    let provision_bytes = fs::read(&config.provision_path)
        .map_err(|_| "No se pudo leer el provisioning profile".to_string())?;

    if p12_bytes.is_empty() {
        return Err("El certificado .p12 esta vacio".to_string());
    }
    if provision_bytes.is_empty() {
        return Err("El provisioning profile esta vacio".to_string());
    }

    if let Some(ref entitlements) = config.entitlements_path {
        if !Path::new(entitlements).is_file() {
            return Err("El archivo de entitlements no existe".to_string());
        }
    }

    for dylib in config
        .dylib_paths
        .iter()
        .chain(config.weak_dylib_paths.iter())
    {
        if !Path::new(dylib).is_file() {
            return Err("Uno de los archivos dylib no existe".to_string());
        }
    }

    if let Some(parent) = Path::new(&config.output_path).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|_| "No se pudo crear el directorio de salida".to_string())?;
        }
    }

    let archive = ZipArchive::parse(&ipa_bytes).map_err(str::to_string)?;
    let _info_plist_path = find_main_info_plist(&archive).map_err(str::to_string)?;
    let (_macho_path, macho_bytes) = extract_macho_from_ipa(&ipa_bytes).map_err(str::to_string)?;
    let _macho_info = parse_macho(&macho_bytes).map_err(str::to_string)?;

    if config.entitlements_path.is_some() {
        return Err(
            "La firma nativa minima aun no soporta entitlements personalizados".to_string(),
        );
    }

    let prepared_ipa = prepare_ipa_if_needed(config, &ipa_bytes, &archive)?;
    let input_for_sign = prepared_ipa
        .as_deref()
        .unwrap_or_else(|| Path::new(&config.input_path));

    let result = sign_ipa_native(config, input_for_sign, &p12_bytes);

    if let Some(path) = prepared_ipa {
        let _ = fs::remove_file(path);
    }

    result
}

#[cfg(not(windows))]
fn sign_ipa_native(config: &SignConfig, input_path: &Path, p12_bytes: &[u8]) -> Result<(), String> {
    let credentials = SigningCredentials::from_p12(p12_bytes, &config.p12_password)
        .map_err(|err| format!("No se pudieron cargar las credenciales del .p12: {err}"))?;

    let mut signer = ZSign::new()
        .credentials(credentials)
        .provisioning_profile(&config.provision_path);

    // El modo rapido por defecto no comprime el ZIP de salida. iOS acepta IPAs
    // almacenadas y esto evita que el repaquetado domine el tiempo de firma.
    signer = signer.compression_level(config.compression_level.unwrap_or(0) as u32);

    signer
        .sign_ipa(input_path, &config.output_path)
        .map_err(|err| format!("Fallo en la firma IPA nativa: {err}"))?;

    let metadata = fs::metadata(&config.output_path)
        .map_err(|_| "La firma termino, pero no se encontro la IPA de salida".to_string())?;
    if metadata.len() == 0 {
        return Err("La firma genero una IPA vacia".to_string());
    }

    Ok(())
}

#[cfg(windows)]
fn sign_ipa_native(
    _config: &SignConfig,
    _input_path: &Path,
    _p12_bytes: &[u8],
) -> Result<(), String> {
    Err("La firma nativa real usa zsign-rs y aun no compila con el toolchain Windows GNU actual. Ejecuta SpeedySigner en Docker/Linux o instala un toolchain MinGW/MSVC completo para habilitarla en Windows.".to_string())
}

fn prepare_ipa_if_needed(
    config: &SignConfig,
    ipa_bytes: &[u8],
    archive: &ZipArchive<'_>,
) -> Result<Option<PathBuf>, String> {
    let has_plist_mods =
        config.bundle_id.is_some() || config.app_name.is_some() || config.version.is_some();
    let has_dylibs = !config.dylib_paths.is_empty() || !config.weak_dylib_paths.is_empty();

    if !has_plist_mods && !has_dylibs {
        return Ok(None);
    }

    let plist_path = find_main_info_plist(archive).map_err(str::to_string)?;
    let app_dir = plist_path
        .strip_suffix("Info.plist")
        .ok_or_else(|| "Ruta de Info.plist invalida".to_string())?
        .to_string();
    let (_, current_macho_bytes) = extract_macho_from_ipa(ipa_bytes).map_err(str::to_string)?;
    let macho_path = find_main_macho_path(archive, &plist_path).map_err(str::to_string)?;

    let temp_path = prepared_ipa_path(config);
    let file = File::create(&temp_path)
        .map_err(|_| "No se pudo crear la IPA preparada temporal".to_string())?;
    let mut writer = ZipWriter::new(file);

    let mut added_paths = HashSet::new();
    for dylib_path in &config.dylib_paths {
        let target = write_dylib_to_ipa(&mut writer, dylib_path, &app_dir)?;
        added_paths.insert(target);
    }
    for dylib_path in &config.weak_dylib_paths {
        let target = write_dylib_to_ipa(&mut writer, dylib_path, &app_dir)?;
        added_paths.insert(target);
    }

    let mut paths: Vec<&String> = archive.entries.keys().collect();
    paths.sort();

    for path in paths {
        if added_paths.contains(path.as_str()) {
            continue;
        }

        let entry = archive
            .entries
            .get(path)
            .ok_or_else(|| "Entrada ZIP no encontrada durante la preparacion".to_string())?;

        if path == &plist_path && has_plist_mods {
            let plist_data = decompress_entry(entry).map_err(str::to_string)?;
            let mut plist = PlistEditor::parse(&plist_data).map_err(str::to_string)?;
            if let Some(ref bundle_id) = config.bundle_id {
                plist.set_bundle_id(bundle_id);
            }
            if let Some(ref app_name) = config.app_name {
                plist.set_display_name(app_name);
            }
            if let Some(ref version) = config.version {
                plist.set_version(version);
            }
            let data = plist
                .serialize_to_binary()
                .or_else(|_| plist.serialize_to_xml())
                .map_err(str::to_string)?;
            writer
                .write_file(path, &data, true, entry.external_attributes)
                .map_err(str::to_string)?;
            continue;
        }

        if path == &macho_path && has_dylibs {
            let mut macho_bytes = current_macho_bytes.clone();
            for dylib_path in &config.dylib_paths {
                let load_path = dylib_load_path(dylib_path)?;
                crate::macho::inject_dylib(&mut macho_bytes, &load_path, false)
                    .map_err(str::to_string)?;
            }
            for dylib_path in &config.weak_dylib_paths {
                let load_path = dylib_load_path(dylib_path)?;
                crate::macho::inject_dylib(&mut macho_bytes, &load_path, true)
                    .map_err(str::to_string)?;
            }
            writer
                .write_file(path, &macho_bytes, true, entry.external_attributes)
                .map_err(str::to_string)?;
            continue;
        }

        writer
            .write_raw_entry(ipa_bytes, entry)
            .map_err(str::to_string)?;
    }

    writer.finish(&archive.comment).map_err(str::to_string)?;
    Ok(Some(temp_path))
}

fn prepared_ipa_path(config: &SignConfig) -> PathBuf {
    let input = Path::new(&config.input_path);
    let dir = input.parent().unwrap_or_else(|| Path::new("."));
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    dir.join(format!(
        ".speedysigner-prepared-{}-{}.ipa",
        std::process::id(),
        now
    ))
}

fn write_dylib_to_ipa<W: std::io::Write + std::io::Seek>(
    writer: &mut ZipWriter<W>,
    dylib_path: &str,
    app_dir: &str,
) -> Result<String, String> {
    let filename = Path::new(dylib_path)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Ruta de dylib invalida".to_string())?;
    let target = format!("{}Frameworks/{}", app_dir, filename);
    let data = fs::read(dylib_path).map_err(|_| "No se pudo leer una dylib".to_string())?;
    writer
        .write_file(&target, &data, true, 0x81ED0000)
        .map_err(str::to_string)?;
    Ok(target)
}

fn dylib_load_path(dylib_path: &str) -> Result<String, String> {
    let filename = Path::new(dylib_path)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Ruta de dylib invalida".to_string())?;
    Ok(format!("@executable_path/Frameworks/{}", filename))
}

fn find_main_macho_path(
    archive: &ZipArchive<'_>,
    plist_path: &str,
) -> Result<String, &'static str> {
    let plist_entry = archive
        .entries
        .get(plist_path)
        .ok_or("No se pudo obtener la entrada del Info.plist de la IPA")?;
    let plist_data = decompress_entry(plist_entry)?;
    let plist_value = Value::from_reader(Cursor::new(plist_data))
        .map_err(|_| "Error al parsear el archivo Info.plist (formato invalido)")?;
    let plist_dict = plist_value
        .as_dictionary()
        .ok_or("Info.plist principal no es un diccionario valido")?;
    let executable_name = plist_dict
        .get("CFBundleExecutable")
        .and_then(|v| v.as_string())
        .ok_or("Info.plist no contiene la clave CFBundleExecutable")?;
    let app_dir = plist_path
        .strip_suffix("Info.plist")
        .ok_or("Ruta de Info.plist invalida")?;
    Ok(format!("{}{}", app_dir, executable_name))
}

/// Busca la ruta del archivo Info.plist principal dentro del Payload de la IPA.
/// Generalmente tiene el patrón: `Payload/<nombre>.app/Info.plist`
pub fn find_main_info_plist<'a>(archive: &ZipArchive<'a>) -> Result<String, &'static str> {
    for path in archive.entries.keys() {
        if path.starts_with("Payload/") && path.ends_with(".app/Info.plist") {
            // Asegurarnos de que no sea un Info.plist anidado dentro de un Framework o AppExtension
            let slash_count = path.matches('/').count();
            if slash_count == 2 {
                return Ok(path.clone());
            }
        }
    }
    Err("No se pudo encontrar el Info.plist principal en Payload/")
}

/// Lee una IPA en memoria, localiza el Info.plist principal, lee el CFBundleExecutable
/// y extrae los bytes del binario Mach-O ejecutable principal.
pub fn extract_macho_from_ipa(ipa_bytes: &[u8]) -> Result<(String, Vec<u8>), &'static str> {
    // 1. Parsear el archivo ZIP de la IPA
    let archive = ZipArchive::parse(ipa_bytes)?;

    // 2. Encontrar el Info.plist principal
    let plist_path = find_main_info_plist(&archive)?;
    let plist_entry = archive
        .entries
        .get(&plist_path)
        .ok_or("No se pudo obtener la entrada del Info.plist de la IPA")?;

    // 3. Descomprimir el Info.plist
    let plist_data = decompress_entry(plist_entry)?;

    // 4. Parsear el Info.plist para extraer CFBundleExecutable
    let plist_value = Value::from_reader(Cursor::new(plist_data))
        .map_err(|_| "Error al parsear el archivo Info.plist (formato inválido)")?;

    let plist_dict = plist_value
        .as_dictionary()
        .ok_or("Info.plist principal no es un diccionario válido")?;

    let executable_name = plist_dict
        .get("CFBundleExecutable")
        .and_then(|v| v.as_string())
        .ok_or("Info.plist no contiene la clave CFBundleExecutable")?;

    // 5. Construir la ruta del binario ejecutable
    // El binario está en: Payload/<nombre>.app/<CFBundleExecutable>
    // plist_path es: Payload/<nombre>.app/Info.plist, así que quitamos "Info.plist" y agregamos el nombre del ejecutable
    let app_dir = plist_path
        .strip_suffix("Info.plist")
        .ok_or("Ruta de Info.plist inválida")?;
    let macho_path = format!("{}{}", app_dir, executable_name);

    // 6. Obtener y descomprimir el binario Mach-O
    let macho_entry = archive
        .entries
        .get(&macho_path)
        .ok_or("No se encontró el binario ejecutable Mach-O principal en la IPA")?;

    let macho_bytes = decompress_entry(macho_entry)?;

    Ok((macho_path, macho_bytes))
}
