import type { IdentityRecord } from "../integrations/mono-lookup/lookup.types";

// What a credit officer reads after an identity lookup: not the government
// record, but whether it agreed with what the applicant told us. Deliberately
// field-by-field rather than one score — a name typo and a wrong date of
// birth are different problems and want different handling (same reasoning as
// the per-row bank verification panel).
export interface IdentityCheck {
  checkedAt: string;
  source: "bvn" | "nin" | "mashup";
  /** False when a fake client produced this — the reviewer must not trust it. */
  live: boolean;
  /** The name on the government record, for a human to eyeball. */
  recordName: string | null;
  nameMatch: "exact" | "partial" | "mismatch";
  /** null = couldn't compare (missing or unparseable on either side). */
  dateOfBirthMatch: boolean | null;
  genderMatch: boolean | null;
  phoneMatch: boolean | null;
  /** A BVN record carries a NIN — corroborates a separately declared one. */
  ninCorroborated: boolean | null;
  verdict: "match" | "partial" | "mismatch";
}

export interface DeclaredIdentity {
  fullName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  phone: string | null;
  nin: string | null;
}

/** Filler that carries no identifying signal, so it shouldn't count as a hit. */
const NAME_NOISE = new Set(["MR", "MRS", "MISS", "MS", "DR", "CHIEF", "ALHAJI", "HAJIA", "ENGR"]);

function nameTokens(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .toUpperCase()
    .replace(/[^A-Z ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !NAME_NOISE.has(w));
}

/** Nigerian numbers arrive as 080…, +23480…, 23480… — compare the last 10. */
function phoneTail(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

function genderLetter(raw: string | null): string | null {
  if (!raw) return null;
  const c = raw.trim()[0]?.toUpperCase();
  return c === "M" || c === "F" ? c : null;
}

function isoDate(raw: string | null): string | null {
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function compareNames(declared: string | null, record: IdentityRecord): IdentityCheck["nameMatch"] {
  const mine = new Set(nameTokens(declared));
  const first = nameTokens(record.firstName)[0] ?? null;
  const last = nameTokens(record.lastName)[0] ?? null;
  const all = [
    ...nameTokens(record.firstName),
    ...nameTokens(record.lastName),
    ...nameTokens(record.middleName),
  ];
  if (!mine.size || !all.length) return "mismatch";

  const hasFirst = !!first && mine.has(first);
  const hasLast = !!last && mine.has(last);

  // Both halves of the legal name present is the bar for a real match; an
  // unlisted middle name is normal and shouldn't demote it past "partial".
  if (hasFirst && hasLast) return all.every((t) => mine.has(t)) ? "exact" : "partial";
  // One half only: a marriage-name change or a transposition, not a clear no.
  if (hasFirst || hasLast) return "partial";
  return "mismatch";
}

export function matchIdentity(
  record: IdentityRecord,
  declared: DeclaredIdentity,
  opts: { live: boolean },
): IdentityCheck {
  const nameMatch = compareNames(declared.fullName, record);

  const myDob = isoDate(declared.dateOfBirth);
  const theirDob = isoDate(record.dateOfBirth);
  const dateOfBirthMatch = myDob && theirDob ? myDob === theirDob : null;

  const myGender = genderLetter(declared.gender);
  const theirGender = genderLetter(record.gender);
  const genderMatch = myGender && theirGender ? myGender === theirGender : null;

  const myPhone = phoneTail(declared.phone);
  const theirPhone = phoneTail(record.phone);
  const phoneMatch = myPhone && theirPhone ? myPhone === theirPhone : null;

  const ninCorroborated =
    declared.nin && record.nin ? declared.nin.replace(/\D/g, "") === record.nin.replace(/\D/g, "") : null;

  const recordName =
    [record.firstName, record.middleName, record.lastName].filter(Boolean).join(" ").trim() || null;

  // A wrong date of birth is as disqualifying as a wrong name — neither is a
  // typo you wave through. Everything else is a flag, not a verdict.
  const verdict: IdentityCheck["verdict"] =
    nameMatch === "mismatch" || dateOfBirthMatch === false
      ? "mismatch"
      : nameMatch === "exact" && dateOfBirthMatch === true
        ? "match"
        : "partial";

  return {
    checkedAt: new Date().toISOString(),
    source: record.source,
    live: opts.live,
    recordName,
    nameMatch,
    dateOfBirthMatch,
    genderMatch,
    phoneMatch,
    ninCorroborated,
    verdict,
  };
}
