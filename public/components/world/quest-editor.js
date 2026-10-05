import { CollectibleIcon, canonicalRarity, escapeHtml } from "../collected-list.js";

export const buildQuestPayload = (state) => {
  const payload = {
    title: state.title.trim(),
    description: state.description.trim(),
    collectibleIds: state.collectibles
      .filter((collectible) => state.selectedIds.includes(collectible.id))
      .map((collectible) => collectible.id)
  };
  if (state.sourceActivityId) payload.sourceActivityId = state.sourceActivityId;
  return payload;
};

export const initialEditorState = ({ draft, quest }) => {
  if (quest) {
    return {
      mode: "edit",
      questId: quest.id,
      title: quest.title ?? "",
      description: quest.description ?? "",
      collectibles: quest.collectibles ?? [],
      selectedIds: (quest.collectibles ?? []).map((collectible) => collectible.id),
      status: quest.status ?? "draft"
    };
  }
  return {
    mode: "create",
    title: draft.title ?? "",
    description: draft.description ?? "",
    collectibles: draft.collectibles ?? [],
    selectedIds: (draft.collectibles ?? []).map((collectible) => collectible.id),
    sourceActivityId: draft.sourceActivityId,
    status: "draft"
  };
};

const CollectibleOption = (collectible, selectedIds) => {
  const rarity = canonicalRarity(collectible.rarity);
  return `
    <li>
      <label>
        <input type="checkbox" data-quest-collectible="${escapeHtml(collectible.id)}"
          ${selectedIds.includes(collectible.id) ? "checked" : ""}>
        ${CollectibleIcon(collectible.type, rarity === "common" ? undefined : rarity)}
        <span data-user-content>${escapeHtml(collectible.name)}</span>
        <small>${collectible.found ? "Visited" : "Unvisited"}</small>
      </label>
    </li>
  `;
};

export const QuestEditor = (state, message) => `
  <form class="quest-editor" aria-label="${state.mode === "edit" ? "Edit quest" : "Create quest"}">
    <header>
      <h2>${state.mode === "edit" ? "Edit quest" : "Create quest"}</h2>
      <button class="quest-editor-close" type="button" data-quest-cancel aria-label="Close quest editor">\u00d7</button>
    </header>
    <label class="quest-editor-field">
      <span>Title</span>
      <input type="text" name="title" maxlength="120" required value="${escapeHtml(state.title)}">
    </label>
    <label class="quest-editor-field">
      <span>Description</span>
      <textarea name="description" maxlength="2000" rows="3" data-user-content>${escapeHtml(state.description)}</textarea>
    </label>
    <fieldset class="quest-editor-collectibles">
      <legend>Collectibles <small>${state.selectedIds.length} of ${state.collectibles.length} selected</small></legend>
      ${state.collectibles.length
    ? `<ul>${state.collectibles.map((collectible) => CollectibleOption(collectible, state.selectedIds)).join("")}</ul>`
    : "<p>No collectibles were encountered on this activity.</p>"}
    </fieldset>
    ${message ? `<p class="quest-editor-message" role="alert">${escapeHtml(message)}</p>` : ""}
    <footer>
      <button type="button" data-quest-cancel>CANCEL</button>
      <button type="submit" data-quest-save>SAVE DRAFT</button>
      <button type="button" data-quest-publish>${state.status === "published" ? "SAVE & KEEP PUBLISHED" : "PUBLISH"}</button>
    </footer>
  </form>
`;

const responseJson = async (response) => {
  if (response.status === 204) return undefined;
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Unable to save this quest.");
  return body;
};

export const mountQuestEditor = (host, { draft, quest, onSaved, onCancel }) => {
  const state = initialEditorState({ draft, quest });
  let message;
  let saving = false;

  const render = () => {
    host.innerHTML = QuestEditor(state, message);
    const form = host.querySelector(".quest-editor");
    form.querySelector('[name="title"]').addEventListener("input", (event) => {
      state.title = event.target.value;
    });
    form.querySelector('[name="description"]').addEventListener("input", (event) => {
      state.description = event.target.value;
    });
    form.querySelectorAll("[data-quest-collectible]").forEach((input) => {
      input.addEventListener("change", () => {
        const id = input.dataset.questCollectible;
        state.selectedIds = input.checked
          ? [...new Set([...state.selectedIds, id])]
          : state.selectedIds.filter((value) => value !== id);
        render();
      });
    });
    form.querySelectorAll("[data-quest-cancel]").forEach((button) => {
      button.addEventListener("click", onCancel);
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void save(false);
    });
    form.querySelector("[data-quest-publish]").addEventListener("click", () => void save(true));
  };

  const save = async (publish) => {
    if (saving) return;
    saving = true;
    message = undefined;
    try {
      const payload = buildQuestPayload(state);
      if (payload.title === "") throw new Error("A quest needs a title.");
      const saved = state.mode === "edit"
        ? await fetch(`/api/quests/${encodeURIComponent(state.questId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }).then(responseJson)
        : await fetch("/api/quests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }).then(responseJson);
      const published = publish
        ? await fetch(`/api/quests/${encodeURIComponent(saved.id)}/publish`, { method: "POST" }).then(responseJson)
        : saved;
      onSaved(published);
    } catch (error) {
      message = error instanceof Error ? error.message : "Unable to save this quest.";
      render();
    } finally {
      saving = false;
    }
  };

  render();
};
