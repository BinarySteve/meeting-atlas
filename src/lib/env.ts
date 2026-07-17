import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  STORAGE_ROOT: z.string().min(1),
  BACKUP_ROOT: z.string().min(1).default("./backups"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(2_147_483_648),
  SESSION_SECRET: z.string().min(32),
  WEBAUTHN_RP_ID: z.string().min(1).default("localhost"),
  WEBAUTHN_ORIGIN: z.string().url().default("http://localhost:6982"),
  WEBAUTHN_RP_NAME: z.string().min(1).default("Meeting Atlas"),
  PROCESSING_MODE: z.enum(["simulation", "remote"]).default("simulation"),
  PROCESSING_API_URL: z.string().url(),
  PROCESSING_API_CREDENTIAL: z.string().min(32),
  LM_STUDIO_URL: z.string().url().default("http://192.168.4.30:1234/v1"),
  LM_STUDIO_MODEL: z.string().min(1).default("qwen/qwen3.6-35b-a3b"),
  ALLOW_SIMULATION: z.string().default("false").transform((v) => v === "true"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  FFMPEG_PATH: z.string().default("ffmpeg"),
  PG_DUMP_PATH: z.string().default("pg_dump"),
  PG_RESTORE_PATH: z.string().default("pg_restore"),
  TAR_PATH: z.string().default("tar"),
  SUBPROCESS_TIMEOUT_MS: z.coerce.number().int().positive().default(21_600_000),
  HEALTH_TIMEOUT_MS: z.coerce.number().int().positive().default(3_000),
  RETENTION_DAYS: z.coerce.number().int().nonnegative().default(0),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type AppEnv = z.infer<typeof schema>;
export const getEnv = (): AppEnv => schema.parse(process.env);
