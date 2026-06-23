/**
 * Tests unitarios para utils/platform.ts
 */

// Nota: isIOS se evalúa en tiempo de módulo, así que necesitamos mockear
// Platform y navigator antes de importar. Usamos jest.resetModules() entre tests.

describe("platform - isIOS detection", () => {
    const originalNavigator = global.navigator;

    afterEach(() => {
        jest.resetModules();
        Object.defineProperty(global, "navigator", {
            value: originalNavigator,
            configurable: true,
        });
    });

    it("devuelve true para iPhone en userAgent", async () => {
        Object.defineProperty(global, "navigator", {
            value: {
                userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
                platform: "iPhone",
                maxTouchPoints: 5,
            },
            configurable: true,
        });

        jest.mock("react-native", () => ({ Platform: { OS: "web" } }));
        const { isIOS } = await import("../platform");
        expect(isIOS).toBe(true);
    });

    it("devuelve true para iPad en userAgent", async () => {
        Object.defineProperty(global, "navigator", {
            value: {
                userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)",
                platform: "iPad",
                maxTouchPoints: 5,
            },
            configurable: true,
        });

        jest.mock("react-native", () => ({ Platform: { OS: "web" } }));
        const { isIOS } = await import("../platform");
        expect(isIOS).toBe(true);
    });

    it("devuelve true para iPad en modo desktop (MacIntel + touchPoints > 1)", async () => {
        Object.defineProperty(global, "navigator", {
            value: {
                userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
                platform: "MacIntel",
                maxTouchPoints: 5,
            },
            configurable: true,
        });

        jest.mock("react-native", () => ({ Platform: { OS: "web" } }));
        const { isIOS } = await import("../platform");
        expect(isIOS).toBe(true);
    });

    it("devuelve false para Chrome en escritorio", async () => {
        Object.defineProperty(global, "navigator", {
            value: {
                userAgent:
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120",
                platform: "Win32",
                maxTouchPoints: 0,
            },
            configurable: true,
        });

        jest.mock("react-native", () => ({ Platform: { OS: "web" } }));
        const { isIOS } = await import("../platform");
        expect(isIOS).toBe(false);
    });
});
