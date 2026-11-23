"use server";
import { revalidatePath } from "next/cache";
import { answerQuiz } from "@/lib/agents/history";
import { searchMangaDex, trackSeries, trackWebtoon } from "@/lib/agents/manga";
import { db } from "@/lib/db";
import { JOBS } from "@/lib/jobs";
import { isRunning, runJob } from "@/lib/scheduler";

export async function runJobNow(name: string) {
  const job = JOBS.find((j) => j.name === name);
  if (!job) return { message: `Unknown job ${name}` };
  if (isRunning(name)) return { message: "Already running" };
  void runJob(job, "manual").then(() => revalidatePath("/", "layout"));
  return { message: "Started — refresh in a minute" };
}

export async function submitQuiz(id: number, choice: number) {
  const r = answerQuiz(id, choice);
  return r;
}

export async function searchManga(query: string) {
  if (query.trim().length < 2) return [];
  return searchMangaDex(query.trim());
}

export async function trackManga(s: { id: string; title: string; url: string; cover: string | null }) {
  trackSeries({ source: "mangadex", external_id: s.id, title: s.title, url: s.url, cover: s.cover });
  revalidatePath("/shelf");
}

export async function addWebtoon(formData: FormData) {
  await trackWebtoon(String(formData.get("url") ?? ""));
  revalidatePath("/shelf");
}

export async function untrack(id: number) {
  db.prepare("DELETE FROM chapters WHERE series_id = ?").run(id);
  db.prepare("DELETE FROM series WHERE id = ?").run(id);
  revalidatePath("/shelf");
}

export async function markSeen(seriesId: number) {
  db.prepare("UPDATE chapters SET seen = 1 WHERE series_id = ?").run(seriesId);
  revalidatePath("/shelf");
  revalidatePath("/");
}

export async function saveNotes(id: number, notes: string) {
  db.prepare("UPDATE series SET notes = ? WHERE id = ?").run(notes, id);
  revalidatePath("/shelf");
}
