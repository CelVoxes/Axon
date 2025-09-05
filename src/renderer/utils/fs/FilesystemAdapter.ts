export type DirectoryEntry = { name: string; isDirectory: boolean; path: string };

export interface FilesystemAdapter {
  listDirectory(dirPath: string): Promise<DirectoryEntry[]>;
  getFileInfo(filePath: string): Promise<{
    size?: number;
    created?: string | Date;
    modified?: string | Date;
    isDirectory: boolean;
  }>;
  readFile(filePath: string): Promise<string>;
}

