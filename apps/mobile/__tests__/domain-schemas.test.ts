import {
  JobSchema,
  CreateJobSchema,
  CreateNoteSchema,
  CreateMaterialSchema,
  CreateTimeEntrySchema,
  JobExtractionResultSchema,
} from '../src/domain/schemas';

describe('JobSchema', () => {
  it('validates a valid job object', () => {
    const result = JobSchema.safeParse({
      id: '123',
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
    });
    expect(result.success).toBe(true);
  });

  it('rejects a job without a title', () => {
    const result = JobSchema.safeParse({
      id: '123',
      userId: 'user1',
      title: '',
      status: 'draft',
      aiStatus: 'not_started',
      syncStatus: 'local_only',
      createdAt: '2024-03-15T00:00:00Z',
      updatedAt: '2024-03-15T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid job status', () => {
    const result = JobSchema.safeParse({
      id: '123',
      userId: 'user1',
      title: 'Test',
      status: 'invalid_status',
      aiStatus: 'not_started',
      syncStatus: 'local_only',
      createdAt: '2024-03-15T00:00:00Z',
      updatedAt: '2024-03-15T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid statuses', () => {
    const statuses = ['draft', 'scheduled', 'in_progress', 'completed', 'archived'];
    for (const status of statuses) {
      const result = JobSchema.safeParse({
        id: '1',
        userId: 'u1',
        title: 'Test',
        jobType: null,
        status,
        priority: 'normal',
        roughNotes: null,
        structuredSummary: null,
        internalNotes: null,
        customerVisibleSummary: null,
        aiStatus: 'not_started',
        syncStatus: 'local_only',
        createdAt: '2024-03-15T00:00:00Z',
        updatedAt: '2024-03-15T00:00:00Z',
      });
      expect(result.success).toBe(true);
    }
  });
});

describe('CreateJobSchema', () => {
  it('validates a valid create job input', () => {
    const result = CreateJobSchema.safeParse({ title: 'New Job', jobType: 'plumbing' });
    expect(result.success).toBe(true);
  });

  it('rejects empty title', () => {
    const result = CreateJobSchema.safeParse({ title: '' });
    expect(result.success).toBe(false);
  });

  it('accepts title only', () => {
    const result = CreateJobSchema.safeParse({ title: 'A job' });
    expect(result.success).toBe(true);
  });
});

describe('CreateNoteSchema', () => {
  it('validates a valid note', () => {
    const result = CreateNoteSchema.safeParse({ content: 'Fixed the sink' });
    expect(result.success).toBe(true);
  });

  it('rejects empty content', () => {
    const result = CreateNoteSchema.safeParse({ content: '' });
    expect(result.success).toBe(false);
  });
});

describe('CreateMaterialSchema', () => {
  it('validates with required fields only', () => {
    const result = CreateMaterialSchema.safeParse({ name: 'PVC Pipe' });
    expect(result.success).toBe(true);
  });

  it('validates with all fields', () => {
    const result = CreateMaterialSchema.safeParse({
      name: 'PVC Pipe',
      quantity: 3,
      unit: 'ft',
      unitCost: 5.50,
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative quantity', () => {
    const result = CreateMaterialSchema.safeParse({ name: 'Test', quantity: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects zero quantity', () => {
    const result = CreateMaterialSchema.safeParse({ name: 'Test', quantity: 0 });
    expect(result.success).toBe(false);
  });
});

describe('CreateTimeEntrySchema', () => {
  it('validates a valid time entry', () => {
    const result = CreateTimeEntrySchema.safeParse({ durationMinutes: 30 });
    expect(result.success).toBe(true);
  });

  it('rejects zero duration', () => {
    const result = CreateTimeEntrySchema.safeParse({ durationMinutes: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects negative duration', () => {
    const result = CreateTimeEntrySchema.safeParse({ durationMinutes: -5 });
    expect(result.success).toBe(false);
  });

  it('accepts optional description', () => {
    const result = CreateTimeEntrySchema.safeParse({ durationMinutes: 30, description: 'Worked on sink' });
    expect(result.success).toBe(true);
  });
});

describe('JobExtractionResultSchema', () => {
  it('validates a complete extraction result', () => {
    const result = JobExtractionResultSchema.safeParse({
      jobType: 'plumbing',
      workPerformed: ['Replaced sink P-trap'],
      issuesFound: [],
      materials: [{ name: 'PVC Kit', quantity: 1, unit: 'kit' }],
      durationMinutes: 55,
      customerApproved: true,
      followUpNotes: ['Follow up if leak returns'],
      missingFields: [],
      confidence: 0.85,
    });
    expect(result.success).toBe(true);
  });

  it('accepts minimal extraction result', () => {
    const result = JobExtractionResultSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('provides defaults for arrays', () => {
    const result = JobExtractionResultSchema.parse({});
    expect(result.workPerformed).toEqual([]);
    expect(result.materials).toEqual([]);
    expect(result.followUpNotes).toEqual([]);
    expect(result.missingFields).toEqual([]);
  });

  it('rejects confidence > 1', () => {
    const result = JobExtractionResultSchema.safeParse({ confidence: 2 });
    expect(result.success).toBe(false);
  });
});
