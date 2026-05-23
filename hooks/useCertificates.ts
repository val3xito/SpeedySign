/**
 * useCertificates.ts
 * Hook para gestionar certificados de firma.
 * Usa Supabase como backend: DB para metadatos + Storage para archivos.
 * Cada usuario solo puede ver y usar SUS propios certificados (RLS).
 */

import { useState, useEffect, useCallback } from "react";
import { supabase, ensureAnonymousAuth } from "../utils/supabase";
import { Certificate, createMockCertificate, isCertificateExpired } from "../utils/certValidator";
import { getSigningServerURL } from "../utils/ipaDownloader";

/** Lista de certificados por defecto */
export const DEFAULT_CERTIFICATES: Certificate[] = [];

/** Número máximo de certificados por usuario */
export const MAX_CERTIFICATES = 3;

/**
 * Hook que gestiona el estado de los certificados con Supabase.
 * @returns Objeto con certificados, funciones de importación/eliminación
 */
export function useCertificates() {
    const [certificates, setCertificates] = useState<Certificate[]>([]);
    const [activeCertificateId, setActiveCertificateId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [userId, setUserId] = useState<string | null>(null);

    /**
     * Carga los certificados del usuario desde Supabase.
     */
    const loadCertificates = useCallback(async () => {
        try {
            setLoading(true);

            // Asegurar autenticación anónima
            const uid = await ensureAnonymousAuth();
            setUserId(uid);

            // Cargar certificados del usuario desde Supabase DB
            const { data, error } = await supabase
                .from('certificates')
                .select('*')
                .eq('user_id', uid)
                .order('created_at', { ascending: false });

            if (error) {
                console.error("Error al cargar certificados de Supabase:", error);
                return;
            }

            if (data && data.length > 0) {
                const certs: Certificate[] = data.map((row: any) => {
                    const isDistribution = (row.name || '').toLowerCase().includes('dist');
                    return {
                        id: row.id,
                        name: row.name,
                        type: isDistribution ? 'distribution' as const : 'development' as const,
                        p12FileName: row.p12_file_name || row.name,
                        provisionFileName: row.provision_file_name || "",
                        password: row.p12_password || "",
                        p12URI: row.p12_file_path || "",
                        provisionURI: row.provision_file_path || "",
                        expirationDate: row.expiration_date || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
                        importedAt: row.created_at,
                        isValid: !isCertificateExpired(row.expiration_date),
                    };
                });

                // Marcar el activo
                const activeRow = data.find((r: any) => r.is_active);
                if (activeRow) setActiveCertificateId(activeRow.id);

                setCertificates(certs);
            } else {
                setCertificates([]);
            }
        } catch (error) {
            console.error("Error al cargar certificados:", error);
        } finally {
            setLoading(false);
        }
    }, []);

    // Cargar certificados al montar
    useEffect(() => {
        loadCertificates();
    }, [loadCertificates]);

    /**
     * Sube un archivo a Supabase Storage y devuelve la ruta.
     */
    const uploadFile = async (uid: string, fileUri: string, fileName: string, fileObj?: File): Promise<string> => {
        let blob: Blob;
        if (fileObj) {
            blob = fileObj;
        } else {
            const res = await fetch(fileUri);
            blob = await res.blob();
        }
        const storagePath = `${uid}/${Date.now()}_${fileName}`;

        const { error } = await supabase.storage
            .from('certificates')
            .upload(storagePath, blob, {
                contentType: 'application/octet-stream',
                upsert: false,
            });

        if (error) throw new Error(`Error al subir ${fileName}: ${error.message}`);
        return storagePath;
    };

    /**
     * Importa un nuevo certificado: sube archivos a Storage + guarda metadatos en DB.
     */
    const importCertificate = useCallback(
        async (
            p12FileName: string,
            p12Password: string,
            provisionFileName: string,
            p12TempURI: string,
            provisionTempURI: string,
            commonName?: string,
            realExpirationDate?: string,
            p12FileObj?: File,
            provFileObj?: File
        ): Promise<Certificate> => {
            // Verificar límite antes de subir nada al servidor
            if (certificates.length >= MAX_CERTIFICATES) {
                throw new Error(
                    `Límite de ${MAX_CERTIFICATES} certificados alcanzado. ` +
                    `Elimina uno existente antes de importar otro.`
                );
            }

            const uid = userId || await ensureAnonymousAuth();

            // Subir archivos a Supabase Storage
            const p12Path = await uploadFile(uid, p12TempURI, p12FileName, p12FileObj);

            let provisionPath: string | null = null;
            if (provisionTempURI) {
                provisionPath = await uploadFile(uid, provisionTempURI, provisionFileName, provFileObj);
            }

            // Generar ID del certificado
            const certId = crypto.randomUUID();
            const now = new Date().toISOString();
            
            // Usar la fecha real del certificado o fallback a 1 año
            const expDate = realExpirationDate || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
            
            // Usar el Common Name si existe
            const cleanName = p12FileName.replace(/\.p12$/i, '');
            const finalName = commonName || cleanName;

            // Insertar metadatos en la tabla certificates
            const { error } = await supabase
                .from('certificates')
                .insert({
                    id: certId,
                    user_id: uid,
                    name: finalName,
                    p12_file_name: p12FileName,
                    p12_file_path: p12Path,
                    provision_file_name: provisionFileName,
                    provision_file_path: provisionPath || '',
                    p12_password: p12Password,
                    expiration_date: expDate,
                    is_active: certificates.length === 0,
                    created_at: now,
                });

            if (error) {
                throw new Error(`Error al guardar certificado: ${error.message}`);
            }

            const isDistribution = p12FileName.toLowerCase().includes('dist');
            const newCert: Certificate = {
                id: certId,
                name: finalName,
                type: isDistribution ? 'distribution' : 'development',
                p12FileName,
                provisionFileName,
                password: p12Password,
                p12URI: p12TempURI,
                provisionURI: provisionTempURI,
                expirationDate: expDate,
                importedAt: now,
                isValid: !isCertificateExpired(expDate),
            };

            setCertificates((prev) => [newCert, ...prev]);
            if (certificates.length === 0) setActiveCertificateId(certId);

            return newCert;
        },
        [certificates, userId]
    );

    /**
     * Elimina un certificado: borra archivos de Storage + fila de DB.
     */
    const removeCertificate = useCallback(
        async (id: string) => {
            // Obtener la fila para saber qué archivos borrar
            const { data: row } = await supabase
                .from('certificates')
                .select('p12_file_path, provision_file_path')
                .eq('id', id)
                .single();

            // Borrar archivos de Storage
            if (row) {
                const filesToDelete = [row.p12_file_path, row.provision_file_path].filter(Boolean);
                if (filesToDelete.length > 0) {
                    await supabase.storage.from('certificates').remove(filesToDelete);
                }
            }

            // Borrar de la DB
            await supabase.from('certificates').delete().eq('id', id);

            // Actualizar estado local
            setCertificates((prev) => prev.filter((c) => c.id !== id));

            if (activeCertificateId === id) {
                setActiveCertificateId(null);
            }
        },
        [activeCertificateId]
    );

    /**
     * Establece el certificado activo por ID.
     */
    const setActiveCertificate = useCallback(async (id: string) => {
        const uid = userId || await ensureAnonymousAuth();

        // Desactivar todos los certificados del usuario
        await supabase
            .from('certificates')
            .update({ is_active: false })
            .eq('user_id', uid);

        // Activar el seleccionado
        await supabase
            .from('certificates')
            .update({ is_active: true })
            .eq('id', id);

        setActiveCertificateId(id);
    }, [userId]);

    /**
     * Desactiva un certificado por ID.
     */
    const deactivateCertificate = useCallback(async (id: string) => {
        await supabase
            .from('certificates')
            .update({ is_active: false })
            .eq('id', id);

        setActiveCertificateId(null);
    }, []);

    /**
     * Obtiene el certificado activo válido.
     */
    const getActiveCertificate = useCallback((): Certificate | null => {
        const allValid = [...DEFAULT_CERTIFICATES, ...certificates].filter((c) => c.isValid);
        if (allValid.length === 0) return null;

        if (activeCertificateId) {
            const explicit = allValid.find((c) => c.id === activeCertificateId);
            if (explicit) return explicit;
        }

        const validImported = certificates.filter(c => c.isValid);
        if (validImported.length > 0) {
            return validImported[0]; // Ya ordenados por created_at desc
        }

        return DEFAULT_CERTIFICATES.filter(c => c.isValid)[0] || null;
    }, [certificates, activeCertificateId]);

    /**
     * Verifica la validez y revocación (OCSP) de un certificado existente
     */
    const verifyCertificate = useCallback(async (cert: Certificate) => {
        try {
            if (!cert.p12URI || !cert.password) {
                return { success: false, message: "Faltan credenciales del certificado." };
            }

            // Descargar URL del storage (necesita token o public URL según bucket)
            // Si el bucket es privado y dependemos del cliente para descargarlo, usamos supabase.storage.from:
            const { data, error } = await supabase.storage.from('certificates').download(cert.p12URI);
            if (error || !data) {
                return { success: false, message: "No se pudo descargar el certificado del servidor." };
            }

            // Guardar el arrayBuffer antes de crear la URL (lo necesitamos si forge falla)
            const arrayBuffer = await data.arrayBuffer();

            // Validar usando forge para extraer metadatos y PEMs
            const p12Url = URL.createObjectURL(data);
            const validateP12Password = require('../utils/validateP12').validateP12Password;
            const validation = await validateP12Password(p12Url, cert.password);
            URL.revokeObjectURL(p12Url);

            if (!validation.valid) {
                return { success: false, message: "Contraseña incorrecta o certificado corrupto." };
            }

            // Si forge extrajo la fecha real del cert, actualizarla en Supabase
            if (validation.expirationDate && validation.expirationDate !== cert.expirationDate) {
                await supabase.from('certificates').update({
                    expiration_date: validation.expirationDate,
                    ...(validation.commonName && validation.commonName !== cert.name ? { name: validation.commonName } : {})
                }).eq('id', cert.id);

                setCertificates(prev => prev.map(c => c.id === cert.id ? {
                    ...c,
                    expirationDate: validation.expirationDate!,
                    isValid: !isCertificateExpired(validation.expirationDate!),
                    ...(validation.commonName && validation.commonName !== cert.name ? { name: validation.commonName } : {})
                } : c));
            }

            // Construir el cuerpo de la petición OCSP:
            // - Si forge extrajo los PEMs → los enviamos directamente
            // - Si no (formato moderno OpenSSL 3.x) → enviamos el .p12 en base64
            //   para que sea el servidor (que tiene OpenSSL) quien extraiga los certs
            let requestBody: Record<string, any>;
            if (validation.certPems && validation.certPems.length > 0) {
                requestBody = { certPems: validation.certPems };
            } else {
                const bytes = new Uint8Array(arrayBuffer);
                let binary = '';
                for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                requestBody = { p12Base64: btoa(binary), p12Password: cert.password };
            }

            // Llamar al backend para validar OCSP
            const backendUrl = `${getSigningServerURL()}/api/check-ocsp`;
            try {
                const { data: { session } } = await supabase.auth.getSession();
                const authHeader = session?.access_token
                    ? { 'Authorization': `Bearer ${session.access_token}` }
                    : {};
                const response = await fetch(backendUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...authHeader } as any,
                    body: JSON.stringify(requestBody)
                });

                if (!response.ok) {
                    let msg = "El servidor de verificación no respondió correctamente.";
                    try {
                        const errText = await response.text();
                        const errBody = JSON.parse(errText);
                        msg = errBody.message || errBody.error || msg;
                    } catch { /* respuesta no JSON */ }
                    return { success: false, message: msg };
                }

                let result: any;
                try {
                    const resText = await response.text();
                    result = JSON.parse(resText);
                } catch {
                    return { success: true, message: "Certificado verificado (sin detalle del servidor)." };
                }
                
                // Actualizar validez en DB si fue revocado
                if (result.status === "revoked") {
                    const revokedName = cert.name.endsWith("(Revocado)") ? cert.name : `${cert.name} (Revocado)`;
                    const pastDate = new Date(0).toISOString();
                    
                    await supabase.from('certificates').update({ 
                        is_active: false,
                        name: revokedName,
                        expiration_date: pastDate
                    }).eq('id', cert.id);

                    setCertificates(prev => prev.map(c => c.id === cert.id ? { 
                        ...c, 
                        isValid: false, 
                        isActive: false,
                        name: revokedName,
                        expirationDate: pastDate 
                    } : c));
                    
                    if (activeCertificateId === cert.id) setActiveCertificateId(null);
                }

                return { success: result.status === "valid", message: result.message || "Verificado", status: result.status };

            } catch (fetchErr: any) {
                return { success: false, message: "No se pudo contactar el servidor para comprobar OCSP (asegúrate de que el backend esté corriendo)." };
            }

        } catch (e: any) {
            console.error("Error verificando certificado localmente:", e);
            return { success: false, message: "Ocurrió un error al intentar verificar." };
        }
    }, [activeCertificateId]);

    const hasValidCertificate = [...DEFAULT_CERTIFICATES, ...certificates].some((c) => c.isValid);

    return {
        certificates,
        loading,
        hasValidCertificate,
        importCertificate,
        removeCertificate,
        verifyCertificate,
        getActiveCertificate,
        activeCertificateId,
        setActiveCertificate,
        deactivateCertificate,
        reload: loadCertificates,
    };
}
