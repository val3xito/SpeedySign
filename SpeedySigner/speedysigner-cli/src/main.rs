use anyhow::{anyhow, bail, Context, Result};
use speedysigner_core::{sign_ipa, SignConfig};
use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::Path;

#[derive(Debug, Default)]
struct Args {
    key: String,
    password: Option<String>,
    provision: String,
    output: String,
    bundle_id: Option<String>,
    name: Option<String>,
    version: Option<String>,
    entitlements: Option<String>,
    sha256_only: bool,
    compression: Option<u8>,
    dylib: Vec<String>,
    weak_dylib: Vec<String>,
    input: String,
}

fn main() -> Result<()> {
    let args = parse_args(env::args().skip(1))?;
    println!("=== SpeedySigner CLI ===");
    println!("Entrada: {}", args.input);
    println!("Salida: {}", args.output);
    println!("Certificado: {}", args.key);
    println!("Provision: {}", args.provision);

    validate_inputs(&args)?;

    println!("Motor de firma: SpeedySigner nativo");
    let config = args.to_sign_config();
    sign_ipa(&config).map_err(|err| anyhow!(err))?;

    println!("=== SpeedySigner completo la firma con exito ===");
    Ok(())
}

fn parse_args<I, S>(raw_args: I) -> Result<Args>
where
    I: IntoIterator<Item = S>,
    S: Into<OsString>,
{
    let mut args = Args::default();
    let mut iter = raw_args.into_iter().map(Into::into).peekable();

    while let Some(raw) = iter.next() {
        let arg = raw.to_string_lossy().into_owned();
        match arg.as_str() {
            "-h" | "--help" => {
                print_help();
                std::process::exit(0);
            }
            "-v" | "--version" => {
                println!("speedysigner-cli {}", env!("CARGO_PKG_VERSION"));
                std::process::exit(0);
            }
            "-k" | "--key" | "--pkey" => args.key = take_value(&mut iter, &arg)?,
            "-p" | "--password" => args.password = Some(take_value(&mut iter, &arg)?),
            "-m" | "--provision" | "--prov" => args.provision = take_value(&mut iter, &arg)?,
            "-o" | "--output" => args.output = take_value(&mut iter, &arg)?,
            "-b" | "--bundle-id" | "--bundle_id" => {
                args.bundle_id = Some(take_value(&mut iter, &arg)?);
            }
            "-n" | "--name" | "--bundle-name" | "--bundle_name" => {
                args.name = Some(take_value(&mut iter, &arg)?);
            }
            "-r" | "--version-name" | "--bundle-version" | "--bundle_version" => {
                args.version = Some(take_value(&mut iter, &arg)?);
            }
            "-e" | "--entitlements" => args.entitlements = Some(take_value(&mut iter, &arg)?),
            "-z" | "--compression" | "--zip-level" | "--zip_level" => {
                let value = take_value(&mut iter, &arg)?;
                args.compression = Some(
                    value
                        .parse::<u8>()
                        .with_context(|| format!("Nivel de compresion invalido: {}", value))?,
                );
            }
            "-l" | "--dylib" => args.dylib.push(take_value(&mut iter, &arg)?),
            "-w" | "--weak" | "--weak-dylib" | "--weak_dylib" => {
                args.weak_dylib.push(take_value(&mut iter, &arg)?);
            }
            "-2" | "--sha256_only" | "--sha256-only" => args.sha256_only = true,
            _ if arg.starts_with('-') => bail!("Argumento no soportado: {}", arg),
            _ => {
                if args.input.is_empty() {
                    args.input = arg;
                } else {
                    bail!(
                        "Solo se permite una IPA de entrada. Argumento extra: {}",
                        arg
                    );
                }
            }
        }
    }

    if args.key.is_empty() {
        bail!("Falta el certificado: usa -k <certificado.p12>");
    }
    if args.provision.is_empty() {
        bail!("Falta el provisioning profile: usa -m <perfil.mobileprovision>");
    }
    if args.output.is_empty() {
        bail!("Falta la salida: usa -o <salida.ipa>");
    }
    if args.input.is_empty() {
        bail!("Falta la IPA de entrada");
    }

    Ok(args)
}

impl Args {
    fn to_sign_config(&self) -> SignConfig {
        SignConfig {
            input_path: self.input.clone(),
            output_path: self.output.clone(),
            p12_path: self.key.clone(),
            p12_password: self.password.clone().unwrap_or_default(),
            provision_path: self.provision.clone(),
            bundle_id: self.bundle_id.clone(),
            app_name: self.name.clone(),
            version: self.version.clone(),
            entitlements_path: self.entitlements.clone(),
            sha256_only: self.sha256_only,
            compression_level: self.compression,
            dylib_paths: self.dylib.clone(),
            weak_dylib_paths: self.weak_dylib.clone(),
        }
    }
}

fn take_value<I>(iter: &mut std::iter::Peekable<I>, flag: &str) -> Result<String>
where
    I: Iterator<Item = OsString>,
{
    let value = iter
        .next()
        .ok_or_else(|| anyhow!("{} requiere un valor", flag))?;
    Ok(value.to_string_lossy().into_owned())
}

fn print_help() {
    println!(
        "SpeedySigner CLI\n\nUsage: speedysigner -k cert.p12 -p password -m profile.mobileprovision -o output.ipa [options] input.ipa\n\nOptions:\n  -k, --key <file>              Certificado .p12\n  -p, --password <password>     Contrasena del certificado\n  -m, --provision <file>        Provisioning profile\n  -o, --output <file>           IPA de salida\n  -b, --bundle-id <id>          Bundle ID nuevo\n  -n, --name <name>             Nombre visible nuevo\n  -r, --bundle-version <ver>    Version nueva\n  -e, --entitlements <file>     Entitlements personalizados\n  -z, --compression <0-9>       Nivel de compresion ZIP\n  -l, --dylib <file>            Inyecta una dylib\n  -w, --weak <file>             Inyecta una dylib debil\n  -2, --sha256-only             Firma solo con SHA-256"
    );
}

fn validate_inputs(args: &Args) -> Result<()> {
    ensure_file(&args.input, "IPA de entrada")?;
    ensure_file(&args.key, "certificado")?;
    ensure_file(&args.provision, "provisioning profile")?;

    if let Some(ref entitlements) = args.entitlements {
        ensure_file(entitlements, "entitlements")?;
    }

    if let Some(level) = args.compression {
        if level > 9 {
            bail!("El nivel de compresion debe estar entre 0 y 9");
        }
    }

    for dylib in args.dylib.iter().chain(args.weak_dylib.iter()) {
        ensure_file(dylib, "dylib")?;
    }

    if let Some(parent) = Path::new(&args.output).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).with_context(|| {
                format!(
                    "No se pudo crear el directorio de salida {}",
                    parent.display()
                )
            })?;
        }
    }

    Ok(())
}

fn ensure_file(path: &str, label: &str) -> Result<()> {
    let path = Path::new(path);
    if !path.is_file() {
        bail!(
            "No se encontro el archivo de {} en {}",
            label,
            path.display()
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_args() -> Args {
        Args {
            key: "cert.p12".into(),
            password: Some("pass".into()),
            provision: "profile.mobileprovision".into(),
            output: "out.ipa".into(),
            bundle_id: Some("com.example.app".into()),
            name: Some("Example".into()),
            version: Some("1.2.3".into()),
            entitlements: Some("entitlements.plist".into()),
            sha256_only: true,
            compression: Some(0),
            dylib: vec!["one.dylib".into()],
            weak_dylib: vec!["weak.dylib".into()],
            input: "in.ipa".into(),
        }
    }

    #[test]
    fn builds_native_sign_config_from_cli_args() {
        let args = base_args();
        let config = args.to_sign_config();

        assert_eq!(config.p12_path, "cert.p12");
        assert_eq!(config.p12_password, "pass");
        assert_eq!(config.provision_path, "profile.mobileprovision");
        assert_eq!(config.output_path, "out.ipa");
        assert_eq!(config.bundle_id.as_deref(), Some("com.example.app"));
        assert_eq!(config.app_name.as_deref(), Some("Example"));
        assert_eq!(config.version.as_deref(), Some("1.2.3"));
        assert_eq!(
            config.entitlements_path.as_deref(),
            Some("entitlements.plist")
        );
        assert_eq!(config.compression_level, Some(0));
        assert_eq!(config.dylib_paths, vec!["one.dylib"]);
        assert_eq!(config.weak_dylib_paths, vec!["weak.dylib"]);
        assert!(config.sha256_only);
        assert_eq!(config.input_path, "in.ipa");
    }
}
