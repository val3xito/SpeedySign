use super::parser::ZipEntry;
use flate2::read::DeflateDecoder;
use std::io::Read;

pub fn decompress_entry(entry: &ZipEntry) -> Result<Vec<u8>, &'static str> {
    match entry.compression_method {
        0 => {
            // Stored (no compression)
            Ok(entry.compressed_data.to_vec())
        }
        8 => {
            // Deflated
            let mut decoder = DeflateDecoder::new(entry.compressed_data);
            let mut decompressed = Vec::with_capacity(entry.uncompressed_size as usize);
            decoder
                .read_to_end(&mut decompressed)
                .map_err(|_| "Error al descomprimir datos Deflate")?;
            Ok(decompressed)
        }
        _ => Err("Método de compresión no soportado"),
    }
}
