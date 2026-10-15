import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** File-backed streak store (the fix for the planted bug). */
export function createStore(file = process.env.HABIT_DB ?? "habits.json") {
  const load = () => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {});
  return {
    checkIn(habit) {
      const data = load();
      data[habit] = (data[habit] ?? 0) + 1;
      writeFileSync(file, JSON.stringify(data));
      return data[habit];
    },
    all: load,
  };
}
