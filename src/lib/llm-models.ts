import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { getEnv } from "./env";

type ModelPreferenceClient = typeof db | Prisma.TransactionClient;

export async function selectedLlmModel(
  userId: string,
  client: ModelPreferenceClient = db,
): Promise<string> {
  const user = await client.user.findUniqueOrThrow({
    where: { id: userId },
    select: { llmModel: true },
  });
  return user.llmModel?.trim() || getEnv().LM_STUDIO_MODEL;
}
