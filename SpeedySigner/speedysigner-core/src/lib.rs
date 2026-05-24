pub mod zip;
pub mod macho;
pub mod plist;
pub mod signature;
pub mod signer;

// Re-exportar las funciones más utilizadas
pub use signer::extract_macho_from_ipa;
pub use macho::{parse_macho, inject_dylib};
pub use plist::PlistEditor;
pub use signature::AppleSigner;
pub use zip::{ZipArchive, ZipEntry, ZipWriter};
