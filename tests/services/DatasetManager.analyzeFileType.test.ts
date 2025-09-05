import { describe, it, expect } from 'vitest';
import { DatasetManager } from '../../src/renderer/services/analysis/DatasetManager';
import type { FilesystemAdapter, DirectoryEntry } from '../../src/renderer/utils/fs/FilesystemAdapter';

class MockFS implements FilesystemAdapter {
  private files = new Map<string, string>();
  private dirs = new Map<string, DirectoryEntry[]>();
  private info = new Map<string, { isDirectory: boolean; size?: number }>();
  setFile(p: string, c: string) { this.files.set(p, c); this.info.set(p, { isDirectory: false, size: c.length }); }
  setDir(p: string, entries: DirectoryEntry[]) { this.dirs.set(p, entries); this.info.set(p, { isDirectory: true }); }
  async listDirectory(p: string) { return this.dirs.get(p) || []; }
  async getFileInfo(p: string) { const i = this.info.get(p); if (!i) throw new Error('no info'); return i; }
  async readFile(p: string) { const v = this.files.get(p); if (v == null) throw new Error('no file'); return v; }
}

describe('DatasetManager.analyzeFileType', () => {
  it('classifies CSV single-cell vs expression matrix via headers', async () => {
    const fs = new MockFS();
    fs.setFile('/data/single_cell.csv', 'cell_id,gene,counts\n1,A,10');
    fs.setFile('/data/expr.tsv', 'gene\tsample_1\tsample_2\nA\t1\t2');

    const dm = new DatasetManager(fs);
    const sc = await dm.analyzeFileType('/data/single_cell.csv');
    expect(sc.format).toBe('csv');
    expect(sc.dataType).toBe('single_cell_expression');

    const em = await dm.analyzeFileType('/data/expr.tsv');
    expect(em.format).toBe('tsv');
    expect(em.dataType).toBe('expression_matrix');
  });

  it('classifies VCF/BAM/FASTQ by extension', async () => {
    const fs = new MockFS();
    fs.setFile('/data/reads.fastq', '@r1\nACGT');
    fs.setFile('/data/aln.bam', 'BAM\u0001');
    fs.setFile('/data/variants.vcf', '##fileformat=VCFv4.2');

    const dm = new DatasetManager(fs);
    expect((await dm.analyzeFileType('/data/reads.fastq')).dataType).toBe('sequence_data');
    expect((await dm.analyzeFileType('/data/aln.bam')).dataType).toBe('alignment_data');
    expect((await dm.analyzeFileType('/data/variants.vcf')).dataType).toBe('variant_data');
  });
});

