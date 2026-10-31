import { z } from "zod";

const text = z.string().min(1);
const texts = z.array(text);
const evidence = z.object({
  file: text,
  fromLine: z.number().int().positive(),
  toLine: z.number().int().positive(),
  contains: text,
});
export const taskSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    id: z.string().regex(/^DD-\d{2}-0[1-8]$/),
    system: z.string().regex(/^(0[1-9]|1[0-2])$/),
    title: text,
    split: z.enum(["development", "holdout"]),
    family: text,
    capability: z.enum(["current", "target"]),
    provenance: z.object({
      kind: z.enum(["synthetic", "history_adapted"]),
      sources: texts.min(1),
      privacy: text,
    }),
    tags: texts.min(1),
    track: z.enum(["desktop", "diagnostic", "semantic"]),
    requirements: texts.min(1),
    environment: z
      .object({
        profile: text,
        protocol: text,
        fixtureDir: text.nullable(),
        inputFiles: texts.optional(),
        setup: texts.min(1),
      })
      .passthrough(),
    user: z.object({
      goal: text,
      brief: text,
      knownFacts: texts,
      initialMessage: text,
      answers: z.array(z.object({ when: text, reply: text })),
      unknownReply: text,
    }),
    steps: z.array(z.object({ action: text, observe: text })).min(1),
    completion: z.object({
      when: text,
      stopAfterMs: z.number().int().positive(),
      maxUserTurns: z.number().int().positive(),
    }),
    must: z
      .array(
        z.object({
          id: text,
          description: text,
          kind: z.enum(["programmatic", "semantic", "desktop"]),
          gate: z.boolean(),
        }),
      )
      .min(2),
    mustNot: texts.min(1),
    grading: z.object({
      oracle: text,
      rubric: texts.min(1),
      checks: z.array(z.object({ entry: text, command: text, purpose: text })),
    }),
    variants: z.array(
      z
        .object({ id: text, change: text, expectedDifference: text })
        .passthrough(),
    ),
  })
  .passthrough();
const example = z.object({ answer: text, rationale: text });
export const oracleSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    id: text,
    facts: z
      .array(
        z.object({ id: text, statement: text, evidence: z.array(evidence) }),
      )
      .min(1),
    counterEvidence: z.array(z.unknown()),
    unknowns: texts,
    allowedConclusions: texts.min(1),
    forbiddenConclusions: texts.min(1),
    rubric: z
      .array(z.object({ dimension: text, zero: text, one: text, two: text }))
      .min(1),
    positiveExamples: z.array(example).min(1),
    negativeExamples: z.array(example).min(1),
    alternativeValidExamples: z.array(example).min(1),
    checks: z
      .array(z.object({ mustId: text, method: text, expected: text }))
      .min(2),
  })
  .passthrough();

export const statuses = [
  "pass",
  "product_failure",
  "infrastructure_failure",
  "grading_dispute",
  "insufficient_evidence",
  "not_implemented",
  "not_run",
];
export const resultSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    runId: text,
    caseId: text,
    attempt: z.number().int().positive(),
    status: z.enum(statuses),
    executionTrack: z.enum([
      "desktop_proxy",
      "diagnostic",
      "semantic_calibration",
    ]),
    blinded: z.boolean(),
    mockService: z.boolean(),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    checks: z.array(
      z.object({
        id: text,
        passed: z.boolean().nullable(),
        observation: text,
        evidence: texts.min(1),
      }),
    ),
    scores: z.array(
      z.object({
        dimension: text,
        score: z.number().int().min(0).max(2).nullable(),
        observation: text,
        evidence: texts.min(1),
      }),
    ),
    artifacts: texts,
    limitations: texts,
    reviewer: z.object({
      kind: z.enum(["agent_proxy", "programmatic"]),
      identity: text,
      independentContext: z.boolean(),
    }),
    forbiddenChecks: z
      .array(
        z.object({
          index: z.number().int().nonnegative(),
          absent: z.boolean(),
          observation: text,
          evidence: texts.min(1),
        }),
      )
      .optional(),
    metrics: z
      .object({
        elapsedMs: z.number().nonnegative(),
        modelRequests: z.number().int().nonnegative(),
        cost: z.number().nonnegative().nullable(),
      })
      .passthrough(),
  })
  .passthrough();
export const manifestSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    runId: text,
    createdAt: z.string().datetime(),
    application: z.object({
      version: text,
      executable: text,
      executableSha256: text,
      build: text,
    }),
    suiteVersion: text,
    platform: text,
    executionTrack: text,
    mockService: z.boolean(),
    model: z.object({
      protocol: text,
      name: text,
      endpoint: text,
      configuration: z.record(z.string(), z.unknown()),
    }),
    display: z.object({
      width: z.number().nullable(),
      height: z.number().nullable(),
      scale: z.number().nullable(),
    }),
    isolation: z.object({
      profile: text,
      traceRoots: texts.min(1),
      excluded: texts.min(1),
    }),
    fixtureHashes: z.record(z.string(), text),
    sourceRevision: text,
    caseIds: texts.min(1),
  })
  .passthrough();
export const schemas = {
  task: taskSchema,
  oracle: oracleSchema,
  result: resultSchema,
  manifest: manifestSchema,
};
export function jsonSchemas() {
  return Object.fromEntries(
    Object.entries(schemas).map(([k, v]) => [k, z.toJSONSchema(v)]),
  );
}
