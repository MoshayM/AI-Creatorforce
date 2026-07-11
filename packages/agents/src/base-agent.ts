import { callAI, callAIStructured, type AIMessage, type AICallOptions } from '@cf/shared';
import { z } from 'zod';

export interface AgentContext {
  jobId: string;
  projectId: string;
  userId: string;
}

export abstract class BaseAgent<TInput, TOutput> {
  abstract readonly name: string;
  abstract readonly systemPrompt: string;

  abstract run(input: TInput, ctx: AgentContext): Promise<TOutput>;

  protected async callAI(messages: AIMessage[], opts?: AICallOptions) {
    return callAI(messages, { ...opts, systemPrompt: this.systemPrompt });
  }

  protected async callStructured<T>(
    messages: AIMessage[],
    // Input type left open (mirrors callAIStructured) so schemas with
    // .default()/.transform() infer T from their OUTPUT type.
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    opts?: AICallOptions,
  ): Promise<T> {
    return callAIStructured(messages, schema, { ...opts, systemPrompt: this.systemPrompt });
  }
}
