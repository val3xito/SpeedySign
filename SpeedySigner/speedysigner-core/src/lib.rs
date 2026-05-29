pub mod macho;
pub mod plist;
pub mod signature;
pub mod signer;
pub mod zip;

// Re-exportar las funciones más utilizadas
pub use macho::{inject_dylib, parse_macho};
pub use plist::PlistEditor;
pub use signature::AppleSigner;
pub use signer::{extract_macho_from_ipa, sign_ipa, SignConfig};
pub use zip::{ZipArchive, ZipEntry, ZipWriter};
