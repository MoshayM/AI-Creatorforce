import { BaseAgent, type AgentContext } from './base-agent';
import { ComplianceResultSchema, mustPassCompliance, type ComplianceResult } from '@cf/shared';

export interface ComplianceInput {
  title: string;
  script: string;
  description?: string;
  tags?: string[];
}

export class ComplianceAgent extends BaseAgent<ComplianceInput, ComplianceResult> {
  readonly name = 'ComplianceAgent';
  readonly systemPrompt = `You are a strict YouTube content compliance auditor. Analyze content for: copyright issues, misinformation, hate speech, violence, adult content, spam, impersonation, privacy violations, and advertiser-friendliness. Be thorough and conservative. A score below 70 means NOT passed. BLOCK severity flags mean the content CANNOT be published regardless of score. Respond only with valid JSON matching the schema.`;

  async run(input: ComplianceInput, _ctx: AgentContext): Promise<ComplianceResult> {
    const result = await this.callStructured(
      [{
        role: 'user',
        content: `Perform a full compliance audit of this YouTube video content:\n\nTitle: ${input.title}\n\nScript:\n${input.script}\n\nDescription: ${input.description ?? 'N/A'}\n\nTags: ${input.tags?.join(', ') ?? 'N/A'}`,
      }],
      ComplianceResultSchema,
      { maxTokens: 2048 },
    );

    // Compliance is a hard gate — throws if content fails or any BLOCK flag is present.
    // This cannot be bypassed.
    mustPassCompliance(result);

    return result;
  }
}
