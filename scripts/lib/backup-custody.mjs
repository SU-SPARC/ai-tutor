import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  appendFile,
  mkdir,
  open,
  readFile,
  readdir,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { safeHash } from "./database-integrity-evidence.mjs";

export const BACKUP_ENVELOPE_MAGIC = "PFXJBACKUP1\n";
export const BACKUP_ENVELOPE_VERSION = 1;
export const BACKUP_ENVELOPE_CIPHER = "aes-256-gcm";
export const BACKUP_ENVELOPE_KDF = "x25519-hkdf-sha256";
export const BACKUP_ENVELOPE_INFO = "pf-xj-backup-envelope-v1";
export const BACKUP_CUSTODY_LEDGER = "custody-ledger.jsonl";
export const BACKUP_ARCHIVE_SUFFIX = ".dump.enc";
export const BACKUP_CUSTODY_STATUS_AUDIT = "production_backup_custody_status";
export const BACKUP_ACCEPTANCE_ROLES = Object.freeze([
  "professor",
  "it_operator",
  "recovery_administrator",
]);

// Approved baseline. Every value is enforced by a command or reported as a
// finding; changing one is a reviewed policy decision, not a runtime option.
export const BACKUP_CUSTODY_POLICY = Object.freeze({
  cadenceHours: 24,
  encryption: `${BACKUP_ENVELOPE_KDF}+${BACKUP_ENVELOPE_CIPHER}`,
  freshnessLimitHours: 36,
  minimumInstitutionalOwners: 2,
  providerEvidenceMaxAgeDays: 7,
  recoveryPointObjectiveHours: 24,
  recoveryTimeObjectiveHours: 24,
  retentionDays: 35,
});

const FORBIDDEN_CUSTODY_SEGMENTS = new Set([
  ".git",
  ".next",
  ".vercel",
  "build",
  "node_modules",
  "out",
  "public",
]);
const TAG_BYTES = 16;
const IV_BYTES = 12;
const HEADER_SCAN_BYTES = 8192;
const SAFE_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._:/+-]{1,199}$/;
const RUN_ID_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export class BackupCustodyError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = "BackupCustodyError";
  }
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export function generateBackupKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  const publicKeyBase64 = publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64");
  return {
    fingerprint: safeHash(publicKeyBase64),
    privateKey: privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64"),
    publicKey: publicKeyBase64,
  };
}

export function importBackupPublicKey(value) {
  const key = importKey(value, "spki", "BACKUP_ENCRYPTION_PUBLIC_KEY");
  return { fingerprint: safeHash(normalizeBase64(value)), key };
}

export function importBackupPrivateKey(value) {
  const key = importKey(value, "pkcs8", "BACKUP_ENCRYPTION_PRIVATE_KEY");
  const publicKeyBase64 = createPublicKey(key)
    .export({ format: "der", type: "spki" })
    .toString("base64");
  return { fingerprint: safeHash(publicKeyBase64), key };
}

function importKey(value, type, name) {
  const normalized = normalizeBase64(value);
  if (!normalized) {
    throw new BackupCustodyError(`${name} is required.`, "key_unavailable");
  }
  let key;
  try {
    const der = Buffer.from(normalized, "base64");
    key =
      type === "spki"
        ? createPublicKey({ format: "der", key: der, type })
        : createPrivateKey({ format: "der", key: der, type });
  } catch {
    throw new BackupCustodyError(
      `${name} is not a valid base64 DER X25519 key.`,
      "key_invalid",
    );
  }
  if (key.asymmetricKeyType !== "x25519") {
    throw new BackupCustodyError(
      `${name} must be an X25519 key.`,
      "key_invalid",
    );
  }
  return key;
}

function normalizeBase64(value) {
  return typeof value === "string" ? value.replace(/\s+/g, "") : "";
}

function deriveEnvelopeKey({
  ephemeralPrivateKey,
  privateKey,
  publicKey,
  recipientPublicDer,
}) {
  const shared = privateKey
    ? diffieHellman({ privateKey, publicKey })
    : diffieHellman({ privateKey: ephemeralPrivateKey, publicKey });
  return Buffer.from(
    hkdfSync("sha256", shared, recipientPublicDer, BACKUP_ENVELOPE_INFO, 32),
  );
}

// ---------------------------------------------------------------------------
// Envelope encryption
// ---------------------------------------------------------------------------

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: hash.digest("hex") };
}

export async function encryptBackupArchive({
  inputPath,
  outputPath,
  publicKey,
}) {
  if (!String(outputPath).endsWith(BACKUP_ARCHIVE_SUFFIX)) {
    throw new BackupCustodyError(
      `Encrypted archives must end with ${BACKUP_ARCHIVE_SUFFIX}.`,
      "output_extension",
    );
  }
  const recipient = importBackupPublicKey(publicKey);
  const recipientPublicDer = recipient.key.export({
    format: "der",
    type: "spki",
  });
  const plaintext = await sha256File(inputPath);
  const ephemeral = generateKeyPairSync("x25519");
  const key = deriveEnvelopeKey({
    ephemeralPrivateKey: ephemeral.privateKey,
    publicKey: recipient.key,
    recipientPublicDer,
  });
  const iv = randomBytes(IV_BYTES);
  const header = {
    cipher: BACKUP_ENVELOPE_CIPHER,
    ephemeralPublicKey: ephemeral.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64"),
    iv: iv.toString("base64"),
    kdf: BACKUP_ENVELOPE_KDF,
    plaintextBytes: plaintext.bytes,
    plaintextSha256: plaintext.sha256,
    recipientKeyFingerprint: recipient.fingerprint,
    v: BACKUP_ENVELOPE_VERSION,
  };
  const headerLine = `${JSON.stringify(header)}\n`;
  const headerBuffer = Buffer.from(headerLine, "utf8");
  const cipher = createCipheriv(BACKUP_ENVELOPE_CIPHER, key, iv);
  cipher.setAAD(headerBuffer);
  const output = createWriteStream(outputPath, { flags: "wx", mode: 0o600 });
  try {
    await new Promise((resolve, reject) => {
      output.once("error", reject);
      output.write(
        Buffer.concat([Buffer.from(BACKUP_ENVELOPE_MAGIC), headerBuffer]),
        (error) => (error ? reject(error) : resolve()),
      );
    });
    await pipeline(createReadStream(inputPath), cipher, output, { end: false });
    const tag = cipher.getAuthTag();
    await new Promise((resolve, reject) => {
      output.once("error", reject);
      output.end(tag, resolve);
    });
  } catch (error) {
    output.destroy();
    await unlink(outputPath).catch(() => undefined);
    throw error;
  } finally {
    key.fill(0);
  }
  const ciphertext = await sha256File(outputPath);
  return {
    ciphertextSha256: ciphertext.sha256,
    encryptedBytes: ciphertext.bytes,
    headerBytes: BACKUP_ENVELOPE_MAGIC.length + headerBuffer.length,
    plaintextBytes: plaintext.bytes,
    plaintextSha256: plaintext.sha256,
    recipientKeyFingerprint: recipient.fingerprint,
  };
}

export async function readBackupEnvelopeHeader(filePath) {
  const handle = await open(filePath, "r");
  let prefix;
  try {
    const buffer = Buffer.alloc(HEADER_SCAN_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_SCAN_BYTES, 0);
    prefix = buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
  const magic = Buffer.from(BACKUP_ENVELOPE_MAGIC);
  if (!prefix.subarray(0, magic.length).equals(magic)) {
    throw new BackupCustodyError(
      "The file is not a backup envelope.",
      "envelope_invalid",
    );
  }
  const newline = prefix.indexOf(0x0a, magic.length);
  if (newline < 0) {
    throw new BackupCustodyError(
      "The backup envelope header is incomplete.",
      "envelope_invalid",
    );
  }
  const headerBuffer = prefix.subarray(magic.length, newline + 1);
  let header;
  try {
    header = JSON.parse(headerBuffer.toString("utf8"));
  } catch {
    throw new BackupCustodyError(
      "The backup envelope header is not valid JSON.",
      "envelope_invalid",
    );
  }
  if (
    header?.v !== BACKUP_ENVELOPE_VERSION ||
    header.cipher !== BACKUP_ENVELOPE_CIPHER ||
    header.kdf !== BACKUP_ENVELOPE_KDF ||
    typeof header.ephemeralPublicKey !== "string" ||
    typeof header.iv !== "string" ||
    !/^[0-9a-f]{64}$/.test(String(header.plaintextSha256 ?? "")) ||
    !Number.isInteger(header.plaintextBytes) ||
    !/^[0-9a-f]{16}$/.test(String(header.recipientKeyFingerprint ?? ""))
  ) {
    throw new BackupCustodyError(
      "The backup envelope header is unsupported.",
      "envelope_invalid",
    );
  }
  return {
    header,
    headerBuffer,
    headerBytes: magic.length + headerBuffer.length,
  };
}

export async function decryptBackupArchive({
  inputPath,
  outputPath,
  privateKey,
}) {
  if (!String(outputPath).endsWith(".dump")) {
    throw new BackupCustodyError(
      "Decrypted archives must end with .dump.",
      "output_extension",
    );
  }
  const recipient = importBackupPrivateKey(privateKey);
  const { header, headerBuffer, headerBytes } =
    await readBackupEnvelopeHeader(inputPath);
  if (header.recipientKeyFingerprint !== recipient.fingerprint) {
    throw new BackupCustodyError(
      "The archive was encrypted to a different recovery key.",
      "key_mismatch",
    );
  }
  const size = (await stat(inputPath)).size;
  if (size < headerBytes + TAG_BYTES) {
    throw new BackupCustodyError(
      "The backup envelope is truncated.",
      "envelope_invalid",
    );
  }
  const ephemeralPublicKey = importKey(
    header.ephemeralPublicKey,
    "spki",
    "envelope ephemeral key",
  );
  const recipientPublicDer = createPublicKey(recipient.key).export({
    format: "der",
    type: "spki",
  });
  const key = deriveEnvelopeKey({
    privateKey: recipient.key,
    publicKey: ephemeralPublicKey,
    recipientPublicDer,
  });
  const tagHandle = await open(inputPath, "r");
  const tag = Buffer.alloc(TAG_BYTES);
  try {
    await tagHandle.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
  } finally {
    await tagHandle.close();
  }
  const decipher = createDecipheriv(
    BACKUP_ENVELOPE_CIPHER,
    key,
    Buffer.from(header.iv, "base64"),
  );
  decipher.setAAD(headerBuffer);
  decipher.setAuthTag(tag);
  const ciphertextEnd = size - TAG_BYTES - 1;
  const output = createWriteStream(outputPath, { flags: "wx", mode: 0o600 });
  try {
    if (ciphertextEnd >= headerBytes) {
      await pipeline(
        createReadStream(inputPath, { end: ciphertextEnd, start: headerBytes }),
        decipher,
        output,
      );
    } else {
      decipher.final();
      await new Promise((resolve, reject) => {
        output.once("error", reject);
        output.end(resolve);
      });
    }
  } catch {
    output.destroy();
    await unlink(outputPath).catch(() => undefined);
    throw new BackupCustodyError(
      "The backup envelope failed authentication; the archive is corrupt, tampered, or encrypted to another key.",
      "envelope_authentication_failed",
    );
  } finally {
    key.fill(0);
  }
  const plaintext = await sha256File(outputPath);
  if (
    plaintext.sha256 !== header.plaintextSha256 ||
    plaintext.bytes !== header.plaintextBytes
  ) {
    await unlink(outputPath).catch(() => undefined);
    throw new BackupCustodyError(
      "The decrypted archive does not match the envelope's recorded digest.",
      "plaintext_digest_mismatch",
    );
  }
  return {
    plaintextBytes: plaintext.bytes,
    plaintextSha256: plaintext.sha256,
    recipientKeyFingerprint: recipient.fingerprint,
  };
}

// ---------------------------------------------------------------------------
// Custody store and ledger
// ---------------------------------------------------------------------------

export function resolveCustodyStore({ environment, repositoryRoot }) {
  const raw = String(environment.BACKUP_CUSTODY_DIR ?? "").trim();
  if (!raw || !path.isAbsolute(raw)) {
    throw new BackupCustodyError(
      "BACKUP_CUSTODY_DIR must be an absolute path to the institution-approved encrypted custody location.",
      "custody_store_required",
    );
  }
  const directory = path.resolve(raw);
  const relative = path.relative(path.resolve(repositoryRoot), directory);
  if (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    throw new BackupCustodyError(
      "The custody store must be outside the repository; archives never enter Git.",
      "custody_store_inside_repository",
    );
  }
  const segments = directory.split(path.sep).filter(Boolean);
  if (segments.some((segment) => FORBIDDEN_CUSTODY_SEGMENTS.has(segment))) {
    throw new BackupCustodyError(
      "The custody store must not sit under an application hosting, build, or dependency directory.",
      "custody_store_in_hosting_path",
    );
  }
  return {
    archivesDir: path.join(directory, "archives"),
    directory,
    ledgerPath: path.join(directory, BACKUP_CUSTODY_LEDGER),
    manifestsDir: path.join(directory, "manifests"),
    stagingDir: path.join(directory, "staging"),
  };
}

export async function ensureCustodyStore(store) {
  for (const directory of [
    store.directory,
    store.archivesDir,
    store.manifestsDir,
    store.stagingDir,
  ]) {
    await mkdir(directory, { mode: 0o700, recursive: true });
  }
  return store;
}

export function newBackupRunId(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, "-");
}

export function backupArchiveName(runId, target) {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new BackupCustodyError("Invalid backup run id.", "invalid_run_id");
  }
  if (!/^[a-z]+$/.test(String(target))) {
    throw new BackupCustodyError("Invalid backup target.", "invalid_target");
  }
  return `${runId}-${target}${BACKUP_ARCHIVE_SUFFIX}`;
}

export async function appendLedgerEntry(store, entry) {
  const record = {
    ...entry,
    recordedAt: entry.recordedAt ?? new Date().toISOString(),
  };
  const line = JSON.stringify(record);
  if (/postgres(?:ql)?:\/\//i.test(line)) {
    throw new BackupCustodyError(
      "A ledger entry can never contain a database URL.",
      "ledger_entry_unsafe",
    );
  }
  await appendFile(store.ledgerPath, `${line}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return record;
}

export async function readLedger(store) {
  let text;
  try {
    text = await readFile(store.ledgerPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { entries: [], malformedLines: 0 };
    throw error;
  }
  return parseLedger(text);
}

export function parseLedger(text) {
  const entries = [];
  let malformedLines = 0;
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (
        entry &&
        typeof entry === "object" &&
        typeof entry.runId === "string"
      ) {
        entries.push(entry);
      } else {
        malformedLines += 1;
      }
    } catch {
      malformedLines += 1;
    }
  }
  return { entries, malformedLines };
}

export function requiredSafeLabel(value, name) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!SAFE_LABEL_PATTERN.test(normalized) || /:\/\//.test(normalized)) {
    throw new BackupCustodyError(
      `${name} must be a short non-secret label.`,
      "invalid_label",
    );
  }
  return normalized;
}

export function optionalSafeLabel(value, name) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return undefined;
  }
  return requiredSafeLabel(value, name);
}

// Two institutional owners and a named operator are recorded as fingerprints
// only. A daily export must never be skipped because a name is missing, so
// this returns a status instead of throwing; the status command reports it.
export function backupCustodyOwnership(environment) {
  const names = {
    institutionalOwner1: optionalSafeLabel(
      environment.BACKUP_INSTITUTIONAL_OWNER_1,
      "BACKUP_INSTITUTIONAL_OWNER_1",
    ),
    institutionalOwner2: optionalSafeLabel(
      environment.BACKUP_INSTITUTIONAL_OWNER_2,
      "BACKUP_INSTITUTIONAL_OWNER_2",
    ),
    operator: optionalSafeLabel(environment.BACKUP_OPERATOR, "BACKUP_OPERATOR"),
  };
  const missing = Object.entries(names)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  const lowered = Object.values(names)
    .filter(Boolean)
    .map((value) => value.toLocaleLowerCase());
  const distinct = new Set(lowered).size === lowered.length;
  if (missing.length === 0 && !distinct) {
    return {
      institutionalOwnerFingerprints: [],
      missing: [],
      operatorFingerprint: null,
      status: "not_distinct",
    };
  }
  return {
    institutionalOwnerFingerprints: [
      names.institutionalOwner1,
      names.institutionalOwner2,
    ]
      .filter(Boolean)
      .map(safeHash),
    missing,
    operatorFingerprint: names.operator ? safeHash(names.operator) : null,
    status: missing.length === 0 ? "recorded" : "not_recorded",
  };
}

// ---------------------------------------------------------------------------
// Status evaluation and retention
// ---------------------------------------------------------------------------

export function completedRuns(entries) {
  return entries
    .filter((entry) => entry.status === "completed" && entry.archive?.name)
    .sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt)));
}

export function selectArchivesToPrune({
  entries,
  now = new Date(),
  policy = BACKUP_CUSTODY_POLICY,
}) {
  const completed = completedRuns(entries);
  const pruned = new Set(
    entries
      .filter((entry) => entry.status === "pruned")
      .flatMap((entry) => entry.prunedArchives ?? []),
  );
  const cutoff = now.getTime() - policy.retentionDays * DAY_MS;
  const latest = completed.at(-1);
  return completed.filter(
    (entry) =>
      entry !== latest &&
      !pruned.has(entry.archive.name) &&
      Date.parse(entry.recoveryPointAt ?? entry.recordedAt) < cutoff,
  );
}

export function evaluateBackupCustody({
  approvedKeyFingerprint,
  archives = new Map(),
  entries,
  malformedLines = 0,
  now = new Date(),
  ownership,
  policy = BACKUP_CUSTODY_POLICY,
  providerEvidence = null,
}) {
  const findings = [];
  const add = (code, severity, detail) =>
    findings.push({ code, detail, severity });
  const nowMs = now.getTime();
  const pruned = new Set(
    entries
      .filter((entry) => entry.status === "pruned")
      .flatMap((entry) => entry.prunedArchives ?? []),
  );
  const completed = completedRuns(entries).filter(
    (entry) => !pruned.has(entry.archive.name),
  );
  const latestCompleted = completed.at(-1) ?? null;
  const sortedRuns = [...entries]
    .filter((entry) =>
      ["started", "completed", "failed"].includes(entry.status),
    )
    .sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt)));
  const latestRun = sortedRuns.at(-1) ?? null;
  const failedCount = entries.filter(
    (entry) => entry.status === "failed",
  ).length;

  if (malformedLines > 0) {
    add(
      "ledger_malformed",
      "high",
      `${malformedLines} custody ledger line(s) could not be parsed.`,
    );
  }
  if (!latestCompleted) {
    add(
      "no_completed_backup",
      "critical",
      "The custody store holds no completed encrypted export.",
    );
  } else {
    const recoveryPointAt =
      latestCompleted.recoveryPointAt ?? latestCompleted.recordedAt;
    const ageHours = (nowMs - Date.parse(recoveryPointAt)) / HOUR_MS;
    if (ageHours > policy.freshnessLimitHours) {
      add(
        "latest_backup_stale",
        "critical",
        `The newest completed export is older than ${policy.freshnessLimitHours} hours.`,
      );
    }
    const file = archives.get(latestCompleted.archive.name);
    if (!file) {
      add(
        "archive_missing",
        "critical",
        "The newest completed export's encrypted archive is absent from the custody store.",
      );
    } else {
      if (file.sha256 !== latestCompleted.archive.ciphertextSha256) {
        add(
          "archive_hash_mismatch",
          "critical",
          "The newest encrypted archive's digest differs from the ledger.",
        );
      }
      if (file.sizeBytes !== latestCompleted.archive.encryptedBytes) {
        add(
          "archive_size_mismatch",
          "critical",
          "The newest encrypted archive's size differs from the ledger.",
        );
      }
    }
    if (
      approvedKeyFingerprint &&
      latestCompleted.archive.recipientKeyFingerprint !== approvedKeyFingerprint
    ) {
      add(
        "encryption_key_mismatch",
        "critical",
        "The newest export was encrypted to a key other than the approved recovery key.",
      );
    }
    if (!latestCompleted.custodyRegion) {
      add(
        "custody_region_not_recorded",
        "high",
        "The newest export does not record the approved custody region.",
      );
    }
  }
  if (latestRun && latestRun.status === "failed") {
    add(
      "latest_run_failed",
      "high",
      `The most recent export run failed (${latestRun.error?.code ?? "unknown"}).`,
    );
  } else if (latestRun && latestRun.status === "started") {
    const ageHours = (nowMs - Date.parse(latestRun.recordedAt)) / HOUR_MS;
    if (ageHours > 2) {
      add(
        "run_incomplete",
        "high",
        "An export run started but never recorded completion or failure.",
      );
    }
  }
  const missingDays = [];
  if (completed.length > 0) {
    const completedDays = new Set(
      completed.map((entry) =>
        String(entry.recoveryPointAt ?? entry.recordedAt).slice(0, 10),
      ),
    );
    const firstDay = Date.parse(
      `${String(completed[0].recoveryPointAt ?? completed[0].recordedAt).slice(0, 10)}T00:00:00Z`,
    );
    const yesterday = new Date(nowMs - DAY_MS).toISOString().slice(0, 10);
    const lastDayMs = Date.parse(`${yesterday}T00:00:00Z`);
    const windowStart = Math.max(
      firstDay,
      nowMs - policy.retentionDays * DAY_MS,
    );
    for (let day = windowStart; day <= lastDayMs; day += DAY_MS) {
      const label = new Date(day).toISOString().slice(0, 10);
      if (!completedDays.has(label)) missingDays.push(label);
    }
    if (missingDays.length > 0) {
      add(
        "missing_daily_backup",
        "high",
        `${missingDays.length} calendar day(s) inside the retention window have no completed export.`,
      );
    }
  }
  const overdue = selectArchivesToPrune({ entries, now, policy });
  if (overdue.length > 0) {
    add(
      "retention_prune_due",
      "medium",
      `${overdue.length} archive(s) exceed the ${policy.retentionDays}-day retention and await reviewed pruning.`,
    );
  }
  if (!ownership || ownership.status !== "recorded") {
    add(
      "ownership_not_recorded",
      "high",
      "Two institutional owners and a named backup operator are not recorded.",
    );
  }
  if (!providerEvidence) {
    add(
      "provider_evidence_missing",
      "high",
      "No provider backup verification artifact was found.",
    );
  } else {
    const ageDays = (nowMs - Date.parse(providerEvidence.generatedAt)) / DAY_MS;
    if (ageDays > policy.providerEvidenceMaxAgeDays) {
      add(
        "provider_evidence_stale",
        "high",
        `The provider verification artifact is older than ${policy.providerEvidenceMaxAgeDays} days.`,
      );
    }
    if (providerEvidence.status !== "verified") {
      add(
        "provider_backups_inactive",
        "critical",
        "The provider does not report an active daily backup or point-in-time recovery; the encrypted logical export is the only recovery point.",
      );
    }
  }

  const status = findings.length === 0 ? "verified" : "findings";
  return {
    counts: {
      completed: completed.length,
      failed: failedCount,
      overdueForPruning: overdue.length,
      runs: sortedRuns.length,
    },
    findings,
    latestBackup: latestCompleted
      ? {
          ageHours: round(
            (nowMs -
              Date.parse(
                latestCompleted.recoveryPointAt ?? latestCompleted.recordedAt,
              )) /
              HOUR_MS,
          ),
          archiveSha256: latestCompleted.archive.ciphertextSha256,
          encryptedBytes: latestCompleted.archive.encryptedBytes,
          plaintextSha256: latestCompleted.archive.plaintextSha256,
          recipientKeyFingerprint:
            latestCompleted.archive.recipientKeyFingerprint,
          recoveryPointAt: latestCompleted.recoveryPointAt ?? null,
          runId: latestCompleted.runId,
        }
      : null,
    missingDays,
    status,
  };
}

export async function inventoryArchives(store, entries) {
  const archives = new Map();
  const names = new Set(
    completedRuns(entries).map((entry) => entry.archive.name),
  );
  let present = [];
  try {
    present = await readdir(store.archivesDir);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  for (const name of present) {
    if (!names.has(name)) continue;
    const filePath = path.join(store.archivesDir, name);
    const digest = await sha256File(filePath);
    archives.set(name, { sha256: digest.sha256, sizeBytes: digest.bytes });
  }
  return archives;
}

export async function latestProviderVerification(evidenceDir) {
  let names;
  try {
    names = await readdir(evidenceDir);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  let latest = null;
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    let artifact;
    try {
      artifact = JSON.parse(
        await readFile(path.join(evidenceDir, name), "utf8"),
      );
    } catch {
      continue;
    }
    if (
      artifact?.audit !== "production_database_backups" ||
      artifact.status === "not_run"
    ) {
      continue;
    }
    if (!latest || String(artifact.generatedAt) > String(latest.generatedAt)) {
      latest = artifact;
    }
  }
  if (!latest) return null;
  return {
    findingCodes: (latest.findings ?? []).map((finding) => finding.code),
    generatedAt: String(latest.generatedAt),
    latestRecoveryPointAt:
      latest.automatedBackups?.latestRecoveryPointAt ?? null,
    pitrEnabled: Boolean(latest.automatedBackups?.pitrEnabled),
    region: latest.project?.region ?? null,
    status: String(latest.status),
  };
}

export function createAcceptanceRecord({
  acceptedBy,
  changeTicket,
  generatedAt = new Date().toISOString(),
  objectives,
  restoreEvidence,
  role,
}) {
  const name = requiredSafeLabel(acceptedBy, "RECOVERY_ACCEPTED_BY");
  if (!BACKUP_ACCEPTANCE_ROLES.includes(role)) {
    throw new BackupCustodyError(
      `RECOVERY_ACCEPTANCE_ROLE must be one of: ${BACKUP_ACCEPTANCE_ROLES.join(", ")}.`,
      "acceptance_role_invalid",
    );
  }
  const ticket = requiredSafeLabel(changeTicket, "RECOVERY_ACCEPTANCE_TICKET");
  if (
    restoreEvidence?.exercise !== "disposable_database_restore" ||
    restoreEvidence.status !== "passed" ||
    restoreEvidence.target !== "production" ||
    !restoreEvidence.recoveryPoint ||
    !restoreEvidence.recoveryTime
  ) {
    throw new BackupCustodyError(
      "Acceptance requires a passed Production disposable restore artifact.",
      "restore_evidence_invalid",
    );
  }
  const measured = {
    recoveryPointAgeHours: round(
      Number(restoreEvidence.recoveryPoint.ageAtExerciseMs ?? Number.NaN) /
        HOUR_MS,
    ),
    recoveryTimeHours: round(
      Number(restoreEvidence.recoveryTime.measuredMs ?? Number.NaN) / HOUR_MS,
    ),
  };
  const withinObjectives =
    Number.isFinite(measured.recoveryPointAgeHours) &&
    Number.isFinite(measured.recoveryTimeHours) &&
    measured.recoveryPointAgeHours <= objectives.recoveryPointObjectiveHours &&
    measured.recoveryTimeHours <= objectives.recoveryTimeObjectiveHours;
  return {
    acceptor: { fingerprint: safeHash(name), role },
    artifact: "recovery_objective_acceptance",
    artifactVersion: 1,
    changeTicket: ticket,
    generatedAt,
    measured,
    objectives,
    restoreEvidence: {
      archiveSha256: restoreEvidence.archive?.sha256 ?? null,
      generatedAt: String(restoreEvidence.generatedAt),
      integrityAuditStatus: restoreEvidence.integrityAudit?.status ?? null,
      targetFingerprint: restoreEvidence.targetFingerprint ?? null,
    },
    status: withinObjectives ? "accepted" : "rejected",
    target: "production",
    withinObjectives,
    writesAttempted: 0,
  };
}

export function sanitizeErrorCode(error) {
  if (error instanceof BackupCustodyError) return error.code;
  if (error && typeof error.code === "string" && /^[a-z_]+$/.test(error.code)) {
    return error.code;
  }
  return "operation_failed";
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
