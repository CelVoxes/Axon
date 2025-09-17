import { describe, it, expect } from 'vitest';
import { DatasetManager } from '../../src/renderer/services/analysis/DatasetManager';
import type { FilesystemAdapter, DirectoryEntry } from '../../src/renderer/utils/fs/FilesystemAdapter';

class MockFS implements FilesystemAdapter {
  private files = new Map<string, string>();
  private dirs = new Map<string, DirectoryEntry[]>();
  private info = new Map<string, { isDirectory: boolean; size?: number }>();

  setFile(p: string, c: string) {
    this.files.set(p, c);
    this.info.set(p, { isDirectory: false, size: c.length });
  }

  setDir(p: string, entries: DirectoryEntry[]) {
    this.dirs.set(p, entries);
    this.info.set(p, { isDirectory: true });
  }

  async listDirectory(p: string) {
    return this.dirs.get(p) || [];
  }

  async getFileInfo(p: string) {
    const entry = this.info.get(p);
    if (!entry) throw new Error(`No info for ${p}`);
    return entry;
  }

  async readFile(p: string) {
    const content = this.files.get(p);
    if (content == null) throw new Error(`No file for ${p}`);
    return content;
  }
}

describe('DatasetManager data/type detection', () => {
  it('prefers directory.tenx metadata when present', async () => {
    const fs = new MockFS();
    const dm = new DatasetManager(fs);

    const datasets = [
      {
        id: 'tenx-local',
        title: 'example_data',
        localPath: '/workspace/example_data',
        directory: {
          contains: ['matrix.mtx', 'genes.tsv', 'barcodes.tsv'],
          tenx: { matrix_mtx: true, features_genes: true, barcodes: true },
        },
      } as any,
    ];

    const analysis = await dm.analyzeDataTypesAndSelectTools(datasets, '/workspace');
    expect(analysis.dataTypes).toEqual(['single_cell_expression']);
    expect(analysis.recommendedTools).toContain('scanpy');
    expect(analysis.recommendedTools).toContain('leidenalg');
  });

  it('walks filtered_feature_bc_matrix directories when metadata is missing', async () => {
    const fs = new MockFS();
    fs.setDir('/workspace/example_data', [
      {
        name: 'filtered_feature_bc_matrix',
        isDirectory: true,
        path: '/workspace/example_data/filtered_feature_bc_matrix',
      },
    ]);
    fs.setDir('/workspace/example_data/filtered_feature_bc_matrix', [
      {
        name: 'matrix.mtx',
        isDirectory: false,
        path: '/workspace/example_data/filtered_feature_bc_matrix/matrix.mtx',
      },
      {
        name: 'barcodes.tsv',
        isDirectory: false,
        path: '/workspace/example_data/filtered_feature_bc_matrix/barcodes.tsv',
      },
      {
        name: 'features.tsv',
        isDirectory: false,
        path: '/workspace/example_data/filtered_feature_bc_matrix/features.tsv',
      },
    ]);

    const dm = new DatasetManager(fs);
    const datasets = [
      {
        id: 'tenx-nested',
        title: 'Example filtered matrix',
        localPath: '/workspace/example_data',
      } as any,
    ];

    const analysis = await dm.analyzeDataTypesAndSelectTools(datasets, '/workspace');
    expect(analysis.dataTypes).toEqual(['single_cell_expression']);
    expect(analysis.recommendedTools).toContain('scanpy');
  });
});
