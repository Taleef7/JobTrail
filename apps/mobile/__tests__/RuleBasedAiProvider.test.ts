import { RuleBasedAiProvider } from '../src/ai/RuleBasedAiProvider';

const provider = new RuleBasedAiProvider();

describe('RuleBasedAiProvider', () => {
  describe('extractJobFields', () => {
    it('extracts job type from plumbing note', async () => {
      const result = await provider.extractJobFields({
        noteText: 'Replaced kitchen sink P-trap, used one PVC kit',
        jobId: 'test-1',
      });
      expect(result.jobType).toBe('plumbing');
    });

    it('extracts job type from electrical note', async () => {
      const result = await provider.extractJobFields({
        noteText: 'Fixed faulty wiring in outlet, used new switch',
        jobId: 'test-2',
      });
      expect(result.jobType).toBe('electrical');
    });

    it('extracts work performed', async () => {
      const result = await provider.extractJobFields({
        noteText: 'Replaced kitchen sink P-trap and fixed the drain pipe',
        jobId: 'test-3',
      });
      expect(result.workPerformed.length).toBeGreaterThan(0);
      expect(result.workPerformed[0].toLowerCase()).toContain('kitchen sink');
    });

    it('extracts duration in minutes', async () => {
      const result = await provider.extractJobFields({
        noteText: 'Replaced P-trap, took 55 minutes, customer approved',
        jobId: 'test-4',
      });
      expect(result.durationMinutes).toBe(55);
    });

    it('extracts materials with quantity and unit', async () => {
      const result = await provider.extractJobFields({
        noteText: 'Used one PVC kit and 2 boxes of screws',
        jobId: 'test-5',
      });
      expect(result.materials.length).toBeGreaterThan(0);
      expect(result.materials.some(m => m.unit === 'kit' || m.unit === 'box')).toBe(true);
    });

    it('detects customer approval', async () => {
      const result = await provider.extractJobFields({
        noteText: 'Job complete, customer approved the work',
        jobId: 'test-6',
      });
      expect(result.customerApproved).toBe(true);
    });

    it('extracts follow-up notes', async () => {
      const result = await provider.extractJobFields({
        noteText: 'Fixed the leak. Follow up if leak returns.',
        jobId: 'test-7',
      });
      expect(result.followUpNotes.length).toBeGreaterThan(0);
    });

    it('handles empty note gracefully', async () => {
      const result = await provider.extractJobFields({
        noteText: '',
        jobId: 'test-8',
      });
      expect(result.workPerformed).toEqual([]);
      expect(result.materials).toEqual([]);
      expect(result.durationMinutes).toBeUndefined();
    });

    it('computes confidence score', async () => {
      const result = await provider.extractJobFields({
        noteText: 'Replaced kitchen sink P-trap, used one PVC kit, took 55 minutes, customer approved, follow up if leak returns',
        jobId: 'test-9',
      });
      expect(result.confidence).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('identifies missing fields for sparse note', async () => {
      const result = await provider.extractJobFields({
        noteText: 'Did some work',
        jobId: 'test-10',
      });
      expect(result.missingFields).toContain('materials');
      expect(result.missingFields).toContain('durationMinutes');
    });
  });

  describe('summarizeJob', () => {
    it('generates a summary from job data', async () => {
      const result = await provider.summarizeJob({
        job: {
          id: 'test',
          userId: 'user1',
          title: 'Kitchen Sink Repair',
          jobType: 'plumbing',
          status: 'completed',
          priority: 'normal',
          clientId: null,
          siteId: null,
          roughNotes: null,
          structuredSummary: null,
          internalNotes: null,
          customerVisibleSummary: null,
          aiStatus: 'completed',
          syncStatus: 'synced',
          createdAt: '2024-03-15T00:00:00Z',
          updatedAt: '2024-03-15T00:00:00Z',
        },
        notes: [{ id: 'n1', jobId: 'test', userId: 'user1', noteType: 'manual', content: 'Replaced P-trap', createdAt: '', updatedAt: '', syncStatus: 'synced' }],
        materials: [{ id: 'm1', jobId: 'test', userId: 'user1', name: 'PVC Kit', quantity: 1, unit: 'kit', unitCost: 15, totalCost: 15, billable: true, createdAt: '', updatedAt: '', syncStatus: 'synced' }],
        timeEntries: [{ id: 't1', jobId: 'test', userId: 'user1', startedAt: null, endedAt: null, durationMinutes: 55, description: null, billable: true, createdAt: '', updatedAt: '', syncStatus: 'synced' }],
      });
      expect(result.summary).toContain('Kitchen Sink Repair');
      expect(result.summary).toContain('P-trap');
      expect(result.summary).toContain('PVC Kit');
      expect(result.summary).toContain('55 minutes');
    });

    it('handles empty notes and materials', async () => {
      const result = await provider.summarizeJob({
        job: { id: 'test', userId: 'user1', title: 'Test Job', jobType: null, status: 'draft', priority: 'normal', clientId: null, siteId: null, roughNotes: null, structuredSummary: null, internalNotes: null, customerVisibleSummary: null, aiStatus: 'not_started', syncStatus: 'local_only', createdAt: '', updatedAt: '' },
        notes: [],
        materials: [],
        timeEntries: [],
      });
      expect(result.summary).toContain('No notes recorded');
      expect(result.summary).toContain('No materials recorded');
      expect(result.summary).toContain('No labor time recorded');
    });
  });

  describe('suggestMissingFields', () => {
    it('suggests materials when none exist', async () => {
      const result = await provider.suggestMissingFields({
        job: { id: 'test', userId: 'user1', title: 'Test', jobType: null, status: 'draft', priority: 'normal', clientId: null, siteId: null, roughNotes: null, structuredSummary: null, internalNotes: null, customerVisibleSummary: null, aiStatus: 'not_started', syncStatus: 'local_only', createdAt: '', updatedAt: '' },
        notes: [],
        materials: [],
        timeEntries: [{ id: 't1', jobId: 'test', userId: 'user1', startedAt: null, endedAt: null, durationMinutes: 30, description: null, billable: true, createdAt: '', updatedAt: '', syncStatus: 'synced' }],
      });
      expect(result.missingFields).toContain('materials');
      expect(result.suggestions['materials']).toBeDefined();
    });
  });
});
