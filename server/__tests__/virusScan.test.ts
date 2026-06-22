import { scanFileForVirus } from "../utils/virusScan";
import * as childProcess from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

// Mock child_process
jest.mock("child_process", () => {
    const original = jest.requireActual("child_process");
    return {
        ...original,
        execFile: jest.fn(),
    };
});

const mockedExecFile = childProcess.execFile as unknown as jest.Mock;

// ──────────────────────────────────────────────────────────────────────────────
// Helpers para mockear fetch (VirusTotal API)
// ──────────────────────────────────────────────────────────────────────────────

function mockVTResponse(status: number, body: object | null) {
    global.fetch = jest.fn().mockResolvedValue({
        status,
        ok: status >= 200 && status < 300,
        json: async () => body,
    } as Response);
}

function mockVTClean(total = 70) {
    mockVTResponse(200, {
        data: {
            attributes: {
                last_analysis_stats: {
                    malicious: 0,
                    suspicious: 0,
                    harmless: total,
                    undetected: 0,
                },
            },
        },
    });
}

function mockVTMalicious(malicious = 5, total = 70) {
    mockVTResponse(200, {
        data: {
            attributes: {
                last_analysis_stats: {
                    malicious,
                    suspicious: 0,
                    harmless: total - malicious,
                    undetected: 0,
                },
            },
        },
    });
}

function mockVTNotFound() {
    mockVTResponse(404, null);
}

function mockVTNetworkError() {
    global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));
}

// ──────────────────────────────────────────────────────────────────────────────
// Test suite
// ──────────────────────────────────────────────────────────────────────────────

describe("scanFileForVirus", () => {
    let tempDir: string;
    let tempFile: string;
    const originalFetch = global.fetch;

    beforeAll(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "speedysign-virus-test-"));
        tempFile = path.join(tempDir, "test.ipa");
        fs.writeFileSync(tempFile, "dummy contents for testing");
    });

    afterAll(() => {
        try {
            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
        } catch {}
        global.fetch = originalFetch;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.ENABLE_ANTIVIRUS;
        delete process.env.VIRUSTOTAL_API_KEY;
        delete process.env.VIRUSTOTAL_THRESHOLD;
        // Siempre mockear fetch para poder hacer aserciones y evitar llamadas reales a la red
        global.fetch = jest.fn();
    });

    // ── Tests básicos ───────────────────────────────────────────────────────

    it("should return false if the file does not exist", async () => {
        const result = await scanFileForVirus("/nonexistent/file.ipa");
        expect(result).toBe(false);
    });

    it("should return true immediately if ENABLE_ANTIVIRUS is 'false'", async () => {
        process.env.ENABLE_ANTIVIRUS = "false";
        const result = await scanFileForVirus(tempFile);
        expect(result).toBe(true);
        expect(mockedExecFile).not.toHaveBeenCalled();
    });

    // ── Tests ClamAV (sin API key de VT) ────────────────────────────────────

    it("should return true (fail-open) if command execution times out", async () => {
        let savedCallback: any;
        mockedExecFile.mockImplementation((file, args, options, callback) => {
            savedCallback = callback;
            return {
                kill: () => {
                    if (savedCallback) savedCallback(new Error("Killed"), "", "");
                },
            } as any;
        });

        jest.useFakeTimers();
        const promise = scanFileForVirus(tempFile);
        jest.advanceTimersByTime(13000);
        const result = await promise;
        expect(result).toBe(true);
        jest.useRealTimers();
    });

    it("should return true (fail-open) if clamdscan and clamscan are not installed (ENOENT)", async () => {
        const error = new Error("spawn ENOENT") as any;
        error.code = "ENOENT";
        mockedExecFile.mockImplementation((file, args, options, callback) => {
            callback(error, "", "");
            return {} as any;
        });

        const result = await scanFileForVirus(tempFile);
        expect(result).toBe(true);
        expect(mockedExecFile).toHaveBeenCalledTimes(2); // clamdscan + clamscan fallback
    });

    it("should return false (fail-close) if clamdscan detects a virus (code 1)", async () => {
        const error = new Error("Virus found") as any;
        error.code = 1;
        mockedExecFile.mockImplementation((file, args, options, callback) => {
            callback(error, "FOUND Eicar-Test-Signature", "");
            return {} as any;
        });

        const result = await scanFileForVirus(tempFile);
        expect(result).toBe(false);
        expect(mockedExecFile).toHaveBeenCalledTimes(1); // clamdscan bloquea, no intenta clamscan
    });

    it("should return true if clamdscan finishes clean (code 0)", async () => {
        mockedExecFile.mockImplementation((file, args, options, callback) => {
            callback(null, "OK", "");
            return {} as any;
        });

        const result = await scanFileForVirus(tempFile);
        expect(result).toBe(true);
        expect(mockedExecFile).toHaveBeenCalledTimes(1);
    });

    it("should return true (fail-open) if both return exit code 2 (daemon/DB error)", async () => {
        const error = new Error("Error code 2") as any;
        error.code = 2;
        mockedExecFile.mockImplementation((file, args, options, callback) => {
            callback(error, "", "database missing");
            return {} as any;
        });

        const result = await scanFileForVirus(tempFile);
        expect(result).toBe(true);
        expect(mockedExecFile).toHaveBeenCalledTimes(2);
    });

    // ── Tests VirusTotal ─────────────────────────────────────────────────────

    it("VT: should return true immediately if VT reports the file as clean (skip ClamAV)", async () => {
        process.env.VIRUSTOTAL_API_KEY = "test-api-key";
        mockVTClean(70);

        const result = await scanFileForVirus(tempFile);
        expect(result).toBe(true);
        expect(mockedExecFile).not.toHaveBeenCalled(); // ClamAV no debería ejecutarse
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("VT: should return false immediately if VT detects malware (≥ threshold)", async () => {
        process.env.VIRUSTOTAL_API_KEY = "test-api-key";
        mockVTMalicious(5, 70);

        const result = await scanFileForVirus(tempFile);
        expect(result).toBe(false);
        expect(mockedExecFile).not.toHaveBeenCalled(); // ClamAV no debería ejecutarse
    });

    it("VT: should continue to ClamAV if VT returns 404 (unknown file)", async () => {
        process.env.VIRUSTOTAL_API_KEY = "test-api-key";
        mockVTNotFound();
        // ClamAV limpio
        mockedExecFile.mockImplementation((file, args, options, callback) => {
            callback(null, "OK", "");
            return {} as any;
        });

        const result = await scanFileForVirus(tempFile);
        expect(result).toBe(true);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(mockedExecFile).toHaveBeenCalledTimes(1); // ClamAV ejecutado como fallback
    });

    it("VT: should continue to ClamAV if VT network error (fail-open for VT)", async () => {
        process.env.VIRUSTOTAL_API_KEY = "test-api-key";
        mockVTNetworkError();
        mockedExecFile.mockImplementation((file, args, options, callback) => {
            callback(null, "OK", "");
            return {} as any;
        });

        const result = await scanFileForVirus(tempFile);
        expect(result).toBe(true);
        expect(mockedExecFile).toHaveBeenCalledTimes(1);
    });

    it("VT: should skip VT entirely if no VIRUSTOTAL_API_KEY is set", async () => {
        // No API key set
        mockedExecFile.mockImplementation((file, args, options, callback) => {
            callback(null, "OK", "");
            return {} as any;
        });

        const result = await scanFileForVirus(tempFile);
        expect(result).toBe(true);
        // Sin API key, fetch no debe llamarse (VT queda desactivado)
        expect(global.fetch).not.toHaveBeenCalled();
        expect(mockedExecFile).toHaveBeenCalledTimes(1); // Solo ClamAV
    });

    it("VT: should block if malicious count is exactly at threshold (default=3)", async () => {
        process.env.VIRUSTOTAL_API_KEY = "test-api-key";
        mockVTMalicious(3, 70); // Exactamente en el umbral

        const result = await scanFileForVirus(tempFile);
        expect(result).toBe(false);
        expect(mockedExecFile).not.toHaveBeenCalled();
    });

    it("VT: should warn but continue to ClamAV if detections below threshold (1 or 2 engines)", async () => {
        process.env.VIRUSTOTAL_API_KEY = "test-api-key";
        mockVTMalicious(1, 70); // Por debajo del umbral de 3
        mockedExecFile.mockImplementation((file, args, options, callback) => {
            callback(null, "OK", "");
            return {} as any;
        });

        const result = await scanFileForVirus(tempFile);
        expect(result).toBe(true);
        expect(mockedExecFile).toHaveBeenCalledTimes(1); // ClamAV confirma segunda opinión
    });

    it("VT: should respect custom VIRUSTOTAL_THRESHOLD env var", async () => {
        process.env.VIRUSTOTAL_API_KEY = "test-api-key";
        process.env.VIRUSTOTAL_THRESHOLD = "1"; // Máxima seguridad
        mockVTMalicious(1, 70); // 1 detección, que ya supera el umbral de 1

        const result = await scanFileForVirus(tempFile);
        expect(result).toBe(false);
        expect(mockedExecFile).not.toHaveBeenCalled();
    });

    it("VT: should continue to ClamAV if VT API returns 429 (rate limited)", async () => {
        process.env.VIRUSTOTAL_API_KEY = "test-api-key";
        mockVTResponse(429, null);
        mockedExecFile.mockImplementation((file, args, options, callback) => {
            callback(null, "OK", "");
            return {} as any;
        });

        const result = await scanFileForVirus(tempFile);
        expect(result).toBe(true);
        expect(mockedExecFile).toHaveBeenCalledTimes(1);
    });
});
