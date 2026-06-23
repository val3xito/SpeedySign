/**
 * Tests unitarios para utils/sanitizer.ts
 * Cubre las funciones críticas de seguridad del frontend.
 */

import {
    sanitizeFilename,
    sanitizeUrl,
    escapeHTML,
    validateProtocol,
    sanitizeText,
} from "../sanitizer";

// ── sanitizeFilename ──────────────────────────────────────────────────────────

describe("sanitizeFilename", () => {
    it("permite caracteres alfanuméricos, puntos, guiones y underscores", () => {
        expect(sanitizeFilename("my-app_v1.0.ipa")).toBe("my-app_v1.0.ipa");
    });

    it("reemplaza espacios por underscore", () => {
        expect(sanitizeFilename("my app.ipa")).toBe("my_app.ipa");
    });

    it("elimina path traversal", () => {
        const result = sanitizeFilename("../../etc/passwd");
        expect(result).not.toContain("../");
        expect(result).not.toContain("..\\");
        // El string resultante no debe poder traversar directorios
        expect(result).toBe("etc_passwd");
    });

    it("elimina caracteres especiales peligrosos", () => {
        const result = sanitizeFilename("app;rm -rf /.ipa");
        expect(result).not.toContain(";");
        expect(result).not.toContain(" ");
    });

    it("colapsa múltiples underscores consecutivos", () => {
        expect(sanitizeFilename("my___app")).toBe("my_app");
    });

    it("trunca a 255 caracteres", () => {
        const long = "a".repeat(300);
        expect(sanitizeFilename(long).length).toBeLessThanOrEqual(255);
    });

    it("maneja string vacío", () => {
        expect(sanitizeFilename("")).toBe("");
    });
});

// ── sanitizeUrl ───────────────────────────────────────────────────────────────

describe("sanitizeUrl", () => {
    it("devuelve URL válida sin fragmento", () => {
        expect(sanitizeUrl("https://example.com/app.ipa#section")).toBe(
            "https://example.com/app.ipa"
        );
    });

    it("devuelve string vacío para URLs inválidas", () => {
        expect(sanitizeUrl("not-a-url")).toBe("");
        expect(sanitizeUrl("javascript:alert(1)")).toBe("");
    });

    it("preserva query params válidos", () => {
        const url = "https://example.com/app.ipa?token=abc123";
        expect(sanitizeUrl(url)).toBe(url);
    });
});

// ── escapeHTML ────────────────────────────────────────────────────────────────

describe("escapeHTML", () => {
    it("escapa ampersand", () => {
        expect(escapeHTML("Tom & Jerry")).toBe("Tom &amp; Jerry");
    });

    it("escapa tags HTML", () => {
        expect(escapeHTML("<script>alert(1)</script>")).toBe(
            "&lt;script&gt;alert(1)&lt;/script&gt;"
        );
    });

    it("escapa comillas dobles y simples", () => {
        expect(escapeHTML('"quoted"')).toBe("&quot;quoted&quot;");
        expect(escapeHTML("it's")).toBe("it&#x27;s");
    });

    it("devuelve el mismo string si no hay caracteres peligrosos", () => {
        expect(escapeHTML("Hello World 123")).toBe("Hello World 123");
    });

    it("maneja string vacío", () => {
        expect(escapeHTML("")).toBe("");
    });
});

// ── validateProtocol ─────────────────────────────────────────────────────────

describe("validateProtocol", () => {
    it("acepta URLs https", () => {
        expect(validateProtocol("https://cdn.example.com/app.ipa")).toBe(true);
    });

    it("acepta blob: URLs", () => {
        expect(validateProtocol("blob:https://example.com/abc-123")).toBe(true);
    });

    it("acepta file: URLs", () => {
        expect(validateProtocol("file:///tmp/app.ipa")).toBe(true);
    });

    it("acepta rutas relativas", () => {
        expect(validateProtocol("/assets/icon.png")).toBe(true);
    });

    it("rechaza http (no seguro)", () => {
        expect(validateProtocol("http://example.com/app.ipa")).toBe(false);
    });

    it("rechaza javascript: (XSS)", () => {
        expect(validateProtocol("javascript:alert(1)")).toBe(false);
    });

    it("rechaza data: (exfiltración)", () => {
        expect(validateProtocol("data:text/html,<script>alert(1)</script>")).toBe(false);
    });

    it("rechaza string vacío", () => {
        expect(validateProtocol("")).toBe(false);
    });
});

// ── sanitizeText ─────────────────────────────────────────────────────────────

describe("sanitizeText", () => {
    it("elimina tags HTML", () => {
        expect(sanitizeText("<b>Hola</b> mundo")).toBe("Hola mundo");
    });

    it("elimina scripts incrustados", () => {
        expect(sanitizeText('<script>alert("xss")</script>Texto')).not.toContain("<script>");
    });

    it("respeta el límite de longitud por defecto", () => {
        const long = "a".repeat(600);
        expect(sanitizeText(long).length).toBeLessThanOrEqual(500);
    });

    it("respeta límite de longitud personalizado", () => {
        expect(sanitizeText("hola mundo", 5)).toBe("hola ");
    });

    it("hace trim del resultado", () => {
        expect(sanitizeText("  spaces  ")).toBe("spaces");
    });
});
