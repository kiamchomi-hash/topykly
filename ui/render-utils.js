export function renderIntoTargets(targets, className, buildNodes) {
  targets.forEach((target) => {
    if (!target) {
      return;
    }

    if (target.className !== className) {
      target.className = className;
    }

    const newNodes = buildNodes();
    reconcile(target, newNodes);
  });
}

/**
 * Basic DOM reconciliation that matches nodes by data-id.
 * It preserves existing nodes to maintain state (focus, scroll, etc.)
 * and patches attributes/text/children without serializing DOM trees.
 */
function reconcile(parent, newNodes) {
  const currentNodes = Array.from(parent.children);
  const currentById = new Map();

  currentNodes.forEach((node) => {
    if (node.dataset.id) {
      currentById.set(node.dataset.id, node);
    }
  });

  const newNodeIds = new Set(newNodes.map((node) => node.dataset.id).filter(Boolean));
  currentNodes.forEach((node) => {
    if (node.dataset.id && !newNodeIds.has(node.dataset.id)) {
      parent.removeChild(node);
    }
  });

  newNodes.forEach((newNode, index) => {
    const id = newNode.dataset.id;
    const existing = id ? currentById.get(id) : null;
    const currentAtIndex = parent.children[index];

    if (!existing) {
      parent.insertBefore(newNode, currentAtIndex || null);
      return;
    }

    if (existing !== currentAtIndex) {
      parent.insertBefore(existing, currentAtIndex || null);
    }

    patchElement(existing, newNode);
  });

  while (parent.children.length > newNodes.length) {
    parent.removeChild(parent.lastElementChild);
  }
}

function patchNode(existing, incoming) {
  if (existing.nodeType !== incoming.nodeType) {
    existing.parentNode.replaceChild(incoming, existing);
    return incoming;
  }

  if (existing.nodeType === Node.TEXT_NODE || existing.nodeType === Node.COMMENT_NODE) {
    if (existing.nodeValue !== incoming.nodeValue) {
      existing.nodeValue = incoming.nodeValue;
    }
    return existing;
  }

  if (existing.nodeType !== Node.ELEMENT_NODE) {
    return existing;
  }

  if (existing.tagName !== incoming.tagName) {
    existing.parentNode.replaceChild(incoming, existing);
    return incoming;
  }

  patchElement(existing, incoming);
  return existing;
}

function patchElement(existing, incoming) {
  syncAttributes(existing, incoming);
  syncElementProperties(existing, incoming);
  patchChildren(existing, incoming);
}

function syncAttributes(existing, incoming) {
  Array.from(existing.attributes).forEach((attribute) => {
    if (!incoming.hasAttribute(attribute.name)) {
      existing.removeAttribute(attribute.name);
    }
  });

  Array.from(incoming.attributes).forEach((attribute) => {
    if (existing.getAttribute(attribute.name) !== attribute.value) {
      existing.setAttribute(attribute.name, attribute.value);
    }
  });
}

function syncElementProperties(existing, incoming) {
  if ("value" in existing && document.activeElement !== existing && existing.value !== incoming.value) {
    existing.value = incoming.value;
  }

  if ("checked" in existing && existing.checked !== incoming.checked) {
    existing.checked = incoming.checked;
  }

  if ("selected" in existing && existing.selected !== incoming.selected) {
    existing.selected = incoming.selected;
  }
}

function patchChildren(existing, incoming) {
  const incomingChildren = Array.from(incoming.childNodes);
  const incomingIds = new Set(incomingChildren.map(getNodeId).filter(Boolean));

  Array.from(existing.children).forEach((child) => {
    const id = getNodeId(child);
    if (id && !incomingIds.has(id)) {
      existing.removeChild(child);
    }
  });

  const existingById = new Map();
  Array.from(existing.children).forEach((child) => {
    const id = getNodeId(child);
    if (id) {
      existingById.set(id, child);
    }
  });

  incomingChildren.forEach((incomingChild, index) => {
    const id = getNodeId(incomingChild);
    const currentAtIndex = existing.childNodes[index];
    const matched = id ? existingById.get(id) : currentAtIndex;

    if (!matched) {
      existing.insertBefore(incomingChild, currentAtIndex || null);
      return;
    }

    const patched = patchNode(matched, incomingChild);
    const targetAtIndex = existing.childNodes[index];

    if (patched !== targetAtIndex) {
      existing.insertBefore(patched, targetAtIndex || null);
    }
  });

  while (existing.childNodes.length > incomingChildren.length) {
    existing.removeChild(existing.lastChild);
  }
}

function getNodeId(node) {
  return node.nodeType === Node.ELEMENT_NODE ? node.dataset.id : null;
}