use std::io::{Seek, Write};
use flate2::write::DeflateEncoder;
use flate2::Compression;
use super::parser::ZipEntry;

pub struct WrittenEntry {
    pub name: String,
    pub compressed_size: u32,
    pub uncompressed_size: u32,
    pub compression_method: u16,
    pub crc32: u32,
    pub local_header_offset: u32,
    pub last_mod_time: u16,
    pub last_mod_date: u16,
    pub external_attributes: u32,
}

pub struct ZipWriter<W: Write + Seek> {
    writer: W,
    written_entries: Vec<WrittenEntry>,
}

impl<W: Write + Seek> ZipWriter<W> {
    pub fn new(writer: W) -> Self {
        Self {
            writer,
            written_entries: Vec::new(),
        }
    }

    /// Copia una entrada ZIP directamente del archivo original sin descomprimir ni recomprimir.
    /// Esto es extremadamente rápido y eficiente.
    pub fn write_raw_entry(&mut self, original_data: &[u8], entry: &ZipEntry) -> Result<(), &'static str> {
        let current_offset = self
            .writer
            .stream_position()
            .map_err(|_| "Error al obtener posición del escritor")? as u32;

        let lfh_idx = entry.local_header_offset as usize;
        if lfh_idx + 30 > original_data.len() {
            return Err("Cabecera local fuera de los límites de los datos originales");
        }

        // Obtener el tamaño real de nombre y extra en la cabecera local original
        let name_len = u16::from_le_bytes([original_data[lfh_idx + 26], original_data[lfh_idx + 27]]) as usize;
        let extra_len = u16::from_le_bytes([original_data[lfh_idx + 28], original_data[lfh_idx + 29]]) as usize;
        let total_block_len = 30 + name_len + extra_len + (entry.compressed_size as usize);

        if lfh_idx + total_block_len > original_data.len() {
            return Err("El bloque de la entrada excede los límites de los datos originales");
        }

        // Copiar en crudo todo el bloque (Cabecera Local + Datos Comprimidos)
        let block_bytes = &original_data[lfh_idx..lfh_idx + total_block_len];
        self.writer
            .write_all(block_bytes)
            .map_err(|_| "Error al escribir bloque de entrada ZIP")?;

        self.written_entries.push(WrittenEntry {
            name: entry.name.clone(),
            compressed_size: entry.compressed_size,
            uncompressed_size: entry.uncompressed_size,
            compression_method: entry.compression_method,
            crc32: entry.crc32,
            local_header_offset: current_offset,
            last_mod_time: entry.last_mod_time,
            last_mod_date: entry.last_mod_date,
            external_attributes: entry.external_attributes,
        });

        Ok(())
    }

    /// Escribe un archivo nuevo desde un buffer en memoria, con opción de comprimirlo.
    pub fn write_file(&mut self, name: &str, data: &[u8], compress: bool, external_attributes: u32) -> Result<(), &'static str> {
        let current_offset = self
            .writer
            .stream_position()
            .map_err(|_| "Error al obtener posición del escritor")? as u32;

        let crc32 = crc32fast::hash(data);
        let uncompressed_size = data.len() as u32;

        let (compression_method, compressed_data) = if compress {
            let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
            encoder
                .write_all(data)
                .map_err(|_| "Error al comprimir archivo")?;
            let compressed = encoder.finish().map_err(|_| "Error al finalizar compresión")?;
            (8u16, compressed)
        } else {
            (0u16, data.to_vec())
        };

        let compressed_size = compressed_data.len() as u32;
        let name_bytes = name.as_bytes();
        let name_len = name_bytes.len() as u16;

        // Escribir cabecera local
        // Firma: 0x04034b50
        self.writer
            .write_all(&0x04034b50u32.to_le_bytes())
            .map_err(|_| "Error al escribir firma LFH")?;
        // Versión requerida: 20 (para deflate y carpetas)
        self.writer
            .write_all(&20u16.to_le_bytes())
            .map_err(|_| "Error al escribir versión LFH")?;
        // Flags: 0
        self.writer
            .write_all(&0u16.to_le_bytes())
            .map_err(|_| "Error al escribir flags LFH")?;
        // Método de compresión
        self.writer
            .write_all(&compression_method.to_le_bytes())
            .map_err(|_| "Error al escribir método de compresión LFH")?;
        // Last mod time & date: 0 (valores por defecto para reproducibilidad)
        self.writer
            .write_all(&0u16.to_le_bytes())
            .map_err(|_| "Error al escribir mod time LFH")?;
        self.writer
            .write_all(&0u16.to_le_bytes())
            .map_err(|_| "Error al escribir mod date LFH")?;
        // CRC32
        self.writer
            .write_all(&crc32.to_le_bytes())
            .map_err(|_| "Error al escribir crc LFH")?;
        // Tamaño comprimido
        self.writer
            .write_all(&compressed_size.to_le_bytes())
            .map_err(|_| "Error al escribir tamaño comprimido LFH")?;
        // Tamaño descomprimido
        self.writer
            .write_all(&uncompressed_size.to_le_bytes())
            .map_err(|_| "Error al escribir tamaño descomprimido LFH")?;
        // Nombre length
        self.writer
            .write_all(&name_len.to_le_bytes())
            .map_err(|_| "Error al escribir largo del nombre LFH")?;
        // Extra field length: 0
        self.writer
            .write_all(&0u16.to_le_bytes())
            .map_err(|_| "Error al escribir largo de extra LFH")?;
        // Nombre
        self.writer
            .write_all(name_bytes)
            .map_err(|_| "Error al escribir nombre LFH")?;

        // Escribir datos
        self.writer
            .write_all(&compressed_data)
            .map_err(|_| "Error al escribir datos de archivo")?;

        self.written_entries.push(WrittenEntry {
            name: name.to_string(),
            compressed_size,
            uncompressed_size,
            compression_method,
            crc32,
            local_header_offset: current_offset,
            last_mod_time: 0,
            last_mod_date: 0,
            external_attributes,
        });

        Ok(())
    }

    /// Escribe el Directorio Central (Central Directory) y finaliza el archivo ZIP.
    pub fn finish(mut self, comment: &[u8]) -> Result<(), &'static str> {
        let cd_offset = self
            .writer
            .stream_position()
            .map_err(|_| "Error al obtener posición del escritor")? as u32;

        let mut cd_size = 0u32;

        // Escribir cabeceras del Directorio Central
        for entry in &self.written_entries {
            let name_bytes = entry.name.as_bytes();
            let name_len = name_bytes.len() as u16;

            // Firma de directorio central: 0x02014b50
            self.writer
                .write_all(&0x02014b50u32.to_le_bytes())
                .map_err(|_| "Error al escribir firma CD")?;
            // Versión creada por: 20 (Unix)
            self.writer
                .write_all(&0x0314u16.to_le_bytes())
                .map_err(|_| "Error al escribir version made by CD")?;
            // Versión requerida: 20
            self.writer
                .write_all(&20u16.to_le_bytes())
                .map_err(|_| "Error al escribir version needed CD")?;
            // Flags
            self.writer
                .write_all(&0u16.to_le_bytes())
                .map_err(|_| "Error al escribir flags CD")?;
            // Método de compresión
            self.writer
                .write_all(&entry.compression_method.to_le_bytes())
                .map_err(|_| "Error al escribir metodo CD")?;
            // Last mod time & date
            self.writer
                .write_all(&entry.last_mod_time.to_le_bytes())
                .map_err(|_| "Error al escribir mod time CD")?;
            self.writer
                .write_all(&entry.last_mod_date.to_le_bytes())
                .map_err(|_| "Error al escribir mod date CD")?;
            // CRC32
            self.writer
                .write_all(&entry.crc32.to_le_bytes())
                .map_err(|_| "Error al escribir crc CD")?;
            // Tamaño comprimido
            self.writer
                .write_all(&entry.compressed_size.to_le_bytes())
                .map_err(|_| "Error al escribir tamaño comp CD")?;
            // Tamaño descomprimido
            self.writer
                .write_all(&entry.uncompressed_size.to_le_bytes())
                .map_err(|_| "Error al escribir tamaño descomp CD")?;
            // Name length
            self.writer
                .write_all(&name_len.to_le_bytes())
                .map_err(|_| "Error al escribir largo nombre CD")?;
            // Extra field length: 0
            self.writer
                .write_all(&0u16.to_le_bytes())
                .map_err(|_| "Error al escribir largo extra CD")?;
            // Comment length: 0
            self.writer
                .write_all(&0u16.to_le_bytes())
                .map_err(|_| "Error al escribir largo comentario CD")?;
            // Disk number start: 0
            self.writer
                .write_all(&0u16.to_le_bytes())
                .map_err(|_| "Error al escribir disco inicio CD")?;
            // Internal attr: 0
            self.writer
                .write_all(&0u16.to_le_bytes())
                .map_err(|_| "Error al escribir interno attr CD")?;
            // External attr: de la entrada original
            self.writer
                .write_all(&entry.external_attributes.to_le_bytes())
                .map_err(|_| "Error al escribir externo attr CD")?;
            // Local header offset
            self.writer
                .write_all(&entry.local_header_offset.to_le_bytes())
                .map_err(|_| "Error al escribir offset local CD")?;
            // Escribir nombre
            self.writer
                .write_all(name_bytes)
                .map_err(|_| "Error al escribir nombre CD")?;

            cd_size += 46 + name_len as u32;
        }

        // Escribir End of Central Directory (EOCD)
        let num_entries = self.written_entries.len() as u16;
        let comment_len = comment.len() as u16;

        // Firma EOCD: 0x06054b50
        self.writer
            .write_all(&0x06054b50u32.to_le_bytes())
            .map_err(|_| "Error al escribir firma EOCD")?;
        // Disk number: 0
        self.writer
            .write_all(&0u16.to_le_bytes())
            .map_err(|_| "Error al escribir disco EOCD")?;
        // Disk start CD: 0
        self.writer
            .write_all(&0u16.to_le_bytes())
            .map_err(|_| "Error al escribir disco CD EOCD")?;
        // Entries on this disk
        self.writer
            .write_all(&num_entries.to_le_bytes())
            .map_err(|_| "Error al escribir total de entradas en disco EOCD")?;
        // Total entries
        self.writer
            .write_all(&num_entries.to_le_bytes())
            .map_err(|_| "Error al escribir total de entradas EOCD")?;
        // Size of CD
        self.writer
            .write_all(&cd_size.to_le_bytes())
            .map_err(|_| "Error al escribir tamaño CD EOCD")?;
        // Offset of CD
        self.writer
            .write_all(&cd_offset.to_le_bytes())
            .map_err(|_| "Error al escribir offset CD EOCD")?;
        // Comment length
        self.writer
            .write_all(&comment_len.to_le_bytes())
            .map_err(|_| "Error al escribir largo comentario EOCD")?;
        // Comment
        if comment_len > 0 {
            self.writer
                .write_all(comment)
                .map_err(|_| "Error al escribir comentario EOCD")?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::zip::{ZipArchive, decompress_entry};
    use std::io::Cursor;

    #[test]
    fn test_zip_in_memory() {
        let mut buffer = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(&mut buffer);

        // 1. Escribir un archivo almacenado (sin compresión)
        let file1_data = b"Hola, este es un archivo de prueba almacenado sin comprimir.";
        writer.write_file("test_stored.txt", file1_data, false, 0).unwrap();

        // 2. Escribir un archivo comprimido (deflated)
        let file2_data = b"Hola, este es un archivo de prueba comprimido usando deflate! Repetir datos para probar compresion. Repetir datos para probar compresion. Repetir datos para probar compresion.";
        writer.write_file("test_compressed.txt", file2_data, true, 0).unwrap();

        // Finalizar el zip
        writer.finish(b"Comentario de prueba").unwrap();

        // Obtener los bytes resultantes
        let zip_bytes = buffer.into_inner();

        // 3. Parsear el zip generado en memoria
        let archive = ZipArchive::parse(&zip_bytes).unwrap();

        assert_eq!(archive.comment, b"Comentario de prueba");
        assert_eq!(archive.entries.len(), 2);

        // 4. Verificar archivo almacenado
        let entry1 = archive.entries.get("test_stored.txt").unwrap();
        assert_eq!(entry1.compression_method, 0);
        assert_eq!(entry1.uncompressed_size as usize, file1_data.len());
        let decompressed1 = decompress_entry(entry1).unwrap();
        assert_eq!(decompressed1, file1_data);

        // 5. Verificar archivo comprimido
        let entry2 = archive.entries.get("test_compressed.txt").unwrap();
        assert_eq!(entry2.compression_method, 8);
        assert_eq!(entry2.uncompressed_size as usize, file2_data.len());
        let decompressed2 = decompress_entry(entry2).unwrap();
        assert_eq!(decompressed2, file2_data);

        // 6. Probar Raw Block Copying en un nuevo zip
        let mut raw_buffer = Cursor::new(Vec::new());
        let mut raw_writer = ZipWriter::new(&mut raw_buffer);

        raw_writer.write_raw_entry(&zip_bytes, entry2).unwrap();
        raw_writer.finish(b"").unwrap();

        let raw_zip_bytes = raw_buffer.into_inner();
        let raw_archive = ZipArchive::parse(&raw_zip_bytes).unwrap();
        let raw_entry = raw_archive.entries.get("test_compressed.txt").unwrap();
        assert_eq!(raw_entry.compression_method, 8);
        assert_eq!(decompress_entry(raw_entry).unwrap(), file2_data);
    }
}
