use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct ZipEntry<'a> {
    pub name: String,
    pub compressed_size: u32,
    pub uncompressed_size: u32,
    pub compression_method: u16,
    pub crc32: u32,
    pub local_header_offset: u32,
    pub last_mod_time: u16,
    pub last_mod_date: u16,
    pub external_attributes: u32,
    // Slice que apunta directamente a los datos comprimidos en el archivo mapeado
    pub compressed_data: &'a [u8],
}

pub struct ZipArchive<'a> {
    pub entries: HashMap<String, ZipEntry<'a>>,
    pub comment: Vec<u8>,
}

fn read_u16(data: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([data[offset], data[offset + 1]])
}

fn read_u32(data: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
    ])
}

impl<'a> ZipArchive<'a> {
    pub fn parse(data: &'a [u8]) -> Result<Self, &'static str> {
        let len = data.len();
        if len < 22 {
            return Err("El archivo es demasiado pequeño para ser un ZIP válido");
        }

        // Buscar el fin del directorio central (EOCD) desde el final del archivo
        let mut eocd_offset = None;
        for i in (0..=(len - 22)).rev() {
            if data[i] == 0x50 && data[i + 1] == 0x4b && data[i + 2] == 0x05 && data[i + 3] == 0x06 {
                eocd_offset = Some(i);
                break;
            }
        }

        let eocd_idx = eocd_offset.ok_ok_or("No se encontró el final del directorio central (EOCD)")?;

        let num_entries = read_u16(data, eocd_idx + 10) as usize;
        let cd_size = read_u32(data, eocd_idx + 12) as usize;
        let cd_offset = read_u32(data, eocd_idx + 16) as usize;
        let comment_len = read_u16(data, eocd_idx + 20) as usize;

        let comment = if comment_len > 0 && eocd_idx + 22 + comment_len <= len {
            data[eocd_idx + 22..eocd_idx + 22 + comment_len].to_vec()
        } else {
            Vec::new()
        };

        if cd_offset + cd_size > len {
            return Err("El offset del directorio central está fuera de los límites del archivo");
        }

        let mut entries = HashMap::with_capacity(num_entries);
        let mut current_offset = cd_offset;

        for _ in 0..num_entries {
            if current_offset + 46 > len {
                return Err("Directorio central truncado");
            }

            let sig = read_u32(data, current_offset);
            if sig != 0x02014b50 {
                return Err("Firma de cabecera de directorio central inválida");
            }

            let compression_method = read_u16(data, current_offset + 10);
            let last_mod_time = read_u16(data, current_offset + 12);
            let last_mod_date = read_u16(data, current_offset + 14);
            let crc32 = read_u32(data, current_offset + 16);
            let compressed_size = read_u32(data, current_offset + 20);
            let uncompressed_size = read_u32(data, current_offset + 24);
            let name_len = read_u16(data, current_offset + 28) as usize;
            let extra_len = read_u16(data, current_offset + 30) as usize;
            let comment_len = read_u16(data, current_offset + 32) as usize;
            let external_attributes = read_u32(data, current_offset + 38);
            let local_header_offset = read_u32(data, current_offset + 42);

            if current_offset + 46 + name_len + extra_len + comment_len > len {
                return Err("Entrada de directorio central excede el tamaño del archivo");
            }

            let name_bytes = &data[current_offset + 46..current_offset + 46 + name_len];
            let name = String::from_utf8_lossy(name_bytes).into_owned();

            // Leer cabecera local para encontrar el offset exacto de los datos comprimidos
            let lfh_idx = local_header_offset as usize;
            if lfh_idx + 30 > len {
                return Err("Cabecera local fuera de los límites");
            }

            let lfh_sig = read_u32(data, lfh_idx);
            if lfh_sig != 0x04034b50 {
                return Err("Firma de cabecera local inválida");
            }

            let lfh_name_len = read_u16(data, lfh_idx + 26) as usize;
            let lfh_extra_len = read_u16(data, lfh_idx + 28) as usize;

            let data_offset = lfh_idx + 30 + lfh_name_len + lfh_extra_len;
            if data_offset + (compressed_size as usize) > len {
                return Err("Los datos comprimidos de la entrada exceden el tamaño del archivo");
            }

            let compressed_data = &data[data_offset..data_offset + (compressed_size as usize)];

            entries.insert(
                name.clone(),
                ZipEntry {
                    name,
                    compressed_size,
                    uncompressed_size,
                    compression_method,
                    crc32,
                    local_header_offset,
                    last_mod_time,
                    last_mod_date,
                    external_attributes,
                    compressed_data,
                },
            );

            current_offset += 46 + name_len + extra_len + comment_len;
        }

        Ok(ZipArchive { entries, comment })
    }
}

// Implementación rápida de error conversor para simplificar Result
trait OptionExt<T> {
    fn ok_ok_or(self, err: &'static str) -> Result<T, &'static str>;
}

impl<T> OptionExt<T> for Option<T> {
    fn ok_ok_or(self, err: &'static str) -> Result<T, &'static str> {
        self.ok_or(err)
    }
}
