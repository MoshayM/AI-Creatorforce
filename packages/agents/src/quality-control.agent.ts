import { BaseAgent, type AgentContext } from './base-agent';
import { z } from 'zod';
import { callAIStructured } from '@cf/shared';

export const QualityControlOutputSchema = z.object({
  agentName: z.string(),
  passed: z.boolean(),
  issues: z.array(z.object({
    field: z.string(),
    problem: z.string(),
    severity: z.enum(['critical', 'warning', 'info']),
  })),
  correctedOutput: z.unknown().optional(),
  recommendation: z.enum(['accept', 'retry', 'escalate']),
  reasoning: z.string(),
});
export type QualityControlOutput = z.infer<typeof QualityControlOutputSchema>;

export interface QualityControlInput {
  agentName: string;
  attemptedOutput: unknown;
  expectedSchema: string;
  validationError?: string;
  context?: string;
}

export class QualityControlAgent extends BaseAgent<QualityControlInput, QualityControlOutput> {
  readonly name = 'QualityControlAgent';
  readonly systemPrompt = `You are a quality control auditor for AI agent outputs. You diagnose why an agent output failed validation or quality checks, attempt to repair it, and decide whether to accept, retry with better constraints, or escalate to a human. Always respond with valid JSON.`;

  async run(input: QualityControlInput, _ctx: AgentContext): Promise<QualityControlOutput> {
    return this.callStructured(
      [{
        role: 'user',
        content: `Audit this failed agent output and attempt repair.

Agent: ${input.agentName}
Validation Error: ${input.validationError ?? 'Unknown validation failure'}
Expected Schema: ${input.expectedSchema}
Context: ${input.context ?? 'No additional context'}

Failed Output:
${JSON.stringify(input.attemptedOutput, null, 2).slice(0, 2000)}

Analyze:
1. What fields are missing or malformed?
2. Can the output be repaired to match the schema?
3. Is this a model hallucination, truncation, or schema misunderstanding?

If repairable, provide correctedOutput. Otherwise recommend retry or escalate.`,
      }],
      QualityControlOutputSchema,
      { maxTokens: 3000 },
    );
  }

  static async audit(
    agentName: string,
    output: unknown,
    schemaDescription: string,
    validationError: string,
  ): Promise<QualityControlOutput> {
    const systemPrompt = `You are a QC auditor for AI outputs. Diagnose and repair. Respond only with valid JSON.`;
    return callAIStructured(
      [{
        role: 'user',
        content: `Agent "${agentName}" output failed validation: ${validationError}\n\nSchema: ${schemaDescription}\n\nOutput: ${JSON.stringify(output).slice(0, 1500)}\n\nAttempt repair if possible.`,
      }],
      QualityControlOutputSchema,
      { systemPrompt, maxTokens: 2000 },
    );
  }
}
