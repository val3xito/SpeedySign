pub mod injection;
pub use injection::inject_dylib;
use goblin::mach::{Mach, MachO};

pub struct MachOInfo {
    pub is_fat: bool,
    pub architectures: Vec<String>,
}

/// Parsea un binario Mach-O (soportando binarios universales/fat) y extrae información básica.
pub fn parse_macho(data: &[u8]) -> Result<MachOInfo, &'static str> {
    match Mach::parse(data) {
        Ok(Mach::Binary(macho)) => {
            let arch = get_arch_name(&macho);
            Ok(MachOInfo {
                is_fat: false,
                architectures: vec![arch],
            })
        }
        Ok(Mach::Fat(fat)) => {
            let mut architectures = Vec::new();
            for arch in fat.iter_arches() {
                if let Ok(arch) = arch {
                    // Podemos obtener información de la arquitectura desde el CPU type
                    let name = format!("CPU Type: {}, Subtype: {}", arch.cputype, arch.cpusubtype);
                    architectures.push(name);
                }
            }
            Ok(MachOInfo {
                is_fat: true,
                architectures,
            })
        }
        Err(_) => Err("El binario no es un formato Mach-O válido"),
    }
}

fn get_arch_name(macho: &MachO) -> String {
    if macho.is_64 {
        "arm64 / x86_64 (64-bit)".to_string()
    } else {
        "arm / i386 (32-bit)".to_string()
    }
}
