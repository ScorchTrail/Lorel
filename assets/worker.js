const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const ADVISOR_SYSTEM_PROMPT = [
  "You are a L'Oréal beauty advisor.",
  "Stay strictly on topic: skincare, haircare, makeup, fragrance, and routine optimization.",
  "Use only selected products for routine steps unless user asks for alternatives.",
  "If off-topic requests appear, politely decline and redirect to beauty routine help.",
  "When web results are available, cite concise sources.",
  "Tone: premium, warm, and practical.",
].join(" ");

function sanitizeConversation(conversation) {
  if (!Array.isArray(conversation)) {
    return [];
  }

  return conversation
    .filter(
      (item) =>
        item &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string",
    )
    .map((item) => ({ role: item.role, content: item.content.slice(0, 4000) }));
}

function buildUserPrompt({ type, selectedProducts, question }) {
  const selectedJson = JSON.stringify(selectedProducts || [], null, 2);

  if (type === "generateRoutine") {
    return [
      "Build a complete routine only from the selected products below.",
      "Return a clear sequence (AM/PM when relevant), product-by-product instructions, and safety notes.",
      "Selected products:",
      selectedJson,
    ].join("\n\n");
  }

  return [
    "Use the existing routine context and selected products to answer the follow-up question.",
    "If the question asks for up-to-date product claims/availability, use web search and add source links.",
    "Selected products:",
    selectedJson,
    "User follow-up:",
    question || "",
  ].join("\n\n");
}

function extractCitations(responseJson) {
  const citations = [];
  const output = Array.isArray(responseJson.output) ? responseJson.output : [];

  output.forEach((item) => {
    if (!Array.isArray(item.content)) {
      return;
    }

    item.content.forEach((contentItem) => {
      if (!Array.isArray(contentItem.annotations)) {
        return;
      }

      contentItem.annotations.forEach((annotation) => {
        if (annotation.type === "url_citation" && annotation.url) {
          citations.push({
            title: annotation.title || "Reference",
            url: annotation.url,
          });
        }
      });
    });
  });

  const seen = new Set();
  return citations.filter((item) => {
    if (seen.has(item.url)) {
      return false;
    }
    seen.add(item.url);
    return true;
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: CORS_HEADERS,
      });
    }

    try {
      const apiKey = env.OPENAI_API_KEY;
      if (!apiKey) {
        return new Response(
          JSON.stringify({ error: "OPENAI_API_KEY is missing" }),
          {
            status: 500,
            headers: CORS_HEADERS,
          },
        );
      }

      const body = await request.json();
      const type = body?.type === "followUp" ? "followUp" : "generateRoutine";
      const selectedProducts = Array.isArray(body?.selectedProducts)
        ? body.selectedProducts
        : [];
      const conversation = sanitizeConversation(body?.conversation);
      const userPrompt = buildUserPrompt({
        type,
        selectedProducts,
        question: body?.question,
      });

      const input = [
        {
          role: "system",
          content: [{ type: "text", text: ADVISOR_SYSTEM_PROMPT }],
        },
        ...conversation.map((item) => ({
          role: item.role,
          content: [{ type: "text", text: item.content }],
        })),
        {
          role: "user",
          content: [{ type: "text", text: userPrompt }],
        },
      ];

      let openAiResponse = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          input,
          tools: [{ type: "web_search_preview" }],
          max_output_tokens: 800,
        }),
      });

      let responseJson = await openAiResponse.json();
      if (!openAiResponse.ok && openAiResponse.status === 400) {
        openAiResponse = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            input,
            max_output_tokens: 800,
          }),
        });
        responseJson = await openAiResponse.json();
      }

      if (!openAiResponse.ok) {
        return new Response(
          JSON.stringify({
            error: "Upstream AI request failed",
            details: responseJson,
          }),
          {
            status: openAiResponse.status,
            headers: CORS_HEADERS,
          },
        );
      }

      const reply =
        responseJson.output_text ||
        "I could not generate a response right now.";
      const citations = extractCitations(responseJson);

      return new Response(JSON.stringify({ reply, citations }), {
        headers: CORS_HEADERS,
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: "Worker request handling failed",
          details: String(error),
        }),
        {
          status: 500,
          headers: CORS_HEADERS,
        },
      );
    }
  },
};
