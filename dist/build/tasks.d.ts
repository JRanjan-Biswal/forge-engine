import type { Task, Tasks } from "../schemas/artifacts.js";
/**
 * Build-stage scheduling: turn the task DAG into parallel waves (dependencies +
 * file conflicts), pick the next runnable tasks, update status under the project
 * lock, and assemble a self-contained brief per task for any agent or host.
 */
type TaskItem = Tasks["tasks"][number];
export declare function loadTasks(root: string): TaskItem[];
/**
 * Waves of tasks that can run in parallel: a task joins the earliest wave after all
 * of its dependencies, and never shares a wave with a task that touches the same file.
 */
export declare function planWaves(tasks: TaskItem[]): string[][];
/** Tasks that are `todo` and whose dependencies are all `done`, in wave order. */
export declare function nextTasks(tasks: TaskItem[]): TaskItem[];
export declare function updateTask(root: string, id: string, status: TaskItem["status"], note?: string): TaskItem;
/** Everything one task needs, in one markdown document — for a subagent or a headless worker. */
export declare function taskBrief(root: string, id: string): string;
export type { Task };
