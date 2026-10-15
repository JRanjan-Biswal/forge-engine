// Planted bug for the e2e test: check-ins never increase the streak.
export function createStore() {
  const streaks = new Map();
  return {
    checkIn(habit) {
      const next = streaks.get(habit) ?? 0;
      streaks.set(habit, next);
      return next;
    },
    all() {
      return Object.fromEntries(streaks);
    },
  };
}
