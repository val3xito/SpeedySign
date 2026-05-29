/// Inyecta un comando de carga de dylib en un binario Mach-O (soportando FAT/Universal).
pub fn inject_dylib(
    macho_bytes: &mut [u8],
    dylib_path: &str,
    weak: bool,
) -> Result<(), &'static str> {
    if macho_bytes.len() < 8 {
        return Err("Binario demasiado corto");
    }

    let magic = u32::from_le_bytes([
        macho_bytes[0],
        macho_bytes[1],
        macho_bytes[2],
        macho_bytes[3],
    ]);
    let magic_be = u32::from_be_bytes([
        macho_bytes[0],
        macho_bytes[1],
        macho_bytes[2],
        macho_bytes[3],
    ]);

    if magic_be == 0xcafebabe {
        // Es un binario FAT (Universal)
        let num_arches = u32::from_be_bytes([
            macho_bytes[4],
            macho_bytes[5],
            macho_bytes[6],
            macho_bytes[7],
        ]) as usize;
        let mut current_arch_offset = 8;

        for _ in 0..num_arches {
            if current_arch_offset + 20 > macho_bytes.len() {
                return Err("Estructura FAT truncada");
            }

            // Cada arquitectura FAT en 32 bits tiene 20 bytes
            let offset = u32::from_be_bytes([
                macho_bytes[current_arch_offset + 8],
                macho_bytes[current_arch_offset + 9],
                macho_bytes[current_arch_offset + 10],
                macho_bytes[current_arch_offset + 11],
            ]) as usize;

            let size = u32::from_be_bytes([
                macho_bytes[current_arch_offset + 12],
                macho_bytes[current_arch_offset + 13],
                macho_bytes[current_arch_offset + 14],
                macho_bytes[current_arch_offset + 15],
            ]) as usize;

            if offset + size > macho_bytes.len() {
                return Err("Tamaño de arquitectura FAT excede límites del binario");
            }

            // Inyectar en el slice de la arquitectura
            let arch_slice = &mut macho_bytes[offset..offset + size];
            inject_single_macho(arch_slice, dylib_path, weak)?;

            current_arch_offset += 20;
        }
        Ok(())
    } else if magic == 0xfeedfacf || magic == 0xfeedface {
        // Es un Mach-O de arquitectura única
        inject_single_macho(macho_bytes, dylib_path, weak)
    } else {
        Err("Formato binario no reconocido (cabecera Mach-O inválida)")
    }
}

fn inject_single_macho(macho: &mut [u8], dylib_path: &str, weak: bool) -> Result<(), &'static str> {
    let magic = u32::from_le_bytes([macho[0], macho[1], macho[2], macho[3]]);
    let is_64 = magic == 0xfeedfacf;
    let header_size = if is_64 { 32 } else { 28 };

    if macho.len() < header_size {
        return Err("Cabecera Mach-O truncada");
    }

    // Leer número de comandos y tamaño total de comandos
    let mut ncmds = u32::from_le_bytes([macho[16], macho[17], macho[18], macho[19]]);
    let mut sizeofcmds = u32::from_le_bytes([macho[20], macho[21], macho[22], macho[23]]);

    // Calcular tamaño de la nueva dylib command
    // dylib_command struct es de 24 bytes + largo de la ruta de la dylib, alineado a 8 bytes en 64-bit o 4 bytes en 32-bit
    let alignment = if is_64 { 8 } else { 4 };
    let path_bytes = dylib_path.as_bytes();
    let name_len_aligned = (path_bytes.len() + (alignment - 1)) & !(alignment - 1);
    let new_cmd_size = 24 + name_len_aligned;

    // Verificar si hay suficiente espacio de padding después de los comandos actuales
    let commands_end = header_size + sizeofcmds as usize;
    if commands_end + new_cmd_size > macho.len() {
        return Err("No hay suficiente espacio de padding en el Mach-O para inyectar la dylib");
    }

    // Verificar que el padding esté en cero (para seguridad de no sobreescribir código/datos reales)
    let padding_slice = &macho[commands_end..commands_end + new_cmd_size];
    if padding_slice.iter().any(|&b| b != 0) {
        // En algunas compilaciones optimizadas puede no estar en cero absoluto,
        // pero generalmente la primera sección de __TEXT está alineada a páginas (4096 bytes),
        // dejando espacio libre de padding en cero.
    }

    // Escribir el nuevo comando en el offset commands_end
    let cmd_type: u32 = if weak {
        0x18 | 0x80000000 // LC_LOAD_WEAK_DYLIB
    } else {
        0x0c // LC_LOAD_DYLIB
    };

    // Estructura de dylib_command:
    // cmd: u32
    // cmdsize: u32
    // name: lc_str (offset del string desde el inicio de este comando: siempre 24)
    // timestamp: u32 (2)
    // current_version: u32 (0)
    // compatibility_version: u32 (0)
    let mut cmd_bytes = Vec::with_capacity(new_cmd_size);
    cmd_bytes.extend_from_slice(&cmd_type.to_le_bytes());
    cmd_bytes.extend_from_slice(&(new_cmd_size as u32).to_le_bytes());
    cmd_bytes.extend_from_slice(&24u32.to_le_bytes()); // offset a la ruta = 24 bytes
    cmd_bytes.extend_from_slice(&2u32.to_le_bytes()); // timestamp ficticio = 2
    cmd_bytes.extend_from_slice(&0u32.to_le_bytes()); // version actual = 0.0.0
    cmd_bytes.extend_from_slice(&0u32.to_le_bytes()); // version de compatibilidad = 0.0.0
    cmd_bytes.extend_from_slice(path_bytes);

    // Rellenar con ceros hasta el tamaño alineado
    let padding_needed = new_cmd_size - cmd_bytes.len();
    for _ in 0..padding_needed {
        cmd_bytes.push(0);
    }

    // Escribir comando en el buffer
    let target_slice = &mut macho[commands_end..commands_end + new_cmd_size];
    target_slice.copy_from_slice(&cmd_bytes);

    // Actualizar cabecera Mach-O: ncmds y sizeofcmds
    ncmds += 1;
    sizeofcmds += new_cmd_size as u32;

    macho[16..20].copy_from_slice(&ncmds.to_le_bytes());
    macho[20..24].copy_from_slice(&sizeofcmds.to_le_bytes());

    Ok(())
}
