import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';
import { api, type Project, type Workflow } from './api';
import { EvaluationsPage } from './EvaluationsPage';
import { PromptsPage } from './PromptsPage';
import { WorkflowEditor } from './WorkflowEditor';
const queryClient = new QueryClient();
type Page = 'projects' | 'workflows' | 'prompts' | 'evaluations';
function Studio() {
  const client = useQueryClient();
  const [project, setProject] = useState<Project | null>(null);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [page, setPage] = useState<Page>('projects');
  const [projectName, setProjectName] = useState('AgentOps Demo');
  const [workflowName, setWorkflowName] = useState('Beginner explanation workflow');
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.listProjects });
  const workflows = useQuery({
    queryKey: ['workflows', project?.id],
    queryFn: () => api.listWorkflows(project?.id ?? ''),
    enabled: Boolean(project?.id),
  });
  const createProject = useMutation({
    mutationFn: () => api.createProject(projectName),
    onSuccess: async (created) => {
      setProject(created);
      setPage('workflows');
      await client.invalidateQueries({ queryKey: ['projects'] });
    },
  });
  const createWorkflow = useMutation({
    mutationFn: () => api.createWorkflow(project?.id ?? '', workflowName),
    onSuccess: async (created) => {
      setWorkflow(created);
      await client.invalidateQueries({ queryKey: ['workflows', project?.id] });
    },
  });
  if (project && workflow)
    return (
      <WorkflowEditor projectId={project.id} workflow={workflow} onBack={() => setWorkflow(null)} />
    );
  const chooseProject = (item: Project) => {
    setProject(item);
    setPage('workflows');
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark">AO</div>
        <nav>
          <button
            className={page === 'projects' ? 'active' : ''}
            onClick={() => {
              setPage('projects');
              setProject(null);
            }}
          >
            Projects
          </button>
          <button
            disabled={!project}
            className={page === 'workflows' ? 'active' : ''}
            onClick={() => setPage('workflows')}
          >
            Workflows
          </button>
          <button
            disabled={!project}
            className={page === 'prompts' ? 'active' : ''}
            onClick={() => setPage('prompts')}
          >
            Prompts
          </button>
          <button
            disabled={!project}
            className={page === 'evaluations' ? 'active' : ''}
            onClick={() => setPage('evaluations')}
          >
            Evaluations
          </button>
        </nav>
        <p>
          Milestone 2<br />
          <strong>Evaluation online</strong>
          {project && (
            <>
              <br />
              {project.name}
            </>
          )}
        </p>
      </aside>
      <main>
        <header className="hero">
          <div>
            <span className="eyebrow">AGENTOPS STUDIO</span>
            <h1>Design. Evaluate. Improve.</h1>
            <p>
              Version prompts and workflows, execute synthetic evaluation datasets, and compare
              measured quality, latency, and token usage.
            </p>
          </div>
          <span className="status">
            <i /> Control plane ready
          </span>
        </header>
        {page === 'projects' && (
          <section>
            <div className="section-heading">
              <div>
                <span className="eyebrow">PROJECTS</span>
                <h2>Choose an isolated workspace</h2>
              </div>
            </div>
            <form
              className="create-row"
              onSubmit={(event) => {
                event.preventDefault();
                createProject.mutate();
              }}
            >
              <input
                aria-label="Project name"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
              />
              <button>Create project</button>
            </form>
            <div className="cards">
              {projects.data?.map((item) => (
                <button className="project-card" key={item.id} onClick={() => chooseProject(item)}>
                  <span>PROJECT</span>
                  <strong>{item.name}</strong>
                  <small>{item.id}</small>
                </button>
              ))}
            </div>
            {projects.error && <p className="error">{projects.error.message}</p>}
          </section>
        )}
        {project && page === 'workflows' && (
          <section>
            <div className="section-heading">
              <div>
                <span className="eyebrow">{project.name}</span>
                <h2>Versioned workflows</h2>
              </div>
            </div>
            <form
              className="create-row"
              onSubmit={(event) => {
                event.preventDefault();
                createWorkflow.mutate();
              }}
            >
              <input
                aria-label="Workflow name"
                value={workflowName}
                onChange={(event) => setWorkflowName(event.target.value)}
              />
              <button>Create workflow</button>
            </form>
            <div className="cards">
              {workflows.data?.map((item) => (
                <button className="project-card" key={item.id} onClick={() => setWorkflow(item)}>
                  <span>WORKFLOW</span>
                  <strong>{item.name}</strong>
                  <small>{item.draftGraph?.nodes.length ?? 0} nodes</small>
                </button>
              ))}
            </div>
            {workflows.error && <p className="error">{workflows.error.message}</p>}
          </section>
        )}
        {project && page === 'prompts' && <PromptsPage projectId={project.id} />}{' '}
        {project && page === 'evaluations' && <EvaluationsPage projectId={project.id} />}{' '}
      </main>
    </div>
  );
}
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Studio />
    </QueryClientProvider>
  );
}
