import { BackendClient } from "../backend/BackendClient";
import { ConfigManager } from "../backend/ConfigManager";
import { CodeGenerationService } from "../code/CodeGenerationService";
import { CodeQualityService } from "../code/CodeQualityService";
import { CellExecutionService } from "../notebook/CellExecutionService";
import { NotebookService } from "../notebook/NotebookService";
import { EnvironmentManager } from "../notebook/EnvironmentManager";
import { DatasetManager } from "../analysis/DatasetManager";
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
  private environmentManager: EnvironmentManager;
  private statusCallback?: (status: string) => void;
  private workspacePath: string;

  // Global code context from the notebook/session to avoid duplicate imports/setup
  private globalCodeContext = new Map<string, string>();

  constructor(backendClient: BackendClient, workspacePath: string, sessionId?: string) {
    this.backendClient = backendClient;
    this.workspacePath = workspacePath;
    this.codeGenerator = new CodeGenerationService(
      backendClient,
      ConfigManager.getInstance().getDefaultModel(),
      sessionId
    );
    this.codeQualityService = new CodeQualityService(
      backendClient,
      new CellExecutionService(workspacePath) as any,
      this.codeGenerator as any
    );
    this.notebookService = new NotebookService({ workspacePath });
    this.environmentManager = new EnvironmentManager(new DatasetManager());
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

  // Extract pip/conda packages suggested by LLM code snippets
  private extractPackagesFromCode(code: string): string[] {
    const pkgs = new Set<string>();
    try {
      const c = String(code || "");
      // Match lines like: pip install a b c  OR  %pip install a b  OR  python -m pip install a b
      const installRe = /(\%?pip|python\s+-m\s+pip)\s+install\s+([^\n;#]+)/gi;
      let m: RegExpExecArray | null;
      while ((m = installRe.exec(c)) !== null) {
        const raw = m[2] || "";
        raw
          .split(/\s+/)
          .map((t) => t.trim())
          .filter((t) => !!t && !t.startsWith("-") && !t.startsWith("#"))
          .forEach((t) => pkgs.add(t));
      }
      // Match subprocess style: subprocess.check_call([... 'pip', 'install', 'a', 'b'])
      const subprocRe = /subprocess\.(?:check_call|run)\([^\)]*?([\[\(][^\]\)]+[\]\)])\)/gi;
      const arrayTokenRe = /['\"]([^'\"]+)['\"]/g;
      while ((m = subprocRe.exec(c)) !== null) {
        const list = m[1] || "";
        const tokens: string[] = [];
        let tm: RegExpExecArray | null;
        while ((tm = arrayTokenRe.exec(list)) !== null) {
          tokens.push(tm[1]);
        }
        const pipIdx = tokens.findIndex((t) => t.toLowerCase() === "pip");
        const installIdx = tokens.findIndex((t) => t.toLowerCase() === "install");
        if (pipIdx >= 0 && installIdx > pipIdx) {
          const pkgTokens = tokens.slice(installIdx + 1);
          pkgTokens
            .filter((t) => !!t && !t.startsWith("-"))
            .forEach((t) => pkgs.add(t));
        }
      }
    } catch (_) {}
    return Array.from(pkgs);
  }

  private buildInstallCellCode(packages: string[]): string {
    const unique = Array.from(new Set(packages)).filter(Boolean).sort((a, b) => a.localeCompare(b));
    return [
      "# Install required packages as a single pip transaction for consistent dependency resolution",
      "import subprocess",
      "import sys",
      "",
      `required_packages = ${JSON.stringify(unique)}`,
      "",
      'print("Installing required packages as one pip call...")',
      "try:",
      '    subprocess.check_call([sys.executable, "-m", "pip", "install", *required_packages])',
      '    print("✓ All packages installed")',
      "except subprocess.CalledProcessError:",
      '    print("⚠ Failed to install one or more packages")',
      "",
      "# Optional: verify dependency conflicts",
      "try:",
      '    subprocess.check_call([sys.executable, "-m", "pip", "check"])  # verifies dependency conflicts',
      '    print("Dependency check passed")',
      "except subprocess.CalledProcessError:",
      '    print("⚠ Dependency conflicts detected")',
    ].join("\n");
  }

  private buildRSetupCellCode(): string {
    return [
      "# R setup: install required packages for Seurat v5 workflow",
      "# This cell installs missing packages and attempts to register IRkernel",
      "req <- c('Seurat','SeuratObject','Matrix','uwot','RANN','data.table','readr')",
      "missing <- req[!sapply(req, requireNamespace, quietly = TRUE)]",
      "if (length(missing) > 0) {",
      "  if (is.null(getOption('repos')) || is.na(getOption('repos')['CRAN']) || getOption('repos')['CRAN'] == '') {",
      "    options(repos = c(CRAN = 'https://cloud.r-project.org'))",
      "  }",
      "  message('Installing missing packages: ', paste(missing, collapse=', '))",
      "  try(install.packages(missing, Ncpus = max(1L, parallel::detectCores() - 1L)), silent = FALSE)",
      "}",
      "# Try to ensure IRkernel is available for Jupyter",
      "if (!requireNamespace('IRkernel', quietly = TRUE)) {",
      "  message('IRkernel not installed. To enable R in Jupyter, run: install.packages(\"IRkernel\"); IRkernel::installspec(user=TRUE) then restart Jupyter.')",
      "} else {",
      "  try(IRkernel::installspec(user = TRUE), silent = TRUE)",
      "}",
      "invisible(lapply(req, function(p) try(library(p, character.only = TRUE), silent = TRUE)))",
    ].join("\n");
  }

  private async isDuplicateCell(notebookPath: string, code: string): Promise<boolean> {
    try {
      const nb = await this.notebookService.readNotebook(notebookPath);
      const normalize = (s: string) => String(s || "").replace(/\s+/g, " ").trim();
      const target = normalize(code);
      for (const cell of nb.cells || []) {
        if (cell?.cell_type !== 'code') continue;
        const srcArr: string[] = Array.isArray(cell.source) ? cell.source : [];
        const cellCode = srcArr.join("");
        if (normalize(cellCode) === target) return true;
      }
    } catch (_) {}
    return false;
  }

  private async ensureRSetupCell(
    notebookPath: string,
    datasets: Dataset[]
  ): Promise<void> {
    try {
      // Only for spectral flow datasets
      const isSpectralFlow = Array.isArray(datasets) && datasets.some((d: any) => String((d?.dataType || '')).toLowerCase() === 'spectral_flow_cytometry');
      if (!isSpectralFlow) return;

      const notebookContent = await this.notebookService.readNotebook(notebookPath);
      const existingCode = notebookContent.cells
        .filter(cell => cell.cell_type === 'code')
        .map(cell => Array.isArray(cell.source) ? cell.source.join('') : String(cell.source || ''))
        .join('\n');

      const hasRSetup = /(install\.packages\(|library\(Seurat\)|Seurat::)/i.test(existingCode);
      if (hasRSetup) return;

      // Add a short markdown guidance cell
      const md = [
        '### R kernel and Seurat setup',
        '',
        "This notebook includes R code for spectral flow using Seurat v5 (sketch).",
        "If you see an error like 'Failed to create R kernel', install IRkernel in R:",
        '1. Open an R session',
        "2. Run: `install.packages('IRkernel')`",
        "3. Run: `IRkernel::installspec(user=TRUE)`",
        '4. Restart Jupyter from Axon',
      ].join('\n');
      await this.notebookService.addMarkdownCell(notebookPath, md);

      // Add R setup cell (install packages, attempt IRkernel registration)
      const rSetup = this.buildRSetupCellCode();
      await this.notebookService.addCodeCell(notebookPath, rSetup);
    } catch (error) {
      console.warn('ensureRSetupCell failed:', error);
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

    // If datasets indicate spectral flow cytometry, steer generation to R/Seurat
    const isSpectralFlow = Array.isArray(datasets) && datasets.some((d: any) => String((d?.dataType || "")).toLowerCase() === "spectral_flow_cytometry");
    if (isSpectralFlow) {
      (request as any).language = "r";
    }

    const genResult = await this.codeGenerator.generateCode(request);
    const generatedCode = genResult.code;
    this.addCodeToContext(stepId, generatedCode);

    if (isSpectralFlow) {
      // For R/Seurat cells, ensure an R setup cell exists, then add generated code directly
      await this.ensureRSetupCell(notebookPath, datasets);
      await this.notebookService.addCodeCell(notebookPath, generatedCode);
      if (typeof (this.codeGenerator as any).emitValidationSuccess === "function") {
        (this.codeGenerator as any).emitValidationSuccess(stepId, "Generated R (Seurat) code added without Python linting", generatedCode);
      }
      return;
    }

    // Validate and test (skip execution), collect result but do not emit events yet (Python path)
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
    let finalCode = this.sanitizeNotebookPythonCode(bestCode);

    // Final safety: strip duplicate imports vs global context to avoid repetition across cells
    try {
      const { getExistingImports, removeDuplicateImports } = await import("../../utils/ImportUtils");
      const existing = getExistingImports(this.getGlobalCodeContext());
      finalCode = removeDuplicateImports(finalCode, existing);
    } catch (_) {}

    // Extract any package hints from the generated code
    const llmSuggestedPkgs = this.extractPackagesFromCode(generatedCode);

    // Check if we need to add package installation cell first (Python path only)
    await this.ensurePackageInstallationCell(notebookPath, datasets, llmSuggestedPkgs);

    // Skip adding cell if it already exists verbatim
    if (await this.isDuplicateCell(notebookPath, finalCode)) {
      try {
        (this.codeGenerator as any).emitValidationSuccess(
          stepId,
          "Skipped adding duplicate cell (already present in notebook)",
          bestCode
        );
      } catch (_) {}
      return;
    }

    // Add validated code as notebook cell
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

  /**
   * Ensure that a package installation cell is added to the notebook if needed.
   * This should be called before adding any code cells to ensure dependencies are available.
   */
  private async ensurePackageInstallationCell(
    notebookPath: string,
    datasets: Dataset[],
    llmSuggestedPkgs?: string[]
  ): Promise<void> {
    try {
      console.log('🔍 ensurePackageInstallationCell called with:', { notebookPath, datasets: datasets.length });
      
      // Check if the notebook already has a package installation cell
      // by looking for pip install commands in existing cells
      const notebookContent = await this.notebookService.readNotebook(notebookPath);
      const existingCode = notebookContent.cells
        .filter(cell => cell.cell_type === 'code')
        .map(cell => Array.isArray(cell.source) ? cell.source.join('') : String(cell.source || ''))
        .join('\n');

      // Robust detection for existing install logic (pip/conda or python -m pip)
      const installRegex = /(\b%?pip\s+install\b|\b%?conda\s+install\b)/i;
      const pipModuleRegex = /sys\.executable[\s\S]*?"-m"[\s\S]*?"pip"[\s\S]*?"install"/i;
      const subprocessPipRegex = /subprocess\.(check_call|run)\([^\)]*"pip"[^\)]*"install"/i;
      const hasInstall =
        installRegex.test(existingCode) || pipModuleRegex.test(existingCode) || subprocessPipRegex.test(existingCode);

      console.log('📖 Existing notebook has install step:', hasInstall);

      // If package installation already exists, skip
      if (hasInstall) {
        console.log('⏭️ Skipping package installation - already exists in notebook');
        return;
      }

      // Generate package installation code
      console.log('🔧 Generating package installation code...');
      const packageInstallCode = await this.environmentManager.generatePackageInstallationCode(
        datasets,
        [],
        this.workspacePath
      );

      // Merge environment-derived packages with any LLM-suggested ones (if env code empty)
      let finalInstallCode = packageInstallCode && packageInstallCode.trim().length > 0
        ? packageInstallCode
        : undefined;

      if (!finalInstallCode && Array.isArray(llmSuggestedPkgs) && llmSuggestedPkgs.length > 0) {
        console.log('📦 Falling back to LLM-suggested packages for install cell:', llmSuggestedPkgs);
        finalInstallCode = this.buildInstallCellCode(llmSuggestedPkgs);
      }

      if (finalInstallCode && finalInstallCode.trim().length > 0) {
        console.log('➕ Adding package installation cell to notebook');
        await this.notebookService.addCodeCell(notebookPath, finalInstallCode);
        console.log('✅ Package installation cell added successfully');
      } else {
        console.log('❌ No package installation code generated');
      }
    } catch (error) {
      // Don't fail the main operation if package installation fails
      console.warn('Failed to ensure package installation cell:', error);
    }
  }
}
