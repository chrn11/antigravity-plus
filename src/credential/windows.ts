/**
 * Windows Credential Manager implementation using keytar
 */

import keytar from 'keytar';
import type { CredentialManager } from './manager.js';

export class WindowsCredentialManager implements CredentialManager {
  async set(service: string, account: string, password: string): Promise<void> {
    await keytar.setPassword(service, account, password);
  }

  async get(service: string, account: string): Promise<string | null> {
    return await keytar.getPassword(service, account);
  }

  async delete(service: string, account: string): Promise<boolean> {
    return await keytar.deletePassword(service, account);
  }

  async list(service: string): Promise<string[]> {
    const credentials = await keytar.findCredentials(service);
    return credentials.map((credential) => credential.account);
  }
}
