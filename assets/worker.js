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

function normalizeCategory(raw) {
  const value = String(raw || "").toLowerCase();
  if (value.includes("skin")) return "Skincare";
  if (value.includes("hair")) return "Haircare";
  if (value.includes("make")) return "Makeup";
  if (value.includes("fragrance") || value.includes("perfume"))
    return "Fragrance";
  return "Skincare";
}

function toId(value, index) {
  const base = String(value || "")
    .trim()
    .toLowerCase();
  if (!base) {
    return `live-${index + 1}`;
  }
  return base
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function normalizeLiveProducts(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.products)
      ? payload.products
      : [];

  return list
    .map((item, index) => {
      const name = item?.name || item?.title || item?.product_name || "";
      const brand = item?.brand || item?.brand_name || "L'Oréal";
      const description =
        item?.description ||
        item?.short_description ||
        item?.summary ||
        "Product details unavailable.";
      const category = normalizeCategory(
        item?.category || item?.type || item?.product_type,
      );
      const image =
        item?.image ||
        item?.image_url ||
        item?.imageUrl ||
        item?.thumbnail ||
        "https://placehold.co/640x640/f4efe6/1a1a1a?text=L%27Oreal+Product";

      if (!name) {
        return null;
      }

      return {
        id: toId(item?.id || item?.sku || name, index),
        brand: String(brand),
        name: String(name),
        category,
        description: String(description),
        image: String(image),
      };
    })
    .filter(Boolean);
}

async function getLiveProducts(env) {
  const url = env.PRODUCT_FEED_URL;
  if (!url) {
    return { products: [] };
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Product feed request failed (${response.status})`);
  }

  const upstreamPayload = await response.json();
  const products = normalizeLiveProducts(upstreamPayload);
  return { products };
}

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

function sanitizeLegacyMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter(
      (item) =>
        item &&
        (item.role === "system" ||
          item.role === "user" ||
          item.role === "assistant") &&
        typeof item.content === "string" &&
        item.content.trim().length > 0,
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

function buildFallbackCitations(selectedProducts) {
  if (!Array.isArray(selectedProducts) || selectedProducts.length === 0) {
    return [
      {
        title: "L'Oréal Official",
        url: "https://www.loreal.com/en/",
      },
    ];
  }

  return selectedProducts.slice(0, 4).map((product) => {
    const query = `${product?.brand || "L'Oréal"} ${product?.name || "product"} official`;
    return {
      title: `${product?.brand || "L'Oréal"} ${product?.name || "Product"}`,
      url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
    };
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
      const body = await request.json();

      // Backward compatibility with original worker contract:
      // { messages: [{ role, content }, ...] }
      if (Array.isArray(body?.messages)) {
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

        const safeMessages = sanitizeLegacyMessages(body.messages);
        if (safeMessages.length === 0) {
          return new Response(
            JSON.stringify({ error: "Missing messages array" }),
            {
              status: 400,
              headers: CORS_HEADERS,
            },
          );
        }

        const openAiResponse = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "gpt-4o",
              messages: safeMessages,
              max_completion_tokens: 300,
            }),
          },
        );

        const responseJson = await openAiResponse.json();
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

        return new Response(JSON.stringify(responseJson), {
          headers: CORS_HEADERS,
        });
      }

      if (body?.type === "getProducts") {
        try {
          const livePayload = await getLiveProducts(env);
          return new Response(JSON.stringify(livePayload), {
            headers: CORS_HEADERS,
          });
        } catch (error) {
          return new Response(
            JSON.stringify({ products: [], error: String(error) }),
            {
              status: 200,
              headers: CORS_HEADERS,
            },
          );
        }
      }

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

      const messages = [
        {
          role: "system",
          content: ADVISOR_SYSTEM_PROMPT,
        },
        ...conversation.map((item) => ({
          role: item.role,
          content: item.content,
        })),
        {
          role: "user",
          content: userPrompt,
        },
      ];

      const openAiResponse = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o",
            messages,
            max_completion_tokens: 800,
          }),
        },
      );

      let responseJson = await openAiResponse.json();

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
        responseJson?.choices?.[0]?.message?.content?.trim() ||
        "I could not generate a response right now.";
      const finalCitations = buildFallbackCitations(selectedProducts);

      return new Response(
        JSON.stringify({ reply, citations: finalCitations }),
        {
          headers: CORS_HEADERS,
        },
      );
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
