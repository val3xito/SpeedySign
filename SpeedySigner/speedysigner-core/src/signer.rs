use std::io::Cursor;
use plist::Value;
use crate::zip::{decompress_entry, ZipArchive};

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
    let plist_entry = archive.entries.get(&plist_path)
        .ok_or("No se pudo obtener la entrada del Info.plist de la IPA")?;

    // 3. Descomprimir el Info.plist
    let plist_data = decompress_entry(plist_entry)?;

    // 4. Parsear el Info.plist para extraer CFBundleExecutable
    let plist_value = Value::from_reader(Cursor::new(plist_data))
        .map_err(|_| "Error al parsear el archivo Info.plist (formato inválido)")?;
    
    let plist_dict = plist_value.as_dictionary()
        .ok_or("Info.plist principal no es un diccionario válido")?;
    
    let executable_name = plist_dict.get("CFBundleExecutable")
        .and_then(|v| v.as_string())
        .ok_or("Info.plist no contiene la clave CFBundleExecutable")?;

    // 5. Construir la ruta del binario ejecutable
    // El binario está en: Payload/<nombre>.app/<CFBundleExecutable>
    // plist_path es: Payload/<nombre>.app/Info.plist, así que quitamos "Info.plist" y agregamos el nombre del ejecutable
    let app_dir = plist_path.strip_suffix("Info.plist")
        .ok_or("Ruta de Info.plist inválida")?;
    let macho_path = format!("{}{}", app_dir, executable_name);

    // 6. Obtener y descomprimir el binario Mach-O
    let macho_entry = archive.entries.get(&macho_path)
        .ok_or("No se encontró el binario ejecutable Mach-O principal en la IPA")?;
    
    let macho_bytes = decompress_entry(macho_entry)?;

    Ok((macho_path, macho_bytes))
}
