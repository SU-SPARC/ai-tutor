import { randomBytes } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { parseArguments as parseAcceptArguments } from "../scripts/accept-recovery-objectives.mjs";
import { parseArguments as parseDailyArguments } from "../scripts/backup-daily.mjs";
import {
  assertOutsideRepository,
  parseArguments as parseKeyArguments,
  resolvePrivateKey,
} from "../scripts/backup-keys.mjs";
import {
  main as backupStatusMain,
  parseArguments as parseStatusArguments,
  sendAlert,
} from "../scripts/backup-status.mjs";
import {
  BACKUP_CUSTODY_POLICY,
  BackupCustodyError,
  type LedgerEntry,
  appendLedgerEntry,
  backupArchiveName,
  backupCustodyOwnership,
  createAcceptanceRecord,
  decryptBackupArchive,
  encryptBackupArchive,
  ensureCustodyStore,
  evaluateBackupCustody,
  generateBackupKeyPair,
  importBackupPrivateKey,
  importBackupPublicKey,
  latestProviderVerification,
  newBackupRunId,
  parseLedger,
  readBackupEnvelopeHeader,
  readLedger,
  resolveCustodyStore,
  selectArchivesToPrune,
  sha256File,
} from "../scripts/lib/backup-custody.mjs";
import { safeHash } from "../scripts/lib/database-integrity-evidence.mjs";

const temporaryDirectories: string[] = [];
const now = new Date("2026-09-05T12:00:00.000Z");

afterEach(async () => {
  process.exitCode = 0;
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "backup-custody-"));
  temporaryDirectories.push(directory);
  return directory;
}

function completedEntry(
  overrides: Partial<LedgerEntry> & { recoveryPointAt: string },
): LedgerEntry {
  const runId = newBackupRunId(new Date(overrides.recoveryPointAt));
  return {
    archive: {
      ciphertextSha256: "a".repeat(64),
      encryptedBytes: 10,
      name: backupArchiveName(runId, "production"),
      plaintextBytes: 8,
      plaintextSha256: "b".repeat(64),
      recipientKeyFingerprint: "c".repeat(16),
    },
    custodyRegion: "us-east-1",
    recordedAt: overrides.recoveryPointAt,
    runId,
    status: "completed",
    target: "production",
    ...overrides,
  };
}

const recordedOwnership = backupCustodyOwnership({
  BACKUP_INSTITUTIONAL_OWNER_1: "Owner One",
  BACKUP_INSTITUTIONAL_OWNER_2: "Owner Two",
  BACKUP_OPERATOR: "Backup Operator",
});
const verifiedProvider = {
  findingCodes: [],
  generatedAt: "2026-09-05T00:00:00.000Z",
  latestRecoveryPointAt: "2026-09-05T00:00:00.000Z",
  pitrEnabled: true,
  region: "us-east-1",
  status: "verified",
};

describe("backup custody", () => {
  it("encrypts to a recovery key, authenticates on decrypt, and rejects tampering or the wrong key", async () => {
    const directory = await temporaryDirectory();
    const plain = path.join(directory, "source.dump");
    await writeFile(plain, randomBytes(200_000));
    const pair = generateBackupKeyPair();
    expect(importBackupPublicKey(pair.publicKey).fingerprint).toBe(
      pair.fingerprint,
    );
    expect(importBackupPrivateKey(pair.privateKey).fingerprint).toBe(
      pair.fingerprint,
    );
    expect(() => importBackupPublicKey("not-a-key")).toThrow(
      BackupCustodyError,
    );

    const encrypted = path.join(directory, "source.dump.enc");
    const result = await encryptBackupArchive({
      inputPath: plain,
      outputPath: encrypted,
      publicKey: pair.publicKey,
    });
    const source = await sha256File(plain);
    expect(result.plaintextSha256).toBe(source.sha256);
    expect(result.plaintextBytes).toBe(200_000);
    expect(result.recipientKeyFingerprint).toBe(pair.fingerprint);
    expect((await stat(encrypted)).mode & 0o777).toBe(0o600);
    const { header } = await readBackupEnvelopeHeader(encrypted);
    expect(header).toMatchObject({
      cipher: "aes-256-gcm",
      kdf: "x25519-hkdf-sha256",
      plaintextSha256: source.sha256,
      recipientKeyFingerprint: pair.fingerprint,
      v: 1,
    });
    expect(JSON.stringify(header)).not.toContain(pair.privateKey);
    const ciphertext = await readFile(encrypted);
    expect(ciphertext.includes(await readFile(plain))).toBe(false);

    const decrypted = path.join(directory, "restored.dump");
    const restored = await decryptBackupArchive({
      inputPath: encrypted,
      outputPath: decrypted,
      privateKey: pair.privateKey,
    });
    expect(restored.plaintextSha256).toBe(source.sha256);
    expect((await sha256File(decrypted)).sha256).toBe(source.sha256);

    const tampered = path.join(directory, "tampered.dump.enc");
    const bytes = Buffer.from(ciphertext);
    bytes[bytes.length - 40] ^= 0x01;
    await writeFile(tampered, bytes);
    await expect(
      decryptBackupArchive({
        inputPath: tampered,
        outputPath: path.join(directory, "tampered.dump"),
        privateKey: pair.privateKey,
      }),
    ).rejects.toMatchObject({ code: "envelope_authentication_failed" });
    await expect(stat(path.join(directory, "tampered.dump"))).rejects.toThrow();

    const other = generateBackupKeyPair();
    await expect(
      decryptBackupArchive({
        inputPath: encrypted,
        outputPath: path.join(directory, "other.dump"),
        privateKey: other.privateKey,
      }),
    ).rejects.toMatchObject({ code: "key_mismatch" });
    await expect(
      encryptBackupArchive({
        inputPath: plain,
        outputPath: path.join(directory, "wrong.bin"),
        publicKey: pair.publicKey,
      }),
    ).rejects.toMatchObject({ code: "output_extension" });
  });

  it("keeps the custody store outside Git and hosting paths and records an append-only ledger", async () => {
    const directory = await temporaryDirectory();
    const repositoryRoot = process.cwd();
    expect(() =>
      resolveCustodyStore({
        environment: { BACKUP_CUSTODY_DIR: "relative/custody" },
        repositoryRoot,
      }),
    ).toThrow(/absolute/);
    expect(() =>
      resolveCustodyStore({
        environment: {
          BACKUP_CUSTODY_DIR: path.join(repositoryRoot, "backups"),
        },
        repositoryRoot,
      }),
    ).toThrow(/outside the repository/);
    expect(() =>
      resolveCustodyStore({
        environment: {
          BACKUP_CUSTODY_DIR: path.join(directory, ".next", "cache"),
        },
        repositoryRoot,
      }),
    ).toThrow(/hosting/);
    const store = await ensureCustodyStore(
      resolveCustodyStore({
        environment: { BACKUP_CUSTODY_DIR: path.join(directory, "custody") },
        repositoryRoot,
      }),
    );
    expect((await stat(store.archivesDir)).isDirectory()).toBe(true);
    expect(await readLedger(store)).toEqual({ entries: [], malformedLines: 0 });
    await appendLedgerEntry(store, {
      runId: "2026-09-05T11-00-00-000Z",
      status: "started",
    });
    await expect(
      appendLedgerEntry(store, {
        runId: "2026-09-05T11-00-00-000Z",
        secret: "postgresql://user:pass@host/db",
        status: "failed",
      }),
    ).rejects.toMatchObject({ code: "ledger_entry_unsafe" });
    const ledger = await readLedger(store);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]).toMatchObject({
      runId: "2026-09-05T11-00-00-000Z",
      status: "started",
    });
    expect(ledger.entries[0].recordedAt).toMatch(/Z$/);
    expect(
      parseLedger('{"runId":"x","status":"completed"}\nnot json\n{}\n'),
    ).toEqual({
      entries: [{ runId: "x", status: "completed" }],
      malformedLines: 2,
    });
    expect(() => backupArchiveName("bad", "production")).toThrow(/run id/);
    expect(backupArchiveName("2026-09-05T11-00-00-000Z", "production")).toBe(
      "2026-09-05T11-00-00-000Z-production.dump.enc",
    );
  });

  it("records two institutional owners and an operator as fingerprints only", () => {
    expect(recordedOwnership).toEqual({
      institutionalOwnerFingerprints: [
        safeHash("Owner One"),
        safeHash("Owner Two"),
      ],
      missing: [],
      operatorFingerprint: safeHash("Backup Operator"),
      status: "recorded",
    });
    expect(JSON.stringify(recordedOwnership)).not.toMatch(
      /Owner One|Backup Operator/,
    );
    expect(
      backupCustodyOwnership({ BACKUP_OPERATOR: "Only Operator" }),
    ).toMatchObject({
      missing: ["institutionalOwner1", "institutionalOwner2"],
      status: "not_recorded",
    });
    expect(
      backupCustodyOwnership({
        BACKUP_INSTITUTIONAL_OWNER_1: "Same Person",
        BACKUP_INSTITUTIONAL_OWNER_2: "same person",
        BACKUP_OPERATOR: "Backup Operator",
      }).status,
    ).toBe("not_distinct");
  });

  it("detects stale, missing, failed, corrupted, mis-keyed, and unowned backups", () => {
    const fresh = completedEntry({
      recoveryPointAt: "2026-09-05T03:15:00.000Z",
    });
    const archives = new Map([
      [fresh.archive!.name, { sha256: "a".repeat(64), sizeBytes: 10 }],
    ]);
    const clean = evaluateBackupCustody({
      approvedKeyFingerprint: "c".repeat(16),
      archives,
      entries: [
        completedEntry({ recoveryPointAt: "2026-09-04T03:15:00.000Z" }),
        fresh,
      ],
      now,
      ownership: recordedOwnership,
      providerEvidence: verifiedProvider,
    });
    expect(clean.status).toBe("verified");
    expect(clean.findings).toEqual([]);
    expect(clean.latestBackup).toMatchObject({
      recoveryPointAt: "2026-09-05T03:15:00.000Z",
    });
    expect(clean.counts).toEqual({
      completed: 2,
      failed: 0,
      overdueForPruning: 0,
      runs: 2,
    });

    const codes = (
      entries: LedgerEntry[],
      extra: Record<string, unknown> = {},
    ) =>
      evaluateBackupCustody({
        approvedKeyFingerprint: "c".repeat(16),
        archives,
        entries,
        now,
        ownership: recordedOwnership,
        providerEvidence: verifiedProvider,
        ...extra,
      }).findings.map((finding) => finding.code);

    expect(codes([])).toContain("no_completed_backup");
    expect(
      codes([completedEntry({ recoveryPointAt: "2026-09-03T03:15:00.000Z" })]),
    ).toEqual(
      expect.arrayContaining([
        "latest_backup_stale",
        "archive_missing",
        "missing_daily_backup",
      ]),
    );
    expect(
      codes([
        fresh,
        {
          recordedAt: "2026-09-05T04:00:00.000Z",
          runId: "2026-09-05T04-00-00-000Z",
          status: "failed",
          error: { code: "pg_dump_failed" },
        },
      ]),
    ).toContain("latest_run_failed");
    expect(
      codes([fresh], {
        archives: new Map([
          [fresh.archive!.name, { sha256: "d".repeat(64), sizeBytes: 11 }],
        ]),
      }),
    ).toEqual(
      expect.arrayContaining([
        "archive_hash_mismatch",
        "archive_size_mismatch",
      ]),
    );
    expect(
      codes([fresh], { approvedKeyFingerprint: "e".repeat(16) }),
    ).toContain("encryption_key_mismatch");
    expect(codes([{ ...fresh, custodyRegion: null }])).toContain(
      "custody_region_not_recorded",
    );
    expect(codes([fresh], { ownership: backupCustodyOwnership({}) })).toContain(
      "ownership_not_recorded",
    );
    expect(codes([fresh], { providerEvidence: null })).toContain(
      "provider_evidence_missing",
    );
    expect(
      codes([fresh], {
        providerEvidence: { ...verifiedProvider, status: "findings" },
      }),
    ).toContain("provider_backups_inactive");
    expect(
      codes([fresh], {
        providerEvidence: {
          ...verifiedProvider,
          generatedAt: "2026-08-01T00:00:00.000Z",
        },
      }),
    ).toContain("provider_evidence_stale");
    expect(codes([fresh], { malformedLines: 1 })).toContain("ledger_malformed");

    const old = completedEntry({ recoveryPointAt: "2026-07-01T03:15:00.000Z" });
    const prune = selectArchivesToPrune({ entries: [old, fresh], now });
    expect(prune).toEqual([old]);
    expect(selectArchivesToPrune({ entries: [old], now })).toEqual([]);
    expect(codes([old, fresh])).toContain("retention_prune_due");
    expect(
      codes([
        old,
        fresh,
        {
          prunedArchives: [old.archive!.name],
          runId: fresh.runId,
          status: "pruned",
        },
      ]),
    ).not.toContain("retention_prune_due");
    expect(BACKUP_CUSTODY_POLICY).toMatchObject({
      freshnessLimitHours: 36,
      retentionDays: 35,
    });
  });

  it("reads the newest provider verification artifact and runs the status command end to end", async () => {
    const directory = await temporaryDirectory();
    const providerDir = path.join(directory, "provider");
    const custodyDir = path.join(directory, "custody");
    const evidenceDir = path.join(directory, "status");
    await ensureCustodyStore(
      resolveCustodyStore({
        environment: { BACKUP_CUSTODY_DIR: custodyDir },
        repositoryRoot: process.cwd(),
      }),
    );
    await writeFile(path.join(providerDir, "..", "ignored.txt"), "x").catch(
      () => undefined,
    );
    await rm(providerDir, { force: true, recursive: true });
    await import("node:fs/promises").then((fs) =>
      fs.mkdir(providerDir, { recursive: true }),
    );
    await writeFile(
      path.join(
        providerDir,
        "2026-09-01T00-00-00-000Z-production-not_run.json",
      ),
      JSON.stringify({
        audit: "production_database_backups",
        generatedAt: "2026-09-01T00:00:00.000Z",
        status: "not_run",
      }),
    );
    await writeFile(
      path.join(
        providerDir,
        "2026-09-04T21-59-02-933Z-production-findings.json",
      ),
      JSON.stringify({
        audit: "production_database_backups",
        automatedBackups: { latestRecoveryPointAt: null, pitrEnabled: false },
        findings: [
          { code: "no_successful_provider_backup", severity: "critical" },
        ],
        generatedAt: "2026-09-04T21:59:02.933Z",
        project: { region: "us-east-1" },
        status: "findings",
      }),
    );
    expect(await latestProviderVerification(providerDir)).toEqual({
      findingCodes: ["no_successful_provider_backup"],
      generatedAt: "2026-09-04T21:59:02.933Z",
      latestRecoveryPointAt: null,
      pitrEnabled: false,
      region: "us-east-1",
      status: "findings",
    });
    expect(
      await latestProviderVerification(path.join(directory, "absent")),
    ).toBeNull();

    const pair = generateBackupKeyPair();
    const plain = path.join(directory, "plain.dump");
    await writeFile(plain, randomBytes(1024));
    const store = resolveCustodyStore({
      environment: { BACKUP_CUSTODY_DIR: custodyDir },
      repositoryRoot: process.cwd(),
    });
    const runId = newBackupRunId(new Date("2026-09-05T03:15:00.000Z"));
    const archiveName = backupArchiveName(runId, "production");
    const envelope = await encryptBackupArchive({
      inputPath: plain,
      outputPath: path.join(store.archivesDir, archiveName),
      publicKey: pair.publicKey,
    });
    await appendLedgerEntry(store, {
      archive: {
        ciphertextSha256: envelope.ciphertextSha256,
        encryptedBytes: envelope.encryptedBytes,
        name: archiveName,
        plaintextBytes: envelope.plaintextBytes,
        plaintextSha256: envelope.plaintextSha256,
        recipientKeyFingerprint: envelope.recipientKeyFingerprint,
      },
      custodyRegion: "us-east-1",
      recordedAt: "2026-09-05T03:16:00.000Z",
      recoveryPointAt: "2026-09-05T03:15:00.000Z",
      runId,
      status: "completed",
      target: "production",
    });
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    const evidence = await backupStatusMain(
      [
        "--json",
        "--evidence-dir",
        evidenceDir,
        "--provider-evidence-dir",
        providerDir,
      ],
      {
        environment: {
          BACKUP_ALERT_WEBHOOK_URL: "https://alerts.example.invalid/hook",
          BACKUP_CUSTODY_DIR: custodyDir,
          BACKUP_ENCRYPTION_PUBLIC_KEY: pair.publicKey,
          BACKUP_INSTITUTIONAL_OWNER_1: "Owner One",
          BACKUP_INSTITUTIONAL_OWNER_2: "Owner Two",
          BACKUP_OPERATOR: "Backup Operator",
        },
        fetchImpl,
        now,
      },
    );
    expect(evidence).toMatchObject({
      audit: "production_backup_custody_status",
      counts: { completed: 1, failed: 0 },
      status: "findings",
      target: "production",
    });
    expect(
      (evidence?.findings as Array<{ code: string }>).map(
        (finding) => finding.code,
      ),
    ).toEqual(["provider_backups_inactive"]);
    expect(process.exitCode).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      { body: string },
    ];
    expect(JSON.parse(init.body)).toEqual({
      audit: "production_backup_custody_status",
      criticalFindings: 1,
      findingCodes: ["provider_backups_inactive"],
      generatedAt: now.toISOString(),
      latestRecoveryPointAt: "2026-09-05T03:15:00.000Z",
      status: "findings",
      target: "production",
    });
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain(custodyDir);
    expect(serialized).not.toContain(pair.privateKey);
    expect(serialized).not.toMatch(/Owner One|Backup Operator/);
    const failedAlert = await sendAlert({
      evidence: evidence as never,
      fetchImpl: vi.fn(async () => {
        throw new Error("network");
      }),
      webhookUrl: "https://alerts.example.invalid/hook",
    });
    expect(failedAlert).toEqual({ delivered: false, status: null });

    const notRun = await backupStatusMain(
      ["--json", "--evidence-dir", evidenceDir],
      {
        environment: {},
        now,
      },
    );
    expect(notRun).toMatchObject({
      reason: { code: "custody_store_required" },
      status: "not_run",
    });
    expect(process.exitCode).toBe(3);
  });

  it("records named operator acceptance of measured RPO and RTO as fingerprints only", () => {
    const restoreEvidence = {
      archive: { sha256: "f".repeat(64) },
      exercise: "disposable_database_restore",
      generatedAt: "2026-09-04T21:45:09.058Z",
      integrityAudit: { status: "findings" },
      recoveryPoint: { ageAtExerciseMs: 101_203 },
      recoveryTime: { measuredMs: 213 },
      status: "passed",
      target: "production",
      targetFingerprint: "3".repeat(64),
    };
    const objectives = {
      recoveryPointObjectiveHours: 24,
      recoveryTimeObjectiveHours: 24,
    };
    const record = createAcceptanceRecord({
      acceptedBy: "University IT Operator",
      changeTicket: "BACKUP-CUSTODY-2026-09-04",
      objectives,
      restoreEvidence,
      role: "it_operator",
    });
    expect(record).toMatchObject({
      acceptor: {
        fingerprint: safeHash("University IT Operator"),
        role: "it_operator",
      },
      measured: { recoveryPointAgeHours: 0.028, recoveryTimeHours: 0 },
      status: "accepted",
      withinObjectives: true,
    });
    expect(JSON.stringify(record)).not.toContain("University IT Operator");
    expect(() =>
      createAcceptanceRecord({
        acceptedBy: "",
        changeTicket: "T-1",
        objectives,
        restoreEvidence,
        role: "professor",
      }),
    ).toThrow(/RECOVERY_ACCEPTED_BY/);
    expect(() =>
      createAcceptanceRecord({
        acceptedBy: "Someone",
        changeTicket: "T-1",
        objectives,
        restoreEvidence,
        role: "student",
      }),
    ).toThrow(/RECOVERY_ACCEPTANCE_ROLE/);
    expect(
      createAcceptanceRecord({
        acceptedBy: "Someone",
        changeTicket: "T-1",
        objectives: {
          recoveryPointObjectiveHours: 0.01,
          recoveryTimeObjectiveHours: 24,
        },
        restoreEvidence,
        role: "professor",
      }).status,
    ).toBe("rejected");
    expect(() =>
      createAcceptanceRecord({
        acceptedBy: "Someone",
        changeTicket: "T-1",
        objectives,
        restoreEvidence: { ...restoreEvidence, status: "failed" },
        role: "professor",
      }),
    ).toThrow(/passed Production disposable restore/);
  });

  it("parses fail-closed command options and keeps keys and archives outside the repository", async () => {
    expect(
      parseDailyArguments(["--target", "production", "--prune", "--json"]),
    ).toMatchObject({
      json: true,
      prune: true,
      target: "production",
    });
    expect(() => parseDailyArguments(["--target", "live"])).toThrow(/--target/);
    expect(parseStatusArguments(["--json"])).toMatchObject({
      json: true,
      providerEvidenceDir: "docs/evidence/database-backups",
    });
    expect(() => parseStatusArguments(["--bogus"])).toThrow(/Unknown/);
    expect(
      parseKeyArguments([
        "decrypt",
        "--archive",
        "a.dump.enc",
        "--output",
        "/tmp/a.dump",
      ]),
    ).toMatchObject({
      archive: "a.dump.enc",
      mode: "decrypt",
    });
    expect(() => parseKeyArguments(["keygen"])).toThrow(/--private-key-file/);
    expect(() => parseKeyArguments(["decrypt", "--archive", "a"])).toThrow(
      /--output/,
    );
    expect(() => parseAcceptArguments([])).toThrow(/--restore-evidence/);
    expect(() =>
      assertOutsideRepository(
        path.join(process.cwd(), "docs", "key.backup-key"),
        "The private key file",
      ),
    ).toThrow(/outside the repository/);

    const directory = await temporaryDirectory();
    const keyFile = path.join(directory, "recovery.backup-key");
    await writeFile(keyFile, "abc\n", { mode: 0o644 });
    await expect(
      resolvePrivateKey({ BACKUP_ENCRYPTION_PRIVATE_KEY_FILE: keyFile }),
    ).rejects.toMatchObject({ code: "private_key_permissions" });
    await chmod(keyFile, 0o600);
    expect(
      await resolvePrivateKey({ BACKUP_ENCRYPTION_PRIVATE_KEY_FILE: keyFile }),
    ).toBe("abc");
    await expect(resolvePrivateKey({})).rejects.toMatchObject({
      code: "key_unavailable",
    });

    const ignore = await readFile(".gitignore", "utf8");
    expect(ignore).toContain("*.dump");
    expect(ignore).toContain("*.dump.enc");
    expect(ignore).toContain("ops/backup/*.env");
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));
    expect(packageJson.scripts["db:backup:daily"]).toContain(
      "backup-daily.mjs --target production",
    );
    expect(packageJson.scripts["db:backup:status"]).toContain(
      "docs/evidence/backup-custody",
    );
    expect(packageJson.scripts["db:recovery:accept"]).toContain(
      "accept-recovery-objectives.mjs",
    );
    const wrapper = await readFile("ops/backup/backup-daily.sh", "utf8");
    expect(wrapper).toContain('"$mode" != "600"');
    expect(wrapper).toContain("backup-status.mjs");
  });
});
