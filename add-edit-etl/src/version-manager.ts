import { BaseVersionManager } from 'jimu-core'

class VersionManager extends BaseVersionManager {
  versions = []
}

export const versionManager: BaseVersionManager = new VersionManager()
