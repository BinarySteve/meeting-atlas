import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  meetingFind: vi.fn(),
  activeJobCount: vi.fn(),
  transcriptionFind: vi.fn(),
  diarizationFind: vi.fn(),
  transcriptionDelete: vi.fn(),
  diarizationDelete: vi.fn(),
  meetingDelete: vi.fn(),
  removeStorageKey: vi.fn(),
  writeAudit: vi.fn(),
}));

vi.mock("./db", () => ({
  db: {
    meeting: { findUnique: mocks.meetingFind },
    processingJob: { count: mocks.activeJobCount },
    rawTranscriptionArtifact: { findMany: mocks.transcriptionFind },
    rawDiarizationArtifact: { findMany: mocks.diarizationFind },
    $transaction: vi.fn(async (callback) => callback({
      rawTranscriptionArtifact: { deleteMany: mocks.transcriptionDelete },
      rawDiarizationArtifact: { deleteMany: mocks.diarizationDelete },
      meeting: { delete: mocks.meetingDelete },
    })),
  },
}));
vi.mock("./storage", () => ({ removeStorageKey: mocks.removeStorageKey }));
vi.mock("./data-lifecycle", () => ({ withDataLifecycleLock: (operation: () => Promise<unknown>) => operation() }));
vi.mock("./audit", () => ({ writeAudit: mocks.writeAudit }));

import { deleteMeetingData } from "./retention";

describe("meeting deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.meetingFind.mockResolvedValue({
      id: "meeting-1", title: "Broken meeting",
      recordings: [{ storageKey: "original/a.wav", normalizedStorageKey: "normalized/a.wav" }],
      exports: [{ storageKey: "artifact/export.md" }],
    });
    mocks.activeJobCount.mockResolvedValue(0);
    mocks.transcriptionFind.mockResolvedValue([{ storageKey: "artifact/transcription.json" }]);
    mocks.diarizationFind.mockResolvedValue([{ storageKey: "artifact/diarization.json" }]);
  });

  it("removes every storage object and orphan-prone raw artifact row", async () => {
    await deleteMeetingData("meeting-1", "owner-1");

    expect(mocks.removeStorageKey).toHaveBeenCalledTimes(5);
    expect(mocks.transcriptionDelete).toHaveBeenCalledWith({ where: { meetingId: "meeting-1" } });
    expect(mocks.diarizationDelete).toHaveBeenCalledWith({ where: { meetingId: "meeting-1" } });
    expect(mocks.meetingDelete).toHaveBeenCalledWith({ where: { id: "meeting-1" } });
  });

  it("refuses deletion while processing is active", async () => {
    mocks.activeJobCount.mockResolvedValue(1);

    await expect(deleteMeetingData("meeting-1", "owner-1")).rejects.toThrow("Cannot delete meeting while processing is active");
    expect(mocks.removeStorageKey).not.toHaveBeenCalled();
    expect(mocks.meetingDelete).not.toHaveBeenCalled();
  });
});
