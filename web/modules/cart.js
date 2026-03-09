export function menuItemTotal(item) {
  const base = item.priceExGst || 0;
  return base + Math.round(base * ((item.gstPercent || 0) / 100));
}

export function buildCartSummary(categories, cart) {
  const itemsById = new Map();
  categories.forEach((category) => {
    category.items.forEach((item) => itemsById.set(item.id, item));
  });

  const lines = Object.entries(cart)
    .filter(([id, quantity]) => quantity > 0 && itemsById.has(id))
    .map(([id, quantity]) => {
      const item = itemsById.get(id);
      return {
        id,
        name: item.name,
        quantity,
        unitTotal: menuItemTotal(item),
        total: menuItemTotal(item) * quantity,
      };
    });

  return {
    lines,
    total: lines.reduce((sum, line) => sum + line.total, 0),
  };
}

export function normaliseDraftCart(cart) {
  return Object.fromEntries(
    Object.entries(cart || {})
      .filter(([, quantity]) => Number(quantity) > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([menuItemId, quantity]) => [
        menuItemId,
        Math.min(99, Math.max(0, Math.floor(Number(quantity) || 0))),
      ]),
  );
}

export function serialiseDraftCart(cart) {
  return JSON.stringify(normaliseDraftCart(cart));
}

export function bucketItemsToCart(bucketItems) {
  return (bucketItems || []).reduce((acc, item) => {
    if (item.quantity > 0) {
      acc[item.menuItemId] = item.quantity;
    }
    return acc;
  }, {});
}

export function cartToBucketItems(cart) {
  return Object.entries(normaliseDraftCart(cart)).map(([menuItemId, quantity]) => ({
    menuItemId,
    quantity,
  }));
}
