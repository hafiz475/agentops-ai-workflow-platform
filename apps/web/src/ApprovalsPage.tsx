import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from './api';

export function ApprovalsPage({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const [reason, setReason] = useState('Reviewed in AgentOps Studio.');
  const approvals = useQuery({
    queryKey: ['approvals', projectId],
    queryFn: () => api.listApprovals(projectId),
    refetchInterval: 1500,
  });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) =>
      decision === 'approve'
        ? api.approve(projectId, id, reason)
        : api.reject(projectId, id, reason),
    onSuccess: async () => client.invalidateQueries({ queryKey: ['approvals', projectId] }),
  });
  return (
    <section>
      <div className="section-heading">
        <div>
          <span className="eyebrow">DURABLE EXECUTION</span>
          <h2>Approval inbox</h2>
        </div>
      </div>
      <label>
        Decision reason
        <input
          aria-label="Approval reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <div className="cards">
        {approvals.data?.map((approval) => (
          <article className="project-card" key={approval.id}>
            <span>{approval.status}</span>
            <strong>{approval.title}</strong>
            <span>
              {approval.approvalType === 'AGENT_TOOL' ? 'Agent Tool Approval' : 'Workflow Approval'}
            </span>
            <p>{approval.instructions}</p>
            {approval.approvalType === 'AGENT_TOOL' && (
              <pre>{JSON.stringify(approval.safeContext, null, 2)}</pre>
            )}
            <small>
              Run {approval.runId}
              <br />
              Workflow state {approval.run?.status ?? 'unknown'}
              {approval.run && (
                <>
                  {' '}
                  � attempt {approval.run.attemptCount}/{approval.run.maxAttempts}
                </>
              )}
              <br />
              Requested {new Date(approval.requestedAt).toLocaleString()}
            </small>
            {approval.status === 'PENDING' && (
              <div className="action-stack">
                <button onClick={() => decide.mutate({ id: approval.id, decision: 'approve' })}>
                  Approve
                </button>
                <button
                  className="ghost"
                  onClick={() => decide.mutate({ id: approval.id, decision: 'reject' })}
                >
                  Reject
                </button>
              </div>
            )}
            {approval.reason && <p>{approval.reason}</p>}
          </article>
        ))}
      </div>
      {approvals.error && <p className="error">{approvals.error.message}</p>}
    </section>
  );
}
