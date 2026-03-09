const TABLE_DATA_TABS = new Set(['tables', 'seat']);
const TABLE_CACHE_TTL_MS = 12_000;
const TABLE_EVENTS_CACHE_TTL_MS = 12_000;

export function buildStaffDashboardFetchPlan({
  currentTab,
  now = Date.now(),
  tablesFetchedAt = 0,
  recentTableEventsFetchedAt = 0,
}) {
  const needsTables = TABLE_DATA_TABS.has(currentTab);
  const needsRecentTableEvents = currentTab === 'tables';

  return {
    needsTables,
    needsRecentTableEvents,
    shouldFetchTables: needsTables && ((now - tablesFetchedAt) >= TABLE_CACHE_TTL_MS),
    shouldFetchRecentTableEvents: needsRecentTableEvents && ((now - recentTableEventsFetchedAt) >= TABLE_EVENTS_CACHE_TTL_MS),
  };
}

export function resolveStaffDashboardRefreshMs({ currentTab, dependencyWarnings }) {
  if (dependencyWarnings.length) {
    return 8_000;
  }

  if (currentTab === 'seated') {
    return 10_000;
  }

  if (currentTab === 'tables') {
    return 12_000;
  }

  if (currentTab === 'history') {
    return 8_000;
  }

  return 3_000;
}
