// Cloudflare Worker for L'Oréal Beauty Consultant Proxy

addEventListener("fetch", (event) => {
    event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
    if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
    }

    try {
        const { messages } = await request.json();

        if (!Array.isArray(messages) || messages.length === 0) {
            return new Response(JSON.stringify({ error: "Missing messages array" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }

        const payload = {
            model: "gpt-3.5-turbo",
            messages,
            max_tokens: 150,
            temperature: 0.7,
        };

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorText = await response.text();
            return new Response(
                JSON.stringify({ error: "OpenAI request failed", details: errorText }),
                {
                    status: response.status,
                    headers: { "Content-Type": "application/json" },
                },
            );
        }

        const data = await response.json();
        const reply = data?.choices?.[0]?.message?.content?.trim() || "";

        return new Response(JSON.stringify({ reply, raw: data }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        return new Response(
            JSON.stringify({ error: "Internal server error", details: String(error) }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            },
        );
    }
}