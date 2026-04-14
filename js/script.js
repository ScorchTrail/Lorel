// L'Oréal Beauty Consultant Chatbot Script

const SYSTEM_PROMPT =
  "You are a L'Oréal Beauty Consultant. You specialize in makeup, skincare, and fragrance. Politely decline any non-beauty questions.";

const chatHistory = [{ role: "system", content: SYSTEM_PROMPT }];
const messagesContainer = document.getElementById("chat-window");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-btn");
const queryText = document.getElementById("last-user-query");

// Cloudflare Worker endpoint (placeholder - replace with actual worker URL)
const API_ENDPOINT = "https://your-worker.your-subdomain.workers.dev/chat";

function updateQueryMonitor(text) {
  queryText.textContent = text;
}

/**
 * Creates and appends a chat bubble to the UI.
 * @param {string} text - The message content.
 * @param {"user" | "ai"} sender - The message sender.
 */
function createBubble(text, sender) {
  const bubble = document.createElement("div");
  bubble.classList.add("chat-bubble", `chat-bubble--${sender}`);

  const content = document.createElement("div");
  content.classList.add("chat-bubble__content");
  content.innerText = text;

  const timestamp = document.createElement("div");
  timestamp.classList.add("chat-bubble__timestamp");
  timestamp.textContent = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  bubble.appendChild(content);
  bubble.appendChild(timestamp);
  messagesContainer.appendChild(bubble);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function setPendingState(isPending) {
  sendButton.disabled = isPending;
  userInput.disabled = isPending;
  sendButton.textContent = isPending ? "..." : "SEND";
}

function extractAssistantReply(payload) {
  if (typeof payload.reply === "string") {
    return payload.reply;
  }

  return payload?.choices?.[0]?.message?.content?.trim() || "";
}

async function sendMessage() {
  const userMessage = userInput.value.trim();
  if (!userMessage) {
    return;
  }

  updateQueryMonitor(userMessage);
  chatHistory.push({ role: "user", content: userMessage });
  createBubble(userMessage, "user");
  userInput.value = "";
  setPendingState(true);

  try {
    const response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages: chatHistory }),
    });

    if (!response.ok) {
      throw new Error(`Worker request failed with status ${response.status}`);
    }

    const payload = await response.json();
    const aiResponse = extractAssistantReply(payload);

    if (!aiResponse) {
      throw new Error("Worker response did not include assistant content");
    }

    chatHistory.push({ role: "assistant", content: aiResponse });
    createBubble(aiResponse, "ai");
  } catch (error) {
    console.error("Chat request failed:", error);

    createBubble(
      "I'm sorry, there was an error processing your request. Please try again.",
      "ai",
    );
  } finally {
    setPendingState(false);
    userInput.focus();
  }
}

sendButton.addEventListener("click", sendMessage);
userInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    sendMessage();
  }
});

createBubble(
  "Hello. I am your L'Oréal Beauty Consultant. How can I assist your skincare or makeup routine today?",
  "ai",
);
