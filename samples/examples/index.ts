import chat from "./01-chat.ts";
import toolCall from "./02-tool-call.ts";
import streaming from "./03-streaming.ts";
import multiStep from "./04-multi-step.ts";
import conversation from "./05-conversation.ts";
import structuredOutput from "./06-structured-output.ts";
import errorRecovery from "./07-error-recovery.ts";
import evalBasics from "./08-eval-basics.ts";
import customChecks from "./09-eval-custom-checks.ts";
import benchModels from "./10-bench-models.ts";

/** Add an example: write the file, add one line here. */
export const examples: Record<string, () => Promise<void>> = {
  "01-chat": chat,
  "02-tool-call": toolCall,
  "03-streaming": streaming,
  "04-multi-step": multiStep,
  "05-conversation": conversation,
  "06-structured-output": structuredOutput,
  "07-error-recovery": errorRecovery,
  "08-eval-basics": evalBasics,
  "09-eval-custom-checks": customChecks,
  "10-bench-models": benchModels,
};
