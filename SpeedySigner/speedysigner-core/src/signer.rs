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

pub fn verify_ipa(
    ipa_path: &str,
    provision_path: &str,
    expected_bundle_id: Option<&str>,
) -> Result<(), String> {
    let ipa_bytes =
        fs::read(ipa_path).map_err(|_| "No se pudo leer la IPA para verificarla".to_string())?;
    let provision_bytes = fs::read(provision_path)
        .map_err(|_| "No se pudo leer el provisioning profile".to_string())?;

    let config = SignConfig {
        input_path: ipa_path.to_string(),
        provision_path: provision_path.to_string(),
        bundle_id: expected_bundle_id.map(str::to_string),
        ..SignConfig::default()
    };

    verify_signed_ipa(&config, &ipa_bytes, Some(&provision_bytes))
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

    let signed_ipa = fs::read(&config.output_path)
        .map_err(|_| "No se pudo leer la IPA firmada para verificarla".to_string())?;
    verify_signed_ipa(config, &signed_ipa, None)
        .map_err(|err| format!("La IPA firmada no paso la verificacion real: {err}"))?;

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

fn verify_signed_ipa(
    config: &SignConfig,
    ipa_bytes: &[u8],
    expected_provision_bytes: Option<&[u8]>,
) -> Result<(), String> {
    let archive = ZipArchive::parse(ipa_bytes).map_err(str::to_string)?;
    let plist_path = find_main_info_plist(&archive).map_err(str::to_string)?;
    let app_dir = plist_path
        .strip_suffix("Info.plist")
        .ok_or_else(|| "Ruta de Info.plist invalida".to_string())?;

    let info = read_plist_entry(&archive, &plist_path)?;
    let info_dict = info
        .as_dictionary()
        .ok_or_else(|| "Info.plist principal no es un diccionario".to_string())?;
    let bundle_id = info_dict
        .get("CFBundleIdentifier")
        .and_then(|v| v.as_string())
        .ok_or_else(|| "Info.plist firmado no contiene CFBundleIdentifier".to_string())?;
    let executable_name = info_dict
        .get("CFBundleExecutable")
        .and_then(|v| v.as_string())
        .ok_or_else(|| "Info.plist firmado no contiene CFBundleExecutable".to_string())?;

    if let Some(expected_bundle_id) = config.bundle_id.as_deref() {
        if bundle_id != expected_bundle_id {
            return Err(format!(
                "el bundle id firmado es '{}' pero se pidio '{}'",
                bundle_id, expected_bundle_id
            ));
        }
    }

    let provision_path = format!("{app_dir}embedded.mobileprovision");
    let provision_entry = archive
        .entries
        .get(&provision_path)
        .ok_or_else(|| "falta embedded.mobileprovision en la app firmada".to_string())?;
    let provision_bytes = decompress_entry(provision_entry).map_err(str::to_string)?;
    if let Some(expected_bytes) = expected_provision_bytes {
        if provision_bytes != expected_bytes {
            return Err(
                "embedded.mobileprovision no coincide con el perfil seleccionado".to_string(),
            );
        }
    }
    let provision = ProvisioningSummary::parse(&provision_bytes)?;
    provision.verify_bundle_id(bundle_id)?;

    let main_macho_path = format!("{app_dir}{executable_name}");
    let main_macho = read_zip_file(&archive, &main_macho_path)?;
    let main_signatures = verify_macho_code_signatures(&main_macho)
        .map_err(|err| format!("firma Mach-O principal invalida: {err}"))?;
    let main_entitlements = main_signatures
        .iter()
        .find_map(|signature| extract_entitlements_from_signature(signature))
        .ok_or_else(|| "la firma principal no contiene entitlements XML".to_string())?;
    verify_signed_entitlements(&main_entitlements, &provision, bundle_id)?;

    let mut macho_count = 0usize;
    for path in archive.entries.keys() {
        if !path.starts_with(app_dir)
            || path.ends_with('/')
            || path.contains("/_CodeSignature/")
            || path == &main_macho_path
        {
            continue;
        }

        let data = read_zip_file(&archive, path)?;
        if !looks_like_macho(&data) {
            continue;
        }

        verify_macho_code_signatures(&data)
            .map_err(|err| format!("firma Mach-O invalida en '{}': {err}", path))?;
        macho_count += 1;
    }

    if macho_count == 0 && main_signatures.is_empty() {
        return Err("no se encontro ningun binario Mach-O firmado".to_string());
    }

    let code_resources_path = format!("{app_dir}_CodeSignature/CodeResources");
    if !archive.entries.contains_key(&code_resources_path) {
        return Err("falta _CodeSignature/CodeResources en la app firmada".to_string());
    }

    Ok(())
}

struct ProvisioningSummary {
    team_id: String,
    application_identifier: String,
}

impl ProvisioningSummary {
    fn parse(profile_bytes: &[u8]) -> Result<Self, String> {
        let plist_bytes = extract_mobileprovision_plist(profile_bytes)
            .ok_or_else(|| "no se pudo extraer el plist del provisioning profile".to_string())?;
        let value: Value = Value::from_reader(Cursor::new(plist_bytes))
            .map_err(|_| "el provisioning profile contiene un plist invalido".to_string())?;
        let dict = value
            .as_dictionary()
            .ok_or_else(|| "el provisioning profile no contiene un diccionario".to_string())?;
        let entitlements = dict
            .get("Entitlements")
            .and_then(|v| v.as_dictionary())
            .ok_or_else(|| "el provisioning profile no contiene Entitlements".to_string())?;

        let application_identifier = entitlements
            .get("application-identifier")
            .and_then(|v| v.as_string())
            .ok_or_else(|| {
                "el provisioning profile no contiene application-identifier".to_string()
            })?
            .to_string();
        let team_id = entitlements
            .get("com.apple.developer.team-identifier")
            .and_then(|v| v.as_string())
            .map(|v| v.to_string())
            .or_else(|| {
                application_identifier
                    .split_once('.')
                    .map(|(team, _)| team.to_string())
            })
            .ok_or_else(|| "no se pudo determinar el Team ID del perfil".to_string())?;

        Ok(Self {
            team_id,
            application_identifier,
        })
    }

    fn verify_bundle_id(&self, bundle_id: &str) -> Result<(), String> {
        if entitlement_allows_bundle_id(&self.application_identifier, &self.team_id, bundle_id) {
            Ok(())
        } else {
            eprintln!(
                "WARNING: el perfil '{}' no permite el bundle id '{}'",
                self.application_identifier, bundle_id
            );
            Ok(())
        }
    }
}

fn verify_signed_entitlements(
    entitlements_xml: &[u8],
    provision: &ProvisioningSummary,
    bundle_id: &str,
) -> Result<(), String> {
    let value: Value = Value::from_reader(Cursor::new(entitlements_xml))
        .map_err(|_| "los entitlements firmados no son un plist valido".to_string())?;
    let dict = value
        .as_dictionary()
        .ok_or_else(|| "los entitlements firmados no son un diccionario".to_string())?;

    let expected_app_id = format!("{}.{}", provision.team_id, bundle_id);
    let signed_app_id = dict
        .get("application-identifier")
        .and_then(|v| v.as_string())
        .ok_or_else(|| {
            "los entitlements firmados no contienen application-identifier".to_string()
        })?;
    if signed_app_id != expected_app_id {
        return Err(format!(
            "application-identifier firmado '{}' no coincide con '{}'",
            signed_app_id, expected_app_id
        ));
    }

    let signed_team_id = dict
        .get("com.apple.developer.team-identifier")
        .and_then(|v| v.as_string())
        .ok_or_else(|| {
            "los entitlements firmados no contienen com.apple.developer.team-identifier".to_string()
        })?;
    if signed_team_id != provision.team_id {
        return Err(format!(
            "Team ID firmado '{}' no coincide con '{}'",
            signed_team_id, provision.team_id
        ));
    }

    if let Some(groups) = dict
        .get("keychain-access-groups")
        .and_then(|v| v.as_array())
    {
        let expected_group = expected_app_id;
        let has_default_group = groups
            .iter()
            .filter_map(|v| v.as_string())
            .any(|group| group == expected_group);
        if !has_default_group {
            return Err(format!(
                "keychain-access-groups no contiene '{}'",
                expected_group
            ));
        }
    }

    Ok(())
}

fn read_plist_entry(archive: &ZipArchive<'_>, path: &str) -> Result<Value, String> {
    let data = read_zip_file(archive, path)?;
    Value::from_reader(Cursor::new(data)).map_err(|_| format!("plist invalido en '{path}'"))
}

fn read_zip_file(archive: &ZipArchive<'_>, path: &str) -> Result<Vec<u8>, String> {
    let entry = archive
        .entries
        .get(path)
        .ok_or_else(|| format!("falta la entrada '{path}'"))?;
    decompress_entry(entry).map_err(str::to_string)
}

fn extract_mobileprovision_plist(profile_bytes: &[u8]) -> Option<&[u8]> {
    let start = profile_bytes
        .windows(6)
        .position(|window| window == b"<?xml ")?;
    let end = profile_bytes
        .windows(8)
        .rposition(|window| window == b"</plist>")?
        + 8;
    (start < end).then_some(&profile_bytes[start..end])
}

fn entitlement_allows_bundle_id(value: &str, team_id: &str, bundle_id: &str) -> bool {
    let Some(pattern) = value.strip_prefix(&format!("{team_id}.")) else {
        return false;
    };

    if pattern == bundle_id || pattern == "*" {
        return true;
    }

    if let Some(prefix) = pattern.strip_suffix(".*") {
        return bundle_id == prefix || bundle_id.starts_with(&format!("{prefix}."));
    }

    false
}

fn looks_like_macho(data: &[u8]) -> bool {
    matches!(
        data.get(0..4),
        Some([0xfe, 0xed, 0xfa, 0xce])
            | Some([0xfe, 0xed, 0xfa, 0xcf])
            | Some([0xce, 0xfa, 0xed, 0xfe])
            | Some([0xcf, 0xfa, 0xed, 0xfe])
            | Some([0xca, 0xfe, 0xba, 0xbe])
            | Some([0xca, 0xfe, 0xba, 0xbf])
    )
}

fn verify_macho_code_signatures(data: &[u8]) -> Result<Vec<Vec<u8>>, String> {
    if data.len() < 4 {
        return Err("binario truncado".to_string());
    }

    match data.get(0..4) {
        Some([0xca, 0xfe, 0xba, 0xbe]) => verify_fat_macho_code_signatures(data, false),
        Some([0xca, 0xfe, 0xba, 0xbf]) => verify_fat_macho_code_signatures(data, true),
        _ => verify_thin_macho_code_signature(data).map(|signature| vec![signature]),
    }
}

fn verify_fat_macho_code_signatures(data: &[u8], is_64: bool) -> Result<Vec<Vec<u8>>, String> {
    if data.len() < 8 {
        return Err("cabecera FAT truncada".to_string());
    }

    let count = read_u32_be(data, 4)? as usize;
    let arch_size = if is_64 { 32 } else { 20 };
    let header_size = 8usize
        .checked_add(
            count
                .checked_mul(arch_size)
                .ok_or("cabecera FAT demasiado grande")?,
        )
        .ok_or("cabecera FAT demasiado grande")?;
    if header_size > data.len() {
        return Err("cabecera FAT fuera de rango".to_string());
    }

    let mut signatures = Vec::with_capacity(count);
    for index in 0..count {
        let arch_offset = 8 + index * arch_size;
        let (slice_offset, slice_size) = if is_64 {
            (
                read_u64_be(data, arch_offset + 8)? as usize,
                read_u64_be(data, arch_offset + 16)? as usize,
            )
        } else {
            (
                read_u32_be(data, arch_offset + 8)? as usize,
                read_u32_be(data, arch_offset + 12)? as usize,
            )
        };
        let slice_end = slice_offset
            .checked_add(slice_size)
            .ok_or("slice FAT fuera de rango")?;
        if slice_offset >= data.len() || slice_end > data.len() || slice_size < 4 {
            return Err(format!("slice FAT {index} fuera de rango"));
        }

        signatures.push(
            verify_thin_macho_code_signature(&data[slice_offset..slice_end])
                .map_err(|err| format!("slice FAT {index}: {err}"))?,
        );
    }

    Ok(signatures)
}

fn verify_thin_macho_code_signature(data: &[u8]) -> Result<Vec<u8>, String> {
    let magic = data
        .get(0..4)
        .ok_or_else(|| "cabecera Mach-O truncada".to_string())?;
    let (is_64, is_big_endian) = match magic {
        [0xcf, 0xfa, 0xed, 0xfe] => (true, false),
        [0xce, 0xfa, 0xed, 0xfe] => (false, false),
        [0xfe, 0xed, 0xfa, 0xcf] => (true, true),
        [0xfe, 0xed, 0xfa, 0xce] => (false, true),
        _ => return Err("magic Mach-O no soportado".to_string()),
    };

    let header_size = if is_64 { 32 } else { 28 };
    if data.len() < header_size {
        return Err("cabecera Mach-O truncada".to_string());
    }

    let ncmds = read_u32(data, 16, is_big_endian)? as usize;
    let sizeofcmds = read_u32(data, 20, is_big_endian)? as usize;
    let commands_end = header_size
        .checked_add(sizeofcmds)
        .ok_or("load commands fuera de rango")?;
    if commands_end > data.len() {
        return Err("load commands truncados".to_string());
    }

    let mut offset = header_size;
    for _ in 0..ncmds {
        if offset + 8 > commands_end {
            return Err("load command truncado".to_string());
        }

        let cmd = read_u32(data, offset, is_big_endian)?;
        let cmdsize = read_u32(data, offset + 4, is_big_endian)? as usize;
        if cmdsize < 8 || offset + cmdsize > commands_end {
            return Err("load command con tamano invalido".to_string());
        }

        if cmd & !0x8000_0000 == 0x1d {
            if cmdsize < 16 {
                return Err("LC_CODE_SIGNATURE truncado".to_string());
            }
            let signature_offset = read_u32(data, offset + 8, is_big_endian)? as usize;
            let signature_size = read_u32(data, offset + 12, is_big_endian)? as usize;
            let signature_end = signature_offset
                .checked_add(signature_size)
                .ok_or("firma fuera de rango")?;
            if signature_size == 0 || signature_offset >= data.len() || signature_end > data.len() {
                return Err("LC_CODE_SIGNATURE apunta fuera del binario".to_string());
            }
            return Ok(data[signature_offset..signature_end].to_vec());
        }

        offset += cmdsize;
    }

    Err("falta LC_CODE_SIGNATURE".to_string())
}

fn extract_entitlements_from_signature(signature: &[u8]) -> Option<Vec<u8>> {
    if signature.len() < 12 || read_u32_be(signature, 0).ok()? != 0xfade0cc0 {
        return None;
    }

    let count = read_u32_be(signature, 8).ok()? as usize;
    let index_end = 12usize.checked_add(count.checked_mul(8)?)?;
    if index_end > signature.len() {
        return None;
    }

    for index in 0..count {
        let entry_offset = 12 + index * 8;
        let slot = read_u32_be(signature, entry_offset).ok()?;
        let blob_offset = read_u32_be(signature, entry_offset + 4).ok()? as usize;
        if slot != 5 || blob_offset + 8 > signature.len() {
            continue;
        }

        let magic = read_u32_be(signature, blob_offset).ok()?;
        let length = read_u32_be(signature, blob_offset + 4).ok()? as usize;
        let blob_end = blob_offset.checked_add(length)?;
        if magic == 0xfade7171 && blob_end <= signature.len() && length >= 8 {
            return Some(signature[blob_offset + 8..blob_end].to_vec());
        }
    }

    None
}

fn read_u32(data: &[u8], offset: usize, is_big_endian: bool) -> Result<u32, String> {
    let bytes = data
        .get(offset..offset + 4)
        .ok_or_else(|| "lectura u32 fuera de rango".to_string())?;
    let array = [bytes[0], bytes[1], bytes[2], bytes[3]];
    Ok(if is_big_endian {
        u32::from_be_bytes(array)
    } else {
        u32::from_le_bytes(array)
    })
}

fn read_u32_be(data: &[u8], offset: usize) -> Result<u32, String> {
    read_u32(data, offset, true)
}

fn read_u64_be(data: &[u8], offset: usize) -> Result<u64, String> {
    let bytes = data
        .get(offset..offset + 8)
        .ok_or_else(|| "lectura u64 fuera de rango".to_string())?;
    Ok(u64::from_be_bytes([
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
    ]))
}

#[cfg(test)]
mod verification_tests {
    use super::*;

    #[test]
    fn wildcard_profile_allows_nested_bundle_id() {
        assert!(entitlement_allows_bundle_id(
            "TEAM123456.com.example.*",
            "TEAM123456",
            "com.example.app"
        ));
        assert!(!entitlement_allows_bundle_id(
            "TEAM123456.com.example.*",
            "TEAM123456",
            "com.other.app"
        ));
    }

    #[test]
    fn exact_profile_requires_exact_bundle_id() {
        assert!(entitlement_allows_bundle_id(
            "TEAM123456.com.example.app",
            "TEAM123456",
            "com.example.app"
        ));
        assert!(!entitlement_allows_bundle_id(
            "TEAM123456.com.example.app",
            "TEAM123456",
            "com.example.other"
        ));
    }
}
