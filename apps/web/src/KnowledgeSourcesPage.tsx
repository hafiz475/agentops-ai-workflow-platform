import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type KnowledgeSource } from './api';

export function KnowledgeSourcesPage({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const [name, setName] = useState('Engineering knowledge');
  const [provider, setProvider] = useState<'development' | 'openai'>('development');
  const [selected, setSelected] = useState<KnowledgeSource | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('Create a source, then upload TXT, PDF, or DOCX.');
  const sources = useQuery({
    queryKey: ['knowledge-sources', projectId],
    queryFn: () => api.listKnowledgeSources(projectId),
  });
  const documents = useQuery({
    queryKey: ['knowledge-documents', projectId, selected?.id],
    queryFn: () => api.listKnowledgeDocuments(projectId, selected?.id ?? ''),
    enabled: Boolean(selected),
    refetchInterval: (query) =>
      (query.state.data ?? []).some((document) =>
        ['UPLOADED', 'PROCESSING'].includes(document.status),
      )
        ? 800
        : false,
  });
  const create = useMutation({
    mutationFn: () =>
      api.createKnowledgeSource(projectId, {
        name,
        embeddingProvider: provider,
        embeddingModel:
          provider === 'development' ? 'development-hash-v1' : 'text-embedding-3-small',
      }),
    onSuccess: async (source) => {
      setSelected(source);
      setMessage(`Knowledge Source ${source.name} created.`);
      await client.invalidateQueries({ queryKey: ['knowledge-sources', projectId] });
    },
    onError: (error) => setMessage(error.message),
  });
  const upload = useMutation({
    mutationFn: async () => {
      if (!selected || !file) throw new Error('Choose a source and document first.');
      return api.uploadKnowledgeDocument(projectId, selected.id, file);
    },
    onSuccess: async (document) => {
      setMessage(`${document.originalFilename} queued for ingestion.`);
      setFile(null);
      await client.invalidateQueries({
        queryKey: ['knowledge-documents', projectId, selected?.id],
      });
    },
    onError: (error) => setMessage(error.message),
  });

  return (
    <section>
      <div className="section-heading">
        <div>
          <span className="eyebrow">KNOWLEDGE SOURCES</span>
          <h2>Reusable grounded retrieval</h2>
        </div>
      </div>
      <form
        className="create-row"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <input
          aria-label="Knowledge source name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <select
          aria-label="Embedding provider"
          value={provider}
          onChange={(event) => setProvider(event.target.value as 'development' | 'openai')}
        >
          <option value="development">Deterministic development</option>
          <option value="openai">OpenAI embeddings</option>
        </select>
        <button>Create source</button>
      </form>
      <div className="cards">
        {sources.data?.map((source) => (
          <button className="project-card" key={source.id} onClick={() => setSelected(source)}>
            <span>{source.sourceType}</span>
            <strong>{source.name}</strong>
            <small>
              {source.embeddingProvider} / {source.embeddingModel} /{' '}
              {source.embeddingDimensions ?? 'not embedded'} dimensions
            </small>
          </button>
        ))}
      </div>
      {selected && (
        <div className="knowledge-documents">
          <h3>{selected.name} documents</h3>
          <form
            className="create-row"
            onSubmit={(event) => {
              event.preventDefault();
              upload.mutate();
            }}
          >
            <input
              aria-label="Knowledge document"
              type="file"
              accept=".txt,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <button disabled={!file}>Upload document</button>
          </form>
          <div className="cards">
            {documents.data?.map((document) => (
              <article className="project-card" key={document.id}>
                <span>{document.status}</span>
                <strong>{document.originalFilename}</strong>
                <small>
                  {document.mimeType} / {document.fileSize} bytes
                </small>
                {document.errorMessage && <p className="error">{document.errorMessage}</p>}
              </article>
            ))}
          </div>
        </div>
      )}
      <p className="validation-message" role="status">
        {message}
      </p>
    </section>
  );
}
