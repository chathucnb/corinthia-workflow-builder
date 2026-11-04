import { describe, expect, it } from 'vitest';
import { SWIMLANE_SAMPLE, swimlaneSample } from '../app/sampleLanes';
import { fromJson, toJson } from '../export/convert';
import { validate } from '../export/validate';
import type { FlowNode } from '../types';
import { handoffs, lanesOf, layoutLanes, membership, moveLane, nodeW } from './lanes';

const doc = () => swimlaneSample();
const laneName = (d: ReturnType<typeof doc>) => {
  const m = membership(d.nodes);
  const names = new Map(m.lanes.map((l) => [l.id, l.name]));
  return (label: string) => names.get(m.lane.get(d.nodes.find((n) => n.data.label === label)!.id)!);
};

describe('swimlane example', () => {
  it('puts every block in the lane it was given, and VO blocks in the Changes section', () => {
    const d = doc();
    const m = membership(d.nodes);
    const lane = laneName(d);
    for (const n of SWIMLANE_SAMPLE.nodes) expect(lane(n.label), n.label).toBe(n.lane);
    const changes = m.bands.find((b) => b.name === 'Changes (VOs)')!;
    const inChanges = d.nodes.filter((n) => m.band.get(n.id) === changes.id).map((n) => n.data.label).sort();
    expect(inChanges).toEqual(SWIMLANE_SAMPLE.nodes.filter((n) => n.section).map((n) => n.label).sort());
  });

  it('is valid with no blocks outside lanes', () => {
    const issues = validate(doc());
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(issues.filter((i) => /outside every swimlane/.test(i.message))).toEqual([]);
  });

  it('lays lanes side by side with equal heights and a band spanning them', () => {
    const d = doc();
    const lanes = d.nodes.filter((n) => n.type === 'lane').sort((a, b) => a.position.x - b.position.x);
    expect(lanes.map((l) => l.data.label)).toEqual(SWIMLANE_SAMPLE.lanes);
    for (let i = 1; i < lanes.length; i++) expect(lanes[i].position.x).toBe(lanes[i - 1].position.x + nodeW(lanes[i - 1]));
    expect(new Set(lanes.map((l) => l.height)).size).toBe(1);
    const band = d.nodes.find((n) => n.type === 'band')!;
    const last = lanes[lanes.length - 1];
    expect(band.width).toBe(last.position.x + nodeW(last) - lanes[0].position.x);
  });

  it('flows top to bottom', () => {
    const d = doc();
    const y = (label: string) => d.nodes.find((n) => n.data.label === label)!.position.y;
    expect(d.direction).toBe('TB');
    expect(y('Release package')).toBeLessThan(y('Set budget'));
    expect(y('Set budget')).toBeLessThan(y('Package closed'));
    expect(y('Package closed')).toBeLessThan(y('Price the VO')); // Changes section sits below the main flow
  });

  it('finds handoffs between departments', () => {
    const d = doc();
    const lane = laneName(d);
    const list = handoffs(d.nodes, d.edges).map((h) => {
      const s = d.nodes.find((n) => n.id === h.edge.source)!.data.label;
      const t = d.nodes.find((n) => n.id === h.edge.target)!.data.label;
      return `${lane(s)}→${lane(t)}`;
    });
    expect(list).toContain('Design→Commercial');
    expect(list).toContain('Commercial→Accounts');
    expect(list).not.toContain('Design→Design');
  });
});

describe('lane layout', () => {
  it('moves the blocks of later lanes when a lane gets wider', () => {
    const before = doc().nodes;
    const lanes = lanesOf(before);
    const wider = before.map((n) => (n.id === lanes[0].id ? { ...n, width: nodeW(n) + 100 } : n));
    const after = layoutLanes(before, wider);
    const block = (nodes: FlowNode[]) => nodes.find((n) => n.data.label === 'Set budget')!.position.x; // in lane 3
    expect(block(after) - block(before)).toBe(100);
    expect(after.find((n) => n.id === lanes[1].id)!.position.x).toBe(lanes[1].x + 100);
  });

  it('reorders lanes and takes their blocks along', () => {
    const d = doc();
    const lanes = lanesOf(d.nodes);
    const moved = layoutLanes(d.nodes, moveLane(d.nodes, lanes[0].id, 1));
    expect(lanesOf(moved).map((l) => l.name).slice(0, 2)).toEqual(['Procurement', 'Design']);
    const after = { ...d, nodes: moved };
    expect(laneName(after)('Release package')).toBe('Design');
    expect(laneName(after)('BOQ + pre-qualify')).toBe('Procurement');
  });
});

describe('swimlane export', () => {
  it('exports lanes, sections, each block lane and handoffs, and round-trips', () => {
    const d = doc();
    const out = toJson(d);
    expect(out.lanes.map((l) => l.name)).toEqual(SWIMLANE_SAMPLE.lanes);
    expect(out.sections.map((s) => s.name)).toEqual(['Changes (VOs)']);
    const laneById = new Map(out.lanes.map((l) => [l.id, l.name]));
    const budget = out.nodes.find((n) => n.label === 'Set budget')!;
    expect(laneById.get(budget.lane!)).toBe('Commercial');
    expect(out.nodes.find((n) => n.label === 'Price the VO')!.section).toBe(out.sections[0].id);
    expect(out.handoffs.length).toBeGreaterThan(5);
    expect(out.direction).toBe('TB');
    expect(toJson(fromJson(JSON.parse(JSON.stringify(out))))).toEqual(out);
  });
});
