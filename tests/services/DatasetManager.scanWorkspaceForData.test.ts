import { describe, it, expect } from "vitest";
import { DatasetManager } from "../../src/renderer/services/analysis/DatasetManager";
import type {
	FilesystemAdapter,
	DirectoryEntry,
} from "../../src/renderer/utils/fs/FilesystemAdapter";

class MockFS implements FilesystemAdapter {
	private dirMap = new Map<string, DirectoryEntry[]>();
	private fileMap = new Map<string, string>();
	private infoMap = new Map<string, { isDirectory: boolean; size?: number }>();

	setDir(path: string, entries: DirectoryEntry[]) {
		this.dirMap.set(path, entries);
		this.infoMap.set(path, { isDirectory: true });
	}
	setFile(path: string, content: string) {
		this.fileMap.set(path, content);
		this.infoMap.set(path, { isDirectory: false, size: content.length });
	}

	async listDirectory(dirPath: string): Promise<DirectoryEntry[]> {
		return this.dirMap.get(dirPath) || [];
	}
	async getFileInfo(
		filePath: string
	): Promise<{ isDirectory: boolean; size?: number }> {
		const info = this.infoMap.get(filePath);
		if (!info) throw new Error(`No info for ${filePath}`);
		return info;
	}
	async readFile(filePath: string): Promise<string> {
		const v = this.fileMap.get(filePath);
		if (v == null) throw new Error(`No file: ${filePath}`);
		return v;
	}
}

describe("DatasetManager.scanWorkspaceForData", () => {
	it("detects 10x folders and CSV/TSV/VCF files", async () => {
		const fs = new MockFS();

		// Workspace layout
		fs.setDir("/ws", [
			{ name: "data", isDirectory: true, path: "/ws/data" },
			{ name: "notes.txt", isDirectory: false, path: "/ws/notes.txt" },
		]);
		fs.setFile("/ws/notes.txt", "misc");

		fs.setDir("/ws/data", [
			{ name: "pbmc10k", isDirectory: true, path: "/ws/data/pbmc10k" },
			{ name: "pbmc10k_h5", isDirectory: true, path: "/ws/data/pbmc10k_h5" },
			{ name: "multiome", isDirectory: true, path: "/ws/data/multiome" },
			{
				name: "single_cell.csv",
				isDirectory: false,
				path: "/ws/data/single_cell.csv",
			},
			{ name: "expr.tsv", isDirectory: false, path: "/ws/data/expr.tsv" },
			{
				name: "variants.vcf",
				isDirectory: false,
				path: "/ws/data/variants.vcf",
			},
		]);

		// Traditional 10x directory contents
		fs.setDir("/ws/data/pbmc10k", [
			{
				name: "matrix.mtx",
				isDirectory: false,
				path: "/ws/data/pbmc10k/matrix.mtx",
			},
			{
				name: "features.tsv",
				isDirectory: false,
				path: "/ws/data/pbmc10k/features.tsv",
			},
			{
				name: "barcodes.tsv",
				isDirectory: false,
				path: "/ws/data/pbmc10k/barcodes.tsv",
			},
		]);
		fs.setFile("/ws/data/pbmc10k/matrix.mtx", "%%MatrixMarket ...\n");
		fs.setFile("/ws/data/pbmc10k/features.tsv", "geneA\n");
		fs.setFile("/ws/data/pbmc10k/barcodes.tsv", "cell1\n");

		// 10x H5 directory contents
		fs.setDir("/ws/data/pbmc10k_h5", [
			{
				name: "filtered_feature_bc_matrix.h5",
				isDirectory: false,
				path: "/ws/data/pbmc10k_h5/filtered_feature_bc_matrix.h5",
			},
		]);
		fs.setFile(
			"/ws/data/pbmc10k_h5/filtered_feature_bc_matrix.h5",
			"HDF5 data"
		);

		// Another 10x H5 directory with different naming
		fs.setDir("/ws/data/multiome", [
			{
				name: "pbmc_granulocyte_sorted_3k_filtered_feature_bc_matrix.h5",
				isDirectory: false,
				path: "/ws/data/multiome/pbmc_granulocyte_sorted_3k_filtered_feature_bc_matrix.h5",
			},
		]);
		fs.setFile(
			"/ws/data/multiome/pbmc_granulocyte_sorted_3k_filtered_feature_bc_matrix.h5",
			"HDF5 data"
		);

		// Files
		fs.setFile("/ws/data/single_cell.csv", "cell_id,gene,counts\n1,A,10");
		fs.setFile("/ws/data/expr.tsv", "gene\tsample_1\tsample_2\nA\t1\t2");
		fs.setFile("/ws/data/variants.vcf", "##fileformat=VCFv4.2\n#CHROM POS ID");

		const dm = new DatasetManager(fs);
		const datasets = await dm.scanWorkspaceForData("/ws");

		// Traditional 10x matrix format
		const tenx = datasets.find((d) => d.localPath === "/ws/data/pbmc10k");
		expect(tenx?.fileFormat).toBe("10x_mtx");
		expect(tenx?.dataType).toBe("single_cell_expression");
		expect(tenx?.isLocalDirectory).toBe(true);

		// 10x H5 format
		const tenxH5 = datasets.find((d) => d.localPath === "/ws/data/pbmc10k_h5");
		expect(tenxH5?.fileFormat).toBe("10x_h5");
		expect(tenxH5?.dataType).toBe("single_cell_expression");
		expect(tenxH5?.isLocalDirectory).toBe(true);

		// Additional 10x H5 format
		const multiomeH5 = datasets.find(
			(d) => d.localPath === "/ws/data/multiome"
		);
		expect(multiomeH5?.fileFormat).toBe("10x_h5");
		expect(multiomeH5?.dataType).toBe("single_cell_expression");
		expect(multiomeH5?.isLocalDirectory).toBe(true);

		// CSV single-cell
		const csv = datasets.find(
			(d) => d.localPath === "/ws/data/single_cell.csv"
		);
		expect(csv?.fileFormat).toBe("csv");
		expect(csv?.dataType).toBe("single_cell_expression");

		// TSV expression matrix
		const tsv = datasets.find((d) => d.localPath === "/ws/data/expr.tsv");
		expect(tsv?.fileFormat).toBe("tsv");
		expect(tsv?.dataType).toBe("expression_matrix");

		// VCF variant data
		const vcf = datasets.find((d) => d.localPath === "/ws/data/variants.vcf");
		expect(vcf?.fileFormat).toBe("vcf");
		expect(vcf?.dataType).toBe("variant_data");
	});
});
