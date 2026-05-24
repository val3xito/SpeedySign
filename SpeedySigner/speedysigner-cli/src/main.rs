use anyhow::{anyhow, Context, Result};
use clap::Parser;
use std::fs;
use speedysigner_core::{inject_dylib, PlistEditor, ZipArchive, ZipWriter};

#[derive(Parser, Debug)]
#[command(author, version, about = "SpeedySigner CLI", long_about = None)]
struct Args {
    /// Ruta del certificado (.p12)
    #[arg(short = 'k', long)]
    key: String,

    /// Contraseña del certificado
    #[arg(short = 'p', long)]
    password: Option<String>,

    /// Ruta del provisioning profile
    #[arg(short = 'm', long)]
    provision: String,

    /// Ruta del archivo IPA de salida
    #[arg(short = 'o', long)]
    output: String,

    /// Identificador del paquete (Bundle ID) personalizado
    #[arg(short = 'b', long)]
    bundle_id: Option<String>,

    /// Nombre visible (Display Name) personalizado
    #[arg(short = 'n', long)]
    name: Option<String>,

    /// Versión de la app personalizada
    #[arg(short = 'r', long)]
    version: Option<String>,

    /// Ruta de archivo .entitlements personalizado
    #[arg(short = 'e', long)]
    entitlements: Option<String>,

    /// Bandera de compatibilidad de sólo SHA-256
    #[arg(long)]
    sha256_only: bool,

    /// Nivel de compresión del ZIP (0-9)
    #[arg(short = 'z', long)]
    compression: Option<u8>,

    /// Rutas a dylibs para inyección fuerte (se permiten múltiples)
    #[arg(short = 'l', long)]
    dylib: Vec<String>,

    /// Rutas a dylibs para inyección débil (se permiten múltiples)
    #[arg(short = 'w', long)]
    weak_dylib: Vec<String>,

    /// Ruta del archivo IPA de entrada (.ipa o .zip)
    input: String,
}

fn main() -> Result<()> {
    let args = Args::parse();
    println!("=== SpeedySigner CLI ===");
    println!("Entrada: {}", args.input);
    println!("Salida: {}", args.output);
    println!("Certificado: {}", args.key);
    println!("Provision: {}", args.provision);

    // Leer el archivo de entrada en memoria
    let ipa_bytes = fs::read(&args.input)
        .with_context(|| format!("Error al leer el archivo de entrada en: {}", args.input))?;

    println!("Parseando archivo ZIP original ({} bytes)...", ipa_bytes.len());
    let archive = ZipArchive::parse(&ipa_bytes)
        .map_err(|e| anyhow!("Error al parsear el IPA original: {}", e))?;

    // Determinar la ruta de Info.plist y del ejecutable principal si es necesario
    let mut main_plist_path = None;
    let mut main_macho_path = None;
    let mut app_dir_path = None;

    if let Ok(plist_path) = speedysigner_core::signer::find_main_info_plist(&archive) {
        println!("Info.plist principal detectado en: {}", plist_path);
        main_plist_path = Some(plist_path.clone());
        if let Some(plist_entry) = archive.entries.get(&plist_path) {
            if let Ok(plist_data) = speedysigner_core::zip::decompress_entry(plist_entry) {
                if let Ok(plist_editor) = PlistEditor::parse(&plist_data) {
                    if let Some(exec_val) = plist_editor.dict.get("CFBundleExecutable") {
                        if let Some(exec_name) = exec_val.as_string() {
                            if let Some(app_dir) = plist_path.strip_suffix("Info.plist") {
                                app_dir_path = Some(app_dir.to_string());
                                main_macho_path = Some(format!("{}{}", app_dir, exec_name));
                                println!("Binario Mach-O principal detectado en: {}{}", app_dir, exec_name);
                            }
                        }
                    }
                }
            }
        }
    }

    // Ruta temporal para escribir la IPA modificada antes de la firma criptográfica
    let temp_modified_ipa_path = format!("{}.repack.tmp", args.output);
    println!("Creando archivo temporal de repaquetado: {}", temp_modified_ipa_path);

    let out_file = fs::File::create(&temp_modified_ipa_path)
        .with_context(|| format!("Error al crear el archivo temporal de salida en: {}", temp_modified_ipa_path))?;
    let mut writer = ZipWriter::new(out_file);

    // Copiar e inyectar dylibs si se solicitó
    let mut injected_dylibs = Vec::new();
    let has_dylibs = !args.dylib.is_empty() || !args.weak_dylib.is_empty();

    if has_dylibs {
        if let Some(ref app_dir) = app_dir_path {
            // Escribir los archivos dylib en la carpeta Frameworks/ del app bundle
            for dl_path in &args.dylib {
                let path_obj = std::path::Path::new(dl_path);
                if let Some(filename) = path_obj.file_name().and_then(|f| f.to_str()) {
                    let target_zip_path = format!("{}Frameworks/{}", app_dir, filename);
                    println!("Copiando dylib en ZIP: {}", target_zip_path);
                    if let Ok(data) = fs::read(dl_path) {
                        if let Err(e) = writer.write_file(&target_zip_path, &data, true) {
                            println!("Error al escribir dylib en el ZIP: {}", e);
                        } else {
                            injected_dylibs.push((filename.to_string(), false));
                        }
                    } else {
                        println!("Error al leer dylib desde el filesystem: {}", dl_path);
                    }
                }
            }

            for dl_path in &args.weak_dylib {
                let path_obj = std::path::Path::new(dl_path);
                if let Some(filename) = path_obj.file_name().and_then(|f| f.to_str()) {
                    let target_zip_path = format!("{}Frameworks/{}", app_dir, filename);
                    println!("Copiando dylib débil en ZIP: {}", target_zip_path);
                    if let Ok(data) = fs::read(dl_path) {
                        if let Err(e) = writer.write_file(&target_zip_path, &data, true) {
                            println!("Error al escribir dylib débil en el ZIP: {}", e);
                        } else {
                            injected_dylibs.push((filename.to_string(), true));
                        }
                    } else {
                        println!("Error al leer dylib débil desde el filesystem: {}", dl_path);
                    }
                }
            }
        } else {
            println!("Advertencia: No se pudo identificar el directorio .app de la IPA para copiar las dylibs.");
        }
    }

    // Procesar y copiar todas las entradas del ZIP
    for (path, entry) in &archive.entries {
        // Ignorar las rutas que acabamos de agregar manualmente para evitar duplicación
        let mut is_manually_added_dylib = false;
        if let Some(ref app_dir) = app_dir_path {
            for (filename, _) in &injected_dylibs {
                let target_zip_path = format!("{}Frameworks/{}", app_dir, filename);
                if path == &target_zip_path {
                    is_manually_added_dylib = true;
                    break;
                }
            }
        }
        if is_manually_added_dylib {
            continue;
        }

        // ¿Es el Info.plist principal y necesitamos editarlo?
        let is_main_plist = main_plist_path.as_ref() == Some(path);
        let has_plist_mods = args.bundle_id.is_some() || args.name.is_some() || args.version.is_some();

        if is_main_plist && has_plist_mods {
            println!("Aplicando modificaciones a Info.plist: {}", path);
            let plist_data = speedysigner_core::zip::decompress_entry(entry)
                .map_err(|e| anyhow!("Error al descomprimir Info.plist: {}", e))?;
            let mut plist_editor = PlistEditor::parse(&plist_data)
                .map_err(|e| anyhow!("Error al parsear Info.plist: {}", e))?;

            if let Some(ref bid) = args.bundle_id {
                println!("  - Cambiando Bundle ID a: {}", bid);
                plist_editor.set_bundle_id(bid);
            }
            if let Some(ref name) = args.name {
                println!("  - Cambiando Display Name a: {}", name);
                plist_editor.set_display_name(name);
            }
            if let Some(ref ver) = args.version {
                println!("  - Cambiando versión a: {}", ver);
                plist_editor.set_version(ver);
            }

            let new_plist_data = plist_editor.serialize_to_binary()
                .or_else(|_| plist_editor.serialize_to_xml())
                .map_err(|e| anyhow!("Error al serializar Info.plist modificado: {}", e))?;

            writer.write_file(path, &new_plist_data, true)
                .map_err(|e| anyhow!("Error al escribir Info.plist en el ZIP: {}", e))?;
            continue;
        }

        // ¿Es el Mach-O principal y necesitamos inyectar dylibs?
        let is_main_macho = main_macho_path.as_ref() == Some(path);
        let has_dylib_injection = !injected_dylibs.is_empty();

        if is_main_macho && has_dylib_injection {
            println!("Inyectando comandos de carga en el Mach-O: {}", path);
            let mut macho_bytes = speedysigner_core::zip::decompress_entry(entry)
                .map_err(|e| anyhow!("Error al descomprimir Mach-O: {}", e))?;

            for (filename, is_weak) in &injected_dylibs {
                // Ruta que iOS espera ver en el ejecutable Mach-O
                let load_path = format!("@executable_path/Frameworks/{}", filename);
                println!("  - Registrando comando de carga (débil={}): {}", is_weak, load_path);
                if let Err(e) = inject_dylib(&mut macho_bytes, &load_path, *is_weak) {
                    println!("  ⚠️ Advertencia al inyectar dylib en Mach-O: {}", e);
                }
            }

            writer.write_file(path, &macho_bytes, true)
                .map_err(|e| anyhow!("Error al escribir Mach-O modificado en el ZIP: {}", e))?;
            continue;
        }

        // Copiar entrada original en crudo (raw block copy) para máxima velocidad
        writer.write_raw_entry(&ipa_bytes, entry)
            .map_err(|e| anyhow!("Error al copiar la entrada ZIP {}: {}", path, e))?;
    }

    // Finalizar el archivo ZIP
    writer.finish(&archive.comment)
        .map_err(|e| anyhow!("Error al finalizar la estructura del ZIP: {}", e))?;

    // --- PROCESO DE FIRMA CRIPTOGRÁFICA CON zsign_rs ---
    println!("Iniciando proceso de firma criptográfica real...");

    let p12_data = fs::read(&args.key)
        .with_context(|| format!("Error al leer el certificado p12 en: {}", args.key))?;
    let p12_password = args.password.clone().unwrap_or_default();
    
    let credentials = zsign_rs::SigningCredentials::from_p12(&p12_data, &p12_password)
        .map_err(|e| anyhow!("Error al cargar credenciales del certificado .p12: {:?}", e))?;

    let mut signer = zsign_rs::ZSign::new().credentials(credentials);
    signer = signer.provisioning_profile(args.provision.clone());

    // Si se especificó entitlements personalizado
    if let Some(ref ent_path) = args.entitlements {
        println!("Usando entitlements personalizado: {}", ent_path);
        signer = signer.entitlements(ent_path.clone());
    }

    println!("Firmando la IPA con zsign_rs...");
    signer.sign_ipa(&temp_modified_ipa_path, &args.output)
        .map_err(|e| anyhow!("Fallo durante el proceso de firma criptográfica de zsign_rs: {:?}", e))?;

    // Limpiar el archivo temporal de repaquetado
    if let Err(e) = fs::remove_file(&temp_modified_ipa_path) {
        println!("Advertencia: No se pudo eliminar el archivo temporal {}: {}", temp_modified_ipa_path, e);
    }

    println!("=== SpeedySigner completó la firma real con éxito ===");
    Ok(())
}
