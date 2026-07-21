import { getStoreCategory, STORE_CATEGORIES } from "../store-catalog.js";

function createTabMarkup(category, active) {
  return `
    <button
      class="store-modal__tab${active ? " is-active" : ""}"
      type="button"
      role="tab"
      aria-selected="${active}"
      data-store-category="${category.id}"
    >${category.label}</button>
  `;
}

function createItemArtMarkup(item) {
  if (item.assetUrl) {
    return `<img class="store-item__image" src="${item.assetUrl}" alt="" loading="lazy" width="64" height="64" />`;
  }

  return `
    <span class="store-item__placeholder" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="5"></rect>
        <circle cx="9" cy="10" r="1.2" fill="currentColor" stroke="none"></circle>
        <circle cx="15" cy="10" r="1.2" fill="currentColor" stroke="none"></circle>
        <path d="M8.5 14.5c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8"></path>
      </svg>
    </span>
  `;
}

function createItemMarkup(item, layout) {
  const priceLabel = typeof item.price === "number" ? `${item.price} puntos` : "Próximamente";
  return `
    <div
      class="store-item store-item--${layout}${item.assetUrl ? "" : " store-item--placeholder"}"
      data-store-item="${item.id}"
      role="listitem"
    >
      <span class="store-item__art" aria-hidden="${item.assetUrl ? "false" : "true"}">
        ${createItemArtMarkup(item)}
      </span>
      <span class="store-item__name">${item.name}</span>
      <span class="store-item__price">${priceLabel}</span>
    </div>
  `;
}

export function renderStoreModal(state, dom) {
  if (dom.storeModalBackdrop) {
    dom.storeModalBackdrop.hidden = !state.isStoreModalOpen;
  }

  if (dom.storeModal) {
    dom.storeModal.setAttribute("aria-hidden", String(!state.isStoreModalOpen));
  }

  if (dom.storeButton) {
    dom.storeButton.setAttribute("aria-expanded", String(state.isStoreModalOpen));
  }

  if (!dom.storeCategoryTabs || !dom.storeItemGrid) {
    return;
  }

  const category = getStoreCategory(state.storeCategory);
  const signature = [category.id, state.isStoreModalOpen ? "open" : "closed"].join("|");
  if (dom.storeItemGrid.dataset.storeRenderSignature === signature) {
    return;
  }

  dom.storeCategoryTabs.innerHTML = STORE_CATEGORIES
    .map((candidate) => createTabMarkup(candidate, candidate.id === category.id))
    .join("");

  dom.storeItemGrid.className = `store-modal__grid store-modal__grid--${category.layout}`;
  dom.storeItemGrid.innerHTML = `
    <p class="store-modal__category-copy">${category.description}</p>
    <div class="store-modal__items" role="list">
      ${category.items.map((item) => createItemMarkup(item, category.layout)).join("")}
    </div>
  `;
  dom.storeItemGrid.dataset.storeRenderSignature = signature;
}
