import {
  buildStaffDashboardFetchPlan,
  resolveStaffDashboardRefreshMs,
} from '../../web/modules/staff-dashboard.js';

describe('frontend staff dashboard fetch plan', () => {
  it('skips table endpoints when the current tab does not need floor data', () => {
    expect(buildStaffDashboardFetchPlan({
      currentTab: 'queue',
      now: 50_000,
      tablesFetchedAt: 0,
      recentTableEventsFetchedAt: 0,
    })).toEqual({
      needsTables: false,
      needsRecentTableEvents: false,
      shouldFetchTables: false,
      shouldFetchRecentTableEvents: false,
    });

    expect(buildStaffDashboardFetchPlan({
      currentTab: 'manager',
      now: 50_000,
      tablesFetchedAt: 0,
      recentTableEventsFetchedAt: 0,
    }).shouldFetchTables).toBe(false);
  });

  it('fetches tables only for floor tabs and respects cache windows', () => {
    expect(buildStaffDashboardFetchPlan({
      currentTab: 'seat',
      now: 50_000,
      tablesFetchedAt: 20_000,
      recentTableEventsFetchedAt: 0,
    })).toEqual({
      needsTables: true,
      needsRecentTableEvents: false,
      shouldFetchTables: true,
      shouldFetchRecentTableEvents: false,
    });

    expect(buildStaffDashboardFetchPlan({
      currentTab: 'tables',
      now: 50_000,
      tablesFetchedAt: 45_000,
      recentTableEventsFetchedAt: 45_000,
    })).toEqual({
      needsTables: true,
      needsRecentTableEvents: true,
      shouldFetchTables: false,
      shouldFetchRecentTableEvents: false,
    });
  });

  it('slows refresh cadence for heavy tabs and degraded states', () => {
    expect(resolveStaffDashboardRefreshMs({ currentTab: 'queue', dependencyWarnings: [] })).toBe(3_000);
    expect(resolveStaffDashboardRefreshMs({ currentTab: 'history', dependencyWarnings: [] })).toBe(8_000);
    expect(resolveStaffDashboardRefreshMs({ currentTab: 'tables', dependencyWarnings: [] })).toBe(12_000);
    expect(resolveStaffDashboardRefreshMs({ currentTab: 'tables', dependencyWarnings: ['Tables'] })).toBe(8_000);
  });
});
