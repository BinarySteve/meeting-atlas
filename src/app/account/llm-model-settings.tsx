"use client";

import { useMemo, useState } from "react";

type LlmModel = { id: string; displayName: string; loaded: boolean; reported?: boolean };

export function LlmModelSettings({
  initialModel,
  initialModels,
  initialError,
}: {
  initialModel: string;
  initialModels: LlmModel[];
  initialError: string;
}) {
  const [models, setModels] = useState<LlmModel[]>(initialModels);
  const [selectedModel, setSelectedModel] = useState(initialModel);
  const [draftModel, setDraftModel] = useState(initialModel);
  const [busy, setBusy] = useState<"loading" | "saving" | "">("");
  const [message, setMessage] = useState(initialError);

  async function loadModels() {
    try {
      const response = await fetch("/api/account/llm-model", { cache: "no-store" });
      const result = (await response.json()) as {
        error?: string;
        models?: LlmModel[];
        selectedModel?: string;
      };
      if (!response.ok || !result.models || !result.selectedModel) {
        setMessage(result.error ?? "Unable to read local models.");
        return;
      }
      setModels(result.models);
      setSelectedModel(result.selectedModel);
      setDraftModel(result.selectedModel);
      if (!result.models.length) setMessage("LM Studio reports no local LLM models.");
    } catch {
      setMessage("Unable to reach the local model service.");
    } finally {
      setBusy("");
    }
  }

  const options = useMemo(() => {
    if (models.some((model) => model.id === draftModel)) return models;
    return [{ id: draftModel, displayName: draftModel, loaded: false, reported: false }, ...models];
  }, [draftModel, models]);

  async function saveModel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("saving");
    setMessage("");
    try {
      const response = await fetch("/api/account/llm-model", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: draftModel }),
      });
      const result = (await response.json()) as { error?: string; selectedModel?: string };
      if (!response.ok || !result.selectedModel) {
        setMessage(result.error ?? "Unable to update the model.");
        return;
      }
      setSelectedModel(result.selectedModel);
      setDraftModel(result.selectedModel);
      setMessage("LLM model updated for new processing jobs.");
    } catch {
      setMessage("Unable to reach the local model service.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="security-card account-form-card llm-model-card">
      <div>
        <p className="eyebrow">Local processing</p>
        <h2>Summary LLM model</h2>
        <p>
          Choose which local LM Studio model creates summaries and outcomes. New jobs snapshot this choice; running jobs and retries keep their original model.
        </p>
      </div>
      <form onSubmit={(event) => void saveModel(event)}>
        <label>
          Model
          <select
            value={draftModel}
            onChange={(event) => setDraftModel(event.target.value)}
            disabled={busy === "loading" || !options.length}
          >
            {options.map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName}{model.displayName === model.id ? "" : ` (${model.id})`} — {model.reported === false ? "not reported by LM Studio" : model.loaded ? "loaded" : "available locally"}
              </option>
            ))}
          </select>
        </label>
        <small>
          Unloaded models require LM Studio Just-in-Time loading or manual loading before processing starts.
        </small>
        <div className="llm-model-actions">
          <button
            className="button primary"
            disabled={Boolean(busy) || draftModel === selectedModel || !models.some((model) => model.id === draftModel)}
          >
            {busy === "saving" ? "Saving…" : "Use this model"}
          </button>
          <button className="button" type="button" disabled={Boolean(busy)} onClick={() => {
            setBusy("loading");
            setMessage("");
            void loadModels();
          }}>
            {busy === "loading" ? "Refreshing…" : "Refresh models"}
          </button>
        </div>
        <p className="form-status" role="status">{message}</p>
      </form>
    </section>
  );
}
