const STORAGE_KEYS = {
  selectedIds: "loreal_selected_product_ids",
  direction: "loreal_document_direction",
};

const state = {
  products: [],
  selectedIds: new Set(),
  searchTerm: "",
  category: "all",
  routineGenerated: false,
  conversation: [],
  previousSelectedCount: 0,
  requestInFlight: false,
};

const dom = {
  productGrid: document.getElementById("product-grid"),
  searchInput: document.getElementById("search-input"),
  categoryFilter: document.getElementById("category-filter"),
  selectedList: document.getElementById("selected-list"),
  selectedCount: document.getElementById("selected-count"),
  clearAllBtn: document.getElementById("clear-all-btn"),
  generateBtn: document.getElementById("generate-routine-btn"),
  chatHistory: document.getElementById("chat-history"),
  chatForm: document.getElementById("chat-form"),
  chatInput: document.getElementById("chat-input"),
  chatSubmitBtn: document.getElementById("chat-submit-btn"),
  rtlToggleBtn: document.getElementById("rtl-toggle-btn"),
  productStatus: document.getElementById("product-status"),
  modal: document.getElementById("description-modal"),
  modalTitle: document.getElementById("modal-title"),
  modalBody: document.getElementById("modal-body"),
  modalClose: document.getElementById("modal-close"),
  hubLauncher: document.getElementById("hub-launcher"),
  hubBadge: document.getElementById("hub-badge"),
  hubPanel: document.getElementById("hub-panel"),
  hubBackdrop: document.getElementById("hub-backdrop"),
  hubCloseBtn: document.getElementById("hub-close-btn"),
  hubTabsWrap: document.querySelector(".hub__tabs"),
  hubTabs: Array.from(document.querySelectorAll("[data-hub-tab]")),
};

const workerEndpoint = document.body.dataset.workerEndpoint || "";
const LEGACY_ADVISOR_SYSTEM_PROMPT =
  "You are an elegant, professional, and helpful Virtual Beauty Advisor for L'Oréal Paris. " +
  "Your goal is to help users discover L'Oréal products (makeup, skincare, haircare, fragrances) and provide personalized routines. " +
  "Only answer beauty and L'Oréal related questions.";

const HEADER_SCROLL_COMPACT_ON = 72;
const HEADER_SCROLL_COMPACT_OFF = 40;
let isHeaderCompact = false;

function syncHeaderState() {
  const scrollY = window.scrollY;
  if (!isHeaderCompact && scrollY > HEADER_SCROLL_COMPACT_ON) {
    isHeaderCompact = true;
  } else if (isHeaderCompact && scrollY < HEADER_SCROLL_COMPACT_OFF) {
    isHeaderCompact = false;
  }

  document.body.classList.toggle("app--scrolled", isHeaderCompact);
}

function setHubOpenState(isOpen) {
  dom.hubPanel.classList.toggle("hub--open", isOpen);
  dom.hubPanel.setAttribute("aria-hidden", isOpen ? "false" : "true");
  dom.hubBackdrop.hidden = !isOpen;
  dom.hubLauncher.setAttribute("aria-expanded", isOpen ? "true" : "false");
  document.body.classList.toggle("app--hub-open", isOpen);

  if (isOpen) {
    const activeTab = dom.hubTabs.find((tab) =>
      tab.classList.contains("hub__tab--active"),
    );
    (activeTab || dom.hubCloseBtn).focus();
  } else {
    dom.hubLauncher.focus();
  }
}

function setActiveHubTab(tabName) {
  const activeIndex = dom.hubTabs.findIndex(
    (tab) => tab.dataset.hubTab === tabName,
  );
  if (activeIndex >= 0) {
    dom.hubTabsWrap.style.setProperty("--hub-tab-index", String(activeIndex));
  }

  dom.hubTabs.forEach((tab) => {
    const isActive = tab.dataset.hubTab === tabName;
    tab.classList.toggle("hub__tab--active", isActive);
    tab.setAttribute("aria-selected", isActive ? "true" : "false");

    const panelId = tab.getAttribute("aria-controls");
    const panel = document.getElementById(panelId);
    if (!panel) {
      return;
    }

    panel.classList.toggle("hub__tab-panel--active", isActive);
    panel.hidden = !isActive;
  });
}

function updateHubBadge() {
  const count = state.selectedIds.size;
  dom.hubBadge.textContent = String(count);
  dom.hubLauncher.classList.toggle("hub-launcher--has-items", count > 0);

  if (count > state.previousSelectedCount) {
    dom.hubLauncher.classList.remove("hub-launcher--pulse");
    requestAnimationFrame(() => {
      dom.hubLauncher.classList.add("hub-launcher--pulse");
    });
  }

  state.previousSelectedCount = count;
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeImageUrl(url) {
  const value = String(url || "").trim();
  if (!value) {
    return "https://placehold.co/640x640/f4efe6/1a1a1a?text=L%27Oreal+Product";
  }

  try {
    const parsed = new URL(value);
    // Encode path safely while preserving separators.
    parsed.pathname = parsed.pathname
      .split("/")
      .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
      .join("/");
    return parsed.toString();
  } catch (error) {
    return "https://placehold.co/640x640/f4efe6/1a1a1a?text=L%27Oreal+Product";
  }
}

function persistSelectedIds() {
  localStorage.setItem(
    STORAGE_KEYS.selectedIds,
    JSON.stringify(Array.from(state.selectedIds)),
  );
}

function hydrateDirection() {
  const savedDirection = localStorage.getItem(STORAGE_KEYS.direction);
  if (savedDirection === "rtl" || savedDirection === "ltr") {
    document.documentElement.setAttribute("dir", savedDirection);
  }
}

function toggleDirection() {
  const current =
    document.documentElement.getAttribute("dir") === "rtl" ? "rtl" : "ltr";
  const next = current === "rtl" ? "ltr" : "rtl";
  document.documentElement.setAttribute("dir", next);
  localStorage.setItem(STORAGE_KEYS.direction, next);
}

function hydrateSelectedIds() {
  const parsed = JSON.parse(
    localStorage.getItem(STORAGE_KEYS.selectedIds) || "[]",
  );
  const validIds = new Set(state.products.map((product) => product.id));
  parsed.forEach((id) => {
    if (validIds.has(id)) {
      state.selectedIds.add(id);
    }
  });
}

function setRoutineControls(isGenerated) {
  state.routineGenerated = isGenerated;
  const hasSelections = state.selectedIds.size > 0;
  const canChat = isGenerated || hasSelections;

  dom.chatInput.disabled = !canChat || state.requestInFlight;
  dom.chatSubmitBtn.disabled = !canChat || state.requestInFlight;
  dom.chatInput.placeholder = isGenerated
    ? "Ask follow-up questions about order, usage, or alternatives"
    : "Ask your first question to auto-generate your routine";
}

function setBusyState(isBusy, context = "") {
  state.requestInFlight = isBusy;

  if (isBusy) {
    document.body.classList.add("app--busy");
    dom.chatForm.setAttribute("aria-busy", "true");
    dom.generateBtn.disabled = true;
    dom.generateBtn.setAttribute("aria-disabled", "true");
    dom.chatSubmitBtn.setAttribute("aria-disabled", "true");
    dom.chatInput.setAttribute("aria-disabled", "true");

    if (context === "generate") {
      dom.chatSubmitBtn.textContent = "Waiting...";
    }
    if (context === "followUp") {
      dom.chatSubmitBtn.textContent = "Waiting...";
      dom.generateBtn.textContent = "Please wait...";
    }
  } else {
    document.body.classList.remove("app--busy");
    dom.chatForm.removeAttribute("aria-busy");
    dom.generateBtn.removeAttribute("aria-disabled");
    dom.chatSubmitBtn.removeAttribute("aria-disabled");
    dom.chatInput.removeAttribute("aria-disabled");
    dom.generateBtn.textContent = "Generate Routine";
    dom.chatSubmitBtn.textContent = "Send";
    dom.generateBtn.disabled = getSelectedProducts().length === 0;
  }

  setRoutineControls(state.routineGenerated);
}

function getSelectedProducts() {
  return state.products.filter((product) => state.selectedIds.has(product.id));
}

function getFilteredProducts() {
  return state.products.filter((product) => {
    const query = state.searchTerm.trim().toLowerCase();
    const inSearch =
      query.length === 0 ||
      product.name.toLowerCase().includes(query) ||
      product.brand.toLowerCase().includes(query) ||
      product.description.toLowerCase().includes(query);
    const inCategory =
      state.category === "all" || product.category === state.category;
    return inSearch && inCategory;
  });
}

function renderCategoryFilter() {
  const categories = Array.from(
    new Set(state.products.map((product) => product.category)),
  ).sort();
  dom.categoryFilter.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All Categories";
  dom.categoryFilter.appendChild(allOption);

  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    dom.categoryFilter.appendChild(option);
  });

  dom.categoryFilter.value = state.category;
}

function openDescriptionModal(product) {
  dom.modalTitle.textContent = `${product.brand} - ${product.name}`;
  dom.modalBody.textContent = product.description;
  dom.modal.classList.add("modal--open");
  dom.modal.removeAttribute("hidden");
  dom.modalClose.focus();
}

function closeDescriptionModal() {
  dom.modal.classList.remove("modal--open");
  dom.modal.setAttribute("hidden", "hidden");
}

function buildProductCard(product) {
  const isSelected = state.selectedIds.has(product.id);

  const li = document.createElement("li");
  li.className = "product-grid__item";

  const card = document.createElement("article");
  card.className = `product-card ${isSelected ? "product-card--selected" : ""}`;
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.setAttribute("aria-pressed", isSelected ? "true" : "false");
  card.setAttribute(
    "aria-label",
    `${isSelected ? "Unselect" : "Select"} ${product.brand} ${product.name}`,
  );

  const top = document.createElement("div");
  top.className = "product-card__top";

  const category = document.createElement("span");
  category.className = "product-card__category";
  category.textContent = product.category;

  const checkbox = document.createElement("input");
  checkbox.className = "product-card__check";
  checkbox.type = "checkbox";
  checkbox.checked = isSelected;
  checkbox.setAttribute(
    "aria-label",
    `Select ${product.brand} ${product.name}`,
  );
  checkbox.addEventListener("change", (event) => {
    event.stopPropagation();
    toggleProductSelection(product.id);
  });

  top.append(category, checkbox);

  const image = document.createElement("img");
  image.className = "product-card__image";
  image.src = normalizeImageUrl(product.image);
  image.alt = `${product.brand} ${product.name}`;
  image.loading = "lazy";
  image.addEventListener("error", () => {
    image.src =
      "https://placehold.co/640x640/f4efe6/1a1a1a?text=L%27Oreal+Product";
  });

  const brand = document.createElement("p");
  brand.className = "product-card__brand";
  brand.textContent = product.brand;

  const name = document.createElement("h3");
  name.className = "product-card__name";
  name.textContent = product.name;

  const actions = document.createElement("div");
  actions.className = "product-card__actions";

  const detailsBtn = document.createElement("button");
  detailsBtn.type = "button";
  detailsBtn.className = "product-card__details";
  detailsBtn.textContent = "Details";
  detailsBtn.setAttribute("aria-haspopup", "dialog");
  detailsBtn.addEventListener("click", () => {
    openDescriptionModal(product);
  });

  actions.append(detailsBtn);

  card.addEventListener("click", (event) => {
    if (
      event.target.closest(".product-card__details") ||
      event.target === checkbox
    ) {
      return;
    }
    toggleProductSelection(product.id);
  });

  card.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    if (
      event.target.closest(".product-card__details") ||
      event.target === checkbox
    ) {
      return;
    }
    event.preventDefault();
    toggleProductSelection(product.id);
  });

  card.append(top, image, brand, name, actions);
  li.appendChild(card);
  return li;
}

function renderProducts() {
  const filteredProducts = getFilteredProducts();
  dom.productGrid.innerHTML = "";

  if (filteredProducts.length === 0) {
    const empty = document.createElement("li");
    empty.className = "product-grid__item product-grid__item--empty";
    empty.textContent = "No products match your search and filter.";
    dom.productGrid.appendChild(empty);
    dom.productStatus.textContent = "0 products visible";
    return;
  }

  const fragment = document.createDocumentFragment();
  filteredProducts.forEach((product) => {
    fragment.appendChild(buildProductCard(product));
  });
  dom.productGrid.appendChild(fragment);
  dom.productStatus.textContent = `${filteredProducts.length} products visible`;
}

function renderSelectedProducts() {
  const selectedProducts = getSelectedProducts();
  dom.selectedList.innerHTML = "";
  dom.selectedCount.textContent = `${selectedProducts.length}`;
  updateHubBadge();

  if (selectedProducts.length === 0) {
    const empty = document.createElement("li");
    empty.className = "selected-products__empty";
    empty.textContent = "No products selected.";
    dom.selectedList.appendChild(empty);
    dom.generateBtn.disabled = true;
    setRoutineControls(state.routineGenerated);
    return;
  }

  const fragment = document.createDocumentFragment();
  selectedProducts.forEach((product) => {
    const li = document.createElement("li");
    li.className = "selected-product";

    const image = document.createElement("img");
    image.className = "selected-product__image";
    image.src = normalizeImageUrl(product.image);
    image.alt = `${product.brand} ${product.name}`;
    image.loading = "lazy";
    image.addEventListener("error", () => {
      image.src =
        "https://placehold.co/640x640/f4efe6/1a1a1a?text=L%27Oreal+Product";
    });

    const meta = document.createElement("div");
    meta.className = "selected-product__meta";

    const name = document.createElement("p");
    name.className = "selected-product__name";
    name.textContent = `${product.brand} - ${product.name}`;

    const category = document.createElement("p");
    category.className = "selected-product__category";
    category.textContent = product.category;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "selected-product__remove";
    removeBtn.textContent = "Remove";
    removeBtn.setAttribute(
      "aria-label",
      `Remove ${product.brand} ${product.name}`,
    );
    removeBtn.addEventListener("click", () => {
      toggleProductSelection(product.id);
    });

    meta.append(name, category);
    li.append(image, meta, removeBtn);
    fragment.appendChild(li);
  });

  dom.selectedList.appendChild(fragment);
  dom.generateBtn.disabled = false;
  setRoutineControls(state.routineGenerated);
}

function toggleProductSelection(productId) {
  if (state.selectedIds.has(productId)) {
    state.selectedIds.delete(productId);
  } else {
    state.selectedIds.add(productId);
  }

  persistSelectedIds();
  renderProducts();
  renderSelectedProducts();
}

function clearAllSelections() {
  state.selectedIds.clear();
  persistSelectedIds();
  renderProducts();
  renderSelectedProducts();
}

function scrollChatToBottom() {
  dom.chatHistory.scrollTop = dom.chatHistory.scrollHeight;
}

function appendChatMessage(role, text, citations = []) {
  const item = document.createElement("li");
  item.className = `chat__message chat__message--${role}`;
  item.innerHTML = escapeHtml(text).replace(/\n/g, "<br>");

  if (Array.isArray(citations) && citations.length > 0) {
    const linksWrap = document.createElement("div");
    linksWrap.className = "chat__citations";

    citations.forEach((citation) => {
      const link = document.createElement("a");
      link.className = "chat__citation-link";
      link.href = citation.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = citation.title
        ? `Source: ${citation.title}`
        : citation.url;
      linksWrap.appendChild(link);
    });

    item.appendChild(linksWrap);
  }

  dom.chatHistory.appendChild(item);
  scrollChatToBottom();
}

function addConversationEntry(role, content) {
  state.conversation.push({ role, content });
}

async function sendToWorker(payload) {
  if (!workerEndpoint) {
    return {
      reply:
        "Worker endpoint is not configured. Set data-worker-endpoint on <body>.",
      citations: [],
    };
  }

  const response = await fetch(workerEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  let data = {};
  try {
    data = await response.json();
  } catch (error) {
    data = {};
  }

  const directReply =
    typeof data?.reply === "string"
      ? data.reply
      : data?.choices?.[0]?.message?.content?.trim() || "";

  if (response.ok && directReply) {
    return {
      reply: directReply,
      citations: Array.isArray(data?.citations) ? data.citations : [],
    };
  }

  const needsLegacyFallback =
    !response.ok &&
    typeof data?.error?.message === "string" &&
    data.error.message.includes("Missing required parameter: 'messages'");

  if (!needsLegacyFallback) {
    throw new Error(`Worker request failed (${response.status})`);
  }

  const selectedProducts = Array.isArray(payload?.selectedProducts)
    ? payload.selectedProducts
    : [];
  const conversation = Array.isArray(payload?.conversation)
    ? payload.conversation
        .filter(
          (item) =>
            item &&
            (item.role === "user" || item.role === "assistant") &&
            typeof item.content === "string",
        )
        .map((item) => ({ role: item.role, content: item.content }))
    : [];

  const productContext = selectedProducts.length
    ? `Selected products:\n${JSON.stringify(selectedProducts, null, 2)}`
    : "";

  const legacyMessages = [
    {
      role: "system",
      content: productContext
        ? `${LEGACY_ADVISOR_SYSTEM_PROMPT}\n\n${productContext}`
        : LEGACY_ADVISOR_SYSTEM_PROMPT,
    },
    ...conversation,
  ];

  const legacyResponse = await fetch(workerEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messages: legacyMessages }),
  });

  const legacyData = await legacyResponse.json();
  if (!legacyResponse.ok) {
    throw new Error(`Worker request failed (${legacyResponse.status})`);
  }

  const legacyReply =
    legacyData?.choices?.[0]?.message?.content?.trim() ||
    legacyData?.reply ||
    "I could not generate a response right now.";

  return {
    reply: legacyReply,
    citations: [],
  };
}

function isValidProductShape(product) {
  return (
    product &&
    (typeof product.id === "string" || typeof product.id === "number") &&
    typeof product.brand === "string" &&
    typeof product.name === "string" &&
    typeof product.category === "string" &&
    typeof product.description === "string" &&
    typeof product.image === "string"
  );
}

function toTitleCase(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeProductsInput(source) {
  const list = Array.isArray(source)
    ? source
    : Array.isArray(source?.products)
      ? source.products
      : [];

  return list.filter(isValidProductShape).map((product) => ({
    id: String(product.id),
    brand: product.brand.trim(),
    name: product.name.trim(),
    category: toTitleCase(product.category),
    description: product.description.trim(),
    image: product.image.trim(),
  }));
}

async function loadProductsFromWorker() {
  if (!workerEndpoint) {
    return null;
  }

  const response = await fetch(workerEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "getProducts" }),
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  const normalized = normalizeProductsInput(data);
  if (normalized.length === 0) {
    return null;
  }

  return normalized;
}

async function handleGenerateRoutine() {
  if (state.requestInFlight) {
    return;
  }

  const selectedProducts = getSelectedProducts();
  if (selectedProducts.length === 0) {
    return;
  }

  // Switch to Advisor immediately on generate click.
  setHubOpenState(true);
  setActiveHubTab("advisor");

  setBusyState(true, "generate");
  dom.generateBtn.textContent = "Generating...";

  appendChatMessage("user", "Generate my routine from the selected products.");
  addConversationEntry(
    "user",
    "Generate my routine from the selected products.",
  );

  try {
    const data = await sendToWorker({
      type: "generateRoutine",
      selectedProducts,
      conversation: state.conversation,
    });

    appendChatMessage("assistant", data.reply, data.citations || []);
    addConversationEntry("assistant", data.reply);
    setRoutineControls(true);
    dom.chatInput.focus();
  } catch (error) {
    setHubOpenState(true);
    setActiveHubTab("advisor");
    appendChatMessage(
      "system",
      "Routine generation is temporarily unavailable. Please try again in a moment.",
    );
  } finally {
    setBusyState(false);
  }
}

async function handleChatSubmit(event) {
  event.preventDefault();
  if (state.requestInFlight) {
    return;
  }

  if (state.selectedIds.size === 0) {
    appendChatMessage(
      "system",
      "Select at least one product to start chatting with the advisor.",
    );
    return;
  }

  const message = dom.chatInput.value.trim();
  if (!message) {
    return;
  }

  if (!state.routineGenerated) {
    await handleGenerateRoutine();
    if (!state.routineGenerated) {
      return;
    }
  }

  dom.chatInput.value = "";
  setBusyState(true, "followUp");

  appendChatMessage("user", message);
  addConversationEntry("user", message);

  try {
    const data = await sendToWorker({
      type: "followUp",
      question: message,
      selectedProducts: getSelectedProducts(),
      conversation: state.conversation,
    });

    appendChatMessage("assistant", data.reply, data.citations || []);
    addConversationEntry("assistant", data.reply);
  } catch (error) {
    appendChatMessage(
      "system",
      "I could not fetch a follow-up answer right now.",
    );
  } finally {
    setBusyState(false);
    dom.chatInput.focus();
  }
}

function handleModalInteractions() {
  dom.modalClose.addEventListener("click", closeDescriptionModal);
  dom.modal.addEventListener("click", (event) => {
    if (event.target === dom.modal) {
      closeDescriptionModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dom.modal.classList.contains("modal--open")) {
      closeDescriptionModal();
    }
  });
}

function attachListeners() {
  dom.searchInput.addEventListener("input", (event) => {
    state.searchTerm = event.target.value;
    renderProducts();
  });

  dom.categoryFilter.addEventListener("change", (event) => {
    state.category = event.target.value;
    renderProducts();
  });

  dom.clearAllBtn.addEventListener("click", clearAllSelections);
  dom.generateBtn.addEventListener("click", handleGenerateRoutine);
  dom.chatForm.addEventListener("submit", handleChatSubmit);
  dom.rtlToggleBtn.addEventListener("click", toggleDirection);
  window.addEventListener("scroll", syncHeaderState, { passive: true });

  dom.hubLauncher.addEventListener("click", () => {
    const isOpen = dom.hubPanel.classList.contains("hub--open");
    setHubOpenState(!isOpen);
  });

  dom.hubCloseBtn.addEventListener("click", () => {
    setHubOpenState(false);
  });

  dom.hubBackdrop.addEventListener("click", () => {
    setHubOpenState(false);
  });

  dom.hubTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      setActiveHubTab(tab.dataset.hubTab);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      dom.hubPanel.classList.contains("hub--open")
    ) {
      setHubOpenState(false);
    }
  });

  handleModalInteractions();
}

async function loadProducts() {
  const liveProducts = await loadProductsFromWorker();
  if (Array.isArray(liveProducts) && liveProducts.length > 0) {
    state.products = liveProducts;
    return;
  }

  const response = await fetch("./products.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Unable to load products.json");
  }

  const data = await response.json();
  const normalized = normalizeProductsInput(data);
  if (!Array.isArray(normalized) || normalized.length === 0) {
    throw new Error("products.json must include a non-empty products array");
  }

  state.products = normalized;
}

async function init() {
  hydrateDirection();
  syncHeaderState();
  setActiveHubTab("selected");
  setHubOpenState(false);
  setRoutineControls(false);

  try {
    await loadProducts();
    hydrateSelectedIds();
    renderCategoryFilter();
    renderProducts();
    renderSelectedProducts();
    attachListeners();
  } catch (error) {
    dom.productGrid.innerHTML =
      '<li class="product-grid__item product-grid__item--empty">Unable to load products right now.</li>';
    dom.productStatus.textContent = "Product feed failed to load";
  }
}

init();
