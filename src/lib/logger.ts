import pino from "pino";
import { getEnv } from "./env";

export const logger = pino({
  level: getEnv().LOG_LEVEL,
  redact: {
    paths: ["authorization", "token", "credential", "password", "request.body", "transcript", "audio"],
    censor: "[REDACTED]",
  },
});
