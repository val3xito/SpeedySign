/**
 * WebSplash.tsx — Pantalla de intro animada (web only).
 * Muestra "SPEEDYSIGN" con stagger de letras y barra de progreso.
 * Se oculta cuando explore.tsx dispara el evento 'speedysign:ready'.
 */
import React, { useEffect, useRef, useState } from "react";
import { Animated, Image, Platform, StyleSheet, View } from "react-native";

const WORD = "SPEEDYSIGN";
const RED_COUNT = 6; // "SPEEDY" en rojo

const LOG_MESSAGES = [
    { limit: 20, text: "> INITIALIZING SECURE BOOT..." },
    { limit: 45, text: "> DECRYPTING ENVIRONMENT KEYS..." },
    { limit: 70, text: "> VERIFYING CERTIFICATES & LOGS..." },
    { limit: 90, text: "> INJECTING ACTIVE RUNTIME..." },
    { limit: 100, text: "> APP READY / INJECTING CONTEXT..." }
];

function getLogMessage(pct: number) {
    if (pct >= 100) return "> SESSION VERIFIED / LAUNCHING...";
    let msg = LOG_MESSAGES[0].text;
    for (let i = 0; i < LOG_MESSAGES.length; i++) {
        if (pct >= LOG_MESSAGES[i].limit) {
            msg = LOG_MESSAGES[i].text;
        }
    }
    return msg;
}

export function WebSplash() {
    const [visible, setVisible] = useState(true);
    const [progress, setProgress] = useState(0);

    const containerOpacity = useRef(new Animated.Value(1)).current;
    const iconScale = useRef(new Animated.Value(0)).current;
    const taglineOpacity = useRef(new Animated.Value(0)).current;
    const letterAnims = useRef(
        WORD.split("").map(() => new Animated.Value(0))
    ).current;

    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        if (Platform.OS !== "web") return;

        // Inject keyframes para el glow pulsante, glitch, cursor y scanlines
        const style = document.createElement("style");
        style.textContent = `
            @keyframes ss-pulse { 0%,100%{transform:scale(1);opacity:.8} 50%{transform:scale(1.1);opacity:1} }
            @keyframes ss-glitch {
              0% { text-shadow: 2px -1px 0 rgba(255, 59, 59, 0.35), -1px 1px 0 rgba(255, 255, 255, 0.3); }
              20% { text-shadow: -2px 1.5px 0 rgba(255, 59, 59, 0.4), 1.5px -1.5px 0 rgba(255, 255, 255, 0.35); }
              40% { text-shadow: 1px -1.5px 0 rgba(255, 59, 59, 0.35), -1.5px 1px 0 rgba(0, 0, 0, 0.3); }
              60% { text-shadow: -1.5px 1px 0 rgba(255, 59, 59, 0.4), 1px -1px 0 rgba(255, 255, 255, 0.35); }
              80% { text-shadow: 2px -1px 0 rgba(255, 59, 59, 0.35), -1px 1px 0 rgba(0, 0, 0, 0.3); }
              100% { text-shadow: 2px -1.5px 0 rgba(255, 59, 59, 0.4), -1.5px 1.5px 0 rgba(255, 255, 255, 0.35); }
            }
            @keyframes ss-blink { 50% { opacity: 0; } }
            .ss-glow { animation: ss-pulse 3s ease-in-out infinite; }
            .ss-title-glitch { animation: ss-glitch 4s ease-in-out infinite; }
            .ss-cursor { animation: ss-blink 0.8s infinite; color: #ff3b3b; font-weight: bold; }
            .ss-scanlines {
              position: absolute;
              inset: 0;
              background: linear-gradient(
                rgba(18, 16, 16, 0) 50%, 
                rgba(0, 0, 0, 0.22) 50%
              );
              background-size: 100% 4px;
              z-index: 10;
              pointer-events: none;
            }
        `;
        document.head.appendChild(style);

        // Icono
        Animated.spring(iconScale, {
            toValue: 1, delay: 100, tension: 100, friction: 8, useNativeDriver: true,
        }).start();

        // Letras en stagger
        Animated.parallel(
            letterAnims.map((anim, i) =>
                Animated.spring(anim, {
                    toValue: 1, delay: 250 + i * 60,
                    tension: 80, friction: 7, useNativeDriver: true,
                })
            )
        ).start();

        // Tagline
        Animated.timing(taglineOpacity, {
            toValue: 1, duration: 600, delay: 1100, useNativeDriver: true,
        }).start();

        const startTime = Date.now();

        // Barra de progreso simulada
        const interval = setInterval(() => {
            setProgress((p) => {
                const inc = p < 75 ? Math.random() * 3 + 2 : Math.random() * 1.5 + 0.3;
                return Math.min(p + inc, 92);
            });
        }, 120);

        // Lluvia de Código Matrix
        const canvas = canvasRef.current;
        let matrixInterval: number | null = null;
        let handleResize: (() => void) | null = null;

        if (canvas) {
            const ctx = canvas.getContext("2d");
            if (ctx) {
                const fontSize = 14;
                let columns = 0;
                let drops: number[] = [];
                const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz⚡".split("");

                handleResize = () => {
                    canvas.width = window.innerWidth;
                    canvas.height = window.innerHeight;
                    columns = Math.floor(canvas.width / fontSize);
                    drops = [];
                    for (let x = 0; x < columns; x++) {
                        drops[x] = Math.random() * -100;
                    }
                };

                window.addEventListener("resize", handleResize);
                handleResize();

                const drawMatrix = () => {
                    ctx.fillStyle = "rgba(10, 10, 15, 0.08)";
                    ctx.fillRect(0, 0, canvas.width, canvas.height);

                    ctx.font = `${fontSize}px monospace`;
                    for (let i = 0; i < drops.length; i++) {
                        const text = chars[Math.floor(Math.random() * chars.length)];
                        const x = i * fontSize;
                        const y = drops[i] * fontSize;

                        const rand = Math.random();
                        if (rand > 0.98) {
                            ctx.fillStyle = "#ffffff";
                        } else if (rand > 0.90) {
                            ctx.fillStyle = "#ff8a80";
                        } else {
                            ctx.fillStyle = "rgba(255, 23, 68, 0.35)";
                        }

                        ctx.fillText(text, x, y);

                        if (y > canvas.height && Math.random() > 0.975) {
                            drops[i] = 0;
                        }
                        drops[i]++;
                    }
                };

                matrixInterval = window.setInterval(drawMatrix, 33);
            }
        }

        // Handler de cierre
        const hide = () => {
            const elapsed = Date.now() - startTime;
            const remaining = Math.max(0, 1000 - elapsed);

            setTimeout(() => {
                clearInterval(interval);
                if (matrixInterval !== null) clearInterval(matrixInterval);
                setProgress(100);
                setTimeout(() => {
                    Animated.timing(containerOpacity, {
                        toValue: 0, duration: 700, useNativeDriver: true,
                    }).start(() => setVisible(false));
                }, 350);
            }, remaining);
        };

        window.addEventListener("speedysign:ready", hide);
        const safety = setTimeout(hide, 6000);

        return () => {
            clearInterval(interval);
            if (matrixInterval !== null) clearInterval(matrixInterval);
            if (handleResize) window.removeEventListener("resize", handleResize);
            clearTimeout(safety);
            window.removeEventListener("speedysign:ready", hide);
            document.head.removeChild(style);
        };
    }, []);

    if (Platform.OS !== "web" || !visible) return null;

    return (
        <Animated.View style={[StyleSheet.absoluteFillObject, styles.container, { opacity: containerOpacity }]}>
            {/* Glow ambiental */}
            <View style={styles.glowWrap}>
                {/* @ts-ignore */}
                <div className="ss-glow" style={{
                    width: "70vmax", height: "70vmax", borderRadius: "50%",
                    background: "radial-gradient(circle, rgba(255,40,40,0.14) 0%, transparent 65%)",
                    position: "absolute",
                }} />
            </View>

            {/* Canvas de Matrix Rain */}
            <canvas
                ref={canvasRef}
                style={{
                    position: "absolute",
                    inset: 0,
                    zIndex: 1,
                    pointerEvents: "none",
                    opacity: 0.35,
                }}
            />

            {/* Scanlines overlay */}
            <div className="ss-scanlines" />

            {/* Contenido central */}
            <View style={styles.center}>
                {/* Icono — favicon del proyecto */}
                <Animated.View style={[styles.icon, {
                    opacity: iconScale,
                    transform: [{ scale: iconScale }],
                }]}>
                    <Image
                        source={require("../assets/logo-transparent.png")}
                        style={{
                            width: 110,
                            height: 110,
                            padding: 25,
                            boxSizing: "content-box",
                            mixBlendMode: "screen",
                            filter: "drop-shadow(0 0 20px rgba(255, 59, 59, 0.8))",
                        } as any}
                        resizeMode="contain"
                    />
                </Animated.View>

                {/* Letras SPEEDYSIGN con glitch */}
                <div className="ss-title-glitch" style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "flex-end",
                    overflow: "hidden",
                }}>
                    {WORD.split("").map((char, i) => (
                        <Animated.Text
                            key={i}
                            style={[
                                styles.letter,
                                i < RED_COUNT ? styles.letterRed : styles.letterWhite,
                                {
                                    opacity: letterAnims[i],
                                    transform: [{
                                        translateY: letterAnims[i].interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [55, 0],
                                        }),
                                    }],
                                },
                            ]}
                        >
                            {char}
                        </Animated.Text>
                    ))}
                </div>

                {/* Tagline terminal */}
                <Animated.View style={{ opacity: taglineOpacity }}>
                    {/* @ts-ignore */}
                    <div style={{
                        fontFamily: "monospace",
                        color: "#ff3b3b",
                        fontSize: "10px",
                        textTransform: "uppercase",
                        letterSpacing: "2px",
                        height: "16px",
                        opacity: 0.85,
                        marginTop: "5px",
                        display: "flex",
                        alignItems: "center",
                        gap: "2px"
                    }}>
                        <span>{getLogMessage(progress)}</span>
                        <span className="ss-cursor">█</span>
                    </div>
                </Animated.View>

                {/* Barra de progreso */}
                <View style={styles.progressWrap}>
                    <Animated.View
                        style={[
                            styles.progressBar,
                            // @ts-ignore
                            { width: `${progress}%`, transition: "width 0.15s ease" },
                        ]}
                    />
                </View>
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        zIndex: 9999,
        backgroundColor: "#0a0a0f",
        alignItems: "center",
        justifyContent: "center",
    },
    glowWrap: {
        position: "absolute",
        alignItems: "center",
        justifyContent: "center",
    },
    center: {
        alignItems: "center",
        gap: 20,
    },
    icon: {
        alignItems: "center",
        justifyContent: "center",
    },
    titleRow: {
        flexDirection: "row",
        alignItems: "flex-end",
        overflow: "hidden",
    },
    letter: {
        fontSize: 56,
        fontWeight: "900",
        letterSpacing: -2,
        lineHeight: 64,
    },
    letterRed: {
        color: "#ff3b3b",
        // @ts-ignore — web gradient text
        backgroundImage: "linear-gradient(135deg, #ff5555, #ff1744)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        backgroundClip: "text",
    },
    letterWhite: {
        color: "#ffffff",
        // @ts-ignore — web gradient text
        backgroundImage: "linear-gradient(135deg, #ffffff, #aaaaaa)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        backgroundClip: "text",
    },
    progressWrap: {
        width: 240,
        height: 2,
        backgroundColor: "rgba(255,255,255,0.08)",
        borderRadius: 2,
        overflow: "hidden",
        marginTop: 8,
    },
    progressBar: {
        height: "100%",
        backgroundColor: "#ff3b3b",
        borderRadius: 2,
        shadowColor: "#ff3b3b",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 6,
    },
});
