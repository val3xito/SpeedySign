/**
 * Tests unitarios para funciones puras de utils/ipaDownloader.ts
 * Solo testea funciones sin side-effects ni dependencias de red.
 */

// Mock de expo-constants y react-native para evitar errores de entorno
jest.mock("expo-constants", () => ({ default: { expoConfig: {} } }));
jest.mock("react-native", () => ({
    Platform: { OS: "web" },
    Linking: { openURL: jest.fn() },
}));

// ── getSigningServerURL ───────────────────────────────────────────────────────

describe("getSigningServerURL", () => {
    const originalEnv = process.env;
    const originalWindow = global.window;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
        Object.defineProperty(global, "window", {
            value: originalWindow,
            configurable: true,
        });
    });

    it("usa EXPO_PUBLIC_SIGNING_SERVER_URL si está definida", async () => {
        process.env.EXPO_PUBLIC_SIGNING_SERVER_URL = "https://sign.example.com/";
        const { getSigningServerURL } = await import("../ipaDownloader");
        expect(getSigningServerURL()).toBe("https://sign.example.com");
    });

    it("elimina barra final de EXPO_PUBLIC_SIGNING_SERVER_URL", async () => {
        process.env.EXPO_PUBLIC_SIGNING_SERVER_URL = "https://sign.example.com///";
        const { getSigningServerURL } = await import("../ipaDownloader");
        expect(getSigningServerURL()).toBe("https://sign.example.com");
    });

    it("devuelve URL relativa cuando el puerto es el de producción (3001)", async () => {
        delete process.env.EXPO_PUBLIC_SIGNING_SERVER_URL;
        Object.defineProperty(global, "window", {
            value: { location: { hostname: "speedysign.val3xito.com", port: "3001" } },
            configurable: true,
        });
        const { getSigningServerURL } = await import("../ipaDownloader");
        expect(getSigningServerURL()).toBe("");
    });

    it("apunta a :3001 en modo dev cuando el puerto es distinto", async () => {
        delete process.env.EXPO_PUBLIC_SIGNING_SERVER_URL;
        Object.defineProperty(global, "window", {
            value: { location: { hostname: "localhost", port: "8081" } },
            configurable: true,
        });
        const { getSigningServerURL } = await import("../ipaDownloader");
        expect(getSigningServerURL()).toBe("http://localhost:3001");
    });

    it("devuelve URL relativa en producción (sin puerto explícito)", async () => {
        delete process.env.EXPO_PUBLIC_SIGNING_SERVER_URL;
        Object.defineProperty(global, "window", {
            value: { location: { hostname: "speedysign.val3xito.com", port: "" } },
            configurable: true,
        });
        const { getSigningServerURL } = await import("../ipaDownloader");
        expect(getSigningServerURL()).toBe("");
    });
});

// ── cancelDownload ────────────────────────────────────────────────────────────

describe("cancelDownload", () => {
    beforeEach(() => jest.resetModules());

    it("no lanza error aunque no haya descarga activa", async () => {
        const { cancelDownload } = await import("../ipaDownloader");
        await expect(cancelDownload()).resolves.not.toThrow();
    });
});

// ── cleanupDownload ───────────────────────────────────────────────────────────

describe("cleanupDownload", () => {
    beforeEach(() => jest.resetModules());

    it("no lanza error con URI blob inválida", async () => {
        const { cleanupDownload } = await import("../ipaDownloader");
        // URL.revokeObjectURL es no-op para URLs inválidas en JSDOM
        await expect(cleanupDownload("blob:invalid")).resolves.not.toThrow();
    });

    it("no lanza error con string vacío", async () => {
        const { cleanupDownload } = await import("../ipaDownloader");
        await expect(cleanupDownload("")).resolves.not.toThrow();
    });
});
