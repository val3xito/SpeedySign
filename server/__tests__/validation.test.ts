/**
 * Tests para utils/validation.ts
 * Cubre: sanitizeFilename, isValidDownloadUrl, isValidBundleId, isValidAppName
 */

import { sanitizeFilename, isValidDownloadUrl, isValidBundleId, isValidAppName, isPrivateHostname } from "../utils/validation";

// ── sanitizeFilename ──────────────────────────────────────────────────────────

describe("sanitizeFilename", () => {
    it("acepta nombres válidos", () => {
        expect(sanitizeFilename("MyApp_1.0.ipa")).toBe("MyApp_1.0.ipa");
        expect(sanitizeFilename("cert-dist.p12")).toBe("cert-dist.p12");
        expect(sanitizeFilename("provision.mobileprovision")).toBe("provision.mobileprovision");
    });

    it("rechaza path traversal", () => {
        expect(sanitizeFilename("../../etc/passwd")).toBeNull();
        expect(sanitizeFilename("../secret.txt")).toBeNull();
        expect(sanitizeFilename("..\\secret.txt")).toBeNull();
    });

    it("rechaza caracteres especiales", () => {
        expect(sanitizeFilename("file name.ipa")).toBeNull(); // espacios
        expect(sanitizeFilename("file;rm.ipa")).toBeNull();   // inyección
        expect(sanitizeFilename("file$(cmd).ipa")).toBeNull();
    });

    it("rechaza rutas con separadores", () => {
        expect(sanitizeFilename("/absolute/path/file.ipa")).toBeNull();
        expect(sanitizeFilename("subdir/file.ipa")).toBeNull();
        expect(sanitizeFilename("subdir\\file.ipa")).toBeNull();
    });

    it("devuelve null para entradas vacías o no-string", () => {
        expect(sanitizeFilename("")).toBeNull();
        expect(sanitizeFilename(null as any)).toBeNull();
        expect(sanitizeFilename(undefined as any)).toBeNull();
    });
});

// ── isValidDownloadUrl ────────────────────────────────────────────────────────

describe("isValidDownloadUrl", () => {
    const OLD_ENV = process.env.NODE_ENV;
    afterEach(() => { process.env.NODE_ENV = OLD_ENV; });

    it("acepta HTTPS siempre", () => {
        expect(isValidDownloadUrl("https://example.com/app.ipa")).toBe(true);
    });

    it("acepta HTTP a hosts públicos en desarrollo", () => {
        process.env.NODE_ENV = "development";
        expect(isValidDownloadUrl("http://example.com/app.ipa")).toBe(true);
    });

    it("rechaza IPs privadas (SSRF) incluso en desarrollo", () => {
        process.env.NODE_ENV = "development";
        expect(isValidDownloadUrl("http://localhost/app.ipa")).toBe(false);
        expect(isValidDownloadUrl("http://127.0.0.1/app.ipa")).toBe(false);
        expect(isValidDownloadUrl("https://192.168.1.1/app.ipa")).toBe(false);
        expect(isValidDownloadUrl("https://10.0.0.1/app.ipa")).toBe(false);
        expect(isValidDownloadUrl("https://169.254.169.254/latest/meta-data/")).toBe(false);
    });

    it("rechaza HTTP en producción", () => {
        process.env.NODE_ENV = "production";
        expect(isValidDownloadUrl("http://example.com/app.ipa")).toBe(false);
    });

    it("rechaza URLs malformadas", () => {
        expect(isValidDownloadUrl("not-a-url")).toBe(false);
        expect(isValidDownloadUrl("")).toBe(false);
        expect(isValidDownloadUrl(null as any)).toBe(false);
    });

    it("rechaza protocolos peligrosos", () => {
        expect(isValidDownloadUrl("javascript:alert(1)")).toBe(false);
        expect(isValidDownloadUrl("file:///etc/passwd")).toBe(false);
        expect(isValidDownloadUrl("data:text/html,<h1>xss</h1>")).toBe(false);
    });

    it("permite IPv4 publico cuando DNS lo devuelve como IPv6-mapped", () => {
        expect(isPrivateHostname("::ffff:8.8.8.8")).toBe(false);
        expect(isPrivateHostname("::ffff:10.0.0.1")).toBe(true);
        expect(isPrivateHostname("::ffff:169.254.169.254")).toBe(true);
    });
});

// ── isValidBundleId ───────────────────────────────────────────────────────────

describe("isValidBundleId", () => {
    it("acepta bundle IDs válidos", () => {
        expect(isValidBundleId("com.example.app")).toBe(true);
        expect(isValidBundleId("org.myorg.MyApp123")).toBe(true);
        expect(isValidBundleId("")).toBe(true); // Vacío es válido (opcional)
    });

    it("rechaza bundle IDs con caracteres inválidos", () => {
        expect(isValidBundleId("com.app name")).toBe(false); // espacios
        expect(isValidBundleId("com.app!@#")).toBe(false);   // especiales
    });

    it("rechaza bundle IDs demasiado largos", () => {
        expect(isValidBundleId("a".repeat(156))).toBe(false);
    });
});

// ── isValidAppName ────────────────────────────────────────────────────────────

describe("isValidAppName", () => {
    it("acepta nombres válidos", () => {
        expect(isValidAppName("My App")).toBe(true);
        expect(isValidAppName("TestApp-1.0")).toBe(true);
        expect(isValidAppName("App (Beta)")).toBe(true);
    });

    it("rechaza nombres con inyección", () => {
        expect(isValidAppName("App; rm -rf /")).toBe(false);
        expect(isValidAppName("App$(cmd)")).toBe(false);
        expect(isValidAppName('App"exploit')).toBe(false);
    });

    it("rechaza nombres vacíos o muy largos", () => {
        expect(isValidAppName("")).toBe(false);
        expect(isValidAppName("a".repeat(101))).toBe(false);
        expect(isValidAppName(null as any)).toBe(false);
    });
});
