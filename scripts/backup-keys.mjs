#!/usr/bin/env node

import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BackupCustodyError,
  decryptBackupArchive,
  generateBackupKeyPair,
  readBackupEnvelopeHeader,
} from "./lib/backup-custody.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) {
    printUsage();
    return;
  }
  if (options.mode === "keygen") return runKeygen(options);
  if (options.mode === "inspect") return runInspect(options);
  return runDecrypt(options);
}

export function parseArguments(args) {
  if (args.includes("--help") || args.includes("-h")) return { help: true };
  const options = { json: false };
  if (["keygen", "decrypt", "inspect"].includes(args[0])) {
    options.mode = args[0];
  } else {
    throw new BackupCustodyError(
      "The first argument must be keygen, decrypt, or inspect.",
      "invalid_option",
    );
  }
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--private-key-file") {
      options.privateKeyFile = requiredArgumentValue(args, ++index, argument);
    } else if (argument === "--archive") {
      options.archive = requiredArgumentValue(args, ++index, argument);
    } else if (argument === "--output") {
      options.output = requiredArgumentValue(args, ++index, argument);
    } else if (argument === "--json") {
      options.json = true;
    } else {
      throw new BackupCustodyError(
        `Unknown backup key option: ${argument}.`,
        "invalid_option",
      );
    }
  }
  if (options.mode === "keygen" && !options.privateKeyFile) {
    throw new BackupCustodyError(
      "keygen requires --private-key-file <path outside the repository>.",
      "invalid_option",
    );
  }
  if (options.mode === "decrypt" && (!options.archive || !options.output)) {
    throw new BackupCustodyError(
      "decrypt requires --archive <encrypted archive> and --output <outside-repo .dump>.",
      "invalid_option",
    );
  }
  if (options.mode === "inspect" && !options.archive) {
    throw new BackupCustodyError(
      "inspect requires --archive <encrypted archive>.",
      "invalid_option",
    );
  }
  return options;
}

export function assertOutsideRepository(filePath, label) {
  const resolved = path.resolve(filePath);
  const relative = path.relative(repositoryRoot, resolved);
  if (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    throw new BackupCustodyError(
      `${label} must be written outside the repository.`,
      "path_inside_repository",
    );
  }
  return resolved;
}

async function runKeygen(options) {
  const target = assertOutsideRepository(
    options.privateKeyFile,
    "The private key file",
  );
  if (await stat(target).catch(() => null)) {
    throw new BackupCustodyError(
      "The private key file already exists; never overwrite a recovery key.",
      "private_key_exists",
    );
  }
  const pair = generateBackupKeyPair();
  await writeFile(target, `${pair.privateKey}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  const report = {
    fingerprint: pair.fingerprint,
    privateKeyFile: "written with mode 0600; never printed",
    publicKey: pair.publicKey,
  };
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Recovery key fingerprint: ${pair.fingerprint}`);
    console.log(`BACKUP_ENCRYPTION_PUBLIC_KEY=${pair.publicKey}`);
    console.log("Private key written with mode 0600; it is never printed.");
  }
  return report;
}

async function runInspect(options) {
  const { header, headerBytes } = await readBackupEnvelopeHeader(
    path.resolve(options.archive),
  );
  const report = {
    cipher: header.cipher,
    headerBytes,
    kdf: header.kdf,
    plaintextBytes: header.plaintextBytes,
    plaintextSha256: header.plaintextSha256,
    recipientKeyFingerprint: header.recipientKeyFingerprint,
    version: header.v,
  };
  console.log(JSON.stringify(report, null, 2));
  return report;
}

async function runDecrypt(options) {
  const output = assertOutsideRepository(
    options.output,
    "The decrypted archive",
  );
  const privateKey = await resolvePrivateKey(process.env);
  const startedMs = Date.now();
  const result = await decryptBackupArchive({
    inputPath: path.resolve(options.archive),
    outputPath: output,
    privateKey,
  });
  const report = {
    durationMs: Date.now() - startedMs,
    plaintextBytes: result.plaintextBytes,
    plaintextSha256: result.plaintextSha256,
    recipientKeyFingerprint: result.recipientKeyFingerprint,
    status: "decrypted",
  };
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("Backup archive: decrypted and digest-verified");
    console.log(`Plaintext SHA-256: ${report.plaintextSha256}`);
    console.log(`Plaintext bytes: ${report.plaintextBytes}`);
    console.log(`Recovery key fingerprint: ${report.recipientKeyFingerprint}`);
  }
  return report;
}

export async function resolvePrivateKey(environment) {
  const inline = String(environment.BACKUP_ENCRYPTION_PRIVATE_KEY ?? "").trim();
  if (inline) return inline;
  const file = String(
    environment.BACKUP_ENCRYPTION_PRIVATE_KEY_FILE ?? "",
  ).trim();
  if (!file) {
    throw new BackupCustodyError(
      "BACKUP_ENCRYPTION_PRIVATE_KEY or BACKUP_ENCRYPTION_PRIVATE_KEY_FILE is required; the recovery key is held by the recovery administrators, not the backup host.",
      "key_unavailable",
    );
  }
  const details = await stat(file);
  if ((details.mode & 0o077) !== 0) {
    throw new BackupCustodyError(
      "The private key file must not be readable by group or others (mode 0600).",
      "private_key_permissions",
    );
  }
  return (await readFile(file, "utf8")).trim();
}

function requiredArgumentValue(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new BackupCustodyError(
      `${option} requires a value.`,
      "invalid_option",
    );
  }
  return value;
}

function printUsage() {
  console.log(`Usage:
  node scripts/backup-keys.mjs keygen --private-key-file <outside-repo path> [--json]
  node scripts/backup-keys.mjs inspect --archive <archive.dump.enc>
  BACKUP_ENCRYPTION_PRIVATE_KEY_FILE=<0600 file> node scripts/backup-keys.mjs decrypt --archive <archive.dump.enc> --output <outside-repo>.dump [--json]

keygen creates an X25519 recovery key pair: the public key is printed for the
backup host, the private key is written once with mode 0600 and never printed.
decrypt authenticates the envelope, verifies the recorded plaintext digest,
and writes the archive for db:recovery:test. inspect prints header metadata
only.`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code =
      error instanceof BackupCustodyError ? error.code : "operation_failed";
    console.error(
      `Backup key operation failed (${code}): ${String(error?.message ?? error)}`,
    );
    process.exitCode = 1;
  });
}
