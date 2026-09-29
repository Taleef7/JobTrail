import { useEffect, useState } from "react";
import changelogMarkdown from "../../../CHANGELOG.md?raw";
import { parseChangelog } from "./changelog";
import { inlineTokens } from "./inline";
import { summarizeMilestones, type MilestoneRow } from "./milestones";

const REPO = "https://github.com/Taleef7/JobTrail";
const changelog = parseChangelog(changelogMarkdown);

type MilestoneState =
  { kind: "loading" } | { kind: "ready"; rows: MilestoneRow[] } | { kind: "error" };

function useMilestones(): MilestoneState {
  const [state, setState] = useState<MilestoneState>({ kind: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    fetch("https://api.github.com/repos/Taleef7/JobTrail/milestones?state=all&per_page=50", {
      signal: controller.signal,
      headers: { Accept: "application/vnd.github+json" },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json: unknown) => setState({ kind: "ready", rows: summarizeMilestones(json) }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: "error" });
      });
    return () => controller.abort();
  }, []);
  return state;
}

function InlineText({ text }: { text: string }) {
  return (
    <>
      {inlineTokens(text).map((token, i) => {
        if (token.kind === "code") return <code key={i}>{token.value}</code>;
        if (token.kind === "issue") {
          return (
            <a key={i} href={`${REPO}/issues/${token.number}`}>
              {token.value}
            </a>
          );
        }
        return <span key={i}>{token.value}</span>;
      })}
    </>
  );
}

function BuildInfo() {
  const { sha, branch, env, builtAt } = __BUILD__;
  return (
    <dl className="build">
      <div>
        <dt>Commit</dt>
        <dd>
          {sha === "unknown" ? (
            <code>unknown</code>
          ) : (
            <a href={`${REPO}/commit/${sha}`} data-testid="commit-sha" data-sha={sha}>
              <code>{sha.slice(0, 7)}</code>
            </a>
          )}
        </dd>
      </div>
      <div>
        <dt>Branch</dt>
        <dd>
          <code>{branch}</code>
        </dd>
      </div>
      <div>
        <dt>Environment</dt>
        <dd>
          <span className={`pill pill-${env}`}>{env}</span>
        </dd>
      </div>
      <div>
        <dt>Built</dt>
        <dd>
          <time dateTime={builtAt}>{new Date(builtAt).toUTCString()}</time>
        </dd>
      </div>
    </dl>
  );
}

function Milestones() {
  const state = useMilestones();
  if (state.kind === "loading") return <p className="muted">Loading milestone progress…</p>;
  if (state.kind === "error" || state.rows.length === 0) {
    return (
      <p className="muted">
        Couldn&apos;t load live progress. See{" "}
        <a href={`${REPO}/milestones`}>milestones on GitHub</a>.
      </p>
    );
  }
  return (
    <table className="milestones">
      <thead>
        <tr>
          <th scope="col">Milestone</th>
          <th scope="col">Status</th>
          <th scope="col">Issues closed</th>
        </tr>
      </thead>
      <tbody>
        {state.rows.map((m) => (
          <tr key={m.title}>
            <td>
              <a href={m.url}>{m.title}</a>
            </td>
            <td>
              <span className={`status status-${m.status.replace(" ", "-")}`}>{m.status}</span>
            </td>
            <td>
              <div className="progress">
                <div className="bar" role="img" aria-label={`${m.percent}% complete`}>
                  <span style={{ width: `${m.percent}%` }} />
                </div>
                <span className="count">
                  {m.closed}/{m.open + m.closed}
                </span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Shipped() {
  if (changelog.releases.length === 0) return <p className="muted">Nothing shipped yet.</p>;
  return (
    <>
      {changelog.releases.map((release) => (
        <article key={release.version} className="release">
          <h3>
            {release.version}
            {release.date ? <span className="muted"> · {release.date}</span> : null}
          </h3>
          {release.sections.map((section) => (
            <section key={section.heading}>
              <h4>{section.heading}</h4>
              <ul>
                {section.entries.map((entry, i) => (
                  <li key={i}>
                    <InlineText text={entry.text} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </article>
      ))}
    </>
  );
}

export function App() {
  return (
    <main>
      <header>
        <p className="eyebrow">JobTrail v2 · rebuild in progress</p>
        <h1>Job records from a 30-second voice note, on the phone you already have.</h1>
        <p className="lede">
          A small language model running entirely on-device (no signal, no account, nothing
          uploaded) turns a tradesperson&apos;s end-of-job note into a priced record and flags what
          they forgot to bill. This page is the live build: it shows exactly what is deployed, and
          nothing more.
        </p>
      </header>

      <section aria-labelledby="build-h">
        <h2 id="build-h">This deployment</h2>
        <BuildInfo />
      </section>

      <section aria-labelledby="progress-h">
        <h2 id="progress-h">Progress</h2>
        <Milestones />
      </section>

      <section aria-labelledby="shipped-h">
        <h2 id="shipped-h">What&apos;s shipped</h2>
        <Shipped />
      </section>

      <footer>
        <a href={REPO}>Repository</a>
        <a href={`${REPO}/blob/main/docs/superpowers/specs/2026-09-28-jobtrail-rebuild-design.md`}>
          Design doc
        </a>
        <a href={`${REPO}/blob/main/docs/WORKFLOW.md`}>How it&apos;s built</a>
        <a href={`${REPO}/tree/legacy-v0`}>Legacy v0</a>
      </footer>
    </main>
  );
}
