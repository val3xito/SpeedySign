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

describe("scanFileForVirus", () => {
    let tempDir: string;
    let tempFile: string;

    beforeAll(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "speedysign-virus-test-"));
        tempFile = path.join(tempDir, "test.ipa");
        fs.writeFileSync(tempFile, "dummy contents");
    });

    afterAll(() => {
        try {
            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
        } catch {}
    });

    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.ENABLE_ANTIVIRUS;
    });

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

    it("should return true (fail-open) if command execution times out", async () => {
        let savedCallback: any;
        mockedExecFile.mockImplementation((file, args, options, callback) => {
            savedCallback = callback;
            return {
                kill: () => {
                    if (savedCallback) {
                        savedCallback(new Error("Killed"), "", "");
                    }
                },
            } as any;
        });

        jest.useFakeTimers();
        const promise = scanFileForVirus(tempFile);

        // Avanzar el tiempo 13 segundos (más de los 12s del timeout)
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
        // Debe intentar clamdscan y luego el fallback clamscan
        expect(mockedExecFile).toHaveBeenCalledTimes(2);
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
        // clamdscan reportó virus directo, no debe intentar clamscan
        expect(mockedExecFile).toHaveBeenCalledTimes(1);
    });

    it("should return true if clamdscan finishes clean (code 0/null error)", async () => {
        mockedExecFile.mockImplementation((file, args, options, callback) => {
            callback(null, "OK", "");
            return {} as any;
        });

        const result = await scanFileForVirus(tempFile);
        expect(result).toBe(true);
        expect(mockedExecFile).toHaveBeenCalledTimes(1);
    });

    it("should return true (fail-open) if both return exit code 2 (connection/database error)", async () => {
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
});
