"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { NOTICE_STATUSES, noticeStatus, profiles } from "@/db/schema";
import { log } from "@/lib/logger";
import { rescoreProfile } from "@/lib/scoring";

function readStatus(value: FormDataEntryValue | null): (typeof NOTICE_STATUSES)[number] {
  const candidate = String(value ?? "");
  const match = NOTICE_STATUSES.find((s) => s === candidate);
  if (!match) throw new Error(`Ukendt status: ${candidate}`);
  return match;
}

/** One click, no dialog (SPEC §6). Triage is keyed on udbud.dk's notice id. */
export async function setNoticeStatus(formData: FormData): Promise<void> {
  const noticeId = String(formData.get("noticeId") ?? "");
  if (!noticeId) throw new Error("noticeId mangler");
  const status = readStatus(formData.get("status"));
  const assignedTo = String(formData.get("assignedTo") ?? "").trim() || null;

  await getDb()
    .insert(noticeStatus)
    .values({ noticeId, status, assignedTo })
    .onConflictDoUpdate({
      target: noticeStatus.noticeId,
      set: { status, assignedTo: sql`coalesce(${assignedTo}, ${noticeStatus.assignedTo})`, updatedAt: new Date() },
    });

  log.info("triage.status_set", { noticeId, status, assignedTo });
  revalidatePath("/");
  revalidatePath(`/udbud/${noticeId}`);
}

export async function saveNoticeNote(formData: FormData): Promise<void> {
  const noticeId = String(formData.get("noticeId") ?? "");
  if (!noticeId) throw new Error("noticeId mangler");
  const note = String(formData.get("note") ?? "").trim() || null;

  await getDb()
    .insert(noticeStatus)
    .values({ noticeId, note })
    .onConflictDoUpdate({ target: noticeStatus.noticeId, set: { note, updatedAt: new Date() } });

  revalidatePath(`/udbud/${noticeId}`);
}

function readList(formData: FormData, key: string): string[] {
  return String(formData.get(key) ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function readNumber(formData: FormData, key: string): string | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return null;
  const normalized = raw.replace(/\./g, "").replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(normalized) ? normalized : null;
}

export async function saveProfile(formData: FormData): Promise<void> {
  const db = getDb();
  const id = String(formData.get("id") ?? "").trim();
  const values = {
    name: String(formData.get("name") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
    cpvCodes: readList(formData, "cpvCodes"),
    keywords: readList(formData, "keywords"),
    excludedKeywords: readList(formData, "excludedKeywords"),
    regions: readList(formData, "regions"),
    noticeTypes: readList(formData, "noticeTypes"),
    buyerAllowlist: readList(formData, "buyerAllowlist"),
    buyerBlocklist: readList(formData, "buyerBlocklist"),
    minValue: readNumber(formData, "minValue"),
    maxValue: readNumber(formData, "maxValue"),
    minScoreForDigest: Number(formData.get("minScoreForDigest") ?? 60),
    updatedAt: new Date(),
  };

  if (!values.name) throw new Error("Profilen skal have et navn");

  if (id) {
    // Bumping the version invalidates cached scores instead of deleting them:
    // we keep the history of what an older profile definition thought.
    await db
      .update(profiles)
      .set({ ...values, version: sql`${profiles.version} + 1` })
      .where(eq(profiles.id, id));
    log.info("profile.updated", { id, name: values.name });
  } else {
    const [created] = await db.insert(profiles).values(values).returning({ id: profiles.id });
    log.info("profile.created", { id: created?.id, name: values.name });
  }

  revalidatePath("/profiler");
  revalidatePath("/");
}

export async function deleteProfile(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("id mangler");
  await getDb().delete(profiles).where(eq(profiles.id, id));
  log.info("profile.deleted", { id });
  revalidatePath("/profiler");
  revalidatePath("/");
}

/**
 * "Genscor de sidste 30 dages udbud med denne profil" (SPEC §6) — so a profile
 * edit can be judged on real tenders straight away instead of tomorrow.
 */
export async function rescoreProfileAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("id mangler");
  const days = Number(formData.get("days") ?? 30) || 30;

  const result = await rescoreProfile(getDb(), id, days);
  log.info("profile.rescored", { id, days, scored: result.scored, candidates: result.candidates });

  revalidatePath("/profiler");
  revalidatePath("/");
}
