import { aiToDoc, type AiWorkflow } from '../ai/apply';
import { cloneDoc } from '../export/convert';
import type { WorkflowDoc } from '../types';

const j = (o: unknown) => JSON.stringify(o);
const n = (id: string, type: string, label: string, lane: string, data: unknown = {}, section = '') => ({ id, type, label, lane, section, dataJson: j(data) });
const e = (source: string, sourceHandle: string, target: string, label = '') => ({ source, sourceHandle, target, label });

/** A package procurement flow across five departments, with a Changes section. */
export const SWIMLANE_SAMPLE: AiWorkflow = {
  name: 'Package Procurement (swimlanes)',
  description: 'How a package moves from Design through Procurement / Commercial to site and payment, and where changes (VOs) enter.',
  lanes: ['Design', 'Procurement', 'Commercial', 'PM / Site', 'Accounts'],
  sections: ['Changes (VOs)'],
  variables: [
    { name: 'packageType', type: 'string', description: 'direct | milestone' },
    { name: 'contractSigned', type: 'boolean', description: 'Contract signed before the change?' },
  ],
  nodes: [
    n('s', 'start', 'Release package', 'Design', { trigger: 'manual' }),
    n('docs', 'document', 'DWG, specs, schedule, SOW', 'Design', { docType: 'Tender package', action: 'upload', required: true }),
    n('budget', 'approval', 'Set budget', 'Commercial', { role: 'Commercial Manager', slaHours: 48 }),
    n('type', 'switch', 'Package type?', 'Commercial', {
      variable: 'packageType',
      cases: [
        { id: 'case_direct', value: 'direct', label: 'Direct purchase' },
        { id: 'case_ms', value: 'milestone', label: 'Milestone / progress' },
      ],
      hasDefault: false,
    }),
    n('boq', 'task', 'BOQ + pre-qualify', 'Procurement', { assigneeRole: 'Procurement Officer' }),
    n('itt1', 'assign', 'ITT to 3+ pre-qualified', 'Procurement', { role: 'Procurement Officer', task: 'Issue ITT, level bids' }),
    n('award1', 'approval', 'Award (direct)', 'Procurement', { role: 'CEO' }),
    n('tpa', 'document', 'TPA + PO signed', 'Procurement', { docType: 'Purchase order', action: 'sign', required: true }),
    n('itt2', 'assign', 'ITT to 3+ vendors', 'Commercial', { role: 'Quantity Surveyor', task: 'Tech check and levelling' }),
    n('award2', 'approval', 'Award by band', 'Commercial', { role: 'Commercial Manager' }),
    n('po', 'document', 'PO + contract signed', 'Commercial', { docType: 'Contract', action: 'sign', required: true }),
    n('adv', 'task', 'Pay advance / deposit', 'Accounts', { assigneeRole: 'Accounts', description: 'Against security / advance invoice' }),
    n('shop', 'approval', 'Approve shop drawings + samples', 'Design', { role: 'Head of Design', requireComment: true }),
    n('prod', 'task', 'Production', 'Procurement', { assigneeRole: 'Supplier' }),
    n('deliver', 'task', 'Deliver to site, raise MIR', 'Procurement', { assigneeRole: 'Procurement Officer' }),
    n('mir', 'inspection', 'Pass MIR, install', 'PM / Site', { assigneeRole: 'Site Engineer', checklist: ['Matches approved sample', 'Installed'], photosRequired: true }),
    n('claim', 'approval', 'Validate vendor claim', 'Commercial', { role: 'Quantity Surveyor' }),
    n('pay', 'task', 'Pay claim / balance', 'Accounts', { assigneeRole: 'Accounts' }),
    n('end', 'end', 'Package closed', 'Accounts', { status: 'completed' }),
    // Changes section
    n('vo1', 'task', 'Design change', 'Design', { assigneeRole: 'Head of Design', description: 'Revised drawings / specs' }, 'Changes (VOs)'),
    n('contracted', 'condition', 'Contracted?', 'Design', { condition: { logic: 'AND', rules: [{ var: 'contractSigned', op: 'isTrue' }] } }, 'Changes (VOs)'),
    n('retender', 'task', 'Re-tender / re-plan', 'Procurement', { assigneeRole: 'Procurement Officer' }, 'Changes (VOs)'),
    n('price', 'task', 'Price the VO', 'Commercial', { assigneeRole: 'Quantity Surveyor', description: 'Cost + time impact' }, 'Changes (VOs)'),
    n('decide', 'approval', 'Decide VO', 'Commercial', { role: 'Commercial Manager' }, 'Changes (VOs)'),
    n('newval', 'document', 'New contract value', 'Commercial', { docType: 'Variation order', action: 'generate', required: true }, 'Changes (VOs)'),
    n('forecast', 'notification', 'Cash forecast update', 'Accounts', { recipientRole: 'Accounts', channel: 'inApp', message: 'Commitments updated by an approved VO' }, 'Changes (VOs)'),
  ],
  edges: [
    e('s', 'out', 'docs'),
    e('docs', 'out', 'budget'),
    e('budget', 'approved', 'type', 'Approved'),
    e('budget', 'rejected', 'docs', 'Rejected'),
    e('type', 'case_direct', 'boq', 'Direct purchase'),
    e('type', 'case_ms', 'itt2', 'Milestone / progress'),
    e('boq', 'out', 'itt1'),
    e('itt1', 'out', 'award1'),
    e('award1', 'approved', 'tpa', 'Approved'),
    e('award1', 'rejected', 'itt1', 'Rejected'),
    e('tpa', 'out', 'adv'),
    e('itt2', 'out', 'award2'),
    e('award2', 'approved', 'po', 'Approved'),
    e('award2', 'rejected', 'itt2', 'Rejected'),
    e('po', 'out', 'adv'),
    e('adv', 'out', 'shop'),
    e('shop', 'approved', 'prod', 'Approved'),
    e('shop', 'rejected', 'vo1', 'Change needed'),
    e('prod', 'out', 'deliver'),
    e('deliver', 'out', 'mir'),
    e('mir', 'pass', 'claim', 'Pass'),
    e('mir', 'fail', 'deliver', 'Fail'),
    e('claim', 'approved', 'pay', 'Approved'),
    e('claim', 'rejected', 'mir', 'Rejected'),
    e('pay', 'out', 'end'),
    e('vo1', 'out', 'contracted'),
    e('contracted', 'true', 'price', 'Yes'),
    e('contracted', 'false', 'retender', 'No'),
    e('retender', 'out', 'boq'),
    e('price', 'out', 'decide'),
    e('decide', 'approved', 'newval', 'Agreed'),
    e('decide', 'rejected', 'shop', 'Rejected'),
    e('newval', 'out', 'forecast'),
    e('forecast', 'out', 'prod'),
  ],
  assumptions: [],
};

export const swimlaneSample = (): WorkflowDoc => cloneDoc(aiToDoc(SWIMLANE_SAMPLE, { workflows: [] }).doc);
