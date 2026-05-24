pub mod p12;
pub mod cms;

pub struct AppleSigner {
    pub certificate: Vec<u8>,
    pub private_key: Vec<u8>,
}

impl AppleSigner {
    /// Carga el certificado y llave privada desde un buffer .p12
    pub fn from_p12(p12_bytes: &[u8], password: &str) -> Result<Self, &'static str> {
        // En una implementación final, esto usará el parser ASN.1 / PKCS12 para extraer
        // el certificado X.509 de Apple y la llave privada RSA/ECDSA.
        p12::extract_credentials(p12_bytes, password)
    }

    /// Firma un bloque de datos (generalmente la estructura CodeDirectory) y retorna la firma CMS/PKCS#7
    pub fn sign_code_directory(&self, code_directory_bytes: &[u8]) -> Result<Vec<u8>, &'static str> {
        cms::generate_cms_signature(code_directory_bytes, &self.certificate, &self.private_key)
    }
}
