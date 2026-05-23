const https = require("https");
const http = require("http");
const { URL } = require("url");

function getGoogleDriveFileId(urlStr) {
    try {
        const url = new URL(urlStr);
        const fileDRegex = /\/file\/d\/([a-zA-Z0-9_-]+)/;
        const matchD = url.pathname.match(fileDRegex);
        if (matchD && matchD[1]) return matchD[1];

        const idRegex = /[?&]id=([a-zA-Z0-9_-]+)/;
        const matchId = url.search.match(idRegex);
        if (matchId && matchId[1]) return matchId[1];
    } catch (e) {
        // Ignorar
    }
    return null;
}

function resolveUrlFilename(url) {
    return new Promise((resolve) => {
        const fileId = getGoogleDriveFileId(url);
        if (fileId) {
            console.log("Detected Google Drive URL, file ID:", fileId);
            // Hacer la petición inicial
            const driveUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
            
            https.get(driveUrl, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
                }
            }, (res) => {
                // Si es redirect
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    const redirectUrl = res.headers.location;
                    res.resume();
                    console.log("Initial redirect to:", redirectUrl);
                    // Seguir el redirect
                    https.get(redirectUrl, {
                        headers: {
                            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
                        }
                    }, (res2) => {
                        handleResponse(res2, fileId, resolve);
                    });
                    return;
                }
                handleResponse(res, fileId, resolve);
            }).on("error", () => resolve(null));
        } else {
            console.log("Standard URL resolution");
            // Standard resolution code...
            resolve(null);
        }
    });
}

function handleResponse(res, fileId, resolve) {
    const contentType = res.headers["content-type"] || "";
    const contentDisposition = res.headers["content-disposition"];
    
    console.log("Response status:", res.statusCode);
    console.log("Response content-type:", contentType);
    console.log("Response content-disposition:", contentDisposition);

    if (contentDisposition) {
        let filename = null;
        const filenameMatch = contentDisposition.match(/filename\*?=["']?(?:UTF-8'')?([^;"']+)["']?/i);
        if (filenameMatch && filenameMatch[1]) {
            filename = decodeURIComponent(filenameMatch[1]);
        } else {
            const simpleMatch = contentDisposition.match(/filename\s*=\s*([^;\s]+)/i);
            if (simpleMatch && simpleMatch[1]) {
                filename = decodeURIComponent(simpleMatch[1].replace(/["']/g, ""));
            }
        }
        res.resume();
        resolve(filename);
        return;
    }

    if (contentType.includes("text/html")) {
        console.log("HTML warning page detected. Reading body...");
        let body = "";
        res.on("data", (chunk) => {
            body += chunk.toString();
            if (body.length > 100000) {
                res.destroy();
            }
        });
        res.on("end", () => {
            const confirmMatch = body.match(/confirm=([A-Za-z0-9_-]+)/);
            const confirmToken = confirmMatch ? confirmMatch[1] : null;
            console.log("Found confirm token in HTML:", confirmToken);
            
            const cookies = res.headers["set-cookie"] || [];
            console.log("Cookies received:", cookies);
            
            if (confirmToken) {
                const confirmedUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=${confirmToken}`;
                const cookieHeader = cookies.map(c => c.split(";")[0]).join("; ");
                
                console.log("Making request to confirmed URL:", confirmedUrl);
                https.get(confirmedUrl, {
                    headers: {
                        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
                        "Cookie": cookieHeader
                    }
                }, (resConfirmed) => {
                    // Seguir redirect si lo hay
                    if (resConfirmed.statusCode >= 300 && resConfirmed.statusCode < 400 && resConfirmed.headers.location) {
                        const nextUrl = resConfirmed.headers.location;
                        resConfirmed.resume();
                        console.log("Redirect from confirmed URL to:", nextUrl);
                        https.get(nextUrl, {
                            headers: {
                                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
                                "Cookie": cookieHeader
                            }
                        }, (resFinal) => {
                            const finalCd = resFinal.headers["content-disposition"];
                            console.log("Final content-disposition:", finalCd);
                            let filename = null;
                            if (finalCd) {
                                const filenameMatch = finalCd.match(/filename\*?=["']?(?:UTF-8'')?([^;"']+)["']?/i);
                                if (filenameMatch && filenameMatch[1]) {
                                    filename = decodeURIComponent(filenameMatch[1]);
                                }
                            }
                            resFinal.resume();
                            resolve(filename);
                        });
                    } else {
                        const finalCd = resConfirmed.headers["content-disposition"];
                        console.log("Final content-disposition (no redirect):", finalCd);
                        let filename = null;
                        if (finalCd) {
                            const filenameMatch = finalCd.match(/filename\*?=["']?(?:UTF-8'')?([^;"']+)["']?/i);
                            if (filenameMatch && filenameMatch[1]) {
                                filename = decodeURIComponent(filenameMatch[1]);
                            }
                        }
                        resConfirmed.resume();
                        resolve(filename);
                    }
                }).on("error", () => resolve(null));
            } else {
                resolve(null);
            }
        });
    } else {
        res.resume();
        resolve(null);
    }
}

resolveUrlFilename("https://drive.google.com/file/d/1t3H8v2sO1234567/view?usp=sharing").then(name => {
    console.log("Resolved name:", name);
});
