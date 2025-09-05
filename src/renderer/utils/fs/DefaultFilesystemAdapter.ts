import { FilesystemAdapter, DirectoryEntry } from './FilesystemAdapter';
import { ElectronClient } from '../ElectronClient';

export class DefaultFilesystemAdapter implements FilesystemAdapter {
  async listDirectory(dirPath: string): Promise<DirectoryEntry[]> {
    return await ElectronClient.listDirectory(dirPath);
  }
  async getFileInfo(filePath: string): Promise<{
    size?: number;
    created?: string | Date;
    modified?: string | Date;
    isDirectory: boolean;
  }> {
    return await ElectronClient.getFileInfo(filePath);
  }
  async readFile(filePath: string): Promise<string> {
    return await ElectronClient.readFile(filePath);
  }
}

