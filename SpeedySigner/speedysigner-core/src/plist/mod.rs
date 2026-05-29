use plist::{Dictionary, Value};
use std::io::Cursor;

pub struct PlistEditor {
    pub dict: Dictionary,
}

impl PlistEditor {
    pub fn parse(data: &[u8]) -> Result<Self, &'static str> {
        let value = Value::from_reader(Cursor::new(data))
            .map_err(|_| "Error al parsear Plist en memoria")?;

        let dict = value
            .into_dictionary()
            .ok_or("El Plist no es un diccionario válido")?;

        Ok(Self { dict })
    }

    /// Cambia el identificador del paquete (Bundle ID)
    pub fn set_bundle_id(&mut self, bundle_id: &str) {
        self.dict.insert(
            "CFBundleIdentifier".to_string(),
            Value::String(bundle_id.to_string()),
        );
    }

    /// Cambia el nombre de visualización (Display Name)
    pub fn set_display_name(&mut self, display_name: &str) {
        self.dict.insert(
            "CFBundleDisplayName".to_string(),
            Value::String(display_name.to_string()),
        );
        self.dict.insert(
            "CFBundleName".to_string(),
            Value::String(display_name.to_string()),
        );
    }

    /// Cambia las versiones
    pub fn set_version(&mut self, version: &str) {
        self.dict.insert(
            "CFBundleShortVersionString".to_string(),
            Value::String(version.to_string()),
        );
        self.dict.insert(
            "CFBundleVersion".to_string(),
            Value::String(version.to_string()),
        );
    }

    /// Habilita compartir archivos de la app en la app Archivos de iOS
    pub fn enable_file_sharing(&mut self) {
        self.dict
            .insert("UIFileSharingEnabled".to_string(), Value::Boolean(true));
        self.dict.insert(
            "LSSupportsOpeningDocumentsInPlace".to_string(),
            Value::Boolean(true),
        );
    }

    /// Serializa los cambios a formato Plist binario para minimizar el espacio e incrementar velocidad
    pub fn serialize_to_binary(&self) -> Result<Vec<u8>, &'static str> {
        let mut buffer = Vec::new();
        let value = Value::Dictionary(self.dict.clone());
        value
            .to_writer_binary(&mut buffer)
            .map_err(|_| "Error al serializar Plist a formato binario")?;
        Ok(buffer)
    }

    /// Serializa los cambios a formato XML
    pub fn serialize_to_xml(&self) -> Result<Vec<u8>, &'static str> {
        let mut buffer = Vec::new();
        let value = Value::Dictionary(self.dict.clone());
        value
            .to_writer_xml(&mut buffer)
            .map_err(|_| "Error al serializar Plist a formato XML")?;
        Ok(buffer)
    }
}
