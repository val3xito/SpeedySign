/**
 * Tests para utils/cleanup.ts
 * Cubre: cleanupTempFiles, cleanupSignedFiles, cleanupSignedOnStartup
 */

import fs from "fs";
import os from "os";
import path from "path";
import {
    cleanupTempFiles,
    cleanupSignedFiles,
    cleanupSignedOnStartup,
} from "../utils/cleanup";

function makeTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "speedysign-test-"));
}

function writeFile(dir: string, name: string, mtime?: Date): string {
    const p = path.join(dir, name);
    fs.writeFileSync(p, "data");
    if (mtime) fs.utimesSync(p, mtime, mtime);
    return p;
}

describe("cleanupTempFiles", () => {
    it("elimina archivos con más de 1 hora de antigüedad", () => {
        const dir = makeTmpDir();
        const old = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h atrás
        const oldFile = writeFile(dir, "old.ipa", old);
        const newFile = writeFile(dir, "new.ipa");

        cleanupTempFiles(dir);

        expect(fs.existsSync(oldFile)).toBe(false);
        expect(fs.existsSync(newFile)).toBe(true);

        fs.rmSync(dir, { recursive: true });
    });

    it("no lanza si el directorio no existe", () => {
        expect(() => cleanupTempFiles("/nonexistent/path")).not.toThrow();
    });
});

describe("cleanupSignedFiles", () => {
    it("elimina archivos con más de 3 minutos de antigüedad", () => {
        const dir = makeTmpDir();
        const old = new Date(Date.now() - 4 * 60 * 1000); // 4 min atrás
        const oldFile = writeFile(dir, "signed_old.ipa", old);
        const newFile = writeFile(dir, "signed_new.ipa");

        cleanupSignedFiles(dir);

        expect(fs.existsSync(oldFile)).toBe(false);
        expect(fs.existsSync(newFile)).toBe(true);

        fs.rmSync(dir, { recursive: true });
    });
});

describe("cleanupSignedOnStartup", () => {
    it("elimina todos los archivos del directorio al arrancar", () => {
        const dir = makeTmpDir();
        writeFile(dir, "a.ipa");
        writeFile(dir, "b.ipa");

        cleanupSignedOnStartup(dir);

        expect(fs.readdirSync(dir).length).toBe(0);
        fs.rmSync(dir, { recursive: true });
    });

    it("no lanza si el directorio está vacío", () => {
        const dir = makeTmpDir();
        expect(() => cleanupSignedOnStartup(dir)).not.toThrow();
        fs.rmSync(dir, { recursive: true });
    });
});
