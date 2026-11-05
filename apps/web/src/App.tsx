const capabilities = [
  ['Workflow builder', 'Planned for Milestone 1'],
  ['Prompt registry', 'Foundation ready'],
  ['Execution traces', 'Planned for Milestone 1'],
];

export function App() {
  return (
    <div className="shell">
      <aside>
        <div className="brand-mark">AO</div>
        <nav aria-label="Primary navigation">
          <a className="active" href="#overview">
            Overview
          </a>
          <a href="#workflows">Workflows</a>
          <a href="#prompts">Prompts</a>
          <a href="#runs">Runs</a>
        </nav>
      </aside>
      <main id="overview">
        <header>
          <div>
            <span className="eyebrow">AGENTOPS STUDIO</span>
            <h1>Build AI workflows you can trust.</h1>
            <p>
              Configure, run, and inspect versioned agent workflows from one operational surface.
            </p>
          </div>
          <span className="status">
            <i /> Foundation online
          </span>
        </header>
        <section aria-labelledby="foundation-title">
          <div className="section-heading">
            <div>
              <span className="eyebrow">MILESTONE 0</span>
              <h2 id="foundation-title">Platform foundation</h2>
            </div>
            <button disabled title="Available in Milestone 1">
              New workflow
            </button>
          </div>
          <div className="cards">
            {capabilities.map(([title, detail], index) => (
              <article key={title}>
                <span className="card-number">0{index + 1}</span>
                <h3>{title}</h3>
                <p>{detail}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="boundary" aria-labelledby="boundary-title">
          <div>
            <span className="eyebrow">SERVICE BOUNDARY</span>
            <h2 id="boundary-title">Control and execution, separated.</h2>
          </div>
          <div className="flow">
            <span>React web</span>
            <b>→</b>
            <span>Node control plane</span>
            <b>→</b>
            <span>Python AI service</span>
          </div>
        </section>
      </main>
    </div>
  );
}
