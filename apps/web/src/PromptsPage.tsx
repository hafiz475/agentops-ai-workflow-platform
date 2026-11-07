import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, type Prompt, type PromptVersion } from './api';

export interface PromptsPageProps {
  projectId: string;
}
export function PromptsPage({ projectId }: PromptsPageProps) {
  const client = useQueryClient();
  const [name, setName] = useState('Beginner Explanation');
  const [selected, setSelected] = useState<Prompt | null>(null);
  const [template, setTemplate] = useState('Explain simply: {{input}}');
  const [notes, setNotes] = useState('Initial version');
  const [historical, setHistorical] = useState<PromptVersion | null>(null);
  const [message, setMessage] = useState('Create a prompt, then add immutable versions.');
  const prompts = useQuery({
    queryKey: ['prompts', projectId],
    queryFn: () => api.listPrompts(projectId),
  });
  useEffect(() => {
    if (selected && prompts.data) {
      setSelected(prompts.data.find((item) => item.id === selected.id) ?? null);
    }
  }, [prompts.data, selected?.id]);
  const createPrompt = useMutation({
    mutationFn: () => api.createPrompt(projectId, name),
    onSuccess: async (created) => {
      setSelected({ ...created, versions: [] });
      setMessage('Prompt created. Add Version 1.');
      await client.invalidateQueries({ queryKey: ['prompts', projectId] });
    },
    onError: (error) => setMessage(error.message),
  });
  const createVersion = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('Select a prompt first.');
      return api.createPromptVersion(projectId, selected.id, template, notes || null);
    },
    onSuccess: async (version) => {
      setMessage(`Immutable Prompt Version ${version.versionNumber} created.`);
      setHistorical(null);
      await client.invalidateQueries({ queryKey: ['prompts', projectId] });
    },
    onError: (error) => setMessage(error.message),
  });
  return (
    <section className="workspace-page" aria-label="Prompts page">
      <div className="section-heading">
        <div>
          <span className="eyebrow">PROMPT REGISTRY</span>
          <h2>Version prompts, measure changes</h2>
        </div>
        <span className="provider-badge">Controlled placeholders only</span>
      </div>
      <form
        className="create-row"
        onSubmit={(event) => {
          event.preventDefault();
          createPrompt.mutate();
        }}
      >
        <input
          aria-label="Prompt name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button>Create prompt</button>
      </form>
      <div className="registry-layout">
        <div className="registry-list">
          <h3>Prompts</h3>
          {prompts.data?.map((prompt) => (
            <button
              key={prompt.id}
              className={selected?.id === prompt.id ? 'registry-item active' : 'registry-item'}
              onClick={() => {
                setSelected(prompt);
                setHistorical(null);
              }}
            >
              <strong>{prompt.name}</strong>
              <small>
                {prompt.versions.length} versions · latest v{prompt.versions[0]?.versionNumber ?? 0}
              </small>
              <small>Updated {new Date(prompt.updatedAt).toLocaleDateString()}</small>
            </button>
          ))}
        </div>
        <div className="registry-editor">
          <h3>{selected?.name ?? 'Select a prompt'}</h3>
          {selected && (
            <>
              <label>
                Template
                <textarea
                  aria-label="Prompt template"
                  value={historical?.template ?? template}
                  readOnly={Boolean(historical)}
                  onChange={(event) => setTemplate(event.target.value)}
                />
              </label>
              <label>
                Variables
                <input value={(historical?.variables ?? ['input']).join(', ')} readOnly />
              </label>
              <label>
                Change notes
                <textarea
                  aria-label="Change notes"
                  value={historical?.changeNotes ?? notes}
                  readOnly={Boolean(historical)}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </label>
              {historical ? (
                <p className="validation-message">
                  Version {historical.versionNumber} is immutable and read only.
                </p>
              ) : (
                <button onClick={() => createVersion.mutate()}>Create New Version</button>
              )}
              <div className="version-list">
                {selected.versions.map((version) => (
                  <button className="ghost" key={version.id} onClick={() => setHistorical(version)}>
                    Prompt v{version.versionNumber}
                  </button>
                ))}
                {historical && (
                  <button className="ghost" onClick={() => setHistorical(null)}>
                    Return to new version editor
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <p className="validation-message" role="status">
        {message}
      </p>
      {prompts.error && <p className="error">{prompts.error.message}</p>}
    </section>
  );
}
