import { BackendClient } from "../backend/BackendClient";
import { CodeGenerationService } from "../code/CodeGenerationService";
import { CodeQualityService } from "../code/CodeQualityService";
import { CellExecutionService } from "../notebook/CellExecutionService";
import { NotebookService } from "../notebook/NotebookService";
import { Dataset, CodeGenerationRequest } from "../types";

interface GenerateAndAddArgs {
  stepDescription: string;
  originalQuestion: string;
  datasets: Dataset[];
  workingDir: string;
  notebookPath: string;
}

/**
 * NotebookCodeGenerationService
 * - Dedicated service to generate, validate, and add notebook code cells
 * - Provides a clean API that both ChatPanel and AutonomousAgent can use
 */
export class NotebookCodeGenerationService {
  private backendClient: BackendClient;
  private codeGenerator: CodeGenerationService;
  private codeQualityService: CodeQualityService;
  private notebookService: NotebookService;
  private statusCallback?: (status: string) => void;

  // Global code context from the notebook/session to avoid duplicate imports/setup
  private globalCodeContext = new Map<string, string>();

  constructor(backendClient: BackendClient, workspacePath: string) {
    this.backendClient = backendClient;
    this.codeGenerator = new CodeGenerationService(backendClient);
    this.codeQualityService = new CodeQualityService(
      backendClient,
      new CellExecutionService(workspacePath) as any,
      this.codeGenerator as any
    );
    this.notebookService = new NotebookService({ workspacePath });
  }

  setStatusCallback(cb: (status: string) => void) {
    this.statusCallback = cb;
    this.codeQualityService.setStatusCallback(cb);
  }

  private updateStatus(message: string) {
    if (this.statusCallback) this.statusCallback(message);
  }

  private addCodeToContext(codeId: string, code: string): void {
    this.globalCodeContext.set(codeId, code);
  }

  private getGlobalCodeContext(): string {
    return Array.from(this.globalCodeContext.values()).join("\n\n");
  }

  private async seedContextFromNotebook(notebookPath: string): Promise<void> {
    try {
      const fileContent = await (window as any).electronAPI.readFile(notebookPath);
      const nb = JSON.parse(fileContent);
      if (Array.isArray(nb?.cells)) {
        let added = 0;
        for (let idx = 0; idx < nb.cells.length; idx++) {
          const c = nb.cells[idx];
          if (c?.cell_type !== "code") continue;
          const srcArr: string[] = Array.isArray(c.source) ? c.source : [];
          const code = srcArr.join("");
          if (code && code.trim().length > 0) {
            const id = `nb-cell-${idx}`;
            this.addCodeToContext(id, code);
            added++;
          }
        }
        if (added > 0) {
          this.updateStatus(`Loaded ${added} prior code cells into context`);
        }
      }
    } catch (e) {
      console.warn("NotebookCodeGenerationService: Failed to seed context:", e);
    }
  }

  private sanitizeNotebookPythonCode(code: string): string {
    try {
      const c = String(code || "");
      const needsArgvGuard = /argparse|parse_args\s*\(/.test(c) && !/sys\.argv\s*=/.test(c);
      if (needsArgvGuard) {
        const hasImportSys = /\bimport\s+sys\b/.test(c);
        const prefix = (hasImportSys ? "" : "import sys\n") + "sys.argv = ['']\n";
        return prefix + c;
      }
      return c;
    } catch (_) {
      return code;
    }
  }

  /**
   * Generate and validate code, then add as a new notebook cell.
   * Emits validation events after the cell is successfully added.
   */
  async generateAndAddValidatedCode(args: GenerateAndAddArgs): Promise<void> {
    const { stepDescription, originalQuestion, datasets, workingDir, notebookPath } = args;

    // Ensure global context is seeded from the notebook
    await this.seedContextFromNotebook(notebookPath);

    // Stable stepId so UI streams and validation align
    const stepId = `nbcg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    // Streamed generation with events
    const request: CodeGenerationRequest = {
      stepDescription,
      originalQuestion,
      datasets,
      workingDir,
      stepIndex: 0,
      globalCodeContext: this.getGlobalCodeContext(),
      stepId,
    };

    const genResult = await this.codeGenerator.generateCode(request);
    const generatedCode = genResult.code;
    this.addCodeToContext(stepId, generatedCode);

    // Validate and test (skip execution), collect result but do not emit events yet
    let validation;
    try {
      validation = await this.codeQualityService.validateAndTest(generatedCode, stepId, {
        stepTitle: stepDescription,
        skipExecution: true,
        globalCodeContext: this.getGlobalCodeContext(),
        skipValidationEvents: true,
      });
    } catch (e) {
      // Validation failed hard: emit error event immediately and stop
      try {
        (this.codeGenerator as any).emitValidationErrors(
          stepId,
          [e instanceof Error ? e.message : String(e)],
          [],
          generatedCode,
          generatedCode
        );
      } catch (_) {}
      throw e;
    }

    const bestCode = this.codeQualityService.getBestCode(validation);
    const finalCode = this.sanitizeNotebookPythonCode(bestCode);

    // Add validated code as notebook cell first
    await this.notebookService.addCodeCell(notebookPath, finalCode);

    // Now emit validation events for UI in the correct order
    const eventData = validation.validationEventData;
    if (eventData) {
      if (eventData.isValid) {
        if (typeof (this.codeGenerator as any).emitValidationSuccess === "function") {
          const message = `Code validation passed${eventData.wasFixed ? ' (fixes applied)' : ''}${eventData.warnings.length > 0 ? ` with ${eventData.warnings.length} warning(s)` : ''}`;
          // Use bestCode (unsanitized) for UI comparison, not finalCode (sanitized for notebook)
          (this.codeGenerator as any).emitValidationSuccess(stepId, message, bestCode);
        }
      } else {
        if (typeof (this.codeGenerator as any).emitValidationErrors === "function") {
          (this.codeGenerator as any).emitValidationErrors(
            stepId,
            eventData.errors,
            eventData.warnings,
            eventData.originalCode,
            eventData.lintedCode
          );
        }
      }
    }
  }
}

