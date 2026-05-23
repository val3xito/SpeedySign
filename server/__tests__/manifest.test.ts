/**
 * Tests para utils/manifest.ts
 * Cubre: generateManifest, escapado XML, estructura del plist
 */

import { generateManifest } from "../utils/manifest";

describe("generateManifest", () => {
    it("genera un plist válido con los campos correctos", () => {
        const xml = generateManifest(
            "https://example.com/app.ipa",
            "com.example.app",
            "MyApp",
            "1.0"
        );
        expect(xml).toContain("<?xml version");
        expect(xml).toContain("https://example.com/app.ipa");
        expect(xml).toContain("com.example.app");
        expect(xml).toContain("MyApp");
        expect(xml).toContain("1.0");
        expect(xml).toContain("software-package");
    });

    it("escapa caracteres XML en la URL", () => {
        const xml = generateManifest(
            "https://example.com/app&version=1.ipa",
            "com.example.app",
            "App",
            "1.0"
        );
        expect(xml).toContain("&amp;");
        expect(xml).not.toContain("&version"); // no debe aparecer sin escapar
    });

    it("escapa caracteres XML en el nombre de la app", () => {
        const xml = generateManifest(
            "https://example.com/app.ipa",
            "com.example.app",
            'App <"XSS">',
            "1.0"
        );
        expect(xml).toContain("&lt;");
        expect(xml).toContain("&quot;");
        expect(xml).toContain("&gt;");
    });

    it("usa versión por defecto si no se proporciona", () => {
        const xml = generateManifest(
            "https://example.com/app.ipa",
            "com.example.app",
            "App",
            ""
        );
        expect(xml).toContain("<string>1.0</string>");
    });
});
