import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ElectronClient before importing SUT
vi.mock('../../src/renderer/utils/ElectronClient', () => {
  return {
    ElectronClient: {
      directoryExists: vi.fn(async (p: string) => p.endsWith('/venv') ? false : true),
      createVirtualEnv: vi.fn(async (_: string) => ({ success: true })),
      installPackages: vi.fn(async (_: string, _pkgs: string[]) => ({ success: true })),
      startJupyter: vi.fn(async (_: string) => ({ success: true })),
      getFileInfo: vi.fn(),
      listDirectory: vi.fn(),
      readFile: vi.fn(),
      checkJupyterStatus: vi.fn(async () => true),
    },
  };
});

import { EnvironmentManager } from '../../src/renderer/services/notebook/EnvironmentManager';
import { DatasetManager } from '../../src/renderer/services/analysis/DatasetManager';
import { ElectronClient } from '../../src/renderer/utils/ElectronClient';

describe('EnvironmentManager.installRequiredPackages', () => {
  beforeEach(() => {
    // Minimal window shim for direct electronAPI usage
    (globalThis as any).window = {
      electronAPI: {
        directoryExists: vi.fn(async () => true),
        installPackages: vi.fn(async (_: string, __: string[]) => ({ success: true })),
        createVirtualEnv: vi.fn(async (_: string) => ({ success: true })),
      },
      dispatchEvent: () => {},
    };
  });

  it('scans workspace when datasets are empty and installs recommended packages', async () => {
    const dm = new DatasetManager();
    // Stub scanning result and recommendations
    vi.spyOn(DatasetManager.prototype as any, 'scanWorkspaceForData').mockResolvedValue([
      {
        id: 'local-1',
        title: 'pbmc10k',
        source: 'Local',
        localPath: '/ws/data/pbmc10k',
        isLocalDirectory: true,
        dataType: 'single_cell_expression',
        fileFormat: '10x_mtx',
      },
    ]);
    vi.spyOn(DatasetManager.prototype as any, 'analyzeDataTypesAndSelectTools').mockResolvedValue({
      dataTypes: ['single_cell_expression'],
      recommendedTools: ['scanpy', 'anndata', 'numpy'],
      analysisApproaches: [],
      dataComplexity: 'moderate',
      suggestedApproach: 'standard',
      estimatedCells: 1,
    });

    const env = new EnvironmentManager(dm);
    const res = await env.installRequiredPackages([], '/ws');
    expect(res.success).toBe(true);

    // Ensure window.electronAPI.installPackages was called with the recommended tools
    const calls = ((globalThis as any).window.electronAPI.installPackages as any).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const [_workspace, pkgs] = calls[0];
    expect(pkgs).toEqual(expect.arrayContaining(['scanpy', 'anndata', 'numpy']));
  });
});
