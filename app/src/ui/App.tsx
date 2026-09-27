import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  Boxes,
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  Clock3,
  FileText,
  Layers3,
  LoaderCircle,
  PackageCheck,
  Search,
  ShieldCheck,
  Sparkles,
  Truck,
  Warehouse,
} from 'lucide-react';

const DEFAULT_QUESTION = 'Investigate why OTIF performance declined in August 2026 and tell me what actions management should take according to company policy.';

interface Overview {
  augustOtif: number;
  monthOverMonthChange: number;
  lateOrders: number;
  partialShipments: number;
  warehouseComparison: WarehouseComparison[];
  largestWarehouseDecline: WarehouseComparison | null;
}

interface WarehouseComparison {
  warehouseId: number;
  warehouseName: string;
  julyOtif: number;
  augustOtif: number;
  changePoints: number;
  julyOrders: number;
  augustOrders: number;
  julyLateOrders: number;
  augustLateOrders: number;
  julyPartialShipments: number;
  augustPartialShipments: number;
}

interface ToolTrace {
  id: number;
  name: string;
  label: string;
  arguments: Record<string, unknown>;
  summary: string;
  context: 'operational' | 'policy';
}

interface PolicySource {
  document: string;
  section: string;
  chunkId: string;
  similarity?: number;
  preview?: string;
}

interface InvestigationEvidence {
  otif: Array<Record<string, unknown>>;
  warehouses: Array<Record<string, unknown>>;
  inventory: Array<Record<string, unknown>>;
  vendors: Array<Record<string, unknown>>;
  customers: Array<Record<string, unknown>>;
}

interface Investigation {
  answer: string;
  metadata: {
    toolSequence: Array<{ id: number; label: string }>;
    toolsUsed: Array<{ name: string; label: string; context: string }>;
    toolTrace: ToolTrace[];
    policySources: PolicySource[];
    evidence: InvestigationEvidence;
  };
}

type AnalysisSection = 'executive' | 'observed' | 'interpretation' | 'policy' | 'actions' | 'limitations';

const TOOL_ICONS: Record<string, typeof Activity> = {
  get_otif_metrics: Activity,
  get_warehouse_performance: Warehouse,
  get_inventory_health: Boxes,
  get_vendor_performance: Truck,
  get_customer_impact: PackageCheck,
  search_company_policies: FileText,
};

function sectionForHeading(heading: string): AnalysisSection | undefined {
  const normalized = heading.toLowerCase();
  if (normalized.includes('executive') || normalized.includes('investigation')) return 'executive';
  if (normalized.includes('observed') || normalized.includes('operational fact')) return 'observed';
  if (normalized.includes('interpret')) return 'interpretation';
  if (normalized.includes('recommend') || normalized.includes('management action') || normalized.startsWith('action')) return 'actions';
  if (normalized.includes('policy')) return 'policy';
  if (normalized.includes('limitation') || normalized.includes('evidence gap')) return 'limitations';
  return undefined;
}

function parseSections(answer: string): Record<AnalysisSection, string> {
  const sections: Record<AnalysisSection, string[]> = {
    executive: [], observed: [], interpretation: [], policy: [], actions: [], limitations: [],
  };
  let current: AnalysisSection = 'executive';
  let hasHeadings = false;
  for (const line of answer.split('\n')) {
    const markdownHeading = /^#{1,3}\s+(.+?)\s*#*\s*$/.exec(line);
    const boldHeading = /^\*\*(.+?)\*\*:?\s*$/.exec(line);
    const headingText = markdownHeading?.[1] ?? boldHeading?.[1];
    if (headingText) {
      hasHeadings = true;
      current = sectionForHeading(headingText) ?? current;
    } else {
      sections[current].push(line);
    }
  }
  if (!hasHeadings) sections.executive = [answer];

  return Object.fromEntries(Object.entries(sections).map(([key, value]) => [key, value.join('\n').trim()])) as Record<AnalysisSection, string>;
}

function extractEvidenceGaps(answer: string, explicitSection: string, investigation: Investigation, userQuestion: string): string[] {
  const text = explicitSection || answer;
  const sentences = text.replace(/^\s*[-*+]\s+/gm, '').replace(/\*\*/g, '').split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
  const gapPattern = /does not prove|do not prove|does not establish|cannot (?:confirm|establish|verify|rule out)|not (?:directly )?(?:linked|available|included|provided|verified|yet verified)|no direct|lack of|without (?:a |the )?(?:direct|detailed|complete)|remains? (?:uncertain|unverified)|unknown|evidence gap|would need to be verified|not enough evidence/i;
  const seen = new Set<string>();
  const gaps = sentences.map((sentence) => sentence.trim()).filter((sentence) => {
    const normalized = sentence.replace(/^\d+[.)]\s*/, '').trim();
    const key = normalized.toLowerCase();
    if (!normalized || !gapPattern.test(normalized) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const askedMonth = /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})/i.exec(userQuestion);
  const requestedEnds = investigation.metadata.toolTrace
    .map((tool) => tool.arguments.endDate)
    .filter((date): date is string => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  if (askedMonth && requestedEnds.length) {
    const monthNumber = new Date(`${askedMonth[1]} 1, ${askedMonth[2]}`).getMonth() + 1;
    const monthEnd = new Date(Number(askedMonth[2]), monthNumber, 0).toISOString().slice(0, 10);
    const latestRequested = requestedEnds.at(-1) ?? '';
    if (latestRequested <= monthEnd) gaps.push(`The investigation's tool evidence ends on ${latestRequested}; later performance was not assessed.`);
  }
  return [...new Set(gaps)].slice(0, 5);
}

function listItems(content: string): string[] {
  const items = content.split(/(?=^\s*(?:[-*+]\s|\d+[.)]\s))/m).map((item) => item.trim()).filter(Boolean);
  if (items.length > 1) return items;
  const paragraphs = content.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
  return paragraphs.length > 1 ? paragraphs : [content.trim()].filter(Boolean);
}

function formatPercent(value: unknown): string {
  return typeof value === 'number' ? `${value.toFixed(1)}%` : '—';
}

function formatNumber(value: unknown): string {
  return typeof value === 'number' ? value.toLocaleString() : '—';
}

function formatDateRange(row: Record<string, unknown>): string {
  const start = String(row.startDate ?? '');
  return start ? new Date(`${start}T00:00:00`).toLocaleString('en-US', { month: 'long' }) : '';
}

function documentTitle(document: string): string {
  if (document.includes('shipping')) return 'Shipping SLA';
  if (document.includes('inventory')) return 'Inventory SOP';
  if (document.includes('vendor')) return 'Vendor Escalation Procedure';
  return document;
}

function MetricCard({ icon: Icon, label, value, detail, tone }: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
  tone: string;
}) {
  return (
    <article className="metric-card">
      <div className={`metric-icon ${tone}`}><Icon size={18} strokeWidth={1.9} /></div>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-detail">{detail}</div>
    </article>
  );
}

function MarkdownSection({ title, content, className, icon: Icon }: {
  title: string;
  content: string;
  className: string;
  icon: typeof Activity;
}) {
  if (!content) return null;
  return (
    <section className={`analysis-card ${className}`}>
      <div className="section-heading"><span className="section-icon"><Icon size={16} /></span><h3>{title}</h3></div>
      <div className="markdown-content"><ReactMarkdown>{content}</ReactMarkdown></div>
    </section>
  );
}

function WarehouseComparisonChart({ rows }: { rows: WarehouseComparison[] }) {
  if (!rows.length) return null;
  const largest = rows.reduce((current, row) => row.changePoints < current.changePoints ? row : current);
  return <section className="panel warehouse-chart-panel">
    <div className="panel-title-row"><div><div className="eyebrow small"><span className="eyebrow-line" />SERVICE BY DISTRIBUTION CENTER</div><h3>July to August OTIF</h3></div><span className="chart-legend"><i className="july-dot" /> July <i className="august-dot" /> August</span></div>
    <div className="warehouse-chart" role="img" aria-label="July and August OTIF comparison by warehouse">
      {rows.map((row) => <div className={`warehouse-chart-row${row.warehouseId === largest.warehouseId ? ' largest-decline' : ''}`} key={row.warehouseId}>
        <div className="chart-row-heading"><strong>{row.warehouseName}</strong><span className={row.changePoints < 0 ? 'negative-change' : 'positive-change'}>{row.changePoints > 0 ? '+' : ''}{row.changePoints.toFixed(1)} pts</span></div>
        <div className="chart-bar-line"><span className="chart-month">Jul</span><div className="chart-track"><span className="chart-bar july-bar" style={{ width: `${Math.max(0, Math.min(100, row.julyOtif))}%` }} /></div><strong>{formatPercent(row.julyOtif)}</strong></div>
        <div className="chart-bar-line"><span className="chart-month">Aug</span><div className="chart-track"><span className="chart-bar august-bar" style={{ width: `${Math.max(0, Math.min(100, row.augustOtif))}%` }} /></div><strong>{formatPercent(row.augustOtif)}</strong></div>
      </div>)}
    </div>
  </section>;
}

function ObservedFactsSection({ content }: { content: string }) {
  if (!content) return null;
  const items = listItems(content);
  const primary = items.slice(0, 3);
  const supporting = items.slice(3);
  return <section className="analysis-card facts-card">
    <div className="section-heading"><span className="section-icon"><Activity size={16} /></span><h3>Observed Operational Facts</h3></div>
    <div className="markdown-content"><ReactMarkdown>{primary.join('\n\n')}</ReactMarkdown></div>
    {supporting.length > 0 && <details className="supporting-facts"><summary>View supporting facts ({supporting.length}) <ChevronDown size={14} /></summary><div className="markdown-content"><ReactMarkdown>{supporting.join('\n\n')}</ReactMarkdown></div></details>}
  </section>;
}

function RecommendedActions({ content }: { content: string }) {
  if (!content) return null;
  const actions = listItems(content);
  const renderAction = (item: string, index: number) => {
    const cleaned = item.replace(/^\s*(?:[-*+]\s|\d+[.)]\s)/, '').trim();
    const titleMatch = /^\*\*(.+?)\*\*[:\s-]*/.exec(cleaned);
    const title = titleMatch?.[1] ?? (cleaned.split(/[.!?:;]/)[0].slice(0, 90) || 'Recommended action');
    const body = titleMatch ? cleaned.slice(titleMatch[0].length).trim() : cleaned.slice(title.length).replace(/^[:\s-]+/, '').trim();
    const policySentences = body.split(/(?<=[.!?])\s+/).filter((sentence) => /policy|threshold|requires?|must |business days|days late|below \d|above \d|otif/i.test(sentence));
    return <article className="action-item" key={`${index}-${title}`}><div className="action-number">{String(index + 1).padStart(2, '0')}</div><div className="action-copy"><h4>{title}</h4>{body && <><span className="action-field-label">Why it is required</span><div className="markdown-content"><ReactMarkdown>{body}</ReactMarkdown></div></>}{policySentences.length > 0 && <div className="policy-basis"><span className="action-field-label">Policy basis</span><div className="markdown-content"><ReactMarkdown>{policySentences.join(' ')}</ReactMarkdown></div></div>}</div></article>;
  };
  const primary = actions.slice(0, 2);
  const additional = actions.slice(2);
  return <section className="analysis-card actions-card">
    <div className="section-heading"><span className="section-icon"><ClipboardList size={16} /></span><h3>Recommended Management Actions</h3></div>
    <div className="action-list">{primary.map(renderAction)}</div>
    {additional.length > 0 && <details className="supporting-facts additional-actions"><summary>View additional actions ({additional.length}) <ChevronDown size={14} /></summary><div className="action-list">{additional.map((action, index) => renderAction(action, index + primary.length))}</div></details>}
  </section>;
}

function GroupedPolicySources({ sources }: { sources: PolicySource[] }) {
  const grouped = new Map<string, PolicySource[]>();
  for (const source of sources) grouped.set(source.document, [...(grouped.get(source.document) ?? []), source]);
  const groups = [...grouped.entries()];
  if (!groups.length) return null;
  return <section className="panel sources-panel"><div className="panel-title-row"><div><div className="eyebrow small"><span className="eyebrow-line" />RETRIEVED POLICY CONTEXT</div><h3>Policy sources</h3></div><span className="panel-count">{sources.length} passages</span></div><div className="policy-groups">{groups.map(([document, passages]) => <details className="policy-group" key={document}><summary><span><strong>{documentTitle(document)}</strong><small>{passages.length} relevant {passages.length === 1 ? 'passage' : 'passages'}</small></span><ChevronDown size={15} /></summary><div className="grouped-source-list">{passages.map((source) => <article className="grouped-source" key={`${source.document}-${source.section}-${source.chunkId}`}><div className="grouped-source-heading"><strong>{source.section}</strong>{typeof source.similarity === 'number' && <span>{source.similarity.toFixed(3)} similarity</span>}</div>{source.preview && <p>{source.preview}</p>}</article>)}</div></details>)}</div></section>;
}

export default function App() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [status, setStatus] = useState<'checking' | 'ready' | 'offline'>('checking');
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [investigation, setInvestigation] = useState<Investigation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        const [healthResponse, overviewResponse] = await Promise.all([
          fetch('/api/health'),
          fetch('/api/overview'),
        ]);
        if (healthResponse.ok) {
          const health = await healthResponse.json() as { mcpAgentAvailable?: boolean };
          setStatus(health.mcpAgentAvailable ? 'ready' : 'offline');
        } else setStatus('offline');
        if (overviewResponse.ok) setOverview(await overviewResponse.json() as Overview);
        setUpdatedAt(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
      } catch {
        setStatus('offline');
        setError('Could not reach the local SupplyChain AI API. Start the application and try again.');
      }
    };
    void loadDashboard();
  }, []);

  const sections = useMemo(() => investigation ? parseSections(investigation.answer) : null, [investigation]);
  const operationalTools = investigation?.metadata.toolsUsed.filter((tool) => tool.context === 'operational') ?? [];
  const policyTools = investigation?.metadata.toolsUsed.filter((tool) => tool.context === 'policy') ?? [];

  async function submitQuestion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question.trim() || loading) return;
    setLoading(true);
    setError('');
    setInvestigation(null);
    try {
      const response = await fetch('/api/investigate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: question.trim() }),
      });
      const payload = await response.json() as Investigation | { error?: string };
      if (!response.ok) throw new Error('error' in payload ? payload.error : 'Investigation failed.');
      setInvestigation(payload as Investigation);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Investigation failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><Layers3 size={21} strokeWidth={2.1} /></div>
          <div><div className="brand-name">SupplyChain <span>AI</span></div><div className="brand-subtitle">Operations Intelligence</div></div>
        </div>
        <div className="topbar-right">
          <div className={`connection-pill ${status}`}><span className="status-dot" />{status === 'ready' ? 'Local MCP agent available' : status === 'checking' ? 'Connecting to local agent' : 'Agent unavailable'}</div>
          <div className="local-badge"><ShieldCheck size={15} /> Local workspace</div>
          <div className="avatar">SC</div>
        </div>
      </header>

      <main className="dashboard">
        <div className="page-intro">
          <div>
            <div className="eyebrow"><span className="eyebrow-line" />EXECUTIVE OPERATIONS BRIEF</div>
            <h1>See the signal.<br /><span>Understand the cause.</span></h1>
            <p>Operational data and company policy, brought together for faster decisions.</p>
          </div>
          <div className="report-meta"><span className="meta-label">REPORTING PERIOD</span><strong>August 2026</strong><span className="meta-updated"><Clock3 size={13} /> {updatedAt ? `Updated ${updatedAt}` : 'Live from local data'}</span></div>
        </div>

        <section className="kpi-grid" aria-label="August performance indicators">
          <MetricCard icon={Activity} label="August OTIF" value={overview ? formatPercent(overview.augustOtif) : '—'} detail="Order-level service performance" tone="blue" />
          <MetricCard icon={ArrowDownRight} label="Month-over-month change" value={overview ? `${overview.monthOverMonthChange > 0 ? '+' : ''}${overview.monthOverMonthChange.toFixed(1)} pts` : '—'} detail="Compared with July 2026" tone="red" />
          <MetricCard icon={Truck} label="August late orders" value={overview ? formatNumber(overview.lateOrders) : '—'} detail="Across all distribution centers" tone="amber" />
          <MetricCard icon={PackageCheck} label="August partial shipments" value={overview ? formatNumber(overview.partialShipments) : '—'} detail="Orders shipped below full quantity" tone="violet" />
        </section>

        <section className="question-card">
          <div className="question-topline"><div className="question-icon"><Sparkles size={18} /></div><div><div className="question-title">Ask SupplyChain AI</div><div className="question-caption">Investigate an operational signal or ask what policy requires.</div></div><div className="question-context"><span className="context-indicator" />Context-aware analysis</div></div>
          <form onSubmit={submitQuestion}>
            <label className="sr-only" htmlFor="business-question">Ask SupplyChain AI</label>
            <textarea id="business-question" value={question} onChange={(event) => setQuestion(event.target.value)} rows={3} maxLength={4000} placeholder="Ask an operations question…" />
            <div className="question-footer"><div className="example-hint"><CircleHelp size={14} /> Ask a question about performance, causes, or company procedures.</div><button className="investigate-button" type="submit" disabled={loading || !question.trim() || status === 'offline'}>{loading ? <><LoaderCircle className="spin" size={16} /> Investigating</> : <>Investigate <ArrowRight size={16} /></>}</button></div>
          </form>
          {error && <div className="error-banner" role="alert">{error}</div>}
        </section>

        {loading && <div className="loading-state"><LoaderCircle className="spin" size={22} /><span>Reviewing operational signals and retrieving relevant policy…</span></div>}

        {investigation && sections && <>
          <div className="results-heading"><div><div className="eyebrow"><span className="eyebrow-line" />INVESTIGATION</div><h2>What the data is telling us</h2></div><div className="result-badge"><Check size={14} /> Evidence assembled</div></div>

          <div className="analysis-grid">
            <MarkdownSection title="Executive Summary" content={sections.executive} className="executive-card" icon={Sparkles} />
            {overview?.largestWarehouseDecline && investigation.metadata.toolsUsed.some((tool) => tool.name === 'get_warehouse_performance') && <section className="primary-finding"><div className="primary-finding-kicker"><Activity size={14} />Primary finding</div><div className="primary-finding-copy"><strong>{overview.largestWarehouseDecline.warehouseName} experienced the largest deterioration.</strong><span>Warehouse OTIF moved from {formatPercent(overview.largestWarehouseDecline.julyOtif)} in July to {formatPercent(overview.largestWarehouseDecline.augustOtif)} in August.</span></div><div className="primary-finding-delta">{overview.largestWarehouseDecline.changePoints.toFixed(1)}<small>pts</small></div></section>}
            {overview?.warehouseComparison && <div className="warehouse-chart-slot"><WarehouseComparisonChart rows={overview.warehouseComparison} /></div>}
            <ObservedFactsSection content={sections.observed} />
            <MarkdownSection title="Evidence-Based Interpretation" content={sections.interpretation} className="interpretation-card" icon={Search} />
            <MarkdownSection title="Policy Requirements" content={sections.policy} className="policy-card" icon={FileText} />
            <RecommendedActions content={sections.actions} />
            <MarkdownSection title="Limitations / Evidence Gaps" content={extractEvidenceGaps(investigation.answer, sections.limitations, investigation, question).map((gap) => `- ${gap}`).join('\n')} className="limitations-card" icon={CircleHelp} />
          </div>

          <div className="support-grid">
            <section className="panel evidence-panel">
              <div className="panel-title-row"><div><div className="eyebrow small"><span className="eyebrow-line" />TOOL-RETURNED EVIDENCE</div><h3>Operational signals</h3></div><span className="panel-count">{investigation.metadata.evidence.warehouses.length} warehouse observations</span></div>
              {investigation.metadata.evidence.otif.length > 0 && <div className="evidence-stat-row">
                {investigation.metadata.evidence.otif.map((row) => <div className="evidence-stat" key={String(row.startDate)}><span>{formatDateRange(row)} OTIF</span><strong>{formatPercent(row.otifPercentage)}</strong><small>{formatNumber(row.otifOrders)} of {formatNumber(row.totalOrders)} orders</small></div>)}
              </div>}
              {investigation.metadata.evidence.warehouses.length > 0 && <div className="table-wrap"><table><thead><tr><th>Warehouse</th><th>OTIF</th><th>Late orders</th><th>Partial</th></tr></thead><tbody>
                {investigation.metadata.evidence.warehouses.filter((row) => row.endDate === '2026-08-31').map((row) => <tr key={`${String(row.warehouseId)}-${String(row.startDate)}`}><td><span className="warehouse-cell"><Warehouse size={14} />{String(row.warehouseName)}</span></td><td className={Number(row.otifPercentage) < 50 ? 'critical-value' : ''}>{formatPercent(row.otifPercentage)}</td><td>{formatNumber(row.lateOrderCount)}</td><td>{formatNumber(row.partialShipmentCount)}</td></tr>)}
              </tbody></table></div>}
              {investigation.metadata.evidence.inventory.map((item) => <div className="evidence-callout" key={String(item.startDate)}><Boxes size={16} /><div><strong>{formatNumber(item.productsBelowSafetyStock)} products below safety stock</strong><span>{formatNumber(item.numberOfDaysBelowSafetyStock)} product-location-days in the period</span></div></div>)}
              {investigation.metadata.evidence.vendors.slice(0, 3).map((vendor) => <div className="vendor-evidence" key={`${String(vendor.vendorName)}-${String(vendor.startDate)}`}><div className="vendor-avatar"><Truck size={15} /></div><div className="vendor-copy"><strong>{String(vendor.vendorName)} <span>· {formatNumber(vendor.lateDeliveries)} late POs</span></strong><span>{formatNumber(vendor.averageDaysLate)} avg. days late · {Array.isArray(vendor.latePurchaseOrders) ? vendor.latePurchaseOrders.length : 0} PO details</span></div><ArrowRight size={15} className="muted-arrow" /></div>)}
            </section>

            <section className="panel trace-panel">
              <div className="panel-title-row"><div><div className="eyebrow small"><span className="eyebrow-line" />CONTEXT ENGINEERING</div><h3>Investigation trace</h3></div><span className="live-tag"><span className="status-dot" />LIVE</span></div>
              <div className="trace-label">MODEL-REQUESTED TOOL SEQUENCE</div>
              <div className="sequence-list">{investigation.metadata.toolSequence.map((step, index) => <span className="sequence-step" key={step.id}><span className="sequence-number">{String(step.id).padStart(2, '0')}</span>{step.label}{index < investigation.metadata.toolSequence.length - 1 && <span className="sequence-arrow">→</span>}</span>)}</div>
              <div className="trace-divider" />
              <div className="context-columns">
                <div><div className="trace-label">OPERATIONAL CONTEXT USED</div><div className="tool-pills">{operationalTools.length ? operationalTools.map((tool) => { const Icon = TOOL_ICONS[tool.name] ?? Activity; return <span className="tool-pill" key={tool.name}><Icon size={13} />{tool.label}</span>; }) : <span className="empty-context">Not requested</span>}</div></div>
                <div><div className="trace-label">POLICY CONTEXT USED</div><div className="tool-pills">{policyTools.length ? policyTools.map((tool) => <span className="tool-pill policy-tool" key={tool.name}><FileText size={13} />Policy Search</span>) : <span className="empty-context">Not requested</span>}</div></div>
              </div>
              {investigation.metadata.toolTrace.length > 0 && <details className="trace-details"><summary>Tool activity and result summaries <ChevronDown size={15} /></summary><div className="trace-entries">{investigation.metadata.toolTrace.map((tool) => <div className="trace-entry" key={tool.id}><div><strong>{tool.label}</strong><span>{tool.summary}</span></div><code>{typeof tool.arguments.startDate === 'string' ? `${tool.arguments.startDate} → ${String(tool.arguments.endDate)}` : tool.context === 'policy' ? String(tool.arguments.query ?? '').slice(0, 110) : 'Requested by model'}</code></div>)}</div></details>}
              <div className="trace-note"><ShieldCheck size={15} /><span>Only evidence requested by the agent was added to its working context.</span></div>
            </section>
          </div>

          {investigation.metadata.policySources.length > 0 && <GroupedPolicySources sources={investigation.metadata.policySources} />}
        </>}

        {!investigation && !loading && <section className="welcome-strip"><div className="welcome-icon"><Activity size={18} /></div><div><strong>Operational context, on demand</strong><span>Ask a question to see how business data and approved procedures come together.</span></div><ArrowRight size={17} /></section>}

        <details className="about-panel"><summary><span className="about-summary-icon"><Layers3 size={17} /></span><span><strong>About this analysis</strong><small>How SupplyChain AI assembles context</small></span><ChevronDown size={17} className="about-chevron" /></summary><div className="about-content"><p>The AI does not receive the entire operational database or policy library. It decides which governed MCP tools it needs, receives structured operational evidence, retrieves only relevant policy passages, and synthesizes the evidence into a grounded response.</p><nav className="architecture-flow" aria-label="Question to grounded analysis flow"><span>Question</span><i>→</i><span>AI Agent</span><i>→</i><span>MCP Tools</span><i>→</i><span>Operational Data + Policy Retrieval</span><i>→</i><span>Grounded Analysis</span></nav><p>Operational data is synthetic and stored in SQLite. Policy passages are retrieved using RAG with OpenAI embeddings. Context engineering limits the model to evidence it requests; the trace shows tool activity and returned evidence, not hidden reasoning.</p><div className="architecture-chips"><span>MCP</span><span>RAG</span><span>OpenAI embeddings</span><span>SQLite synthetic data</span><span>Context engineering</span></div></div></details>

        <footer className="page-footer"><span>SUPPLYCHAIN AI <span className="footer-dot">·</span> LOCAL OPERATIONS INTELLIGENCE</span><span>Development environment <span className="footer-dot">·</span> Synthetic data</span></footer>
      </main>
    </div>
  );
}
