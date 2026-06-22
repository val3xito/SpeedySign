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
    });

    it("should return false if the file does not exist", async () => {
        const result = await scanFileForVirus("/nonexistent/file.ipa");
        expect(result).toBe(false);
    });

    it("should return true (fail-open) if clamscan is not installed (ENOENT)", async () => {
        const error = new Error("spawn clamscan ENOENT") as any;
        error.code = "ENOENT";
        mockedExecFile.mockImplementation((file, args, options, callback) => {
            callback(error, "", "");
            return {} as any;
        });

        const result = await scanFileForVirus(tempFile);
        expect(result).toBe(true);
        expect(mockedExecFile).toHaveBeenCalledWith("clamscan", [tempFile], expect.any(Object), expect.any(Function));
    });

    it("should return false (fail-close) if clamscan detects a virus (code 1)", async () => {
        const error = new Error("Virus found") as any;
        error.code = 1;
        mockedExecFile.mockImplementation((file, args, options, callback) => {
            callback(error, "FOUND Eicar-Test-Signature", "");
            return {} as any;
        });

        const result = await scanFileForVirus(tempFile);
        expect(result).toBe(false);
    });

    it("should return true if clamscan finishes clean (code 0/null error)", async () => {
        mockedExecFile.mockImplementation((file, args, options, callback) => {
            callback(null, "OK", "");
            return {} as any;
        });

        const result = await scanFileForVirus(tempFile);
        expect(result).toBe(true);
    });

    it("should return true (fail-open) if clamscan returns other error code (e.g. database loading error)", async () => {
        const error = new Error("Some clamscan error") as any;
        error.code = 2;
        mockedExecFile.mockImplementation((file, args, options, callback) => {
            callback(error, "", "database not found");
            return {} as any;
        });

        const result = await scanFileForVirus(tempFile);
        expect(result).toBe(true);
    });
});
