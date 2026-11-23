import { config } from "./config";
import { curiousReader } from "./agents/explainer";
import { curiousStudent, writeMeanwhileCard } from "./agents/history";
import { checkShelf, recommend } from "./agents/manga";
import { refreshWire, runWire } from "./agents/wire";
import type { Job } from "./scheduler";

export const JOBS: Job[] = [
  { name: "wire.morning", label: "Morning brief", schedule: { type: "daily", at: config.schedule.wireMorning }, usesLlm: true, run: () => runWire("morning") },
  { name: "reader.questions", label: "Curious reader", schedule: { type: "daily", at: config.schedule.wireMorning }, after: "wire.morning", usesLlm: true, run: () => curiousReader(3) },
  { name: "history.card", label: "Meanwhile card + quiz", schedule: { type: "daily", at: config.schedule.history }, usesLlm: true, run: () => writeMeanwhileCard() },
  { name: "history.student", label: "Student asks the tutor", schedule: { type: "daily", at: config.schedule.student }, after: "history.card", usesLlm: true, run: () => curiousStudent() },
  { name: "wire.evening", label: "Evening wrap", schedule: { type: "daily", at: config.schedule.wireEvening }, usesLlm: true, run: () => runWire("evening") },
  { name: "shelf.recs", label: "Shelf recommendations", schedule: { type: "daily", at: config.schedule.recs }, usesLlm: true, run: () => recommend() },
  { name: "wire.refresh", label: "Fetch + triage feeds", schedule: { type: "every", minutes: 180 }, usesLlm: true, run: () => refreshWire() },
  { name: "shelf.check", label: "Check for new chapters", schedule: { type: "every", minutes: 360 }, usesLlm: false, run: () => checkShelf() },
];
