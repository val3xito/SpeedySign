/**
 * manifest.ts
 * Generación de manifiestos plist para instalación OTA en iOS.
 */

/**
 * Genera un manifest.plist para instalación OTA en iOS.
 * Escapa los valores para prevenir inyección XML/XSS.
 */
export function generateManifest(
    ipaUrl: string,
    bundleId: string,
    appName: string,
    version: string
): string {
    const escapeXml = (str: string) => String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>items</key>
    <array>
        <dict>
            <key>assets</key>
            <array>
                <dict>
                    <key>kind</key>
                    <string>software-package</string>
                    <key>url</key>
                    <string>${escapeXml(ipaUrl)}</string>
                </dict>
            </array>
            <key>metadata</key>
            <dict>
                <key>bundle-identifier</key>
                <string>${escapeXml(bundleId)}</string>
                <key>bundle-version</key>
                <string>${escapeXml(version || "1.0")}</string>
                <key>kind</key>
                <string>software</string>
                <key>title</key>
                <string>${escapeXml(appName)}</string>
            </dict>
        </dict>
    </array>
</dict>
</plist>`;
}
