
require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();

const PORT = Number(process.env.PORT) || 3000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const CARTESIA_API_KEY = process.env.CARTESIA_API_KEY;
const CARTESIA_VOICE_ID = process.env.CARTESIA_VOICE_ID;

const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;

const MODEL = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
const CARTESIA_MODEL = process.env.CARTESIA_MODEL || "sonic-3.6";

const VERSION = "10.1.0";

app.disable("x-powered-by");

app.use(express.json({ limit: "1mb" }));

/* SECURITY HEADERS */

app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    next();
});

/* NITIN AI PERSONALITY */

const SYSTEM_PROMPT = `
You are NITIN AI.

You are a warm, intelligent and emotionally aware personal AI companion.

Your communication style:

1. Speak naturally like a friendly conversation partner.
2. Understand Hindi, Hinglish and English.
3. Reply in the language the user uses.
4. Avoid unnecessary greetings.
5. Never repeat welcome messages.
6. Do not start every answer with Hello.
7. Be caring, supportive and respectful.
8. Be playful when the conversation is funny.
9. Be calm and understanding when the user is sad.
10. Be firm but respectful when explaining mistakes.
11. Never pretend to be a real human.
12. Never claim to have emotions or experiences you do not have.
13. Keep answers useful and natural.
14. For coding, provide complete working code when requested.
15. For study questions, explain in beginner-friendly language.

You can act as:
- Best Friend
- Caring Companion
- Teacher
- Mentor
- Coding Expert
- Motivator
- Creative Partner

Do not force a greeting into every conversation.
`;

/* PERSONALITY MODES */

const MODES = {
    general: "Be a natural and friendly general assistant.",
    study: "Teach patiently using simple explanations and examples.",
    coding: "Act as a professional programming assistant. Provide correct code.",
    creative: "Be creative, imaginative and expressive.",
    problem: "Analyze the problem carefully and explain the solution step by step."
};

/* API STATUS */

app.get("/api/status", (req, res) => {
    res.json({
        name: "NITIN AI",
        version: VERSION,
        status: "online",
        model: MODEL,
        chat: Boolean(GEMINI_API_KEY),
        expressiveVoice: Boolean(
            CARTESIA_API_KEY && CARTESIA_VOICE_ID
        ),
        voiceProvider: "Cartesia",
        voiceModel: CARTESIA_MODEL,
        speechRecognition: Boolean(ASSEMBLYAI_API_KEY),
        speechProvider: "AssemblyAI",
        browserVoice: true
    });
});

/* ASSEMBLYAI STREAMING TOKEN */

app.post("/api/assemblyai/token", async (req, res) => {
    try {
        if (!ASSEMBLYAI_API_KEY) {
            return res.status(503).json({
                error: "ASSEMBLYAI_API_KEY is missing in .env"
            });
        }

        const tokenResponse = await fetch(
            "https://streaming.assemblyai.com/v3/token?expires_in_seconds=60",
            {
                method: "GET",
                headers: {
                    "Authorization": ASSEMBLYAI_API_KEY
                },
                signal: AbortSignal.timeout(15000)
            }
        );

        const data = await tokenResponse.json().catch(() => ({}));

        if (!tokenResponse.ok) {
            console.error(
                "AssemblyAI token error:",
                tokenResponse.status,
                data
            );

            return res.status(502).json({
                error: "AssemblyAI authentication failed.",
                providerStatus: tokenResponse.status
            });
        }

        if (!data.token) {
            return res.status(502).json({
                error: "AssemblyAI did not return a temporary token."
            });
        }

        res.setHeader("Cache-Control", "no-store");

        res.json({
            token: data.token,
            provider: "AssemblyAI",
            expiresIn: 60
        });

    } catch (error) {
        console.error("AssemblyAI error:", error);

        res.status(500).json({
            error:
                error.name === "TimeoutError"
                    ? "AssemblyAI token request timed out."
                    : "Unable to connect to AssemblyAI."
        });
    }
});

/* CHAT HISTORY VALIDATION */

function cleanHistory(history) {
    if (!Array.isArray(history)) {
        return [];
    }

    return history
        .slice(-12)
        .filter(item => {
            return (
                item &&
                ["user", "assistant", "model"].includes(item.role) &&
                typeof (item.content || item.text) === "string"
            );
        })
        .map(item => ({
            role: item.role === "assistant" ? "model" : item.role,
            parts: [
                {
                    text: String(item.content || item.text).slice(0, 12000)
                }
            ]
        }));
}

/* GEMINI CHAT API */

app.post("/api/chat", async (req, res) => {
    try {
        if (!GEMINI_API_KEY) {
            return res.status(500).json({
                error: "GEMINI_API_KEY is missing in .env"
            });
        }

        const message =
            typeof req.body.message === "string"
                ? req.body.message.trim()
                : "";

        if (!message) {
            return res.status(400).json({
                error: "Message is required."
            });
        }

        if (message.length > 10000) {
            return res.status(413).json({
                error: "Message is too long."
            });
        }

        const history = cleanHistory(req.body.history);

        const mode = String(req.body.mode || "general");
        const modePrompt = MODES[mode] || MODES.general;

        const contents = [
            ...history,
            {
                role: "user",
                parts: [{ text: message }]
            }
        ];

        const apiResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                signal: AbortSignal.timeout(60000),
                body: JSON.stringify({
                    systemInstruction: {
                        parts: [
                            {
                                text:
                                    SYSTEM_PROMPT +
                                    "\n\nCurrent conversation mode: " +
                                    modePrompt
                            }
                        ]
                    },
                    contents,
                    generationConfig: {
                        temperature: 0.85,
                        maxOutputTokens: 4096
                    }
                })
            }
        );

        const data = await apiResponse.json().catch(() => ({}));

        if (!apiResponse.ok) {
            console.error("Gemini API error:", data);

            return res.status(apiResponse.status).json({
                error:
                    data.error?.message ||
                    "Gemini API request failed."
            });
        }

        const reply = data.candidates?.[0]?.content?.parts
            ?.map(part => part.text || "")
            .join("")
            .trim();

        if (!reply) {
            return res.status(502).json({
                error: "Gemini returned an empty response."
            });
        }

        res.json({
            reply,
            model: MODEL
        });

    } catch (error) {
        console.error("Chat error:", error);

        res.status(500).json({
            error:
                error.name === "TimeoutError"
                    ? "AI request timed out. Please try again."
                    : "Unable to connect to AI service."
        });
    }
});

/* CARTESIA EXPRESSIVE VOICE API */

app.post("/api/tts", async (req, res) => {
    try {
        if (!CARTESIA_API_KEY || !CARTESIA_VOICE_ID) {
            return res.status(503).json({
                error: "Cartesia is not configured. Check your .env file."
            });
        }

        const text =
            typeof req.body.text === "string"
                ? req.body.text.trim()
                : "";

        const speed = Math.min(
            1.5,
            Math.max(0.6, Number(req.body.speed) || 0.95)
        );

        if (!text) {
            return res.status(400).json({
                error: "Text is required."
            });
        }

        if (text.length > 4500) {
            return res.status(413).json({
                error: "Voice text is too long."
            });
        }

        const voiceResponse = await fetch(
            "https://api.cartesia.ai/tts/bytes",
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${CARTESIA_API_KEY}`,
                    "Cartesia-Version": "2026-08-14",
                    "Content-Type": "application/json",
                    "Accept": "audio/mpeg"
                },
                signal: AbortSignal.timeout(60000),
                body: JSON.stringify({
                    model_id: CARTESIA_MODEL,
                    transcript: text,
                    voice: CARTESIA_VOICE_ID,
                    output_format: {
                        container: "mp3",
                        sample_rate: 44100,
                        bit_rate: 128000
                    },
                    generation_config: {
                        speed: speed,
                        volume: 1
                    }
                })
            }
        );

        if (!voiceResponse.ok) {
            const errorText = await voiceResponse.text();

            console.error(
                "Cartesia API error:",
                voiceResponse.status,
                errorText
            );

            return res.status(502).json({
                error: "Cartesia voice generation failed.",
                providerStatus: voiceResponse.status
            });
        }

        const audioBuffer = Buffer.from(
            await voiceResponse.arrayBuffer()
        );

        if (!audioBuffer.length) {
            return res.status(502).json({
                error: "Cartesia returned empty audio."
            });
        }

        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Content-Length", audioBuffer.length);
        res.setHeader("Cache-Control", "no-store");

        res.send(audioBuffer);

    } catch (error) {
        console.error("Cartesia voice error:", error);

        res.status(500).json({
            error:
                error.name === "TimeoutError"
                    ? "Voice generation timed out."
                    : "Cartesia voice generation failed."
        });
    }
});

/* PROTECT PRIVATE FILES */

app.use((req, res, next) => {
    const blockedFiles = [
        ".env",
        "server.js",
        "package.json",
        "package-lock.json"
    ];

    const requestedFile = path.basename(req.path);

    if (blockedFiles.includes(requestedFile)) {
        return res.status(404).send("Not found");
    }

    next();
});

/* STATIC WEBSITE */

app.use(express.static(__dirname));

/* WEBSITE FALLBACK */

app.use((req, res) => {
    if (req.method !== "GET") {
        return res.status(404).json({
            error: "Route not found."
        });
    }

    res.sendFile(
        path.join(__dirname, "index.html"),
        error => {
            if (error && !res.headersSent) {
                res.status(404).send("Website page not found.");
            }
        }
    );
});

/* START SERVER */

if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
        console.log("----------------------------------");
        console.log("       NITIN AI SERVER");
        console.log("----------------------------------");

        console.log(`Website: http://localhost:${PORT}`);

        console.log(
            `Gemini: ${GEMINI_API_KEY ? "Configured" : "Missing API key"}`
        );

        console.log(
            `Cartesia Voice: ${
                CARTESIA_API_KEY && CARTESIA_VOICE_ID
                    ? "Configured"
                    : "Not configured"
            }`
        );

        console.log(
            `AssemblyAI: ${
                ASSEMBLYAI_API_KEY ? "Configured" : "Missing API key"
            }`
        );

        console.log(`Voice Model: ${CARTESIA_MODEL}`);
        console.log(`Version: ${VERSION}`);

        console.log("----------------------------------");
    });
}

module.exports = app;
